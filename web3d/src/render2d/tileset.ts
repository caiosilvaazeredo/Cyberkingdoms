/**
 * O tilemap do Tiny Swords, e a regra que escolhe cada peça.
 *
 * ## O que o guia do pacote define
 *
 * Tile de 64×64, e as camadas empilhadas nesta ordem: cor de fundo, espuma da
 * água, chão plano, e então sombra + chão elevado repetidos por nível de
 * elevação. Espuma e sombra são sprites de 128×128 desenhados sobre a grade de
 * 64 — eles **vazam** para fora do tile de propósito, e é esse vazamento que dá
 * o contorno macio da ilha.
 *
 * ## Por que autotiling, e não desenhar o mapa à mão
 *
 * O mundo do CyberKingdoms é procedural: a costa muda a cada seed. Não existe
 * mapa desenhado para consultar — a peça certa de cada tile precisa sair da
 * vizinhança dele, calculada na hora.
 *
 * A regra usa os **quatro vizinhos** (norte, sul, leste, oeste), e não os oito.
 * Com quatro, dezesseis combinações cobrem tudo que o conjunto do pacote
 * oferece: o bloco 3×3 de cantos e bordas, as duas tiras de um tile de largura,
 * e a peça isolada. Usar oito exigiria as diagonais internas, que este conjunto
 * não traz — pedir 47 peças de um tileset de 16 é o caminho mais rápido para um
 * mapa cheio de buraco.
 */

/** Lado do tile, em pixels. É o número que o guia fixa. */
export const TILE = 64;

/** Coluna e linha dentro do atlas, em tiles. */
export interface Celula {
  readonly col: number;
  readonly row: number;
}

/**
 * O bloco 3×3 de chão plano, mais as tiras e a peça isolada.
 *
 * As coordenadas saem da leitura do `Tilemap_color1.png`: o bloco de cantos e
 * bordas ocupa as colunas 0–2 nas linhas 0–2; a coluna 3 é a tira vertical de
 * um tile de largura; a linha 3 é a tira horizontal; e a célula (3,3) é o tile
 * solto, sem vizinho nenhum.
 */
const CHAO = {
  cantoNO: { col: 0, row: 0 },
  bordaN: { col: 1, row: 0 },
  cantoNE: { col: 2, row: 0 },
  bordaO: { col: 0, row: 1 },
  centro: { col: 1, row: 1 },
  bordaL: { col: 2, row: 1 },
  cantoSO: { col: 0, row: 2 },
  bordaS: { col: 1, row: 2 },
  cantoSE: { col: 2, row: 2 },

  tiraVerticalTopo: { col: 3, row: 0 },
  tiraVerticalMeio: { col: 3, row: 1 },
  tiraVerticalBase: { col: 3, row: 2 },

  tiraHorizontalOeste: { col: 0, row: 3 },
  tiraHorizontalMeio: { col: 1, row: 3 },
  tiraHorizontalLeste: { col: 2, row: 3 },

  isolado: { col: 3, row: 3 },
} as const satisfies Record<string, Celula>;

/** Bits da vizinhança. A ordem não importa desde que seja sempre a mesma. */
export const NORTE = 1;
export const LESTE = 2;
export const SUL = 4;
export const OESTE = 8;

/**
 * A peça de chão para uma vizinhança.
 *
 * Lê-se assim: um tile que tem terra ao norte e ao sul, mas não a leste nem a
 * oeste, é um pedaço de istmo vertical — a tira de um tile de largura. Um tile
 * sem vizinho nenhum é uma ilhota.
 */
export function chaoPara(mascara: number): Celula {
  const n = (mascara & NORTE) !== 0;
  const l = (mascara & LESTE) !== 0;
  const s = (mascara & SUL) !== 0;
  const o = (mascara & OESTE) !== 0;

  if (n && l && s && o) return CHAO.centro;

  if (n && s && l) return CHAO.bordaO;
  if (n && s && o) return CHAO.bordaL;
  if (l && o && s) return CHAO.bordaN;
  if (l && o && n) return CHAO.bordaS;

  if (s && l) return CHAO.cantoNO;
  if (s && o) return CHAO.cantoNE;
  if (n && l) return CHAO.cantoSO;
  if (n && o) return CHAO.cantoSE;

  if (n && s) return CHAO.tiraVerticalMeio;
  if (l && o) return CHAO.tiraHorizontalMeio;

  if (s) return CHAO.tiraVerticalTopo;
  if (n) return CHAO.tiraVerticalBase;
  if (l) return CHAO.tiraHorizontalOeste;
  if (o) return CHAO.tiraHorizontalLeste;

  return CHAO.isolado;
}

/** Monta a máscara a partir de uma consulta "é terra?". */
export function mascaraDe(
  x: number,
  y: number,
  ehTerra: (x: number, y: number) => boolean,
): number {
  return (
    (ehTerra(x, y - 1) ? NORTE : 0) |
    (ehTerra(x + 1, y) ? LESTE : 0) |
    (ehTerra(x, y + 1) ? SUL : 0) |
    (ehTerra(x - 1, y) ? OESTE : 0)
  );
}

/**
 * Se este tile de terra encosta na água.
 *
 * A espuma vai onde o terreno toca a água, e aí entram as **oito** vizinhas: um
 * tile cuja única água é na diagonal ainda tem espuma naquele canto, e conferir
 * só as quatro deixaria um buraco visível na quina de cada enseada.
 */
export function encostaNaAgua(
  x: number,
  y: number,
  ehTerra: (x: number, y: number) => boolean,
): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (!ehTerra(x + dx, y + dy)) return true;
    }
  }
  return false;
}
