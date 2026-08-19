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

/**
 * As telas fora do jogo: menu, painéis, espera e escolha de lado.
 *
 * ## O menu não tem fundo — o fundo é o jogo
 *
 * A marca fica no alto à esquerda e a barra de ações embaixo, e entre as duas
 * não há ilustração nenhuma: o `canvas` continua desenhando **uma partida de
 * verdade**, ao vivo, com os bots que estariam jogando de qualquer jeito. É o
 * modo atração do fliperama, e responde antes de a pessoa perguntar as duas
 * coisas que ela quer saber ao abrir um jogo em rede: como ele é, e se tem
 * alguém jogando.
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

export type NomeDaTela = 'menu' | 'carregando' | 'escolha' | 'jogo' | 'plateia';

export interface AcoesDasTelas {
  /** O jogador quer entrar na batalha. */
  jogar(nome: string): void;
  /** O jogador quer só assistir, sem o menu por cima. */
  assistir(): void;
  /** O jogador confirmou o lado. */
  escolher(time: Time): void;
  /** Um ajuste mudou. Chamada a cada clique, já com o valor novo. */
  ajustou(ajustes: Ajustes): void;
}

export interface DadosDaEscolha {
  porTime: number;
  elenco: FichaDeJogador[];
  placar: Record<Time, number>;
  /** Segundos restantes da partida em curso. */
  relogio: number;
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
  private readonly carregando = pegar<HTMLElement>('#carregando');
  private readonly escolha = pegar<HTMLElement>('#escolha');
  private readonly plateia = pegar<HTMLElement>('#plateia');
  private readonly campoNome = pegar<HTMLInputElement>('#nome');
  private readonly botaoJogar = pegar<HTMLButtonElement>('#jogar');
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

  constructor(private readonly acoes: AcoesDasTelas) {
    this.ajustes = carregarAjustes();
    this.campoNome.value = this.ajustes.nome;

    this.ligarBarra();
    this.montarAjustes();

    this.campoNome.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.pedirParaJogar();
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

  mostrar(nome: NomeDaTela): void {
    this.tela = nome;
    alternar(this.menu, nome === 'menu');
    alternar(this.carregando, nome === 'carregando');
    alternar(this.escolha, nome === 'escolha');
    this.plateia.hidden = nome !== 'plateia';
    if (nome === 'menu') this.botaoJogar.disabled = false;
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

  private pedirParaJogar(): void {
    const nome = this.campoNome.value.trim() || 'Anônimo';
    this.ajustes = { ...this.ajustes, nome };
    salvarAjustes(this.ajustes);
    this.botaoJogar.disabled = true;
    this.recado.textContent = '';
    this.acoes.jogar(nome);
  }

  private confirmarLado(): void {
    this.acoes.escolher(this.ladoEscolhido);
  }

  private ligarBarra(): void {
    this.botaoJogar.addEventListener('click', () => {
      // Sem apelido guardado, o primeiro clique abre a folha para escrever um;
      // com apelido, ele entra direto. É o "Jogar / Continuar" do protótipo.
      if (!this.ajustes.nome.trim()) {
        this.abrirFolha('apelido');
        this.campoNome.focus();
        return;
      }
      this.pedirParaJogar();
    });

    pegar<HTMLButtonElement>('#assistir').addEventListener('click', () => {
      this.fecharFolhas();
      this.acoes.assistir();
    });

    for (const botao of Array.from(
      document.querySelectorAll<HTMLButtonElement>('.barra button[data-folha]'),
    )) {
      botao.addEventListener('click', () => {
        const aberta = botao.getAttribute('aria-expanded') === 'true';
        this.fecharFolhas();
        if (!aberta) this.abrirFolha(botao.dataset.folha!);
      });
    }

    for (const acao of Array.from(document.querySelectorAll<HTMLElement>('[data-acao="jogar"]'))) {
      acao.addEventListener('click', () => this.pedirParaJogar());
    }
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
    this.confirmar.textContent = `entrar no ${nome}`;
    if (dados) {
      const minutos = Math.floor(dados.relogio / 60);
      const segundos = Math.floor(dados.relogio % 60);
      const cheio =
        dados.elenco.filter((f) => f.time === this.ladoEscolhido && !f.bot).length >= dados.porTime;
      this.status.textContent = cheio
        ? 'esse lado está cheio de gente — escolha o outro'
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
