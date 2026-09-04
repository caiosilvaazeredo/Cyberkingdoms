import { CLASSES, perfil } from '../shared/classes';
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
import { avatarDe } from './equipe';
import { FORMATOS, campoPara } from '../shared/formatos';
import { IDS_DOS_MAPAS, MAPAS, type IdDoMapa } from '../shared/mapas';
import { IDS_DOS_MODOS, MODOS, type IdDoModo } from '../shared/modos';
import {
  MAX_BOTS,
  MAX_POR_TIME,
  totalPorTime,
  MIN_BOTS,
  MIN_POR_TIME,
  salaConfiguravel,
  type ConfiguracaoDeSala,
} from '../shared/protocolo';
import type { Porta } from './sofa';

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
   * @param porta `local` abre uma sala reservada ao aparelho; `online` entra na
   * sala mais movimentada, junto com quem estiver na rede. Nos dois, cabem até
   * quatro pessoas aqui.
   */
  jogar(porta: Porta, criar?: ConfiguracaoDeSala): void;
  /** O jogador quer só assistir, sem o menu por cima. */
  assistir(): void;
  /** O jogador confirmou o lado, e o sofá inteiro vai para ele. */
  escolher(time: Time): void;
  /** Desistiu da cabine e voltou ao menu: as conexões extras podem fechar. */
  desistir(): void;
  /**
   * As salas abertas agora, para a lista do painel.
   *
   * A busca é de quem sabe falar com o servidor, não desta classe: as telas
   * cuidam de pixels e de foco de teclado, e enfiar um `fetch` aqui faria o
   * menu ficar impossível de abrir sem uma rede de mentira montada em volta.
   */
  listarSalas(): Promise<SalaAberta[]>;
  /** Um ajuste mudou. Chamada a cada clique, já com o valor novo. */
  ajustou(ajustes: Ajustes): void;
}

/**
 * Uma sala aberta, como o `/salas` a descreve.
 *
 * Repetido aqui em vez de importado do servidor porque o cliente não deve
 * depender de nada de `src/server`: o que os dois compartilham é o formato do
 * que trafega, e este é o formato.
 */
export interface SalaAberta {
  nome: string;
  humanos: number;
  vagas: number;
  modo: IdDoModo;
  mapa: IdDoMapa | 'sorteio';
  porTime: number;
  bots: number;
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
  /**
   * O modo e o mapa desta partida.
   *
   * Sem isto a tela de escolha de lado nunca dizia **o que** a pessoa estava
   * prestes a jogar — só de que lado. Quem entra numa sala pública ou "Jogo
   * Online" cai numa configuração que outra pessoa escolheu, e o primeiro
   * lugar em que ela descobre o modo e o mapa não pode ser o meio da partida.
   */
  modo: IdDoModo;
  mapa: IdDoMapa;
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
  'Cada bolsa que você entulha no baú refém alivia o seu baú do outro lado do mapa. O ouro do mundo não muda: muda de cofre.',
  'Baú acima de 120 exige três carregadores. Sem escolta, o cortejo não sai do lugar.',
  'Minério só vem de mula derrubada. O saqueador derruba uma em três golpes; um guerreiro leva o dobro do tempo.',
  'Madeira e ouro sobem a obra da chapelaria, e a obra dá vida e dano a todo o time — inclusive a quem nunca minerou.',
  'Chapéu cai no chão quando o dono morre. Se você matar o arqueiro deles, o arco pode voltar para casa na sua cabeça.',
  'Longe do cofre, a bolsa vira o que todo dinheiro é: você gasta consigo e cura quarenta e cinco.',
  'Empate no tempo? Ganha o reino cujo baú está mais leve. A balança é o desempate.',
  'Trabalhar na jazida cancela se você andar. Ofício é o momento em que se está indefeso.',
  'No aquecimento a chapelaria já está aberta. É para isso que ele existe.',
];

/**
 * Os botões do menu que abrem painel, num seletor só.
 *
 * Escrito uma vez porque já foi escrito três: quando o menu virou coluna, dois
 * dos três lugares continuaram procurando por `.barra`, que não existe mais. O
 * resultado era silencioso — o realce de "painel aberto" nunca acendia e o
 * botão deixou de fechar o que tinha aberto — e um seletor que não casa com
 * nada não dá erro nenhum para avisar.
 */
const BOTOES_DE_FOLHA = '.coluna button';

/**
 * Para onde o sofá está indo, por porta.
 *
 * Uma tabela e não um ternário: a frase começou distinguindo "local" de "o
 * resto", e quando surgiram a sala montada e a sala convidada o "resto" passou
 * a mentir — quem acabava de montar uma sala com as próprias regras lia que ia
 * entrar "na partida pública". Com uma entrada por porta, acrescentar uma porta
 * sem escrever a frase dela não compila.
 */
const ONDE_VOCES_VAO: Record<Porta, string> = {
  local: 'sala só de vocês, o resto do time vem de bot',
  online: 'vocês entram na partida pública, junto de quem estiver na rede',
  montada: 'sala montada por vocês, com as regras que escolheram',
  convidada: 'vocês entram na sala escolhida na lista',
};

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
  private readonly recadoDaSala = pegar<HTMLElement>('#recado-sala');

  private tela: NomeDaTela = 'menu';
  private ladoEscolhido: Time = 'azul';
  private ajustes: Ajustes;
  private ultimosDados: DadosDaEscolha | null = null;
  /** Qual botão do menu abriu a cabine. Decide a sala lá na hora de conectar. */
  private porta: Porta = 'online';
  /**
   * A sala que o painel está montando.
   *
   * Vive aqui, e não no formulário, porque ela precisa sobreviver ao desvio do
   * apelido: quem aperta "abrir a sala" sem ter apelido cai na folha do
   * apelido, e o que ele configurou não pode se perder no caminho de volta.
   *
   * O padrão é **dois e dois**, e de propósito diferente do padrão do
   * protocolo. Aquele é o que o servidor assume quando o pacote chega torto, e
   * repete a política do lobby: seis vagas e nenhum npc. Este é o que uma
   * pessoa vê ao abrir o painel — e quem monta uma sala normalmente está
   * sozinho, então "seis vagas e nenhum npc" entregaria uma partida em que não
   * há ninguém para jogar contra. Dois de cada lado com dois npcs é um jogo
   * assim que a sala abre, e continua sendo quando os amigos chegarem.
   */
  private montagem: Required<ConfiguracaoDeSala> = salaConfiguravel({ porTime: 2, bots: 2 });
  /** A montagem que o botão do apelido deve reenviar, se houver. */
  private montagemPendente: ConfiguracaoDeSala | undefined;
  /** A sala aberta em que se clicou "entrar", quando a porta é `convidada`. */
  private salaPedida: string | null = null;

  constructor(private readonly acoes: AcoesDasTelas) {
    this.ajustes = carregarAjustes();
    this.campoNome.value = this.ajustes.nome;

    this.ligarBarra();
    this.ligarCabine();
    this.montarPainelDeSalas();
    this.montarVitrineDoMenu();
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
  /** O nome da sala em que se clicou "entrar" na lista. Lido por `main`. */
  get salaDoConvite(): string | null {
    return this.salaPedida;
  }

  get portaEscolhida(): Porta {
    return this.porta;
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

  private pedirParaJogar(porta: Porta, criar?: ConfiguracaoDeSala): void {
    const nome = this.campoNome.value.trim() || 'Anônimo';
    this.ajustes = { ...this.ajustes, nome };
    salvarAjustes(this.ajustes);
    this.recado.textContent = '';
    this.fecharFolhas();
    this.porta = porta;
    this.acoes.jogar(porta, criar);
  }

  private confirmarLado(): void {
    this.acoes.escolher(this.ladoEscolhido);
  }

  /**
   * O painel de montar sala: o modo, o formato do time e as salas abertas.
   *
   * ## Por que os controles nascem do código
   *
   * Os quatro modos e os dois contadores são escritos a partir de `MODOS` e dos
   * limites do protocolo, e não à mão no HTML. Escrever à mão seria mais curto
   * de ler e mais fácil de esquecer: bastaria alguém acrescentar um modo na
   * tabela e não no HTML para o jogo ter um modo que ninguém consegue escolher —
   * e o teste que confere as duas listas não existiria para pegar isso.
   *
   * ## Por que dois botões e um número, e não um campo de texto
   *
   * Um `<input type="number">` aceita "-3", "1e9" e vazio, e cada um deles vira
   * uma pergunta de validação com uma mensagem de erro para escrever. Menos e
   * mais só produzem valores que já estão na faixa, e são alvos de dedo — que é
   * o que interessa num jogo que se joga no sofá.
   */
  /**
   * A tira de classes e a fita de números do menu.
   *
   * Os números saem das **tabelas**, e não de um texto escrito à mão. É a única
   * diferença que importa: um menu que anuncia "quatro mapas" continua
   * anunciando quatro no dia em que o quinto entrar, e ninguém descobre — porque
   * ninguém relê o menu. Lido da tabela, ele conta cinco sozinho.
   */
  private montarVitrineDoMenu(): void {
    const tira = document.querySelector<HTMLElement>('#elenco-do-menu');
    if (tira) {
      for (const classe of CLASSES) {
        const item = document.createElement('li');
        const nome = perfil(classe).nome;
        item.title = nome;
        const img = document.createElement('img');
        img.src = avatarDe(classe);
        img.alt = '';
        const rotulo = document.createElement('span');
        rotulo.textContent = nome;
        item.append(img, rotulo);
        tira.append(item);
      }
    }
    const fita = document.querySelector<HTMLElement>('#fita-do-menu');
    if (fita) {
      fita.textContent = [
        `${CLASSES.length} classes`,
        `${IDS_DOS_MODOS.length} modos`,
        `${IDS_DOS_MAPAS.length} campos`,
        `até ${FORMATOS[FORMATOS.length - 1]!.porTime} por time`,
        'até 4 no mesmo aparelho',
      ].join(' · ');
    }
  }

  private montarPainelDeSalas(): void {
    const caixaModos = pegar<HTMLElement>('#modos');
    for (const id of IDS_DOS_MODOS) {
      const m = MODOS[id];
      const botao = document.createElement('button');
      botao.className = 'modo';
      botao.dataset.modo = id;
      const nome = document.createElement('b');
      nome.textContent = m.nome;
      const lema = document.createElement('small');
      lema.textContent = m.lema;
      botao.append(nome, lema);
      botao.addEventListener('click', () => {
        this.montagem = { ...this.montagem, modo: id };
        this.pintarMontagem();
      });
      caixaModos.append(botao);
    }

    // Os mapas, com o mesmo desenho dos modos — mais um cartão, "Sortear", que
    // não é um mapa e por isso vem escrito à mão em vez de sair da tabela.
    const caixaMapas = pegar<HTMLElement>('#mapas');
    const cartoesDeMapa: { valor: IdDoMapa | 'sorteio'; nome: string; lema: string }[] = [
      ...IDS_DOS_MAPAS.map((id) => ({ valor: id, nome: MAPAS[id].nome, lema: MAPAS[id].lema })),
      {
        valor: 'sorteio',
        nome: 'Sortear',
        lema: 'um campo diferente a cada partida da sala',
      },
    ];
    for (const c of cartoesDeMapa) {
      const botao = document.createElement('button');
      botao.className = 'modo';
      botao.dataset.mapa = c.valor;
      const nome = document.createElement('b');
      nome.textContent = c.nome;
      const lema = document.createElement('small');
      lema.textContent = c.lema;
      botao.append(nome, lema);
      botao.addEventListener('click', () => {
        this.montagem = { ...this.montagem, mapa: c.valor };
        this.pintarMontagem();
      });
      caixaMapas.append(botao);
    }

    // Os formatos, que são atalhos: cada um põe o número **e** o campo que ele
    // exige. Sem eles, montar trinta e dois contra trinta e dois seria clicar
    // vinte e seis vezes no `+`, e ninguém faz isso.
    const caixaFormatos = pegar<HTMLElement>('#formatos');
    for (const f of FORMATOS) {
      const campo = campoPara(f.porTime);
      if (campo === null) continue;
      const botao = document.createElement('button');
      botao.className = 'modo';
      botao.dataset.formato = String(f.porTime);
      const nome = document.createElement('b');
      nome.textContent = f.nome;
      const lema = document.createElement('small');
      lema.textContent = f.lema;
      botao.append(nome, lema);
      botao.addEventListener('click', () => {
        // O campo entra junto só quando o atual não comporta o formato: quem
        // escolheu a Planície e depois clicou em "8 × 8" não queria voltar para
        // o Corte.
        const cabe = totalPorTime(this.montagem.mapa) >= f.porTime;
        this.montagem = salaConfiguravel({
          ...this.montagem,
          porTime: f.porTime,
          ...(cabe ? {} : { mapa: campo }),
        });
        this.pintarMontagem();
      });
      caixaFormatos.append(botao);
    }

    const contadores: {
      chave: 'porTime' | 'bots';
      rotulo: string;
      explica: string;
      min: number;
      max: number;
    }[] = [
      {
        chave: 'porTime',
        rotulo: 'Jogadores por time',
        explica: 'vagas de gente em cada reino',
        min: MIN_POR_TIME,
        max: MAX_POR_TIME,
      },
      {
        chave: 'bots',
        rotulo: 'Npcs por time',
        explica: 'quantos bots cada reino leva',
        min: MIN_BOTS,
        max: MAX_BOTS,
      },
    ];
    const caixaFormato = pegar<HTMLElement>('#formato');
    for (const c of contadores) {
      const linha = document.createElement('div');
      linha.className = 'ajuste';
      const rotulo = document.createElement('span');
      rotulo.append(document.createTextNode(c.rotulo));
      const explica = document.createElement('small');
      explica.textContent = c.explica;
      rotulo.append(explica);

      const grupo = document.createElement('div');
      grupo.className = 'contador';
      const menos = document.createElement('button');
      menos.textContent = '−';
      menos.setAttribute('aria-label', `menos ${c.rotulo.toLowerCase()}`);
      const valor = document.createElement('output');
      valor.dataset.conta = c.chave;
      const mais = document.createElement('button');
      mais.textContent = '+';
      mais.setAttribute('aria-label', `mais ${c.rotulo.toLowerCase()}`);
      for (const [botao, passo] of [
        [menos, -1],
        [mais, 1],
      ] as const) {
        botao.addEventListener('click', () => {
          const alvo = Math.max(c.min, Math.min(c.max, this.montagem[c.chave] + passo));
          // Passa pelo mesmo saneamento do servidor: assim o teto de unidades
          // por time é aplicado aqui também, e o número na tela é o número que
          // a sala vai ter. Um formulário que promete o que o servidor corta é
          // um formulário que mente.
          this.montagem = salaConfiguravel({ ...this.montagem, [c.chave]: alvo });
          this.pintarMontagem();
        });
      }
      grupo.append(menos, valor, mais);
      linha.append(rotulo, grupo);
      caixaFormato.append(linha);
    }

    pegar<HTMLButtonElement>('#abrir-sala').addEventListener('click', () => {
      this.montagemPendente = { ...this.montagem };
      this.pedirParaJogar('montada', this.montagemPendente);
    });
    pegar<HTMLButtonElement>('#atualizar-salas').addEventListener('click', () => {
      void this.recarregarSalas();
    });
    this.pintarMontagem();
  }

  private pintarMontagem(): void {
    for (const b of Array.from(document.querySelectorAll<HTMLButtonElement>('.modo'))) {
      const meu =
        b.dataset.modo !== undefined
          ? b.dataset.modo === this.montagem.modo
          : b.dataset.formato !== undefined
            ? // O formato acende pelo número, e não por ter sido clicado: quem
              // chegou a trinta e dois pelo `+` vê o mesmo botão aceso de quem
              // clicou nele. O botão é um atalho para um valor, não um modo.
              Number(b.dataset.formato) === this.montagem.porTime
            : b.dataset.mapa === this.montagem.mapa;
      b.setAttribute('aria-pressed', String(meu));
    }
    for (const o of Array.from(document.querySelectorAll<HTMLOutputElement>('output[data-conta]'))) {
      const chave = o.dataset.conta as 'porTime' | 'bots';
      o.textContent = String(this.montagem[chave]);
    }
    const total = this.montagem.porTime + this.montagem.bots;
    // O teto é do campo escolhido, e por isso a frase muda quando se troca de
    // mapa sem tocar nos contadores: "é o que o Corte comporta" e "é o que a
    // Planície comporta" são números diferentes.
    const teto = totalPorTime(this.montagem.mapa);
    this.recadoDaSala.textContent =
      `${this.montagem.porTime} contra ${this.montagem.porTime}` +
      (this.montagem.bots > 0 ? ` · ${this.montagem.bots} npc(s) de cada lado` : ' · sem npcs') +
      ` · ${total} de cada lado em campo` +
      (total >= teto ? ' — é o que este campo comporta' : '');
  }

  /**
   * Busca as salas abertas e desenha a lista.
   *
   * Some a própria porta de entrada quando não há nada: uma lista vazia com um
   * título em cima parece um defeito, e a frase que a substitui diz o que
   * fazer em vez de constatar o vazio.
   */
  private async recarregarSalas(): Promise<void> {
    const caixa = pegar<HTMLElement>('#salas-abertas');
    caixa.replaceChildren(texto('procurando salas…', 'vazio'));
    let salas: SalaAberta[];
    try {
      salas = await this.acoes.listarSalas();
    } catch {
      caixa.replaceChildren(texto('não deu para falar com o servidor', 'vazio'));
      return;
    }
    const abertas = salas.filter((s) => s.vagas > 0);
    if (abertas.length === 0) {
      caixa.replaceChildren(texto('nenhuma sala aberta agora — monte a sua acima', 'vazio'));
      return;
    }
    caixa.replaceChildren();
    for (const s of abertas) {
      const linha = document.createElement('div');
      linha.className = 'sala-aberta';
      const quem = document.createElement('span');
      const titulo = document.createElement('b');
      titulo.textContent = MODOS[s.modo]?.nome ?? s.nome;
      const detalhe = document.createElement('small');
      const campo = s.mapa === 'sorteio' ? 'sorteio' : (MAPAS[s.mapa]?.nome ?? s.mapa);
      detalhe.textContent =
        `${campo} · ${s.porTime} por time` +
        (s.bots > 0 ? ` + ${s.bots} npc(s)` : '') +
        ` · ${s.humanos} jogando · ${s.vagas} vaga(s)`;
      quem.append(titulo, detalhe);
      const botao = document.createElement('button');
      botao.className = 'pequeno';
      botao.textContent = 'entrar';
      botao.addEventListener('click', () => {
        this.montagemPendente = undefined;
        this.salaPedida = s.nome;
        this.pedirParaJogar('convidada');
      });
      linha.append(quem, botao);
      caixa.append(linha);
    }
  }

  private ligarBarra(): void {
    const entrar = (porta: Porta) => () => {
      // Sem apelido guardado, o primeiro clique abre a folha para escrever um;
      // com apelido, vai direto para a cabine.
      if (!this.ajustes.nome.trim()) {
        this.porta = porta;
        this.abrirFolha('apelido');
        this.campoNome.focus();
        return;
      }
      this.pedirParaJogar(porta);
    };
    pegar<HTMLButtonElement>('#jogar-local').addEventListener('click', entrar('local'));
    pegar<HTMLButtonElement>('#jogar-online').addEventListener('click', entrar('online'));

    // A Regência é uma sala montada com a configuração já decidida — o
    // jogador não escolhe modo, mapa nem npcs, então não passa pelo painel
    // de `montarPainelDeSalas`. `porTime: 4` é o teto de gente que ela serve
    // sem sobrar bot vazio quando joga só uma pessoa: `botsFixos` nasce nulo
    // para toda sala de campanha (ver `Sala`), e por isso o `bots` daqui
    // nunca é o número que vale — quem decide é sempre `campanha: true`.
    pegar<HTMLButtonElement>('#jogar-campanha').addEventListener('click', () => {
      const criar = salaConfiguravel({
        modo: 'resgate',
        mapa: 'sorteio',
        porTime: 4,
        bots: 0,
        privada: true,
        campanha: true,
      });
      this.montagemPendente = criar;
      this.pedirParaJogar('montada', criar);
    });

    // O Cerco é a mesma Regência — mesma sala montada, mesma escalada — só
    // que com o modo 'cerco' no lugar do 'resgate': os três chefes neutros
    // continuam sem saber que a campanha existe, e a campanha continua sem
    // saber qual modo está rodando. É a composição que a tabela de modos
    // promete, e não um caminho novo para testar.
    pegar<HTMLButtonElement>('#jogar-cerco').addEventListener('click', () => {
      const criar = salaConfiguravel({
        modo: 'cerco',
        mapa: 'sorteio',
        porTime: 4,
        bots: 0,
        privada: true,
        campanha: true,
      });
      this.montagemPendente = criar;
      this.pedirParaJogar('montada', criar);
    });

    pegar<HTMLButtonElement>('#assistir').addEventListener('click', () => {
      this.fecharFolhas();
      this.acoes.assistir();
    });

    for (const botao of Array.from(
      document.querySelectorAll<HTMLButtonElement>(`${BOTOES_DE_FOLHA}[data-folha]`),
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
      acao.addEventListener('click', () => this.pedirParaJogar(this.porta, this.montagemPendente));
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
        : `${dados.sentados.length} de ${MAXIMO_LOCAL} · ${ONDE_VOCES_VAO[this.porta]}`;
  }

  private abrirFolha(nome: string): void {
    this.fecharFolhas();
    const folha = document.querySelector<HTMLElement>(`.folha[data-folha="${nome}"]`);
    if (folha) folha.hidden = false;
    const botao = document.querySelector<HTMLButtonElement>(`${BOTOES_DE_FOLHA}[data-folha="${nome}"]`);
    botao?.setAttribute('aria-expanded', 'true');
    // A lista de salas é buscada ao abrir, e não uma vez ao carregar a página:
    // salas nascem e morrem o tempo todo, e uma lista de dez minutos atrás
    // manda a pessoa entrar numa sala que já não existe.
    if (nome === 'sala') void this.recarregarSalas();
  }

  private fecharFolhas(): void {
    for (const f of Array.from(document.querySelectorAll<HTMLElement>('.folha'))) f.hidden = true;
    for (const b of Array.from(
      document.querySelectorAll<HTMLButtonElement>(`${BOTOES_DE_FOLHA}[data-folha]`),
    )) {
      b.setAttribute('aria-expanded', 'false');
    }
  }

  private pintarEscolha(): void {
    const dados = this.ultimosDados;
    const confronto = document.querySelector<HTMLElement>('#confronto-da-escolha');
    if (confronto) {
      if (!dados) {
        confronto.textContent = '';
      } else {
        const modo = MODOS[dados.modo];
        const mapa = MAPAS[dados.mapa];
        confronto.replaceChildren(
          document.createTextNode(
            `${modo.nome} · ${mapa.nome} · ${dados.porTime} × ${dados.porTime}`,
          ),
        );
        const lema = document.createElement('small');
        lema.textContent = modo.lema;
        confronto.append(lema);
      }
    }
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
        explica: 'quem caiu, quem entulhou o baú',
        opcoes: [
          { valor: true, texto: 'mostrar' },
          { valor: false, texto: 'esconder' },
        ],
      },
      {
        chave: 'minimapa',
        rotulo: 'Minimapa',
        explica: 'o seu time e o inimigo avistado',
        opcoes: [
          { valor: true, texto: 'mostrar' },
          { valor: false, texto: 'esconder' },
        ],
      },
      {
        chave: 'cartao',
        rotulo: 'Cartão de vida e classe',
        explica: 'nome, vida e o que você carrega',
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

/** Um parágrafo de uma linha, para as listas vazias. */
function texto(conteudo: string, classe: string): HTMLElement {
  const p = document.createElement('p');
  p.className = classe;
  p.textContent = conteudo;
  return p;
}

function pegar<T extends HTMLElement>(seletor: string): T {
  const el = document.querySelector<T>(seletor);
  if (!el) throw new Error(`elemento ausente na página: ${seletor}`);
  return el;
}

function alternar(el: HTMLElement, visivel: boolean): void {
  el.classList.toggle('oculta', !visivel);
}
