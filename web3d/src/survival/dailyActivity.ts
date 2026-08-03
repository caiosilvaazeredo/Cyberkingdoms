import { itemDef } from '../economy/item';
import {
  SurvivalTables,
  addUpkeep,
  scaleUpkeep,
  weatherMultipliers,
  workById,
  zeroUpkeep,
  type PlayerFarmWork,
  type PublicWork,
  type Upkeep,
  type Weather,
  type WorkshopWork,
} from './survival';

/**
 * O que o jogador fez durante o dia. É o que entra no reset da meia-noite.
 *
 * O GDD é explícito: a perda de Fome e Sede é baseada em **atividade**, não só
 * em tempo. Este objeto acumula o dia e `resolveUpkeep` transforma numa conta
 * só.
 *
 * ## Por que a conta sai discriminada
 *
 * O GDD trata alimentação como decisão econômica, e decisão exige informação.
 * Uma barra que cai 57 sem explicação vira sorte; a mesma queda com "Trabalho:
 * Ferro-velho 18 · Clima: Onda de calor +11 · Equipamentos −9" vira estratégia.
 * Por isso `resolveUpkeep` devolve linhas, e não um número.
 */

export interface CombatOutcome {
  readonly won: boolean;
  readonly rounds: number;
}

export function combatWasLong(c: CombatOutcome): boolean {
  return c.rounds > SurvivalTables.longCombatRounds;
}

export interface DailyActivity {
  readonly publicWork?: PublicWork | null;
  readonly farmWork?: PlayerFarmWork | null;
  readonly workshopWork?: WorkshopWork | null;
  /** Quantas estradas foram atravessadas no dia. */
  readonly roadsTravelled?: number;
  readonly sleptOnRoad?: boolean;
  readonly combats?: readonly CombatOutcome[];
  /** Estimulantes e bebidas consumidos — cobram Fome e Sede na hora. */
  readonly consumed?: readonly string[];
  readonly weather?: Weather;
}

export const idleDay: DailyActivity = {};

export function didWork(a: DailyActivity): boolean {
  return Boolean(a.publicWork ?? a.farmWork ?? a.workshopWork);
}

export function workLabel(a: DailyActivity): string {
  const id = a.publicWork ?? a.farmWork ?? a.workshopWork;
  return id ? workById(id).label : 'Ocioso';
}

/** Uma linha da conta do dia. */
export interface UpkeepLine {
  readonly label: string;
  readonly upkeep: Upkeep;
}

export interface UpkeepBreakdown {
  readonly lines: readonly UpkeepLine[];
  readonly total: Upkeep;
}

/**
 * A fórmula final do GDD:
 * `Consumo = Base + Trabalho + Viagem + Combate + Clima + Modificadores`
 *
 * **A ordem é a fórmula.** Clima multiplica o subtotal acumulado, e os
 * equipamentos reduzem por último, sobre o total já formado. Trocar as duas
 * etapas de lugar muda o número: um implante de −30% aplicado antes do clima
 * teria o desconto multiplicado de volta pela onda de calor.
 */
export function resolveUpkeep(
  activity: DailyActivity,
  modifiers: {
    hungerModifier?: number;
    thirstModifier?: number;
    /**
     * Linhas somadas ao subtotal **antes** do clima.
     *
     * Existe para o que não é atividade nem item — hoje, o curso. Entrar aqui e
     * não como campo de `DailyActivity` mantém a fórmula do GDD intacta: a
     * ordem `Base + Trabalho + Viagem + Combate + Clima + Modificadores`
     * continua valendo, e o extra apenas ocupa o mesmo degrau do trabalho.
     */
    extra?: readonly UpkeepLine[];
  } = {},
): UpkeepBreakdown {
  const hungerModifier = modifiers.hungerModifier ?? 0;
  const thirstModifier = modifiers.thirstModifier ?? 0;

  const lines: UpkeepLine[] = [];
  let subtotal: Upkeep = SurvivalTables.idleBase;
  lines.push({ label: 'Base (existir)', upkeep: SurvivalTables.idleBase });

  const trabalhos: [string, string | null | undefined][] = [
    ['Trabalho', activity.publicWork],
    ['Fazenda', activity.farmWork],
    ['Oficina', activity.workshopWork],
  ];
  for (const [prefixo, id] of trabalhos) {
    if (!id) continue;
    const w = workById(id);
    lines.push({ label: `${prefixo}: ${w.label}`, upkeep: w.upkeep });
    subtotal = addUpkeep(subtotal, w.upkeep);
  }

  const estradas = activity.roadsTravelled ?? 0;
  if (estradas > 0) {
    const viagem: Upkeep = {
      hunger: SurvivalTables.travelRoad.hunger * estradas,
      thirst: SurvivalTables.travelRoad.thirst * estradas,
    };
    lines.push({ label: `Viagem (${estradas}x)`, upkeep: viagem });
    subtotal = addUpkeep(subtotal, viagem);
  }

  if (activity.sleptOnRoad) {
    lines.push({
      label: 'Dormir na estrada',
      upkeep: SurvivalTables.sleepOnRoad,
    });
    subtotal = addUpkeep(subtotal, SurvivalTables.sleepOnRoad);
  }

  for (const combate of activity.combats ?? []) {
    let custo = combate.won
      ? SurvivalTables.combatVictory
      : SurvivalTables.combatDefeat;
    const longo = combatWasLong(combate);
    if (longo) custo = scaleUpkeep(custo, SurvivalTables.longCombatMultiplier);
    lines.push({
      label:
        `Combate: ${combate.won ? 'vitória' : 'derrota'}` +
        `${longo ? ' (longo)' : ''}`,
      upkeep: custo,
    });
    subtotal = addUpkeep(subtotal, custo);
  }

  for (const id of activity.consumed ?? []) {
    const def = itemDef(id);
    if (def.hungerCost === 0 && def.thirstCost === 0) continue;
    const custo: Upkeep = { hunger: def.hungerCost, thirst: def.thirstCost };
    lines.push({ label: def.name, upkeep: custo });
    subtotal = addUpkeep(subtotal, custo);
  }

  for (const linha of modifiers.extra ?? []) {
    lines.push(linha);
    subtotal = addUpkeep(subtotal, linha.upkeep);
  }

  // Clima multiplica o que se acumulou até aqui.
  const clima = activity.weather ?? 'clear';
  if (clima !== 'clear') {
    const m = weatherMultipliers(clima);
    const comClima: Upkeep = {
      hunger: Math.round(subtotal.hunger * m.hunger),
      thirst: Math.round(subtotal.thirst * m.thirst),
    };
    const delta = diff(comClima, subtotal);
    if (delta.hunger !== 0 || delta.thirst !== 0) {
      lines.push({ label: `Clima: ${m.label}`, upkeep: delta });
    }
    subtotal = comClima;
  }

  if (hungerModifier !== 0 || thirstModifier !== 0) {
    const reduzido: Upkeep = {
      hunger: Math.round(subtotal.hunger * (1 + hungerModifier)),
      thirst: Math.round(subtotal.thirst * (1 + thirstModifier)),
    };
    const delta = diff(reduzido, subtotal);
    if (delta.hunger !== 0 || delta.thirst !== 0) {
      lines.push({ label: 'Equipamentos', upkeep: delta });
    }
    subtotal = reduzido;
  }

  // Consumo nunca é negativo, por mais extremo que seja o equipamento: um
  // consumo negativo viraria fome se **enchendo** sozinha, e a sobrevivência
  // deixaria de ser um sistema.
  const total: Upkeep = {
    hunger: Math.max(0, subtotal.hunger),
    thirst: Math.max(0, subtotal.thirst),
  };

  return { lines, total };
}

function diff(depois: Upkeep, antes: Upkeep): Upkeep {
  return {
    hunger: depois.hunger - antes.hunger,
    thirst: depois.thirst - antes.thirst,
  };
}

export { zeroUpkeep };
