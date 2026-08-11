import type { Plot, PlacedBuilding } from '../building/plot';
import type { BuildingCategory } from '../building/buildingType';

/**
 * A ponte entre o catálogo do jogo e os sprites do pacote.
 *
 * ## Por que a ponte é por categoria
 *
 * O catálogo tem 41 construções; o pacote gratuito tem dez prédios. Mapear um a
 * um daria dez acertos e trinta e um buracos. Mapear por **categoria** dá uma
 * cidade legível: a silhueta não diz *qual* construção é, mas diz o que ela
 * faz — casa, oficina, torre, templo — e o rótulo diz o resto.
 *
 * É uma limitação de acervo, não de desenho: quando existir arte própria, só
 * esta tabela muda.
 *
 * ## Por que o nível escolhe dentro da categoria
 *
 * Quando a categoria tem mais de um sprite, o nível da construção decide qual.
 * Evoluir passa a ter efeito visível no terreno, que é o retorno que faltava:
 * antes, subir de nível só mexia num número na ficha.
 */

export const SPRITE_POR_CATEGORIA: Record<BuildingCategory, readonly string[]> = {
  housing: ['House1', 'House2', 'House3'],
  extraction: ['House3', 'Archery'],
  refining: ['Barracks'],
  manufacturing: ['Archery', 'Barracks'],
  commerce: ['House1_yellow'],
  infrastructure: ['Tower'],
  defense: ['Tower', 'Castle_red'],
  civic: ['Monastery', 'Castle'],
};

/** O sprite do pacote que representa uma construção do catálogo. */
export function spriteDoPredio(categoria: BuildingCategory, nivel = 1): string {
  const opcoes = SPRITE_POR_CATEGORIA[categoria] ?? SPRITE_POR_CATEGORIA.housing;
  const i = Math.min(Math.max(nivel, 1), opcoes.length) - 1;
  return opcoes[i]!;
}

/** Uma construção posicionada, em coordenadas de tile do mundo. */
export interface Predio {
  readonly sprite: string;
  readonly x: number;
  readonly y: number;
  /** Quantos tiles de largura o prédio ocupa. */
  readonly tiles: number;
  /** Quantos tiles de profundidade ocupa. Serve para o recorte da decoração. */
  readonly tilesAltura: number;
  readonly rotulo?: string;
  /**
   * Dias que faltam para a obra terminar. `0` é construção pronta.
   *
   * A obra é desenhada semitransparente: o prédio já ocupa o espaço — e a
   * regra do jogo diz que ocupa mesmo — mas ainda não produz, e a tela precisa
   * dizer isso sem abrir ficha nenhuma.
   */
  readonly obraDias?: number;
  /** Construção pronta e parada por falta de gente ou de insumo. */
  readonly parada?: boolean;
}

/** O retângulo do terreno, em tiles do mundo. */
export interface RetanguloTerreno {
  readonly minX: number;
  readonly minY: number;
  /** Inclusivo: o último tile que ainda é do terreno. */
  readonly maxX: number;
  readonly maxY: number;
}

export function retanguloDoTerreno(plot: {
  origin: { x: number; y: number };
  width: number;
  height: number;
}): RetanguloTerreno {
  return {
    minX: plot.origin.x,
    minY: plot.origin.y,
    maxX: plot.origin.x + plot.width - 1,
    maxY: plot.origin.y + plot.height - 1,
  };
}

export function dentroDoTerreno(r: RetanguloTerreno, x: number, y: number): boolean {
  return x >= r.minX && x <= r.maxX && y >= r.minY && y <= r.maxY;
}

/** O centro do terreno, em tiles do mundo. É onde o peão nasce. */
export function centroDoTerreno(plot: {
  origin: { x: number; y: number };
  width: number;
  height: number;
}): { x: number; y: number } {
  return {
    x: plot.origin.x + Math.floor(plot.width / 2),
    y: plot.origin.y + Math.floor(plot.height / 2),
  };
}

/**
 * As construções que o jogador realmente tem, prontas para desenhar.
 *
 * As coordenadas do `Plot` são **células do terreno**, e o desenho trabalha em
 * tiles do mundo. `worldTileFor` já faz essa conversão e é dele que sai o
 * deslocamento — repetir a soma aqui seria uma segunda verdade sobre onde o
 * terreno fica.
 */
export function prediosDoTerreno(plot: Plot): Predio[] {
  return plot.buildings.map((b: PlacedBuilding) => {
    const def = b.def;
    const tile = plot.worldTileFor(b.x, b.y);
    return {
      sprite: spriteDoPredio(def.category, b.level),
      x: tile.x,
      y: tile.y,
      tiles: def.width,
      tilesAltura: def.height,
      rotulo: b.level > 1 ? b.labelWithLevel : b.displayName,
      obraDias: b.isReady ? 0 : b.daysRemaining,
      parada: b.isReady && b.idle,
    };
  });
}
