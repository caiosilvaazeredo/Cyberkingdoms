import { TIMES, type Time } from '../shared/regras';
import type { FichaDeJogador } from '../shared/protocolo';
import {
  PADROES,
  carregarAjustes,
  salvarAjustes,
  type Ajustes,
  type Lado,
  type Visao,
} from './ajustes';
import { MAXIMO_LOCAL, rotuloDaFonte, type IdDeFonte } from './controles';
import { COR_DA_VAGA } from './desenho';
import type { Modo } from './sofa';

/**
 * As telas fora do jogo: menu, cabine do sofá, espera e escolha de lado.
 *
 * ## O menu não tem fundo — o fundo é o jogo
 *
 * Os botões ocupam uma coluna à esquerda e mais nada: o resto da tela é o
 * `canvas` desenhando **uma partida de verdade**, ao vivo, com os bots que
 * estariam jogando de qualquer jeito. É o modo atração do fliperama, e responde
 * antes de a pessoa perguntar as duas coisas que ela quer saber ao abrir um
 * jogo em rede: como ele é, e se tem alguém jogando.
 *
 * ## Por que a coluna, e não a barra
 *
 * Uma coluna de botões gordos, cada um da sua cor, ordena as intenções de cima
 * para baixo — jogar no sofá, jogar com o mundo, aprender, ver — e deixa o
 * campo de batalha inteiro visível ao lado. Uma barra no rodapé faz o oposto:
 * espalha os itens em fila, dá o mesmo peso a todos e ainda corta a parte de
 * baixo do jogo.
 *
 * ## Por que em HTML, e não no `canvas`
 *
 * O campo de batalha é desenhado à mão porque precisa ser. Um menu não precisa.
 * Em HTML ele ganha de graça o que no `canvas` custaria semanas — foco de
 * teclado, rolagem, leitor de tela, caixa de texto que funciona no teclado do
 * celular — e o CSS faz o enquadramento responsivo sozinho.
 *
 * ## Um lugar só para os ajustes
 *
 * Os ajustes moram aqui e são gravados no `localStorage` a cada clique. Não há
 * botão de "salvar": um jogo que perde o ajuste porque o jogador fechou a aba
 * antes de confirmar é um jogo que ensinou o jogador a desconfiar do menu.
 */

export type NomeDaTela = 'menu' | 'cabine' | 'carregando' | 'escolha' | 'jogo' | 'plateia';

export interface AcoesDasTelas {
  /**
   * Abrir a cabine para montar o sofá.
   *
   * @param modo `local` abre uma sala reservada ao aparelho; `online` entra na
   * sala mais movimentada, junto com quem estiver na rede. Nos dois, cabem até
   * quatro pessoas aqui.
   */
  jogar(modo: Modo): void;
  /** O jogador quer só assistir, sem o menu por cima. */
  assistir(): void;
  /** O jogador confirmou o lado, e o sofá inteiro vai para ele. */
  escolher(time: Time): void;
  /** Desistiu da cabine e voltou ao menu: as conexões extras podem fechar. */
  desistir(): void;
  /** Um ajuste mudou. Chamada a cada clique, já com o valor novo. */
  ajustou(ajustes: Ajustes): void;
}

/** O que a cabine mostra: quem já sentou e o que ainda está livre. */
export interface DadosDaCabine {
  sentados: { vaga: number; nome: string; fonte: IdDeFonte }[];
  /** Fontes ligadas e ainda livres, com o que apertar para entrar. */
  livres: { fonte: IdDeFonte; rotulo: string; comoEntrar: string }[];
}

export interface DadosDaEscolha {
  porTime: number;
  elenco: FichaDeJogador[];
  placar: Record<Time, number>;
  /** Segundos restantes da partida em curso. */
  relogio: number;
  /** Quantas pessoas do sofá vão entrar juntas neste lado. */
  quantosLocais: number;
}

export interface EstadoDoServidor {
  ligado: boolean;
  sala: string;
  jogadores: number;
  bots: number;
  ping: number;
  /** Mensagem que substitui o resto quando algo deu errado. */
  aviso?: string;
}

/** Conselhos que giram na tela de espera. */
const CONSELHOS: readonly string[] = [
  'Cada fatia que você dá à refém alivia a sua princesa do outro lado do mapa. O peso do reino não muda: muda de prato.',
  'Princesa acima de 120 exige três carregadores. Sem escolta, o cortejo não sai do lugar.',
  'Carne só vem de bicho abatido. Caçador derruba uma ovelha em três golpes; um guerreiro leva o dobro do tempo.',
  'Madeira e ouro sobem a obra da chapelaria, e a obra dá vida e dano a todo o time — inclusive a quem nunca minerou.',
  'Chapéu cai no chão quando o dono morre. Se você matar o arqueiro deles, o arco pode voltar para casa na sua cabeça.',
  'O bolo longe da masmorra é comida: cura quarenta e cinco.',
  'Empate no tempo? Ganha o reino cuja princesa está mais leve. A balança é o desempate.',
  'Trabalhar na jazida cancela se você andar. Ofício é o momento em que se está indefeso.',
  'No aquecimento a chapelaria já está aberta. É para isso que ele existe.',
];

export class Telas {
  private readonly menu = pegar<HTMLElement>('#menu');
  private readonly cabine = pegar<HTMLElement>('#cabine');
  private readonly carregando = pegar<HTMLElement>('#carregando');
  private readonly escolha = pegar<HTMLElement>('#escolha');
  private readonly plateia = pegar<HTMLElement>('#plateia');
  private readonly campoNome = pegar<HTMLInputElement>('#nome');
  private readonly vagasDoSofa = pegar<HTMLElement>('#vagas-sofa');
  private readonly recadoDaCabine = pegar<HTMLElement>('#cabine-recado');
  private readonly seguirDaCabine = pegar<HTMLButtonElement>('#cabine-seguir');
  private readonly recado = pegar<HTMLElement>('#recado');
  private readonly progresso = pegar<HTMLElement>('#progresso');
  private readonly etapa = pegar<HTMLElement>('#etapa');
  private readonly conselho = pegar<HTMLElement>('#conselho');
  private readonly status = pegar<HTMLElement>('#escolha-status');
  private readonly confirmar = pegar<HTMLButtonElement>('#confirmar');
  private readonly estadoServidor = pegar<HTMLElement>('#estado-servidor');
  private readonly pulso = pegar<HTMLElement>('#pulso');

  private tela: NomeDaTela = 'menu';
  private ladoEscolhido: Time = 'azul';
  private ajustes: Ajustes;
  private ultimosDados: DadosDaEscolha | null = null;
  /** Qual botão do menu abriu a cabine. Decide a sala lá na hora de conectar. */
  private modo: Modo = 'online';

  constructor(private readonly acoes: AcoesDasTelas) {
    this.ajustes = carregarAjustes();
    this.campoNome.value = this.ajustes.nome;

    this.ligarBarra();
    this.ligarCabine();
    this.montarAjustes();

    this.campoNome.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.pedirParaJogar('online');
    });
    this.campoNome.addEventListener('input', () => {
      this.ajustes = { ...this.ajustes, nome: this.campoNome.value.slice(0, 16) };
      salvarAjustes(this.ajustes);
    });

    for (const lado of Array.from(document.querySelectorAll<HTMLElement>('.lado'))) {
      lado.addEventListener('click', () => {
        this.ladoEscolhido = lado.dataset.time === 'vermelho' ? 'vermelho' : 'azul';
        this.pintarEscolha();
      });
      lado.addEventListener('dblclick', () => this.confirmarLado());
    }
    this.confirmar.addEventListener('click', () => this.confirmarLado());

    window.addEventListener('keydown', (e) => {
      // O teclado das telas só escuta quando elas estão à frente: senão o `A`
      // de andar viraria "trocar de lado" no meio de uma partida.
      if (this.tela === 'cabine') {
        // Nada de Enter aqui: `Enter` é o botão de entrar do segundo teclado, e
        // o laço de quadro é quem escuta as fontes. Escuta-se só a desistência.
        if (e.code === 'Escape') this.sairDaCabine();
        return;
      }
      if (this.tela === 'escolha') {
        if (e.code === 'KeyA' || e.code === 'ArrowLeft') {
          this.ladoEscolhido = 'azul';
          this.pintarEscolha();
        } else if (e.code === 'KeyD' || e.code === 'ArrowRight') {
          this.ladoEscolhido = 'vermelho';
          this.pintarEscolha();
        } else if (e.code === 'Enter' || e.code === 'Space') {
          e.preventDefault();
          this.confirmarLado();
        } else if (e.code === 'Escape') {
          this.mostrar('menu');
        }
        return;
      }
      if (this.tela === 'plateia' && e.code === 'Escape') {
        this.mostrar('menu');
        return;
      }
      if (this.tela === 'menu' && e.code === 'Escape') this.fecharFolhas();
    });
  }

  get atual(): NomeDaTela {
    return this.tela;
  }

  get preferencias(): Ajustes {
    return this.ajustes;
  }

  /** Se a cabine está na frente. O laço de quadro só escuta as fontes aí. */
  get montandoOSofa(): boolean {
    return this.tela === 'cabine';
  }

  /** O botão que abriu a cabine: decide se a sala é reservada ou pública. */
  get modoEscolhido(): Modo {
    return this.modo;
  }

  mostrar(nome: NomeDaTela): void {
    this.tela = nome;
    alternar(this.menu, nome === 'menu');
    alternar(this.cabine, nome === 'cabine');
    alternar(this.carregando, nome === 'carregando');
    alternar(this.escolha, nome === 'escolha');
    this.plateia.hidden = nome !== 'plateia';
    if (nome === 'carregando') {
      this.conselho.textContent =
        CONSELHOS[Math.floor(Math.random() * CONSELHOS.length)] ?? CONSELHOS[0]!;
    }
    if (nome === 'escolha') this.pintarEscolha();
  }

  /** Mensagem do painel de apelido — recusa, queda de conexão, o que for. */
  avisar(texto: string): void {
    this.recado.textContent = texto;
    if (texto) this.abrirFolha('apelido');
  }

  /** A linha da direita na barra: se há servidor, e quanta gente tem lá. */
  atualizarEstado(e: EstadoDoServidor): void {
    this.pulso.classList.toggle('vivo', e.ligado);
    this.estadoServidor.textContent = e.aviso
      ? e.aviso
      : e.ligado
        ? `${e.sala} · ${e.jogadores} jogando, ${e.bots} bots · ${e.ping} ms`
        : 'procurando o servidor…';
  }

  /** Progresso do carregamento da arte, de 0 a 1, com o rótulo da etapa. */
  carregou(fracao: number, rotulo: string): void {
    this.progresso.style.width = `${Math.round(Math.max(0, Math.min(1, fracao)) * 100)}%`;
    this.etapa.textContent = rotulo;
  }

  /** Atualiza os painéis dos dois lados com o elenco que o servidor mandou. */
  atualizarEscolha(dados: DadosDaEscolha): void {
    this.ultimosDados = dados;
    if (this.tela === 'escolha') this.pintarEscolha();
  }

  private pedirParaJogar(modo: Modo): void {
    const nome = this.campoNome.value.trim() || 'Anônimo';
    this.ajustes = { ...this.ajustes, nome };
    salvarAjustes(this.ajustes);
    this.recado.textContent = '';
    this.fecharFolhas();
    this.modo = modo;
    this.acoes.jogar(modo);
  }

  private confirmarLado(): void {
    this.acoes.escolher(this.ladoEscolhido);
  }

  private ligarBarra(): void {
    const entrar = (modo: Modo) => () => {
      // Sem apelido guardado, o primeiro clique abre a folha para escrever um;
      // com apelido, vai direto para a cabine.
      if (!this.ajustes.nome.trim()) {
        this.modo = modo;
        this.abrirFolha('apelido');
        this.campoNome.focus();
        return;
      }
      this.pedirParaJogar(modo);
    };
    pegar<HTMLButtonElement>('#jogar-local').addEventListener('click', entrar('local'));
    pegar<HTMLButtonElement>('#jogar-online').addEventListener('click', entrar('online'));

    pegar<HTMLButtonElement>('#assistir').addEventListener('click', () => {
      this.fecharFolhas();
      this.acoes.assistir();
    });

    for (const botao of Array.from(
      document.querySelectorAll<HTMLButtonElement>('.coluna button[data-folha]'),
    )) {
      botao.addEventListener('click', () => {
        const aberta = botao.getAttribute('aria-expanded') === 'true';
        this.fecharFolhas();
        if (!aberta) this.abrirFolha(botao.dataset.folha!);
      });
    }

    // O botão dentro da folha do apelido continua a mesma porta de entrada, e
    // respeita o botão do menu que a abriu.
    for (const acao of Array.from(document.querySelectorAll<HTMLElement>('[data-acao="jogar"]'))) {
      acao.addEventListener('click', () => this.pedirParaJogar(this.modo));
    }
  }

  // --- a cabine ------------------------------------------------------------

  private ligarCabine(): void {
    this.seguirDaCabine.addEventListener('click', () => this.mostrar('escolha'));
    pegar<HTMLButtonElement>('#cabine-voltar').addEventListener('click', () => this.sairDaCabine());
  }

  private sairDaCabine(): void {
    this.acoes.desistir();
    this.mostrar('menu');
  }

  /**
   * Pinta as quatro vagas.
   *
   * Chamada a cada quadro enquanto a cabine está aberta, porque um controle
   * pode ser ligado ou desligado a qualquer momento e a vaga tem de responder
   * na hora — quem acabou de plugar o controle está olhando para a tela
   * esperando que ela mude.
   */
  atualizarCabine(dados: DadosDaCabine): void {
    if (this.tela !== 'cabine') return;
    const filhos: HTMLElement[] = [];
    for (let i = 0; i < MAXIMO_LOCAL; i++) {
      const sentado = dados.sentados.find((s) => s.vaga === i);
      const caixa = document.createElement('div');
      caixa.className = 'vaga-sofa';
      caixa.dataset.cheia = String(sentado !== undefined);
      const cor = COR_DA_VAGA[i % COR_DA_VAGA.length]!;
      if (sentado) caixa.style.borderColor = cor;

      const numero = document.createElement('div');
      numero.className = 'numero';
      numero.textContent = `P${i + 1}`;
      numero.style.color = sentado ? cor : 'rgba(255,255,255,0.3)';
      caixa.append(numero);

      if (sentado) {
        const quem = document.createElement('div');
        quem.className = 'quem';
        quem.textContent = sentado.nome;
        const fonte = document.createElement('div');
        fonte.className = 'fonte';
        fonte.textContent = rotuloDaFonte(sentado.fonte);
        caixa.append(quem, fonte);
      } else {
        const convite = document.createElement('div');
        convite.className = 'convite';
        if (dados.livres.length === 0) {
          convite.textContent = 'ligue um controle para abrir esta vaga';
        } else {
          // Só a primeira vaga vazia recebe o convite completo. Repetir a lista
          // de teclas em três molduras vazias faria a tela parecer um manual.
          const primeiraVazia = dados.sentados.length === i;
          if (primeiraVazia) {
            for (const livre of dados.livres) {
              const linha = document.createElement('div');
              linha.append(document.createTextNode(`${livre.rotulo}: `));
              const tecla = document.createElement('b');
              tecla.textContent = livre.comoEntrar;
              linha.append(tecla);
              convite.append(linha);
            }
          } else {
            convite.textContent = 'vaga livre';
          }
        }
        caixa.append(convite);
      }
      filhos.push(caixa);
    }
    this.vagasDoSofa.replaceChildren(...filhos);

    this.seguirDaCabine.disabled = dados.sentados.length === 0;
    this.recadoDaCabine.textContent =
      dados.sentados.length === 0
        ? 'aperte o botão de entrar para ocupar a primeira vaga'
        : `${dados.sentados.length} de ${MAXIMO_LOCAL} · ${
            this.modo === 'local'
              ? 'sala só de vocês, o resto do time vem de bot'
              : 'vocês entram na partida pública, junto de quem estiver na rede'
          }`;
  }

  private abrirFolha(nome: string): void {
    this.fecharFolhas();
    const folha = document.querySelector<HTMLElement>(`.folha[data-folha="${nome}"]`);
    if (folha) folha.hidden = false;
    const botao = document.querySelector<HTMLButtonElement>(`.barra button[data-folha="${nome}"]`);
    botao?.setAttribute('aria-expanded', 'true');
  }

  private fecharFolhas(): void {
    for (const f of Array.from(document.querySelectorAll<HTMLElement>('.folha'))) f.hidden = true;
    for (const b of Array.from(
      document.querySelectorAll<HTMLButtonElement>('.barra button[data-folha]'),
    )) {
      b.setAttribute('aria-expanded', 'false');
    }
  }

  private pintarEscolha(): void {
    const dados = this.ultimosDados;
    for (const time of TIMES) {
      const painel = document.querySelector<HTMLElement>(`.lado[data-time="${time}"]`);
      if (!painel) continue;
      painel.setAttribute('aria-selected', String(this.ladoEscolhido === time));

      const caixa = pegar<HTMLElement>(`#vagas-${time}`);
      const sub = pegar<HTMLElement>(`#sub-${time}`);
      caixa.replaceChildren();
      if (!dados) {
        sub.textContent = 'esperando o servidor…';
        continue;
      }
      const doTime = dados.elenco.filter((f) => f.time === time);
      const humanos = doTime.filter((f) => !f.bot);
      sub.textContent = `${humanos.length} jogador(es) · ${doTime.length - humanos.length} bot(s) · ${dados.placar[time]} resgate(s)`;

      for (let i = 0; i < dados.porTime; i++) {
        const ficha = doTime[i];
        const linha = document.createElement('div');
        linha.className = 'vaga';
        const bolinha = document.createElement('span');
        bolinha.className = 'ficha';
        linha.append(bolinha);
        if (!ficha) {
          linha.classList.add('livre');
          linha.append(document.createTextNode('vaga aberta'));
        } else {
          if (ficha.bot) linha.classList.add('bot');
          linha.append(document.createTextNode(ficha.bot ? `${ficha.nome} ⚙` : ficha.nome));
        }
        caixa.append(linha);
      }
    }

    const nome = this.ladoEscolhido === 'azul' ? 'Reino Azul' : 'Reino Vermelho';
    const quantos = dados?.quantosLocais ?? 1;
    // Com o sofá cheio, o botão diz **quantos** vão entrar: é o momento de
    // descobrir que o lado escolhido pode não ter quatro vagas, e não depois.
    this.confirmar.textContent =
      quantos > 1 ? `entrar no ${nome} · ${quantos} jogadores` : `entrar no ${nome}`;
    if (dados) {
      const minutos = Math.floor(dados.relogio / 60);
      const segundos = Math.floor(dados.relogio % 60);
      const livres =
        dados.porTime -
        dados.elenco.filter((f) => f.time === this.ladoEscolhido && !f.bot).length;
      this.status.textContent =
        livres < quantos
          ? `esse lado só tem ${Math.max(0, livres)} vaga(s) de gente — escolha o outro`
          : `partida em curso · ${minutos}:${String(segundos).padStart(2, '0')} no relógio`;
    }
  }

  /** Mensagem na tela de escolha, quando o servidor recusa o lado. */
  avisarNaEscolha(texto: string): void {
    this.status.textContent = texto;
  }

  /**
   * Monta a lista de ajustes a partir de uma tabela.
   *
   * Escrever os controles à mão no HTML seria mais curto de ler e mais fácil de
   * esquecer: bastaria alguém acrescentar um ajuste no tipo e não no HTML para o
   * jogo passar a ter uma preferência que ninguém consegue mudar. Aqui a tabela
   * é a única fonte, e o formulário nasce dela.
   */
  private montarAjustes(): void {
    const caixa = pegar<HTMLElement>('#ajustes');
    const controles: {
      chave: keyof Ajustes;
      rotulo: string;
      explica: string;
      opcoes: { valor: string | boolean; texto: string }[];
    }[] = [
      {
        chave: 'visao',
        rotulo: 'Campo de visão',
        explica: 'quanto do mapa cabe na tela',
        opcoes: [
          { valor: 'perto' as Visao, texto: 'perto' },
          { valor: 'padrao' as Visao, texto: 'padrão' },
          { valor: 'longe' as Visao, texto: 'longe' },
        ],
      },
      {
        chave: 'nomes',
        rotulo: 'Nomes na tela',
        explica: 'apelido sobre a cabeça de cada um',
        opcoes: [
          { valor: true, texto: 'mostrar' },
          { valor: false, texto: 'esconder' },
        ],
      },
      {
        chave: 'mato',
        rotulo: 'Mato e enfeites',
        explica: 'desligue em celular que engasga',
        opcoes: [
          { valor: true, texto: 'desenhar' },
          { valor: false, texto: 'limpar' },
        ],
      },
      {
        chave: 'registro',
        rotulo: 'Registro de eventos',
        explica: 'quem caiu, quem deu fatia',
        opcoes: [
          { valor: true, texto: 'mostrar' },
          { valor: false, texto: 'esconder' },
        ],
      },
      {
        chave: 'manche',
        rotulo: 'Manche no celular',
        explica: 'de que lado fica o controle de andar',
        opcoes: [
          { valor: 'esquerda' as Lado, texto: 'esquerda' },
          { valor: 'direita' as Lado, texto: 'direita' },
        ],
      },
    ];

    const pintar = (): void => {
      for (const botao of Array.from(
        caixa.querySelectorAll<HTMLButtonElement>('button[data-chave]'),
      )) {
        const chave = botao.dataset.chave as keyof Ajustes;
        const valor =
          botao.dataset.valor === 'true'
            ? true
            : botao.dataset.valor === 'false'
              ? false
              : botao.dataset.valor;
        botao.setAttribute('aria-pressed', String(this.ajustes[chave] === valor));
      }
    };

    for (const controle of controles) {
      const linha = document.createElement('div');
      linha.className = 'ajuste';
      const rotulo = document.createElement('span');
      rotulo.append(document.createTextNode(controle.rotulo));
      const explica = document.createElement('small');
      explica.textContent = controle.explica;
      rotulo.append(explica);
      const opcoes = document.createElement('div');
      opcoes.className = 'opcoes';
      for (const opcao of controle.opcoes) {
        const botao = document.createElement('button');
        botao.textContent = opcao.texto;
        botao.dataset.chave = controle.chave;
        botao.dataset.valor = String(opcao.valor);
        botao.addEventListener('click', () => {
          this.ajustes = { ...this.ajustes, [controle.chave]: opcao.valor } as Ajustes;
          salvarAjustes(this.ajustes);
          this.acoes.ajustou(this.ajustes);
          pintar();
        });
        opcoes.append(botao);
      }
      linha.append(rotulo, opcoes);
      caixa.append(linha);
    }

    pegar<HTMLButtonElement>('#padroes').addEventListener('click', () => {
      this.ajustes = { ...PADROES, nome: this.ajustes.nome };
      salvarAjustes(this.ajustes);
      this.acoes.ajustou(this.ajustes);
      pintar();
    });

    pintar();
  }
}

function pegar<T extends HTMLElement>(seletor: string): T {
  const el = document.querySelector<T>(seletor);
  if (!el) throw new Error(`elemento ausente na página: ${seletor}`);
  return el;
}

function alternar(el: HTMLElement, visivel: boolean): void {
  el.classList.toggle('oculta', !visivel);
}
