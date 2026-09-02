import type { TipoDeEstrutura, TipoDeJazida } from './arena';
import { ARENA_LARGURA } from './regras';

/**
 * Os campos de batalha, como dado.
 *
 * ## O que um mapa muda, e o que ele não muda
 *
 * Um mapa não mexe em regra nenhuma: mesma balança, mesmos chapéus, mesmo bolo.
 * Ele mexe nas duas coisas que decidem o **ritmo** de uma partida — onde estão
 * os estrangulamentos, e quão exposta fica a economia. É por isso que quatro
 * mapas dão quatro jogos e não quatro papéis de parede.
 *
 * ## Só o lado azul é escrito
 *
 * Cada mapa desenha a metade esquerda e a coluna do eixo; o vermelho é o
 * espelho, montado por `criarArena`. É a mesma regra que a arena original já
 * seguia, e ela vale ainda mais agora: com quatro mapas, manter oito listas de
 * coordenadas em pares seria garantir que um dia a cozinha vermelha ficasse um
 * tile mais longe do que a azul, e ninguém descobriria sem medir.
 *
 * O `Pincel` que os relevos recebem espelha sozinho: escrever em `tx` escreve
 * também em `espelhar(tx)`. Um mapa que tentasse desenhar assimetria não
 * conseguiria — o que é exatamente a intenção.
 *
 * ## Todos no mesmo grid
 *
 * Sessenta por trinta e quatro, os quatro. Tamanhos diferentes exigiriam tirar
 * a largura de `espelhar` e espalhá-la por tudo o que hoje é constante, e o
 * ganho não paga: relevo e planta já mudam o jogo o bastante. O que varia é o
 * que está dentro do quadro, não o quadro.
 */

export type IdDoMapa = 'corte' | 'vau' | 'desfiladeiro' | 'arquipelago';

/**
 * O desenhista do relevo.
 *
 * Escreve sempre nos dois lados. `agua` e `ponte` recebem a coluna do lado
 * azul; quem cuida do espelho é quem construiu o pincel.
 */
export interface Pincel {
  readonly largura: number;
  readonly altura: number;
  agua(tx: number, ty: number): void;
  ponte(tx: number, ty: number): void;
  /** Devolve o chão ao que era, para abrir passagem num traço já desenhado. */
  chao(tx: number, ty: number): void;
}

export interface Mapa {
  readonly id: IdDoMapa;
  readonly nome: string;
  /** Uma linha: o que este mapa faz com a partida. */
  readonly lema: string;
  /**
   * A água e as pontes. A moldura da borda e a grama já vêm prontas.
   *
   * Só a metade azul precisa ser escrita — ver o topo deste arquivo.
   */
  relevo(p: Pincel): void;
  /** Onde cada construção fica, em tiles do lado azul. */
  readonly planta: Readonly<Record<TipoDeEstrutura, readonly [number, number]>>;
  /** Jazidas do lado azul. O espelho gera as do vermelho. */
  readonly jazidasDoLado: readonly (readonly [number, number, TipoDeJazida])[];
  /** Jazidas do meio, em pares espelhados. Ver a nota em `arena.ts`. */
  readonly jazidasDoMeio: readonly (readonly [number, number, TipoDeJazida])[];
  readonly pastosDoLado: readonly (readonly [number, number])[];
  readonly pastosDoMeio: readonly (readonly [number, number])[];
  /**
   * Os estrangulamentos que este mapa promete, para o teste conferir.
   *
   * O trecho (`de`..`ate`) faz parte da promessa: um fosso é um retângulo, e a
   * coluna dele só é parede nas linhas do próprio castelo — acima e abaixo se
   * contorna, o que é o desenho e não um defeito. Sem o trecho, o teste varreria
   * a coluna inteira e reprovaria o mapa por causa da grama que existe de
   * propósito.
   *
   * Uma lista vazia quer dizer "este mapa não estrangula nada", que é uma
   * escolha legítima — o Vau existe justamente para isso. O que não pode é o
   * mapa achar que estrangula e não estrangular.
   */
  readonly portoes: readonly {
    readonly coluna: number;
    readonly de: number;
    readonly ate: number;
    readonly passagens: readonly number[];
  }[];
}

const meio = (ARENA_LARGURA - 1) / 2;

// --- Corte ------------------------------------------------------------------

/**
 * O mapa original: dois castelos ilhados, um descampado no meio.
 *
 * O fosso dá à defesa algo para defender — sem ele o castelo teria uma frente
 * de vinte tiles e nenhum estrangulamento. As duas pontes ficam longe uma da
 * outra de propósito: coladas, um time seguraria as duas com os mesmos quatro
 * guerreiros e o mapa teria um portão só.
 *
 * O lago do meio existe para que o caminho mais curto entre as pontes de cima e
 * as de baixo não seja uma reta: quem troca de flanco paga em segundos, e é
 * isso que dá tempo de a defesa reagir.
 */
export const CASTELO = { x0: 2, y0: 6, x1: 16, y1: 27 } as const;
export const PONTES_Y = [10, 11, 22, 23] as const;

const CORTE: Mapa = {
  id: 'corte',
  nome: 'Corte',
  lema: 'castelo com fosso e duas pontes · o lago cobra para trocar de flanco',
  relevo(p) {
    for (let ty = CASTELO.y0; ty <= CASTELO.y1; ty++) p.agua(CASTELO.x1, ty);
    for (let tx = CASTELO.x0; tx <= CASTELO.x1; tx++) {
      p.agua(tx, CASTELO.y0);
      p.agua(tx, CASTELO.y1);
    }
    for (const py of PONTES_Y) p.ponte(CASTELO.x1, py);
    elipse(p, meio, (p.altura - 1) / 2, 3.5, 4.5);
  },
  planta: {
    trono: [5, 15],
    jaula: [6, 9],
    cozinha: [11, 20],
    chapelaria: [11, 12],
    nascedouro: [6, 20],
  },
  jazidasDoLado: [
    [13, 15, 'arvore'],
    [13, 17, 'arvore'],
    [8, 25, 'ouro'],
    [20, 9, 'arvore'],
    [20, 24, 'ouro'],
    [24, 16, 'ouro'],
  ],
  jazidasDoMeio: [
    [29, 4, 'arvore'],
    [30, 4, 'arvore'],
    [29, 29, 'arvore'],
    [30, 29, 'arvore'],
  ],
  pastosDoLado: [
    [10, 10],
    [22, 20],
  ],
  pastosDoMeio: [
    [29, 10],
    [30, 10],
    [29, 23],
    [30, 23],
    [25, 16],
    [34, 16],
  ],
  portoes: [{ coluna: CASTELO.x1, de: CASTELO.y0, ate: CASTELO.y1, passagens: [...PONTES_Y] }],
};

// --- Vau --------------------------------------------------------------------

/**
 * O oposto do Corte: castelo aberto, e o rio no meio do campo.
 *
 * Sem fosso, não há portão para segurar: quem defende tem de defender com os
 * pés, e uma invasão custa correr, não custa quebrar uma linha. Em troca, o
 * **meio** vira o único lugar estreito do mapa — três travessias num rio que
 * corta o campo de cima a baixo.
 *
 * O resultado é uma partida de campo aberto com uma briga fixa: a do vau. Quem
 * gosta do Corte gosta de segurar a ponte de casa; aqui a ponte é de ninguém.
 */
const TRAVESSIAS_Y = [7, 8, 16, 17, 25, 26] as const;

const VAU: Mapa = {
  id: 'vau',
  nome: 'Vau',
  lema: 'castelo aberto e um rio no meio · a briga é sempre nas travessias',
  relevo(p) {
    // O rio é uma coluna dupla no eixo: `agua` espelha, então escrever a coluna
    // do meio menos meio tile dá as duas colunas centrais.
    for (let ty = 2; ty < p.altura - 2; ty++) p.agua(Math.floor(meio), ty);
    for (const py of TRAVESSIAS_Y) p.ponte(Math.floor(meio), py);
  },
  planta: {
    trono: [5, 17],
    jaula: [5, 9],
    cozinha: [12, 22],
    chapelaria: [12, 11],
    nascedouro: [8, 17],
  },
  jazidasDoLado: [
    [10, 6, 'arvore'],
    [10, 27, 'arvore'],
    [16, 13, 'arvore'],
    [16, 20, 'ouro'],
    [21, 6, 'ouro'],
    [21, 27, 'ouro'],
  ],
  jazidasDoMeio: [
    [26, 12, 'arvore'],
    [33, 12, 'arvore'],
    [26, 21, 'ouro'],
    [33, 21, 'ouro'],
  ],
  pastosDoLado: [
    [7, 24],
    [18, 9],
  ],
  pastosDoMeio: [
    [24, 4],
    [35, 4],
    [24, 30],
    [35, 30],
    [23, 17],
    [36, 17],
  ],
  // Nada estrangula: é a proposta do mapa.
  portoes: [],
};

// --- Desfiladeiro -----------------------------------------------------------

/**
 * Uma ponte por castelo, e mais nada.
 *
 * O Corte dá duas portas e obriga a defesa a escolher; aqui há uma só, e a
 * escolha desaparece. Atacar exige juntar gente e passar por cima de quem está
 * lá — e o cortejo da princesa, que anda devagar e precisa de escolta, tem de
 * atravessar exatamente o tile onde a defesa está sentada.
 *
 * O meio fica limpo de propósito. Com um funil desses em cada ponta, um lago no
 * caminho tornaria cada investida cara demais para valer a pena, e a partida
 * viraria dois times olhando um para o outro.
 */
const CASTELO_ESTREITO = { x0: 2, y0: 5, x1: 15, y1: 28 } as const;
const PORTAO_Y = [16, 17] as const;

const DESFILADEIRO: Mapa = {
  id: 'desfiladeiro',
  nome: 'Desfiladeiro',
  lema: 'uma ponte por castelo · quem defende o portão defende tudo',
  relevo(p) {
    for (let ty = CASTELO_ESTREITO.y0; ty <= CASTELO_ESTREITO.y1; ty++) {
      p.agua(CASTELO_ESTREITO.x1, ty);
    }
    for (let tx = CASTELO_ESTREITO.x0; tx <= CASTELO_ESTREITO.x1; tx++) {
      p.agua(tx, CASTELO_ESTREITO.y0);
      p.agua(tx, CASTELO_ESTREITO.y1);
    }
    for (const py of PORTAO_Y) p.ponte(CASTELO_ESTREITO.x1, py);
  },
  planta: {
    trono: [5, 16],
    jaula: [6, 10],
    cozinha: [11, 22],
    chapelaria: [11, 11],
    nascedouro: [7, 16],
  },
  jazidasDoLado: [
    [12, 7, 'arvore'],
    [12, 26, 'arvore'],
    [9, 20, 'ouro'],
    [19, 8, 'arvore'],
    [19, 25, 'ouro'],
    [22, 16, 'ouro'],
  ],
  jazidasDoMeio: [
    [28, 6, 'arvore'],
    [31, 6, 'arvore'],
    [28, 27, 'ouro'],
    [31, 27, 'ouro'],
  ],
  pastosDoLado: [
    [8, 8],
    [8, 25],
  ],
  pastosDoMeio: [
    [26, 12],
    [33, 12],
    [26, 21],
    [33, 21],
    [29, 16],
    [30, 16],
  ],
  portoes: [
    {
      coluna: CASTELO_ESTREITO.x1,
      de: CASTELO_ESTREITO.y0,
      ate: CASTELO_ESTREITO.y1,
      passagens: [...PORTAO_Y],
    },
  ],
};

// --- Arquipélago ------------------------------------------------------------

/**
 * O meio do mapa vira uma ilha, e o ouro fica nela.
 *
 * Nos outros três, minerar é seguro: as jazidas de casa ficam atrás do fosso e
 * as do meio estão em campo aberto, mas dá para fugir. Aqui a melhor jazida de
 * ouro está numa ilha ligada por quatro pontes, e sair dela é passar por uma
 * delas. Cavar vira ato de guerra, e a obra da chapelaria — que nos outros
 * mapas é melhoria lateral — passa a exigir controlar território.
 *
 * O castelo mantém o fosso e as duas pontes do Corte: um mapa que estrangula
 * nas duas pontas seria só espera, e a ilha já é a parte difícil.
 */
const ILHA = { x0: 24, x1: 35, y0: 12, y1: 21 } as const;
const PONTES_DA_ILHA_Y = [14, 19] as const;

const ARQUIPELAGO: Mapa = {
  id: 'arquipelago',
  nome: 'Arquipélago',
  lema: 'o ouro do meio numa ilha cercada · cavar vira ato de guerra',
  relevo(p) {
    for (let ty = CASTELO.y0; ty <= CASTELO.y1; ty++) p.agua(CASTELO.x1, ty);
    for (let tx = CASTELO.x0; tx <= CASTELO.x1; tx++) {
      p.agua(tx, CASTELO.y0);
      p.agua(tx, CASTELO.y1);
    }
    for (const py of PONTES_Y) p.ponte(CASTELO.x1, py);

    // O canal que cerca a ilha do meio. Só o lado azul é escrito; o espelho faz
    // a borda leste, e o topo e a base são desenhados dos dois lados de uma vez
    // porque cada `agua(tx, ty)` já escreve o par.
    for (let ty = ILHA.y0; ty <= ILHA.y1; ty++) p.agua(ILHA.x0, ty);
    for (let tx = ILHA.x0; tx <= Math.floor(meio); tx++) {
      p.agua(tx, ILHA.y0);
      p.agua(tx, ILHA.y1);
    }
    for (const py of PONTES_DA_ILHA_Y) p.ponte(ILHA.x0, py);
    // E duas pontes por cima e por baixo, para a ilha não ser um beco.
    p.ponte(29, ILHA.y0);
    p.ponte(29, ILHA.y1);
  },
  planta: {
    trono: [5, 15],
    jaula: [6, 9],
    cozinha: [11, 20],
    chapelaria: [11, 12],
    nascedouro: [6, 20],
  },
  jazidasDoLado: [
    [13, 15, 'arvore'],
    [13, 17, 'arvore'],
    [8, 25, 'ouro'],
    [20, 9, 'arvore'],
    [20, 24, 'arvore'],
    [22, 30, 'ouro'],
  ],
  // O tesouro da ilha, e é ele que dá nome ao mapa.
  jazidasDoMeio: [
    [27, 16, 'ouro'],
    [32, 16, 'ouro'],
    [27, 17, 'ouro'],
    [32, 17, 'ouro'],
  ],
  pastosDoLado: [
    [10, 10],
    [21, 20],
  ],
  pastosDoMeio: [
    [28, 5],
    [31, 5],
    [28, 28],
    [31, 28],
    [26, 14],
    [33, 14],
  ],
  portoes: [
    { coluna: CASTELO.x1, de: CASTELO.y0, ate: CASTELO.y1, passagens: [...PONTES_Y] },
    { coluna: ILHA.x0, de: ILHA.y0, ate: ILHA.y1, passagens: [...PONTES_DA_ILHA_Y] },
  ],
};

// --- a tabela ---------------------------------------------------------------

export const MAPAS: Readonly<Record<IdDoMapa, Mapa>> = {
  corte: CORTE,
  vau: VAU,
  desfiladeiro: DESFILADEIRO,
  arquipelago: ARQUIPELAGO,
};

export const MAPA_PADRAO: IdDoMapa = 'corte';

/** A lista, na ordem em que a tela mostra. */
export const IDS_DOS_MAPAS: readonly IdDoMapa[] = [
  'corte',
  'vau',
  'desfiladeiro',
  'arquipelago',
];

/**
 * O mapa de um id vindo de fora.
 *
 * Tolerante pelo mesmo motivo de `modoDe`: o id chega pela rede, e um nome
 * desconhecido cai no padrão em vez de derrubar a sala.
 */
export function mapaDe(id: unknown): Mapa {
  return typeof id === 'string' && id in MAPAS ? MAPAS[id as IdDoMapa] : MAPAS[MAPA_PADRAO];
}

/**
 * Sorteia um mapa a partir da seed da partida.
 *
 * Determinístico de propósito: a seed já decide o mato e a partida inteira, e
 * fazer o mapa depender de `Math.random` seria a única coisa do jogo que o
 * servidor não conseguiria reproduzir ao investigar um defeito.
 */
export function mapaSorteado(seed: number): IdDoMapa {
  const i = (seed >>> 0) % IDS_DOS_MAPAS.length;
  return IDS_DOS_MAPAS[i]!;
}

/** Uma elipse de água, para o pincel. */
function elipse(p: Pincel, cx: number, cy: number, rx: number, ry: number): void {
  for (let ty = Math.floor(cy - ry); ty <= Math.ceil(cy + ry); ty++) {
    for (let tx = Math.floor(cx - rx); tx <= Math.ceil(cx); tx++) {
      const dx = (tx - cx) / rx;
      const dy = (ty - cy) / ry;
      if (dx * dx + dy * dy <= 1) p.agua(tx, ty);
    }
  }
}
