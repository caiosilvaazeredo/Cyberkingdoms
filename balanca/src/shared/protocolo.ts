import { CLASSES, CLASSES_COM_CHAPEU, type Classe } from './classes';
import type {
  Carga,
  Estado,
  Evento,
  Fase,
  Item,
  Princesa,
  Projetil,
  TipoDeItem,
  Unidade,
} from './estado';
import { TIMES, type Time } from './regras';

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
 * princesas, um punhado de projéteis. Um pacote completo custa ~1,5 kB e tem
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
 * O mapa não viaja: o cliente monta a arena a partir da seed.
 */

export const VERSAO_DO_PROTOCOLO = 3;

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
  /** Botão de contexto: pegar, entregar, alimentar, vestir. */
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
    }
  /**
   * Escolher o lado é uma mensagem separada de entrar, e não um campo dela.
   *
   * Quem acabou de conectar ainda não sabe o que quer: precisa **ver** os dois
   * times para escolher, e para ver precisa já estar conectado. Então entrar dá
   * um espectador, e é esta mensagem que transforma o espectador em jogador.
   */
  | { t: 'escolherTime'; time: Time; nome?: string }
  | { t: 'comando'; c: Comando }
  | { t: 'ping'; tempo: number }
  | { t: 'sair' };

// --- servidor → cliente ----------------------------------------------------

export interface FichaDeJogador {
  id: number;
  nome: string;
  time: Time;
  bot: boolean;
}

export type DoServidor =
  | {
      t: 'bemvindo';
      seed: number;
      sala: string;
      porTime: number;
    }
  /**
   * O espectador virou jogador. Chega depois de `escolherTime`, e de novo a
   * cada partida nova — a sala não morre no fim do jogo, monta a próxima.
   */
  | { t: 'nasceu'; voce: number; time: Time }
  | { t: 'elenco'; jogadores: FichaDeJogador[] }
  | { t: 'retrato'; r: Retrato }
  | { t: 'pong'; tempo: number }
  | { t: 'recusado'; motivo: string };

export interface Retrato {
  /** `[tick, faseIdx, faseEm*10, relogio, placarAzul, placarVermelho, vencedor]` */
  p: number[];
  u: number[][];
  pr: number[][];
  pj: number[][];
  it: number[][];
  /** Jazidas: cheias ou em recomposição. */
  jz: number[][];
  /** Os bichos. */
  an: number[][];
  cz: number[][];
  /** A obra de cada time. */
  of: number[][];
  /** Chapéus em estoque: azul e vermelho, na ordem de `CLASSES_COM_CHAPEU`. */
  es: number[][];
  ev: Evento[];
}

const FASES: readonly Fase[] = ['aquecimento', 'jogando', 'ponto', 'fim'];
const CARGAS: readonly Carga[] = ['nada', 'madeira', 'ouro', 'carne', 'bolo', 'princesa'];
const ITENS: readonly TipoDeItem[] = ['chapeu', 'bolo', 'carne', 'madeira', 'ouro'];
const ONDES: readonly Princesa['onde'][] = ['jaula', 'carregada', 'chao', 'salva'];

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
    ],
    // `[id, time, classe, x, y, olharX*100, olharY*100, vida, vivo, carga,
    //   golpe*100, colheita*100, renasceEm*10, ultimoComando, abates, mortes,
    //   fatias, resgates, entregas]`
    //
    // `golpe` vai como centésimos de segundo, e não como um sim/não: é o
    // relógio da animação de ataque, e o cliente precisa dele para saber em que
    // ponto do arco da espada o boneco está.
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
      u.fatias,
      u.resgates,
      u.entregas,
    ]),
    // `[time, peso, onde, x, y, portador, ajudantes, voltaEm]`
    pr: estado.princesas.map((p) => [
      idxTime(p.time),
      arred(p.peso),
      ONDES.indexOf(p.onde),
      arred(p.x),
      arred(p.y),
      p.portador ?? -1,
      p.ajudantes,
      arred(p.voltaEm),
    ]),
    // `[id, time, x, y, vx, vy]`
    pj: estado.projeteis.map((p) => [
      p.id,
      idxTime(p.time),
      arred(p.x),
      arred(p.y),
      arred(p.vx),
      arred(p.vy),
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
    // `[time, carne, assando*10, bolos]`
    cz: estado.cozinhas.map((c) => [idxTime(c.time), c.carne, arred(c.assando * 10), c.bolos]),
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
  const [tick, fase, faseEm, relogio, azul, vermelho, vencedor] = r.p as number[];
  base.tick = tick!;
  base.fase = FASES[fase!]!;
  base.faseEm = faseEm! / 10;
  base.relogio = relogio!;
  base.placar = { azul: azul!, vermelho: vermelho! };
  base.vencedor = vencedor! < 0 ? null : timePorIdx(vencedor!);

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
      fatias: 0,
      resgates: 0,
      entregas: 0,
      ultimoComando: 0,
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
    u.fatias = linha[16]!;
    u.resgates = linha[17]!;
    u.entregas = linha[18]!;
    return u;
  });

  base.princesas = r.pr.map((l) => ({
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
      tipo: 'flecha',
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

  base.cozinhas = r.cz.map((l) => ({
    time: timePorIdx(l[0]!),
    carne: l[1]!,
    assando: l[2]! / 10,
    bolos: l[3]!,
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
