import modulesJson from '../data/modules.json';

import type { BuildingCategory } from './buildingType';

/**
 * Módulos que se instalam numa construção pronta.
 *
 * Como o resto do catálogo, os números vêm de JSON gerado do Dart. O que fica
 * aqui é o tipo e o acesso.
 *
 * Dois campos merecem atenção porque se parecem e fazem coisas diferentes:
 * `upkeepDelta` é somado em créditos, `upkeepMultiplier` é uma fração aplicada
 * **depois** da soma. Um módulo que custa +5/dia e outro que corta 60% da
 * manutenção compõem nessa ordem, não na inversa.
 */
export interface ModuleDef {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly creditCost: number;
  readonly materialCost: Readonly<Record<string, number>>;
  /** Categorias de construção que aceitam este módulo. */
  readonly categories: readonly BuildingCategory[];
  /** Fração somada à produção (0.30 = +30%). */
  readonly outputMultiplier: number;
  readonly storageBonus: number;
  readonly defenseBonus: number;
  readonly statusBonus: number;
  readonly jobSlotBonus: number;
  readonly populationBonus: number;
  /** Manutenção somada em créditos por dia. */
  readonly upkeepDelta: number;
  /** Fração aplicada depois de `upkeepDelta` (-0.60 = -60%). */
  readonly upkeepMultiplier: number;
  readonly thirstUpkeepModifier: number;
  readonly hungerUpkeepModifier: number;
  /** Produz no máximo mesmo com zero funcionários. */
  readonly removesStaffingPenalty: boolean;
}

// `as unknown as` pelo mesmo motivo do catálogo de construções: o TypeScript
// infere do JSON um tipo literal por material, que não converte para
// `Record<string, number>`.
const modules = modulesJson as unknown as readonly ModuleDef[];
const byId = new Map(modules.map((m) => [m.id, m]));

export const allModules: readonly ModuleDef[] = modules;

export function moduleDef(id: string): ModuleDef {
  const def = byId.get(id);
  if (!def) throw new Error(`módulo desconhecido: "${id}"`);
  return def;
}

/** Módulos que servem numa construção da categoria dada. */
export function modulesFor(category: BuildingCategory): readonly ModuleDef[] {
  return modules.filter((m) => m.categories.includes(category));
}
