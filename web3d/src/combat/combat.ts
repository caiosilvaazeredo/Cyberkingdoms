import { DeterministicRandom, mix } from '../core/rng';
import type { Inventory } from '../economy/inventory';
import { itemDef } from '../economy/item';
import {
  AttributeSet,
  type Attribute,
  type AttributeMap,
} from '../character/attributes';

/**
 * Combate PvP determinístico, espelhando `lib/domain/combat/combat.dart`.
 *
 * ## Por que determinístico importa aqui mais que em qualquer outro lugar
 *
 * O jogo é um MMO com economia real em disputa. O cliente **não** pode ser a
 * autoridade sobre quem ganhou uma briga: ele roda na máquina do adversário.
 * Sendo determinístico — mesma seed, mesmos combatentes, mesmo resultado —, o
 * servidor recalcula o combate no reset diário e compara. Um cliente que
 * mentiu produz um relatório que não bate, e a mentira morre ali.
 *
 * É pelo mesmo motivo que existe o registro rodada a rodada: o GDD pede
 * "relatórios de combate determinístico", e um jogador que perdeu precisa
 * conseguir auditar por quê, e não só receber a notícia.
 */

export const MAX_ROUNDS = 20;

export interface CombatLogEntry {
  readonly round: number;
  readonly attackerName: string;
  readonly defenderName: string;
  readonly damage: number;
  readonly critical: boolean;
  readonly defenderHpAfter: number;
}

export function formatLogEntry(e: CombatLogEntry): string {
  return (
    `R${e.round} · ${e.attackerName} » ${e.defenderName}: ${e.damage}` +
    `${e.critical ? ' (CRÍTICO)' : ''} · HP ${e.defenderHpAfter}`
  );
}

export interface CombatReport {
  readonly winnerId: string;
  readonly loserId: string;
  readonly rounds: number;
  readonly log: readonly CombatLogEntry[];
  /** Itens que o perdedor deixou cair. O GDD determina perda **parcial**. */
  readonly lootedItems: Readonly<Record<string, number>>;
  /** Status (reputação) que o perdedor perdeu. */
  readonly statusLost: number;
}

export function wasLong(report: CombatReport): boolean {
  return report.rounds > 6;
}

/** HP máximo derivado de Resistência. */
export function maxHpFor(attributes: AttributeSet): number {
  return 60 + attributes.get('endurance') * 5;
}

export interface CombatantOptions {
  readonly id: string;
  readonly name: string;
  readonly attributes: AttributeSet;
  readonly attackPower: number;
  readonly defensePower: number;
  readonly hp: number;
  readonly droneCount?: number;
}

/** Um combatente já resolvido: atributos somados com equipamento e drogas. */
export class Combatant {
  readonly id: string;
  readonly name: string;
  readonly attributes: AttributeSet;
  readonly attackPower: number;
  readonly defensePower: number;
  readonly droneCount: number;
  hp: number;

  constructor(options: CombatantOptions) {
    this.id = options.id;
    this.name = options.name;
    this.attributes = options.attributes;
    this.attackPower = options.attackPower;
    this.defensePower = options.defensePower;
    this.droneCount = options.droneCount ?? 0;
    this.hp = options.hp;
  }

  /** Monta a partir do estado do personagem, aplicando as drogas ativas. */
  static fromCharacter(options: {
    id: string;
    name: string;
    attributes: AttributeSet;
    inventory: Inventory;
    hp: number;
    activeDrugs?: readonly string[];
  }): Combatant {
    const bonuses: AttributeMap = {};
    for (const drug of options.activeDrugs ?? []) {
      const def = itemDef(drug);
      if (def.strengthBonus !== 0) {
        bonuses.strength = (bonuses.strength ?? 0) + def.strengthBonus;
      }
      if (def.enduranceBonus !== 0) {
        bonuses.endurance = (bonuses.endurance ?? 0) + def.enduranceBonus;
      }
    }

    return new Combatant({
      id: options.id,
      name: options.name,
      attributes:
        Object.keys(bonuses).length === 0
          ? options.attributes
          : options.attributes.withBonus(bonuses),
      attackPower: options.inventory.attackPower,
      defensePower: options.inventory.defensePower,
      hp: options.hp,
      droneCount: options.inventory.quantityOf('drone'),
    });
  }

  /** Dano por rodada, antes da defesa do alvo. */
  get offense(): number {
    return (
      this.attributes.get('strength') * 1.6 +
      this.attackPower * 1.0 +
      this.droneCount * 6.0 +
      this.attributes.get('perception') * 0.4
    );
  }

  /** Mitigação por rodada. */
  get defense(): number {
    return this.attributes.get('endurance') * 1.1 + this.defensePower * 1.2;
  }

  /** Chance de crítico, puxada por Sorte. */
  get critChance(): number {
    return Math.min(0.35, Math.max(0, this.attributes.get('luck') * 0.012));
  }
}

const iniciativa = (c: Combatant): number =>
  c.attributes.get('perception') * 2 + c.attributes.get('luck');

export function resolveCombat(
  a: Combatant,
  b: Combatant,
  seed: number,
): CombatReport {
  const rng = new DeterministicRandom(seed);
  const log: CombatLogEntry[] = [];

  // Iniciativa: Percepção decide quem ataca primeiro; empate vai para Sorte.
  let attacker = a;
  let defender = b;
  if (iniciativa(b) > iniciativa(a)) {
    attacker = b;
    defender = a;
  }

  let round = 0;
  while (round < MAX_ROUNDS && a.hp > 0 && b.hp > 0) {
    round++;

    const critical = rng.nextDouble() < attacker.critChance;
    // Variação de ±15% mantém o combate imprevisível sem apagar a vantagem de
    // quem investiu em equipamento.
    const swing = rng.rangeDouble(0.85, 1.15);
    const raw = attacker.offense * swing * (critical ? 1.75 : 1.0);
    const mitigated = raw - defender.defense * 0.6;
    // Piso de 1: sem ele, defesa alta o bastante zera o dano e o combate roda
    // as vinte rodadas sem ninguém perder HP.
    const damage = Math.max(1, Math.round(mitigated));

    defender.hp = Math.max(0, defender.hp - damage);
    log.push({
      round,
      attackerName: attacker.name,
      defenderName: defender.name,
      damage,
      critical,
      defenderHpAfter: defender.hp,
    });

    if (defender.hp <= 0) break;

    const swap = attacker;
    attacker = defender;
    defender = swap;
  }

  // Estourando o limite de rodadas, ganha quem tem mais HP **proporcional**:
  // comparar HP absoluto premiaria o combatente com mais Resistência mesmo
  // tendo apanhado mais.
  let winner: Combatant;
  let loser: Combatant;
  if (a.hp <= 0) {
    winner = b;
    loser = a;
  } else if (b.hp <= 0) {
    winner = a;
    loser = b;
  } else {
    const aRatio = a.hp / maxHpFor(a.attributes);
    const bRatio = b.hp / maxHpFor(b.attributes);
    winner = aRatio >= bRatio ? a : b;
    loser = aRatio >= bRatio ? b : a;
  }

  return {
    winnerId: winner.id,
    loserId: loser.id,
    rounds: round,
    log,
    lootedItems: {},
    statusLost: rng.range(1, 3),
  };
}

/**
 * O que o perdedor deixa cair: uma fração do inventário, nunca tudo.
 *
 * O GDD é explícito: "a derrota normalmente não elimina o personagem; as
 * penalidades incluem perda parcial de itens". Perder tudo numa briga faria o
 * PvP virar um risco que ninguém aceita, e um MMO sem PvP não é este jogo.
 */
export function rollLoot(
  loserInventory: Inventory,
  seed: number,
  fraction = 0.25,
): Record<string, number> {
  const rng = new DeterministicRandom(mix(seed, 0x100));
  const loot: Record<string, number> = {};
  for (const [id, quantidade] of loserInventory.stacks) {
    // Implantes são cirúrgicos: não caem.
    if (itemDef(id).category === 'implant') continue;
    if (!rng.chance(0.5)) continue;
    const levado = Math.floor(quantidade * fraction);
    if (levado > 0) loot[id] = levado;
  }
  return loot;
}

export type { Attribute };
