import recipesJson from '../data/recipes.json';

import { citizenRank, type CitizenLevel } from '../building/buildingType';
import type { AttributeSet } from '../character/attributes';
import { SurvivalTables, type Upkeep } from '../survival/survival';
import { itemDef, type ProductionTier } from './item';

/**
 * O livro de receitas — extrair → refinar → manufaturar.
 *
 * Os dados vivem em `src/data/recipes.json`, gerado a partir do Dart pelo
 * `test/catalog_export_test.dart`. Este arquivo traz só a **regra**, que é o
 * que não cabe em JSON: rendimento por Inteligência, custo de sobrevivência
 * por estação, e os filtros por nível e estação.
 *
 * A cadeia é estreita de propósito no gargalo — terras raras → chip. É o
 * gargalo que cria cartel e monopólio, que são as dinâmicas que o GDD lista
 * como resultado esperado da economia.
 */

export type CraftStation =
  | 'extractionSite'
  | 'refinery'
  | 'textileWorkshop'
  | 'hardwareWorkshop'
  | 'laboratory'
  | 'gunsmith'
  | 'kitchen';

export interface Recipe {
  readonly id: string;
  readonly output: string;
  readonly outputQuantity: number;
  /** Insumos consumidos por execução. */
  readonly inputs: Readonly<Record<string, number>>;
  readonly station: CraftStation;
  /** Dias (resets) que a produção leva para ficar pronta. */
  readonly days: number;
  readonly requiredLevel: CitizenLevel;
  /** Quanto cada ponto de Inteligência acima de 6 aumenta o rendimento. */
  readonly intelligenceBonusPerPoint: number;
}

// `unknown` no meio porque o TypeScript infere cada `inputs` do JSON como um
// objeto com as chaves exatas daquela receita, e chaves ausentes viram
// `undefined` — incompatível com o índice `Record<string, number>`. O tipo que
// vale é o declarado acima; o JSON é gerado do Dart e verificado lá.
export const allRecipes = recipesJson as unknown as readonly Recipe[];

export function recipeById(id: string): Recipe | null {
  return allRecipes.find((r) => r.id === id) ?? null;
}

export function recipesProducing(item: string): readonly Recipe[] {
  return allRecipes.filter((r) => r.output === item);
}

export function recipesAtStation(station: CraftStation): readonly Recipe[] {
  return allRecipes.filter((r) => r.station === station);
}

export function recipesAvailableAt(level: CitizenLevel): readonly Recipe[] {
  return allRecipes.filter(
    (r) => citizenRank[r.requiredLevel] <= citizenRank[level],
  );
}

export function recipeTier(recipe: Recipe): ProductionTier {
  return itemDef(recipe.output).tier;
}

/**
 * Rendimento efetivo considerando a Inteligência de quem trabalha.
 *
 * 8% por ponto acima de 6 dá ±24% na faixa de rolagem (3 a 12). Precisa ser
 * dessa ordem de grandeza: com um valor pequeno demais o arredondamento engole
 * a diferença em receitas de saída baixa, e o atributo vira decoração.
 *
 * O piso de 1 é o que garante que Inteligência ruim atrasa, mas nunca impede:
 * uma receita que devolve zero travaria a cadeia inteira do jogador.
 */
export function recipeYield(recipe: Recipe, attributes: AttributeSet): number {
  const inteligencia = attributes.get('intelligence');
  const bonus = (inteligencia - 6) * recipe.intelligenceBonusPerPoint;
  const multiplicador = Math.min(2.0, Math.max(0.5, 1 + bonus));
  return Math.min(9999, Math.max(1, Math.round(recipe.outputQuantity * multiplicador)));
}

export const craftStationLabels: Record<CraftStation, string> = {
  extractionSite: 'Jazida',
  refinery: 'Casa de Ofícios',
  textileWorkshop: 'Tecelagem',
  hardwareWorkshop: 'Oficina do Ferreiro',
  laboratory: 'Botica',
  gunsmith: 'Besteiro',
  kitchen: 'Cozinha da Vila',
};

export const craftStationTiers: Record<CraftStation, ProductionTier> = {
  extractionSite: 'extraction',
  refinery: 'refining',
  textileWorkshop: 'refining',
  hardwareWorkshop: 'manufacturing',
  laboratory: 'manufacturing',
  gunsmith: 'manufacturing',
  kitchen: 'manufacturing',
};

/**
 * Custo de Fome e Sede de um dia trabalhando numa estação.
 *
 * Cada estação aponta para uma entrada das tabelas de sobrevivência em vez de
 * declarar números próprios. Duplicar aqui criaria uma segunda verdade sobre o
 * mesmo custo, e o Balance Manual deixaria de valer.
 */
export function stationUpkeep(station: CraftStation): Upkeep {
  const t = SurvivalTables;
  switch (station) {
    case 'extractionSite':
      return upkeepOf(t.publicWork.dump);
    case 'refinery':
      return upkeepOf(t.workshopWork.hardware);
    case 'textileWorkshop':
      return upkeepOf(t.workshopWork.textiles);
    case 'hardwareWorkshop':
      return upkeepOf(t.workshopWork.hardware);
    case 'laboratory':
      return upkeepOf(t.workshopWork.laboratory);
    case 'gunsmith':
      return upkeepOf(t.workshopWork.gunsmith);
    case 'kitchen':
      return upkeepOf(t.playerFarmWork.bioreactors);
  }
}

function upkeepOf(entry: { hunger: number; thirst: number } | undefined): Upkeep {
  // Entrada faltando no JSON não pode virar `NaN` e contaminar a fome do
  // personagem para sempre; zero é visivelmente errado e recuperável.
  if (!entry) return { hunger: 0, thirst: 0 };
  return { hunger: entry.hunger, thirst: entry.thirst };
}
