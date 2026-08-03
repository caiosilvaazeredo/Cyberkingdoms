import survivalJson from '../data/survival.json';

/**
 * Tabelas de Fome e Sede — seção 13 do GDD (Rev. 3.0).
 *
 * Os números vivem em `src/data/survival.json`, gerado a partir da transcrição
 * Dart. Qualquer rebalanceamento acontece **na fonte** e em nenhum outro lugar,
 * para que o Balance Manual continue tendo uma origem única. Reescrever um
 * valor aqui cria uma segunda verdade.
 */

/** Par (fome, sede). Positivo é consumo. */
export interface Upkeep {
  readonly hunger: number;
  readonly thirst: number;
}

export const zeroUpkeep: Upkeep = { hunger: 0, thirst: 0 };

export function addUpkeep(a: Upkeep, b: Upkeep): Upkeep {
  return { hunger: a.hunger + b.hunger, thirst: a.thirst + b.thirst };
}

/**
 * Escala e arredonda.
 *
 * `Math.round` e não truncamento: a versão Dart usa `round()`, e um combate
 * longo a 1,5× de um consumo 5 tem de dar 8, não 7. Meia unidade por atividade
 * vira dias de diferença ao longo de uma campanha.
 */
export function scaleUpkeep(u: Upkeep, factor: number): Upkeep {
  return {
    hunger: Math.round(u.hunger * factor),
    thirst: Math.round(u.thirst * factor),
  };
}

interface WorkEntry {
  readonly label: string;
  readonly hunger: number;
  readonly thirst: number;
}

interface WeatherEntry {
  readonly label: string;
  readonly hungerMultiplier: number;
  readonly thirstMultiplier: number;
}

interface SurvivalData {
  readonly idleBase: Upkeep;
  readonly travelRoad: Upkeep;
  readonly sleepOnRoad: Upkeep;
  readonly combatVictory: Upkeep;
  readonly combatDefeat: Upkeep;
  readonly longCombatMultiplier: number;
  readonly longCombatRounds: number;
  readonly maxVital: number;
  readonly minVital: number;
  readonly starvationThreshold: number;
  readonly starvationDamage: number;
  readonly consecutiveDaysToDeath: number;
  readonly publicWork: Record<string, WorkEntry>;
  readonly playerFarmWork: Record<string, WorkEntry>;
  readonly workshopWork: Record<string, WorkEntry>;
  readonly weather: Record<string, WeatherEntry>;
}

export const SurvivalTables = survivalJson as SurvivalData;

export type PublicWork = keyof typeof survivalJson.publicWork;
export type PlayerFarmWork = keyof typeof survivalJson.playerFarmWork;
export type WorkshopWork = keyof typeof survivalJson.workshopWork;
export type Weather = keyof typeof survivalJson.weather;

/** Todos os trabalhos disponíveis, com a origem de cada um. */
export interface WorkOption {
  readonly id: string;
  readonly label: string;
  readonly upkeep: Upkeep;
  readonly kind: 'public' | 'farm' | 'workshop';
}

function options(
  table: Record<string, WorkEntry>,
  kind: WorkOption['kind'],
): WorkOption[] {
  return Object.entries(table).map(([id, e]) => ({
    id,
    label: e.label,
    upkeep: { hunger: e.hunger, thirst: e.thirst },
    kind,
  }));
}

export const allWork: readonly WorkOption[] = [
  ...options(SurvivalTables.publicWork, 'public'),
  ...options(SurvivalTables.playerFarmWork, 'farm'),
  ...options(SurvivalTables.workshopWork, 'workshop'),
];

export function workById(id: string): WorkOption {
  const found = allWork.find((w) => w.id === id);
  if (!found) throw new Error(`trabalho desconhecido: "${id}"`);
  return found;
}

export function weatherMultipliers(weather: Weather): {
  label: string;
  hunger: number;
  thirst: number;
} {
  const w = SurvivalTables.weather[weather]!;
  // O rótulo sai junto porque quem calcula o clima é quem escreve a linha da
  // conta do dia; buscá-lo de novo na tabela seria uma segunda consulta pela
  // mesma chave, com uma segunda chance de errar a chave.
  return { label: w.label, hunger: w.hungerMultiplier, thirst: w.thirstMultiplier };
}

/**
 * Aplica um consumo a um valor vital, travando na faixa do GDD.
 *
 * Vital nunca passa de 100 nem cai abaixo de 0: um saldo negativo acumulado
 * faria o jogador precisar comer três dias seguidos só para voltar a zero, e o
 * castigo da inanição já é a morte em quatro dias.
 */
export function applyUpkeep(current: number, cost: number): number {
  return Math.min(
    SurvivalTables.maxVital,
    Math.max(SurvivalTables.minVital, current - cost),
  );
}

export function restore(current: number, amount: number): number {
  return Math.min(SurvivalTables.maxVital, current + amount);
}

/** `true` se o valor vital está na faixa que causa dano por inanição. */
export function isStarving(vital: number): boolean {
  return vital <= SurvivalTables.starvationThreshold;
}
