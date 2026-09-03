/**
 * O autotiling do chão — a mesma regra que o cliente 2D do CyberKingdoms usa.
 *
 * O conjunto do Tiny Swords traz um bloco 3×3 de cantos e bordas, duas tiras de
 * um tile de largura e uma peça isolada: dezesseis combinações, que é
 * exatamente o que a vizinhança de **quatro** lados produz. Usar as oito
 * exigiria as diagonais internas, que este conjunto não tem — pedir 47 peças de
 * um tileset de 16 é o caminho mais curto para um mapa cheio de buraco.
 */

export const TILE = 64;

export interface Celula {
  readonly col: number;
  readonly row: number;
}

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

export const NORTE = 1;
export const LESTE = 2;
export const SUL = 4;
export const OESTE = 8;

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

export function mascaraDe(
  x: number,
  y: number,
  ehChao: (x: number, y: number) => boolean,
): number {
  return (
    (ehChao(x, y - 1) ? NORTE : 0) |
    (ehChao(x + 1, y) ? LESTE : 0) |
    (ehChao(x, y + 1) ? SUL : 0) |
    (ehChao(x - 1, y) ? OESTE : 0)
  );
}

/**
 * Se o tile encosta na água — e aqui são as **oito** vizinhas.
 *
 * A espuma vai onde a terra toca o mar, e um tile cuja única água está na
 * diagonal ainda precisa de espuma naquele canto. Conferir só as quatro deixa
 * um buraco visível em cada quina de enseada.
 */
export function encostaNaAgua(
  x: number,
  y: number,
  ehChao: (x: number, y: number) => boolean,
): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (!ehChao(x + dx, y + dy)) return true;
    }
  }
  return false;
}
