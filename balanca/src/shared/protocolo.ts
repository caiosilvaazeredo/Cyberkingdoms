import { CLASSES, CLASSES_COM_CHAPEU, type Classe, type Fera } from './classes';
import type {
  Carga,
  Estado,
  Evento,
  Fase,
  Item,
  Bau,
  Projetil,
  TipoDeGuardiao,
  TipoDeItem,
  TipoDeProjetil,
  Unidade,
  VarianteDaInvasao,
} from './estado';
import { IDS_DOS_MAPAS, MAPAS, mapaDe, porTimeMaximo, type IdDoMapa } from './mapas';
import { modoDe, type IdDoModo } from './modos';
import { POR_TIME, TIMES, type Time } from './regras';

/**
 * O que trafega entre o navegador e o servidor.
 *
 * ## Duas mensagens fazem o jogo
 *
 * O cliente manda `comando` — para onde quer andar, se apertou atacar, se
 * apertou usar. O servidor manda `retrato` — o estado inteiro da partida,
 * quinze vezes por segundo. Todo o resto é cerimônia de entrada e saída.
 *
 * Retrato inteiro, e não diferença, porque a partida cabe: doze unidades, duas
 * baús, um punhado de projéteis. Um pacote completo custa ~1,5 kB e tem
 * uma propriedade que diferença não tem — quem chega atrasado, ou perde um
 * pacote, se conserta sozinho no próximo. Delta exigiria confirmação, buffer de
 * reenvio e um bug de dessincronização esperando o dia de aparecer.
 *
 * ## Por que tupla, e não objeto com nome
 *
 * `{"x":1728,"y":960,"vida":90}` é três vezes o tamanho de `[1728,960,90]`, e a
 * diferença multiplica por doze unidades e por quinze envios por segundo. A
 * ordem dos campos está documentada em cada codificador, e o teste de ida e
 * volta é quem garante que ela não escorregue.
 *
 * ## O que **não** vai no retrato
 *
 * Nome e time não mudam durante a partida, então viajam uma vez, no `elenco`.
 * O terreno não viaja: o cliente monta a arena a partir da seed e do **nome** do
 * mapa, que são dois números e uma palavra em vez de dois mil tiles.
 */

export const VERSAO_DO_PROTOCOLO = 7;

// --- a sala que alguém monta -----------------------------------------------

/**
 * O que o anfitrião escolhe ao abrir uma sala.
 *
 * Três coisas, e nenhuma delas é um número solto no meio do jogo: o modo, quantas
 * pessoas cabem em cada time e quantos npcs cada time leva. As duas contagens
 * são **por time**, não por sala — dizer "oito jogadores" deixa em aberto se são
 * quatro contra quatro ou seis contra dois, e essa ambiguidade acabaria virando
 * uma partida desequilibrada que ninguém pediu.
 */
export interface ConfiguracaoDeSala {
  modo?: IdDoModo;
  /**
   * O campo de batalha, ou `'sorteio'` para trocar a cada partida.
   *
   * O sorteio é uma escolha e não a ausência de uma: quem quer treinar um mapa
   * fixa um, quem quer variedade pede sorteio, e o servidor não decide por
   * ninguém.
   */
  mapa?: IdDoMapa | 'sorteio';
  /** Vagas de gente em cada time. */
  porTime?: number;
  /**
   * Npcs em cada time, fixos.
   *
   * "Fixos" é a diferença que faz este campo existir. Numa sala do lobby os
   * bots são um tapa-buraco: entram para completar o time e saem quando chega
   * gente. Numa sala montada, eles são uma escolha do anfitrião — três contra
   * três com dois npcs de cada lado é oito em campo, e continua sendo oito
   * quando o terceiro amigo chegar.
   */
  bots?: number;
  /** Sala reservada: o lobby não manda estranhos para ela. */
  privada?: boolean;
  /**
   * A Regência: o lado vermelho vira reino bandido, sempre de bots — quem
   * entra só escolhe azul. Ver `Sala.escolher` e `shared/campanha.ts`.
   */
  campanha?: boolean;
}

/** Vagas de gente por time: pelo menos uma, no máximo o que o campo comporta. */
export const MIN_POR_TIME = 1;
export const MAX_POR_TIME = 32;
/** Npcs por time. Zero é uma escolha legítima: partida só de gente. */
export const MIN_BOTS = 0;
export const MAX_BOTS = 32;

/**
 * Unidades por time, somando gente e npc — e quem dá o teto é o **mapa**.
 *
 * O teto era oito e era um número solto. Ele existia por um motivo verdadeiro
 * (a arena tem tamanho, e doze de um lado transformam a ponte num
 * engarrafamento), mas escrito assim ele valia para o Corte e para qualquer
 * campo que viesse depois — inclusive um cinco vezes maior, onde oito por lado
 * é um campo vazio.
 *
 * Agora a conta é do mapa (`porTimeMaximo`), e o sorteio pega o **menor** dos
 * tetos: uma sala que sorteia campo a cada partida não pode aceitar trinta e
 * dois por lado e depois cair no Corte.
 */
export function totalPorTime(mapa: IdDoMapa | 'sorteio'): number {
  if (mapa === 'sorteio') {
    return Math.min(...IDS_DOS_MAPAS.map((id) => porTimeMaximo(MAPAS[id])));
  }
  return porTimeMaximo(mapaDe(mapa));
}

export function salaConfiguravel(bruta: unknown): Required<ConfiguracaoDeSala> {
  const c = (bruta ?? {}) as ConfiguracaoDeSala;
  const inteiro = (v: unknown, min: number, max: number, padrao: number): number => {
    const n = typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : padrao;
    return Math.max(min, Math.min(max, n));
  };
  // O mapa é resolvido primeiro porque é ele que dá o teto do resto.
  const mapa = c.mapa === 'sorteio' ? ('sorteio' as const) : mapaDe(c.mapa).id;
  const teto = totalPorTime(mapa);
  const porTime = inteiro(c.porTime, MIN_POR_TIME, Math.min(MAX_POR_TIME, teto), POR_TIME);
  const bots = inteiro(c.bots, MIN_BOTS, MAX_BOTS, 0);
  return {
    modo: modoDe(c.modo).id,
    // `'sorteio'` é o único valor que não é um mapa e mesmo assim é válido;
    // qualquer outra coisa desconhecida cai no padrão, como o modo.
    mapa,
    porTime,
    bots: Math.min(bots, teto - porTime),
    privada: c.privada === true,
    campanha: c.campanha === true,
  };
}

// --- cliente → servidor ----------------------------------------------------

export interface Comando {
  /** Cresce a cada envio. É o que o cliente usa para reconciliar a previsão. */
  seq: number;
  /** Direção desejada, normalizada pelo servidor. */
  mx: number;
  my: number;
  /**
   * Para onde a unidade **olha**, que é para onde o golpe sai.
   *
   * Separar mira de movimento é o que permite recuar atirando — sem isso o
   * arqueiro que foge dá as costas para o alvo e o mago nunca acerta nada que
   * não esteja exatamente na frente. Zerado quando o jogador não está mirando,
   * e aí a direção do movimento faz as vezes.
   */
  ax: number;
  ay: number;
  atacar: boolean;
  /** Botão de contexto: pegar, entregar, entulhar, vestir. */
  usar: boolean;
}

export type DoCliente =
  /**
   * `assistindo` marca quem chegou só para ver — o menu do jogo mostra uma
   * partida de verdade correndo atrás do título, e quem está lendo o menu não
   * pode ocupar a vaga de quem quer jogar.
   *
   * `sala` e `privada` existem por causa do sofá. Quatro pessoas no mesmo
   * aparelho abrem **quatro conexões** — é o que dá a cada uma a sua previsão,
   * a sua vida e o seu chapéu, sem inventar um segundo formato de comando. Só
   * que o lobby joga cada conexão na sala mais cheia de gente, e nada garante
   * que as quatro caiam na mesma. Então a primeira entra normalmente e diz o
   * nome da sala em que caiu; as outras três pedem **aquela** sala.
   *
   * `privada` é o "jogo local": abre uma sala em que o lobby não coloca
   * estranhos. O resto do time vem de bot, e quem está no sofá joga sem
   * companhia de fora.
   */
  | {
      t: 'entrar';
      nome: string;
      versao: number;
      assistindo?: boolean;
      sala?: string;
      privada?: boolean;
      /**
       * Abrir uma sala **com estas regras**, em vez de cair na fila do lobby.
       *
       * Vai no `entrar` e não numa mensagem própria de "criar sala" porque
       * criar e entrar são o mesmo gesto: ninguém cria uma sala para não entrar
       * nela. Uma mensagem separada exigiria um estado intermediário — conectado
       * mas sem sala — que só existiria para ser um caminho a mais de erro.
       *
       * Os números chegam de fora e o servidor não confia neles: quem sanea é
       * `salaConfiguravel`, e o que volta no `bemvindo` é o que de fato valeu.
       */
      criar?: ConfiguracaoDeSala;
    }
  /**
   * Escolher o lado é uma mensagem separada de entrar, e não um campo dela.
   *
   * Quem acabou de conectar ainda não sabe o que quer: precisa **ver** os dois
   * times para escolher, e para ver precisa já estar conectado. Então entrar dá
   * um espectador, e é esta mensagem que transforma o espectador em jogador.
   */
  | { t: 'escolherTime'; time: Time; nome?: string }
  /**
   * O líder manda um npc do time dele vestir uma classe.
   *
   * `votar: true` abre a decisão para os humanos do time em vez de resolvê-la.
   * É a mesma mensagem porque é o mesmo gesto — "este npc devia ser arqueiro" —
   * e o que muda é só quem responde.
   */
  | { t: 'mandar'; alvo: number; classe: Classe; votar?: boolean }
  /** Um voto numa votação aberta. O último voto da pessoa é o que vale. */
  | { t: 'votar'; classe: Classe }
  | { t: 'comando'; c: Comando }
  | { t: 'ping'; tempo: number }
  /**
   * O clique no minimapa: "olha aqui". Coordenadas de mundo, não de tile —
   * é a mesma unidade que `Comando` já usa, e poupa o servidor de converter.
   * Vale só para o próprio time; quem decide isso é `Sala.marcar`, não esta
   * mensagem, que só carrega onde a pessoa tocou.
   */
  | { t: 'marcar'; x: number; y: number }
  | { t: 'sair' };

// --- servidor → cliente ----------------------------------------------------

export interface FichaDeJogador {
  id: number;
  nome: string;
  time: Time;
  bot: boolean;
  /**
   * Manda no time: pode ordenar a classe de um npc ou abrir uma votação.
   *
   * Vem no elenco e não no retrato porque muda quase nunca — uma vez quando
   * alguém entra e outra quando o líder sai. O retrato é a mensagem que este
   * protocolo mais cuida em manter pequena.
   */
  lider: boolean;
  /**
   * A classe que o time pediu a este npc, enquanto ele não a veste.
   *
   * Some quando o bot chega à chapelaria e obedece. Serve ao painel: sem ela, o
   * líder manda um arqueiro e não vê nada acontecer por dez segundos, que é o
   * tempo de o bot atravessar o castelo.
   */
  pedida?: Classe;
}

/** Uma votação em curso, como o painel do time a vê. */
export interface VotacaoAberta {
  /** O npc cuja classe está em jogo. */
  alvo: number;
  /** O nome dele, para a frase não ser "vote na classe da unidade 7". */
  alvoNome: string;
  proposta: Classe;
  /** Segundos restantes, arredondados. */
  restante: number;
  /** Quantos votos cada classe tem, na ordem de `CLASSES_COM_CHAPEU`. */
  votos: number[];
  /** Em que você votou, se votou. */
  meuVoto?: Classe;
}

export type DoServidor =
  | {
      t: 'bemvindo';
      seed: number;
      sala: string;
      porTime: number;
      /**
       * O modo e os bots viajam **uma vez**, aqui, e não em cada retrato.
       *
       * Os dois valem pela partida inteira. Mandá-los quinze vezes por segundo
       * seria pagar banda para repetir uma constante — e o retrato é a mensagem
       * que este protocolo mais cuida em manter pequena.
       */
      modo: IdDoModo;
      botsPorTime: number;
      /**
       * O mapa **desta** partida, já resolvido.
       *
       * Nunca `'sorteio'`: o cliente monta a arena a partir dele e precisa do
       * mapa concreto. Numa sala que sorteia, cada `bemvindo` — inclusive o da
       * partida seguinte — traz o que de fato saiu.
       */
      mapa: IdDoMapa;
      /**
       * Presente só nas salas de Regência — o nível atual e os reforços que
       * o time já tem. Vem no `bemvindo` porque, como o modo e o mapa, vale
       * pela partida inteira e a sala manda de novo a cada nível.
       */
      campanha?: { nivel: number; perks: readonly string[] };
    }
  /**
   * O espectador virou jogador. Chega depois de `escolherTime`, e de novo a
   * cada partida nova — a sala não morre no fim do jogo, monta a próxima.
   */
  | { t: 'nasceu'; voce: number; time: Time }
  | { t: 'elenco'; jogadores: FichaDeJogador[] }
  /**
   * A votação do **seu** time, ou `null` quando não há nenhuma.
   *
   * Mandada só a quem é do time: a votação do inimigo não é da sua conta, e
   * saber que eles estão decidindo pôr um clérigo seria informação de graça.
   */
  | { t: 'votacao'; v: VotacaoAberta | null }
  /** Uma frase curta para o painel do time: ordem dada, votação apurada. */
  | { t: 'recadoDoTime'; texto: string }
  /**
   * Um alerta no minimapa: alguém do seu time clicou "olha aqui". Nunca sai
   * do próprio time — o inimigo não vê a marca, do mesmo jeito que não vê a
   * votação. `quem` é para não pintar a própria marca de novo com um eco de
   * volta, embora hoje isso não mude a leitura visual.
   */
  | { t: 'marca'; x: number; y: number; quem: string }
  | { t: 'retrato'; r: Retrato }
  | { t: 'pong'; tempo: number }
  | { t: 'recusado'; motivo: string };

export interface Retrato {
  /**
   * `[tick, faseIdx, faseEm*10, relogio, placarAzul, placarVermelho, vencedor,
   *   abatesAzul, abatesVermelho]`
   *
   * As baixas vão no retrato, e não no `bemvindo`, porque mudam durante a
   * partida: no modo Abate elas **são** o placar, e um placar que só chegasse
   * ao entrar seria um placar congelado.
   */
  p: number[];
  u: number[][];
  pr: number[][];
  pj: number[][];
  it: number[][];
  /** Jazidas: cheias ou em recomposição. */
  jz: number[][];
  /** Os bichos. */
  an: number[][];
  /** Os goblins da invasão. */
  iv: number[][];
  /** O totem do Modo Fera — `[id, x, y]`, ou vazio quando não há nenhum. */
  tm: number[];
  /**
   * O Guardião do Modo Covil — `[id, tipoIdx, x, y, vida, vidaMaxima]`, ou
   * vazio quando não há nenhum (nos outros modos, sempre).
   */
  gd: number[];
  /** Segundos restantes do buff de velocidade, `[azul, vermelho]`. */
  gb: number[];
  /** A Presa do Modo Caça — `[id, x, y, vida, vidaMaxima]`, ou vazio quando não há nenhuma. */
  pz: number[];
  /** Segundos restantes do buff de dano da Presa, `[azul, vermelho]`. */
  pb: number[];
  /** O cajado do Modo Xamã — `[id, x, y]`, ou vazio quando não há nenhum. */
  cj: number[];
  /** O Menino Rei do Modo Fuga — `[id, x, y]`, ou vazio quando não há nenhum. */
  mr: number[];
  /**
   * Se é noite agora, no Modo Vigília — `[1]` ou `[0]`, vazio fora dele
   * (`estado.noite` nunca sai de `false` em nenhum outro modo, então a
   * conta já sai vazia sozinha).
   */
  nt: number[];
  cz: number[][];
  /** A obra de cada time. */
  of: number[][];
  /** Chapéus em estoque: azul e vermelho, na ordem de `CLASSES_COM_CHAPEU`. */
  es: number[][];
  ev: Evento[];
}

const FASES: readonly Fase[] = ['aquecimento', 'jogando', 'ponto', 'fim'];
const CARGAS: readonly Carga[] = ['nada', 'madeira', 'ouro', 'minerio', 'bolsa', 'bau'];
const ITENS: readonly TipoDeItem[] = ['chapeu', 'bolsa', 'minerio', 'madeira', 'ouro'];
const ONDES: readonly Bau['onde'][] = ['cofre', 'carregado', 'chao', 'resgatado'];
const FERAS: readonly Fera[] = ['troll', 'minotauro'];
const PROJETEIS: readonly TipoDeProjetil[] = ['flecha', 'bolaDeCanhao'];
const VARIANTES: readonly VarianteDaInvasao[] = ['comum', 'tocha', 'slingshot'];
const TIPOS_DE_GUARDIAO: readonly TipoDeGuardiao[] = ['minotauro', 'panda', 'tartaruga', 'caveira'];

const idxTime = (t: Time): number => TIMES.indexOf(t);
const timePorIdx = (i: number): Time => TIMES[i]!;
const idxClasse = (c: Classe): number => CLASSES.indexOf(c);

const arred = (n: number): number => Math.round(n);

export function empacotar(estado: Estado): Retrato {
  return {
    p: [
      estado.tick,
      FASES.indexOf(estado.fase),
      arred(estado.faseEm * 10),
      arred(estado.relogio),
      estado.placar.azul,
      estado.placar.vermelho,
      estado.vencedor === null ? -1 : idxTime(estado.vencedor),
      estado.abates.azul,
      estado.abates.vermelho,
    ],
    // `[id, time, classe, x, y, olharX*100, olharY*100, vida, vivo, carga,
    //   golpe*100, colheita*100, renasceEm*10, ultimoComando, abates, mortes,
    //   depósitos, resgates, entregas, fera, xamaAte*10, porco*10]`
    //
    // `golpe` vai como centésimos de segundo, e não como um sim/não: é o
    // relógio da animação de ataque, e o cliente precisa dele para saber em que
    // ponto do arco da espada o boneco está.
    //
    // `fera` viaja separado de `classe` — o Modo Fera não troca a classe de
    // ninguém, só empresta um retrato diferente por cima dela por um tempo.
    //
    // `xamaAte` e `porco` (Modo Xamã) viajam pelo mesmo motivo de `golpe`:
    // não são só relógio interno — `porco` decide a velocidade que a própria
    // previsão do cliente calcula, e os dois decidem o que aparece sobre a
    // cabeça de quem está com eles.
    u: estado.unidades.map((u) => [
      u.id,
      idxTime(u.time),
      idxClasse(u.classe),
      arred(u.x),
      arred(u.y),
      arred(u.olharX * 100),
      arred(u.olharY * 100),
      arred(u.vida),
      u.vivo ? 1 : 0,
      CARGAS.indexOf(u.carga),
      arred(u.golpe * 100),
      arred(u.colheita * 100),
      arred(u.renasceEm * 10),
      u.ultimoComando,
      u.abates,
      u.mortes,
      u.depositos,
      u.resgates,
      u.entregas,
      u.fera === null ? -1 : FERAS.indexOf(u.fera),
      arred(u.xamaAte * 10),
      arred(u.porco * 10),
    ]),
    // `[time, peso, onde, x, y, portador, ajudantes, voltaEm]`
    pr: estado.baus.map((p) => [
      idxTime(p.time),
      arred(p.peso),
      ONDES.indexOf(p.onde),
      arred(p.x),
      arred(p.y),
      p.portador ?? -1,
      p.ajudantes,
      arred(p.voltaEm),
    ]),
    // `[id, time, x, y, vx, vy, tipo]`
    pj: estado.projeteis.map((p) => [
      p.id,
      idxTime(p.time),
      arred(p.x),
      arred(p.y),
      arred(p.vx),
      arred(p.vy),
      PROJETEIS.indexOf(p.tipo),
    ]),
    // `[id, tipo, classe, origem, x, y]`
    it: estado.itens.map((i) => [
      i.id,
      ITENS.indexOf(i.tipo),
      i.classe === null ? -1 : idxClasse(i.classe),
      i.origem === null ? -1 : idxTime(i.origem),
      arred(i.x),
      arred(i.y),
    ]),
    jz: estado.jazidas.map((j) => [j.id, j.cheia ? 1 : 0]),
    // `[id, x, y, vivo, fugindo]`
    an: estado.animais.map((a) => [
      a.id,
      arred(a.x),
      arred(a.y),
      a.vivo ? 1 : 0,
      a.fugindo > 0 ? 1 : 0,
    ]),
    // `[id, time, x, y, variante]`
    iv: estado.invasores.map((i) => [
      i.id,
      idxTime(i.time),
      arred(i.x),
      arred(i.y),
      VARIANTES.indexOf(i.variante),
    ]),
    tm: estado.totem ? [estado.totem.id, arred(estado.totem.x), arred(estado.totem.y)] : [],
    gd: estado.guardiao
      ? [
          estado.guardiao.id,
          TIPOS_DE_GUARDIAO.indexOf(estado.guardiao.tipo),
          arred(estado.guardiao.x),
          arred(estado.guardiao.y),
          arred(estado.guardiao.vida),
          arred(estado.guardiao.vidaMaxima),
        ]
      : [],
    gb: TIMES.map((t) => arred(estado.buffDoGuardiao[t])),
    pz: estado.presa
      ? [
          estado.presa.id,
          arred(estado.presa.x),
          arred(estado.presa.y),
          arred(estado.presa.vida),
          arred(estado.presa.vidaMaxima),
        ]
      : [],
    pb: TIMES.map((t) => arred(estado.buffDaPresa[t])),
    cj: estado.cajado ? [estado.cajado.id, arred(estado.cajado.x), arred(estado.cajado.y)] : [],
    mr: estado.meninoRei
      ? [estado.meninoRei.id, arred(estado.meninoRei.x), arred(estado.meninoRei.y)]
      : [],
    nt: estado.noite ? [1] : [],
    // `[time, minério, cunhando*10, bolsas]`
    cz: estado.casasDaMoeda.map((c) => [idxTime(c.time), c.minerio, arred(c.cunhando * 10), c.bolsas]),
    // `[time, madeira, ouro, nivel]`
    of: estado.oficinas.map((o) => [idxTime(o.time), o.madeira, o.ouro, o.nivel]),
    es: TIMES.map((t) => CLASSES_COM_CHAPEU.map((c) => estado.estoque[t][c])),
    ev: estado.eventos,
  };
}

/**
 * A leitura do retrato, do lado do cliente.
 *
 * Devolve um `Estado` do mesmo tipo que o servidor simula — de propósito. É o
 * que permite ao cliente rodar o **mesmo** código de movimento na previsão
 * local sem uma segunda versão dos tipos para manter em sincronia.
 */
export function desempacotar(r: Retrato, base: Estado): Estado {
  const [tick, fase, faseEm, relogio, azul, vermelho, vencedor, abAzul, abVermelho] =
    r.p as number[];
  base.tick = tick!;
  base.fase = FASES[fase!]!;
  base.faseEm = faseEm! / 10;
  base.relogio = relogio!;
  base.placar = { azul: azul!, vermelho: vermelho! };
  base.vencedor = vencedor! < 0 ? null : timePorIdx(vencedor!);
  base.abates = { azul: abAzul ?? 0, vermelho: abVermelho ?? 0 };

  const antigas = new Map(base.unidades.map((u) => [u.id, u]));
  base.unidades = r.u.map((linha) => {
    const id = linha[0]!;
    const anterior = antigas.get(id);
    const u: Unidade = anterior ?? {
      id,
      time: timePorIdx(linha[1]!),
      nome: '',
      bot: false,
      classe: 'aldeao',
      x: 0,
      y: 0,
      olharX: 1,
      olharY: 0,
      vida: 0,
      vivo: true,
      renasceEm: 0,
      recarga: 0,
      golpe: 0,
      carga: 'nada',
      colheita: 0,
      colhendoId: null,
      abates: 0,
      mortes: 0,
      depositos: 0,
      resgates: 0,
      entregas: 0,
      ultimoComando: 0,
      fera: null,
      feraAte: 0,
      xamaAte: 0,
      porco: 0,
    };
    u.time = timePorIdx(linha[1]!);
    u.classe = CLASSES[linha[2]!]!;
    u.x = linha[3]!;
    u.y = linha[4]!;
    u.olharX = linha[5]! / 100;
    u.olharY = linha[6]! / 100;
    u.vida = linha[7]!;
    u.vivo = linha[8]! === 1;
    u.carga = CARGAS[linha[9]!]!;
    u.golpe = linha[10]! / 100;
    u.colheita = linha[11]! / 100;
    u.renasceEm = linha[12]! / 10;
    u.ultimoComando = linha[13]!;
    u.abates = linha[14]!;
    u.mortes = linha[15]!;
    u.depositos = linha[16]!;
    u.resgates = linha[17]!;
    u.entregas = linha[18]!;
    const idxFera = linha[19]!;
    u.fera = idxFera < 0 ? null : FERAS[idxFera]!;
    u.xamaAte = (linha[20] ?? 0) / 10;
    u.porco = (linha[21] ?? 0) / 10;
    return u;
  });

  base.baus = r.pr.map((l) => ({
    time: timePorIdx(l[0]!),
    peso: l[1]!,
    onde: ONDES[l[2]!]!,
    x: l[3]!,
    y: l[4]!,
    portador: l[5]! < 0 ? null : l[5]!,
    ajudantes: l[6]!,
    voltaEm: l[7]!,
  }));

  base.projeteis = r.pj.map(
    (l): Projetil => ({
      id: l[0]!,
      tipo: PROJETEIS[l[6]!] ?? 'flecha',
      time: timePorIdx(l[1]!),
      dono: -1,
      x: l[2]!,
      y: l[3]!,
      vx: l[4]!,
      vy: l[5]!,
      dano: 0,
      vida: 1,
    }),
  );

  base.itens = r.it.map(
    (l): Item => ({
      id: l[0]!,
      tipo: ITENS[l[1]!]!,
      classe: l[2]! < 0 ? null : CLASSES[l[2]!]!,
      origem: l[3]! < 0 ? null : timePorIdx(l[3]!),
      x: l[4]!,
      y: l[5]!,
      voltaEm: 0,
    }),
  );

  base.jazidas = r.jz.map((l) => ({
    id: l[0]!,
    cheia: l[1]! === 1,
    voltaEm: 0,
    ocupadaPor: null,
  }));

  const antigos = new Map(base.animais.map((a) => [a.id, a]));
  base.animais = r.an.map((l) => {
    const id = l[0]!;
    const a = antigos.get(id) ?? {
      id,
      x: l[1]!,
      y: l[2]!,
      vida: 0,
      vivo: true,
      voltaEm: 0,
      destinoX: l[1]!,
      destinoY: l[2]!,
      pensaEm: 0,
      fugindo: 0,
    };
    // A posição anterior fica guardada no destino: é o que o desenho usa para
    // interpolar a ovelha entre dois retratos, do mesmo jeito que faz com gente.
    a.destinoX = a.x;
    a.destinoY = a.y;
    a.x = l[1]!;
    a.y = l[2]!;
    a.vivo = l[3]! === 1;
    a.fugindo = l[4]! === 1 ? 1 : 0;
    return a;
  });

  base.invasores = r.iv.map((l) => ({
    id: l[0]!,
    time: timePorIdx(l[1]!),
    x: l[2]!,
    y: l[3]!,
    variante: VARIANTES[l[4]!] ?? 'comum',
  }));

  base.totem = r.tm.length === 0 ? null : { id: r.tm[0]!, x: r.tm[1]!, y: r.tm[2]! };

  base.guardiao =
    r.gd.length === 0
      ? null
      : {
          id: r.gd[0]!,
          tipo: TIPOS_DE_GUARDIAO[r.gd[1]!] ?? 'minotauro',
          x: r.gd[2]!,
          y: r.gd[3]!,
          vida: r.gd[4]!,
          vidaMaxima: r.gd[5]!,
          golpeEm: 0,
        };
  base.buffDoGuardiao = { azul: r.gb[0] ?? 0, vermelho: r.gb[1] ?? 0 };

  base.presa =
    r.pz.length === 0
      ? null
      : {
          id: r.pz[0]!,
          x: r.pz[1]!,
          y: r.pz[2]!,
          vida: r.pz[3]!,
          vidaMaxima: r.pz[4]!,
          mordeEm: 0,
        };
  base.buffDaPresa = { azul: r.pb[0] ?? 0, vermelho: r.pb[1] ?? 0 };

  base.cajado = r.cj.length === 0 ? null : { id: r.cj[0]!, x: r.cj[1]!, y: r.cj[2]! };

  base.meninoRei = r.mr.length === 0 ? null : { id: r.mr[0]!, x: r.mr[1]!, y: r.mr[2]! };

  base.noite = r.nt[0] === 1;

  base.casasDaMoeda = r.cz.map((l) => ({
    time: timePorIdx(l[0]!),
    minerio: l[1]!,
    cunhando: l[2]! / 10,
    bolsas: l[3]!,
  }));

  base.oficinas = r.of.map((l) => ({
    time: timePorIdx(l[0]!),
    madeira: l[1]!,
    ouro: l[2]!,
    nivel: l[3]!,
  }));

  for (const [i, t] of TIMES.entries()) {
    for (const [j, c] of CLASSES_COM_CHAPEU.entries()) {
      base.estoque[t][c] = r.es[i]?.[j] ?? 0;
    }
  }

  base.eventos = r.ev;
  return base;
}
