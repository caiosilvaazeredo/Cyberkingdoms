import { DeterministicRandom } from './rng';
import { ARENA_ALTURA, ARENA_LARGURA, TILE, TIMES, type Time } from './regras';

/**
 * O campo de batalha: dois castelos ilhados, um descampado no meio.
 *
 * ## Por que o mapa não trafega na rede
 *
 * A arena é uma **função pura da seed**. Servidor e cliente rodam este mesmo
 * arquivo e chegam ao mesmo tile, então o servidor manda um número e o cliente
 * monta o mapa inteiro. Não há mapa serializado para versionar, nem risco de o
 * cliente desenhar uma ponte onde o servidor vê água — o desencontro seria
 * invisível até alguém atravessar.
 *
 * ## Por que fosso, e não muralha
 *
 * O pacote de arte não tem muro. Tem água, e tem espuma que se desenha sozinha
 * onde a terra encosta no mar. Cercar cada castelo com um fosso resolve as duas
 * coisas ao mesmo tempo: dá o estrangulamento que o jogo precisa — só se entra
 * por duas pontes, e é nelas que a partida acontece — e sai bonito de graça,
 * porque o mesmo autotiling que desenha a costa desenha o fosso.
 *
 * ## Simetria por espelho
 *
 * Só o lado azul é escrito. O vermelho é o espelho em X, montado por código.
 * Um mapa competitivo assimétrico exige balanceamento que este jogo não tem
 * como pagar, e duas listas de coordenadas para manter iguais é a receita para
 * o dia em que a cozinha vermelha fica um tile mais longe do que a azul.
 */

export const AGUA = 0;
export const GRAMA = 1;
export const PONTE = 2;

export type TipoDeEstrutura =
  /** O castelo. Entregar a princesa aqui vale ponto. */
  | 'trono'
  /** A masmorra onde dorme a princesa **inimiga**. É aqui que se alimenta. */
  | 'jaula'
  /** Recebe trigo, devolve bolo. */
  | 'cozinha'
  /** O estoque de chapéus do time. */
  | 'chapelaria'
  /** Onde o time renasce. */
  | 'nascedouro';

export interface Estrutura {
  readonly tipo: TipoDeEstrutura;
  readonly time: Time;
  /** Centro, em unidades de mundo. */
  readonly x: number;
  readonly y: number;
  /** Canto superior esquerdo da pegada, em tiles. Só o desenho usa. */
  readonly tx: number;
  readonly ty: number;
}

export interface Trigal {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  /** `null` quando é do meio do campo, disputado pelos dois. */
  readonly lado: Time | null;
}

export interface Arena {
  readonly seed: number;
  readonly largura: number;
  readonly altura: number;
  readonly tiles: Uint8Array;
  readonly estruturas: readonly Estrutura[];
  readonly trigais: readonly Trigal[];
  tile(tx: number, ty: number): number;
  ehChao(tx: number, ty: number): boolean;
  bloqueado(tx: number, ty: number): boolean;
  estrutura(tipo: TipoDeEstrutura, time: Time): Estrutura;
}

/** Espelha uma coluna para o lado vermelho. */
export const espelhar = (tx: number): number => ARENA_LARGURA - 1 - tx;

/**
 * O recorte do castelo azul, em tiles, e as duas pontes que o ligam ao campo.
 *
 * O fosso é a borda deste retângulo. As pontes ficam longe uma da outra de
 * propósito: se estivessem coladas, um time seguraria as duas com os mesmos
 * quatro guerreiros e o mapa teria um portão só.
 */
export const CASTELO = { x0: 2, y0: 6, x1: 16, y1: 27 } as const;
export const PONTES_Y = [10, 11, 22, 23] as const;

/** Onde cada coisa fica dentro do castelo azul, em tiles. */
const PLANTA: Readonly<Record<TipoDeEstrutura, readonly [number, number]>> = {
  trono: [5, 15],
  jaula: [6, 9],
  cozinha: [11, 20],
  chapelaria: [11, 12],
  nascedouro: [6, 20],
};

/**
 * Trigais do lado azul, e os do meio (que aparecem só uma vez).
 *
 * Dois ficam **dentro** do castelo e dois fora, e a divisão é o desenho
 * econômico do jogo. Só com trigo no campo aberto, um time encurralado perde a
 * cozinha junto com o território e não tem como voltar — a partida acabaria
 * antes do placar. Só com trigo em casa, ninguém precisaria sair, e o meio do
 * mapa seria enfeite. Com os dois, a economia mínima é segura e a economia que
 * **ganha a balança** exige sair de casa.
 */
const TRIGAIS_DO_LADO: readonly (readonly [number, number])[] = [
  [13, 16],
  [8, 24],
  [19, 8],
  [19, 25],
];
const TRIGAIS_DO_MEIO: readonly (readonly [number, number])[] = [
  [30, 6],
  [30, 27],
];

const centro = (tx: number, ty: number): { x: number; y: number } => ({
  x: (tx + 0.5) * TILE,
  y: (ty + 0.5) * TILE,
});

export function criarArena(seed: number): Arena {
  const largura = ARENA_LARGURA;
  const altura = ARENA_ALTURA;
  const tiles = new Uint8Array(largura * altura);

  const por = (tx: number, ty: number, v: number): void => {
    if (tx < 0 || ty < 0 || tx >= largura || ty >= altura) return;
    tiles[ty * largura + tx] = v;
  };

  // Chão por toda parte, e uma moldura de água de dois tiles. A moldura não é
  // decoração: é o que impede a câmera de mostrar o vazio fora do mapa.
  tiles.fill(GRAMA);
  for (let ty = 0; ty < altura; ty++) {
    for (let tx = 0; tx < largura; tx++) {
      if (tx < 2 || ty < 2 || tx >= largura - 2 || ty >= altura - 2) por(tx, ty, AGUA);
    }
  }

  // O fosso de cada castelo, e as pontes por cima dele.
  for (const time of TIMES) {
    const mapear = (tx: number): number => (time === 'azul' ? tx : espelhar(tx));
    for (let ty = CASTELO.y0; ty <= CASTELO.y1; ty++) {
      por(mapear(CASTELO.x1), ty, AGUA);
    }
    for (let tx = CASTELO.x0; tx <= CASTELO.x1; tx++) {
      por(mapear(tx), CASTELO.y0, AGUA);
      por(mapear(tx), CASTELO.y1, AGUA);
    }
    for (const py of PONTES_Y) por(mapear(CASTELO.x1), py, PONTE);
  }

  // Um lago no meio do descampado. Ele existe para que o caminho mais curto
  // entre as duas pontes de cima e as duas de baixo não seja uma reta: quem
  // troca de flanco paga em segundos, e é isso que dá tempo de a defesa
  // reagir.
  //
  // O centro é o **eixo do espelho** — `(largura - 1) / 2`, que cai entre dois
  // tiles —, e não o tile do meio. Centrar num tile deslocaria o lago meio tile
  // para um dos lados, e a arena deixaria de ser simétrica exatamente no lugar
  // onde os dois times se encontram.
  const lagoCx = (largura - 1) / 2;
  const lagoCy = (altura - 1) / 2;
  for (let ty = Math.floor(lagoCy) - 5; ty <= Math.ceil(lagoCy) + 5; ty++) {
    for (let tx = Math.floor(lagoCx) - 4; tx <= Math.ceil(lagoCx) + 4; tx++) {
      const dx = (tx - lagoCx) / 3.5;
      const dy = (ty - lagoCy) / 4.5;
      if (dx * dx + dy * dy <= 1) por(tx, ty, AGUA);
    }
  }

  const estruturas: Estrutura[] = [];
  for (const time of TIMES) {
    for (const tipo of Object.keys(PLANTA) as TipoDeEstrutura[]) {
      const [tx, ty] = PLANTA[tipo];
      const cx = time === 'azul' ? tx : espelhar(tx);
      estruturas.push({ tipo, time, tx: cx, ty, ...centro(cx, ty) });
    }
  }

  const trigais: Trigal[] = [];
  let idTrigal = 0;
  for (const time of TIMES) {
    for (const [tx, ty] of TRIGAIS_DO_LADO) {
      const cx = time === 'azul' ? tx : espelhar(tx);
      trigais.push({ id: idTrigal++, lado: time, ...centro(cx, ty) });
    }
  }
  for (const [tx, ty] of TRIGAIS_DO_MEIO) {
    trigais.push({ id: idTrigal++, lado: null, ...centro(tx, ty) });
  }

  // Nenhum trigal pode nascer dentro d'água — o lago do meio é grande e a
  // planta é escrita à mão. Errar isso deixaria um trigo inalcançável, e a
  // economia do time morreria por um erro de digitação.
  for (const t of trigais) {
    const tx = Math.floor(t.x / TILE);
    const ty = Math.floor(t.y / TILE);
    if (tiles[ty * largura + tx] === AGUA) {
      throw new Error(`trigal ${t.id} caiu na água em (${tx}, ${ty})`);
    }
  }

  const tile = (tx: number, ty: number): number => {
    if (tx < 0 || ty < 0 || tx >= largura || ty >= altura) return AGUA;
    return tiles[ty * largura + tx]!;
  };

  return {
    seed,
    largura,
    altura,
    tiles,
    estruturas,
    trigais,
    tile,
    ehChao: (tx, ty) => tile(tx, ty) !== AGUA,
    bloqueado: (tx, ty) => tile(tx, ty) === AGUA,
    estrutura(tipo, time) {
      const achada = estruturas.find((e) => e.tipo === tipo && e.time === time);
      if (!achada) throw new Error(`estrutura ausente: ${tipo}/${time}`);
      return achada;
    },
  };
}

/**
 * Empurra um círculo para fora dos tiles bloqueados.
 *
 * Resolve um eixo de cada vez, e nessa ordem por um motivo prático: com os dois
 * juntos, quem corre encostado numa parede gruda na quina de cada tile. Um eixo
 * de cada vez faz a unidade **deslizar** ao longo da parede, que é o que a mão
 * do jogador espera quando segura a diagonal.
 */
export function resolverColisao(
  arena: Arena,
  x: number,
  y: number,
  raio: number,
): { x: number; y: number } {
  let px = x;
  let py = y;
  for (let passo = 0; passo < 2; passo++) {
    const tx0 = Math.floor((px - raio) / TILE);
    const tx1 = Math.floor((px + raio) / TILE);
    const ty0 = Math.floor((py - raio) / TILE);
    const ty1 = Math.floor((py + raio) / TILE);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (!arena.bloqueado(tx, ty)) continue;
        const esq = tx * TILE;
        const dir = esq + TILE;
        const topo = ty * TILE;
        const base = topo + TILE;
        const maisPertoX = Math.max(esq, Math.min(px, dir));
        const maisPertoY = Math.max(topo, Math.min(py, base));
        const dx = px - maisPertoX;
        const dy = py - maisPertoY;
        const d2 = dx * dx + dy * dy;
        if (d2 >= raio * raio) continue;
        if (d2 > 0.0001) {
          const d = Math.sqrt(d2);
          px += (dx / d) * (raio - d);
          py += (dy / d) * (raio - d);
        } else {
          // Centro exatamente dentro do tile: não há direção de saída, então
          // vale o eixo de menor penetração. Acontece quando alguém nasce em
          // cima de uma quina, e sem este caso a unidade ficaria presa.
          const paraEsq = px - esq;
          const paraDir = dir - px;
          const paraTopo = py - topo;
          const paraBase = base - py;
          const menor = Math.min(paraEsq, paraDir, paraTopo, paraBase);
          if (menor === paraEsq) px = esq - raio;
          else if (menor === paraDir) px = dir + raio;
          else if (menor === paraTopo) py = topo - raio;
          else py = base + raio;
        }
      }
    }
  }
  return { x: px, y: py };
}

/** Se a reta entre dois pontos passa por água. Vale para flecha e para bola. */
export function linhaLivre(
  arena: Arena,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): boolean {
  const passos = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (TILE / 2));
  for (let i = 1; i < passos; i++) {
    const t = i / passos;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    if (arena.bloqueado(Math.floor(x / TILE), Math.floor(y / TILE))) return false;
  }
  return true;
}

export type Decoracao = 'arvore' | 'arbusto' | 'pedra';

/**
 * O mato, decidido por seed e coordenada.
 *
 * Só o cliente chama. Decoração não colide com nada — se colidisse, seria
 * estado do jogo e teria de vir do servidor. Um arbusto que empata a corrida do
 * carregador precisa estar no mesmo lugar para os doze jogadores; um arbusto
 * que só enfeita não precisa, e não paga banda por isso.
 */
export function decoracaoEm(
  arena: Arena,
  tx: number,
  ty: number,
): { tipo: Decoracao; variante: number; deslocamento: number } | null {
  if (!arena.ehChao(tx, ty) || arena.tile(tx, ty) === PONTE) return null;
  // Perto de qualquer estrutura o chão é limpo: é pátio de castelo, não mata.
  for (const e of arena.estruturas) {
    if (Math.abs(e.tx - tx) <= 2 && Math.abs(e.ty - ty) <= 2) return null;
  }
  for (const t of arena.trigais) {
    if (Math.abs(t.x / TILE - 0.5 - tx) <= 1.5 && Math.abs(t.y / TILE - 0.5 - ty) <= 1.5) {
      return null;
    }
  }
  const dado = new DeterministicRandom(
    (arena.seed ^ (tx * 374761393) ^ (ty * 668265263)) >>> 0,
  );
  const sorte = dado.nextDouble();
  const variante = dado.nextIntBelow(4);
  const deslocamento = dado.nextIntBelow(8);
  if (sorte < 0.07) return { tipo: 'arvore', variante, deslocamento };
  if (sorte < 0.12) return { tipo: 'arbusto', variante, deslocamento };
  if (sorte < 0.15) return { tipo: 'pedra', variante, deslocamento };
  return null;
}
