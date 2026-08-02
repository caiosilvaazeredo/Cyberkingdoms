import itemsJson from '../data/items.json';

/**
 * Catálogo de itens.
 *
 * Os números vêm de `src/data/items.json`, **gerado** a partir do catálogo Dart
 * por `flutter test test/catalog_export_test.dart`. Transcrever à mão algumas
 * centenas de valores já conferidos contra o GDD não é difícil, é silencioso:
 * um preço-base trocado não quebra teste nenhum e só aparece meses depois como
 * uma economia que não fecha.
 *
 * Dados como dados, comportamento como código — o que está aqui é tipo e
 * regra, não tabela.
 */

/**
 * As três camadas produtivas do GDD. A dependência entre elas é o que sustenta
 * a economia dirigida por jogadores: ninguém fabrica um drone sem que alguém
 * tenha extraído sucata.
 */
export type ProductionTier = 'extraction' | 'refining' | 'manufacturing' | 'basic';

export type ItemCategory =
  | 'rawMaterial'
  | 'component'
  | 'food'
  | 'drink'
  | 'drug'
  | 'weapon'
  | 'gear'
  | 'implant'
  | 'contraband';

export interface ItemDef {
  readonly id: string;
  readonly name: string;
  readonly tier: ProductionTier;
  readonly tierLevel: number;
  readonly category: ItemCategory;
  /**
   * Preço de referência em créditos. **Não** é o preço de venda: os mercados
   * são de ordem livre e quem define preço é o jogador. Serve para semear o
   * livro de ofertas e estimar patrimônio.
   */
  readonly baseValue: number;
  readonly weight: number;
  /** `false` = só pode ser negociado no Mercado Clandestino. */
  readonly legal: boolean;
  readonly restoresHunger: number;
  readonly restoresThirst: number;
  /** Custo de consumir o item — estimulantes cobram Sede, tabela do GDD. */
  readonly hungerCost: number;
  readonly thirstCost: number;
  readonly energyBonus: number;
  readonly strengthBonus: number;
  readonly statusBonus: number;
  readonly enduranceBonus: number;
  /** Negativo reduz consumo enquanto equipado. -0.20 = -20% de sede. */
  readonly hungerUpkeepModifier: number;
  readonly thirstUpkeepModifier: number;
  readonly attackPower: number;
  readonly defensePower: number;
  readonly description: string;
}

const items = itemsJson as readonly ItemDef[];

const byId = new Map<string, ItemDef>(items.map((d) => [d.id, d]));

/** Todos os itens, na ordem do catálogo. */
export const allItems: readonly ItemDef[] = items;

/** Ids válidos, para validar save e entrada de rede. */
export const itemIds: readonly string[] = items.map((d) => d.id);

/**
 * Definição de um item.
 *
 * Lança em id desconhecido em vez de devolver `undefined`: um item que não
 * existe vindo de um save ou do servidor é corrupção de dados, e seguir com um
 * buraco no inventário esconde o problema até virar um crash em outro lugar.
 */
export function itemDef(id: string): ItemDef {
  const def = byId.get(id);
  if (!def) throw new Error(`item desconhecido: "${id}"`);
  return def;
}

export function isItemId(id: string): boolean {
  return byId.has(id);
}

export function itemsOfTier(tier: ProductionTier): readonly ItemDef[] {
  return items.filter((d) => d.tier === tier);
}

export function itemsOfCategory(category: ItemCategory): readonly ItemDef[] {
  return items.filter((d) => d.category === category);
}

/** Itens que só circulam no Mercado Clandestino. */
export function contraband(): readonly ItemDef[] {
  return items.filter((d) => !d.legal);
}

/** `true` se consumir o item devolve Fome ou Sede. */
export function isConsumable(def: ItemDef): boolean {
  return def.restoresHunger > 0 || def.restoresThirst > 0;
}

/** `true` se o item faz diferença enquanto equipado. */
export function isEquippable(def: ItemDef): boolean {
  return (
    def.attackPower > 0 ||
    def.defensePower > 0 ||
    def.hungerUpkeepModifier !== 0 ||
    def.thirstUpkeepModifier !== 0 ||
    def.energyBonus > 0 ||
    def.strengthBonus > 0 ||
    def.statusBonus > 0 ||
    def.enduranceBonus > 0
  );
}
