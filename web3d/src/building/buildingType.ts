import buildingsJson from '../data/buildings.json';
import emblemsJson from '../data/emblems.json';
import upgradeJson from '../data/buildingUpgrade.json';

/**
 * Catálogo de construções.
 *
 * Como os itens, os números vêm de JSON gerado a partir do Dart — 41 tipos com
 * duas dezenas de campos cada é território onde transcrever à mão erra em
 * silêncio.
 *
 * **Regra central do jogo, que este módulo não pode deixar escapar:**
 * construção só existe dentro de um terreno, e todo terreno fica dentro de uma
 * metrópole. Não se constrói em campo aberto — o mundo selvagem é para
 * explorar, extrair e viajar; a base é urbana.
 */

export type BuildingCategory =
  | 'housing'
  | 'extraction'
  | 'refining'
  | 'manufacturing'
  | 'commerce'
  | 'infrastructure'
  | 'defense'
  | 'civic';

export type CitizenLevel = 'survivor' | 'farmer' | 'industrialist' | 'elite';

/** Ordem de progressão. Serve para comparar requisito de nível. */
export const citizenRank: Record<CitizenLevel, number> = {
  survivor: 0,
  farmer: 1,
  industrialist: 2,
  elite: 3,
};

export interface BuildingDef {
  readonly id: string;
  readonly name: string;
  readonly category: BuildingCategory;
  /** Footprint em tiles do terreno. */
  readonly width: number;
  readonly height: number;
  readonly creditCost: number;
  readonly materialCost: Readonly<Record<string, number>>;
  /** Resets até ficar pronta. */
  readonly buildDays: number;
  readonly spriteId: string;
  readonly requiredLevel: CitizenLevel;
  /** Vagas de emprego que a construção abre. */
  readonly jobSlots: number;
  readonly produces: string | null;
  readonly outputPerDay: number;
  readonly consumes: Readonly<Record<string, number>>;
  readonly unlocksStation: string | null;
  readonly storageBonus: number;
  readonly defenseBonus: number;
  readonly statusBonus: number;
  readonly populationCapacity: number;
  /** Créditos por dia. Prédio parado por falta de caixa não produz. */
  readonly dailyUpkeep: number;
  readonly hungerUpkeepModifier: number;
  readonly thirstUpkeepModifier: number;
  /** `false` = construir isso é crime; o governo pode confiscar. */
  readonly legal: boolean;
  readonly description: string;
}

// `as unknown as` e não uma conversão direta: o TypeScript infere do JSON um
// tipo literal com uma chave opcional por material que aparece em qualquer
// construção, e recusa a conversão para `Record<string, number>`. A alternativa
// seria declarar o tipo de todos os materiais possíveis, que é exatamente o
// acoplamento que gerar o catálogo existe para evitar.
const buildings = buildingsJson as unknown as readonly BuildingDef[];
const byId = new Map(buildings.map((d) => [d.id, d]));

export const allBuildings: readonly BuildingDef[] = buildings;

export function buildingDef(id: string): BuildingDef {
  const def = byId.get(id);
  if (!def) throw new Error(`construção desconhecida: "${id}"`);
  return def;
}

export function isBuildingId(id: string): boolean {
  return byId.has(id);
}

export function buildingsOfCategory(
  category: BuildingCategory,
): readonly BuildingDef[] {
  return buildings.filter((d) => d.category === category);
}

/** Construções que o jogador pode erguer no nível dado. */
export function buildingsAvailableAt(level: CitizenLevel): readonly BuildingDef[] {
  return buildings.filter(
    (d) => citizenRank[d.requiredLevel] <= citizenRank[level],
  );
}

// ---------------------------------------------------------------- evolução

interface LevelRow {
  readonly level: number;
  readonly outputMultiplier: number;
  readonly upkeepMultiplier: number;
  readonly flatMultiplier: number;
  readonly moduleSlots: number;
}

const upgradeData = upgradeJson as {
  maxLevel: number;
  levels: readonly LevelRow[];
};

export const maxBuildingLevel = upgradeData.maxLevel;

function levelRow(level: number): LevelRow {
  const clamped = Math.min(maxBuildingLevel, Math.max(1, Math.trunc(level)));
  return upgradeData.levels[clamped - 1]!;
}

/**
 * Multiplicadores por nível.
 *
 * A manutenção cresce mais rápido que a produção **de propósito**: uma
 * indústria grande parada sangra caixa, e é isso que impede que subir tudo ao
 * nível III seja sempre a jogada certa.
 */
export const outputMultiplierFor = (level: number): number =>
  levelRow(level).outputMultiplier;
export const upkeepMultiplierFor = (level: number): number =>
  levelRow(level).upkeepMultiplier;
export const flatMultiplierFor = (level: number): number =>
  levelRow(level).flatMultiplier;
export const moduleSlotsFor = (level: number): number =>
  levelRow(level).moduleSlots;

/** Custo em créditos para subir de `fromLevel` para o seguinte. */
export function upgradeCreditCost(def: BuildingDef, fromLevel: number): number {
  return Math.round(def.creditCost * (fromLevel === 1 ? 1.2 : 2.0));
}

/**
 * Materiais para subir de nível.
 *
 * Arredonda para cima, como o original: cobrar meia unidade de sucata não
 * existe, e arredondar para baixo tornaria o nível II mais barato em material
 * do que a construção original em alguns casos.
 */
export function upgradeMaterialCost(
  def: BuildingDef,
  fromLevel: number,
): Record<string, number> {
  const factor = fromLevel === 1 ? 0.8 : 1.5;
  const out: Record<string, number> = {};
  for (const [id, qty] of Object.entries(def.materialCost)) {
    out[id] = Math.ceil(qty * factor);
  }
  return out;
}

export function upgradeDays(def: BuildingDef, fromLevel: number): number {
  const raw = Math.ceil(def.buildDays * (fromLevel === 1 ? 0.8 : 1.4));
  return Math.min(30, Math.max(1, raw));
}

// ----------------------------------------------------------------- brasões

export interface EmblemDef {
  readonly id: string;
  readonly label: string;
  readonly spriteId: string;
}

export const allEmblems = emblemsJson as readonly EmblemDef[];
