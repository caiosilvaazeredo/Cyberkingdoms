import { Biome, biomeDef } from './biome';

/**
 * O que ocupa um tile além do chão.
 *
 * **O chão nunca aparece aqui: todo tile do mundo é mato.** O que muda de um
 * bioma para outro é a espécie da vegetação, a densidade e o tom — não o
 * pavimento. Não existem estradas nem rodovias no terreno; as rotas entre
 * cidades são uma abstração da `WorldLayout`, percorrida pela tela de viagem e
 * não pisada tile a tile.
 */
export const enum TileFeature {
  none = 'none',

  // Vegetação
  tree = 'tree',
  denseTree = 'denseTree',
  deadTree = 'deadTree',
  bush = 'bush',
  grassTuft = 'grassTuft',
  flowers = 'flowers',
  mushroom = 'mushroom',
  stump = 'stump',
  fallenLog = 'fallenLog',
  crops = 'crops',
  cactus = 'cactus',
  lily = 'lily',

  // Relevo
  rock = 'rock',
  boulder = 'boulder',
  cliff = 'cliff',

  // Ocupação humana
  rubble = 'rubble',
  scrapPile = 'scrapPile',
  oilPump = 'oilPump',
  building = 'building',
  tower = 'tower',
  wall = 'wall',
  fence = 'fence',
  crate = 'crate',
  extractionRig = 'extractionRig',
  marketStall = 'marketStall',
  camp = 'camp',
  campfire = 'campfire',
  wreck = 'wreck',
}

/**
 * Só o que um corpo não atravessa.
 *
 * Mato alto, flores e cogumelos são cenário. Bloquear tudo que é vegetação
 * transformaria a floresta num labirinto que o jogador não enxerga — ele veria
 * mato igual dos dois lados e não entenderia por que um deles não deixa passar.
 */
export function blocksMovement(feature: TileFeature): boolean {
  return (
    feature === TileFeature.building ||
    feature === TileFeature.tower ||
    feature === TileFeature.wall ||
    feature === TileFeature.denseTree ||
    feature === TileFeature.boulder ||
    feature === TileFeature.cliff
  );
}

export interface WorldTile {
  readonly biome: Biome;
  /** Altura em unidades de elevação. Vale para o visual e para a travessia. */
  readonly elevation: number;
  readonly feature: TileFeature;
  /** Id do assentamento que ocupa este tile, se houver. */
  readonly settlementId: string | null;
  /** Recurso de Camada 1 extraível aqui. */
  readonly resource: string | null;
  /** 0..1. Multiplica o rendimento de um dia de trabalho neste tile. */
  readonly resourceRichness: number;
}

export function isWalkable(tile: WorldTile): boolean {
  return biomeDef(tile.biome).walkable && !blocksMovement(tile.feature);
}

export function isUrban(tile: WorldTile): boolean {
  return tile.settlementId !== null;
}

export function hasResource(tile: WorldTile): boolean {
  return tile.resource !== null && tile.resourceRichness > 0;
}

/**
 * Custo de atravessar um tile, combinando bioma e relevo.
 *
 * Não há bônus de estrada: o terreno é mato de ponta a ponta. Viajar depressa
 * entre cidades continua existindo, mas pela rota da `WorldLayout` — uma
 * decisão da tela de viagem, não uma faixa de asfalto no chão.
 */
export function travelCost(tile: WorldTile): number {
  if (!isWalkable(tile)) return Infinity;
  const slopePenalty = 1 + Math.abs(tile.elevation) * 0.04;
  // Mato fechado atrasa quem corta caminho por dentro dele.
  const brushPenalty =
    tile.feature === TileFeature.tree ||
    tile.feature === TileFeature.bush ||
    tile.feature === TileFeature.crops
      ? 1.15
      : tile.feature === TileFeature.grassTuft
        ? 1.05
        : 1.0;
  return biomeDef(tile.biome).travelCost * slopePenalty * brushPenalty;
}
