import { maxHpFor } from '../combat/combat';
import { Inventory } from '../economy/inventory';
import { itemDef } from '../economy/item';
import { SurvivalTables, type Upkeep } from '../survival/survival';
import { TileCoord } from '../world/coords';
import {
  AttributeSet,
  MAX_REROLLS,
  nextCitizenLevel,
  type CitizenLevel,
} from './attributes';

/**
 * Estado de um personagem.
 *
 * Junto com o layout do mundo, é tudo que precisa sair para disco: o terreno é
 * função pura da seed e se regenera igual, então persistir chunk seria guardar
 * o que já se sabe calcular.
 *
 * ## Por que a morte permanente é tão difícil de alcançar
 *
 * O GDD reserva a morte permanente ao **abandono**, não ao azar. Perder uma
 * briga não mata; passar fome um dia não mata. Só matam dias seguidos com as
 * duas barras zeradas, ou HP em zero *por inanição*. Num jogo de reset diário,
 * uma morte que pode acontecer por descuido de um dia faria o jogador parar de
 * arriscar — e o risco é o jogo.
 */

export interface CharacterOptions {
  readonly id: string;
  readonly name: string;
  readonly attributes: AttributeSet;
  readonly position: TileCoord;
  readonly homeSettlementId: string;
  readonly level?: CitizenLevel;
  readonly credits?: number;
  readonly hp?: number;
  readonly hunger?: number;
  readonly thirst?: number;
  readonly energy?: number;
  readonly rerollsUsed?: number;
  readonly starvingStreak?: number;
  readonly dead?: boolean;
  readonly deathReason?: string | null;
  readonly inventory?: Inventory;
  readonly travellingTo?: string | null;
  readonly travelDaysRemaining?: number;
  readonly statusOffset?: number;
}

/** O que aconteceu com o personagem no fechamento do dia. */
export interface DayEndOutcome {
  readonly hungerLost: number;
  readonly thirstLost: number;
  readonly hpLost: number;
  readonly starving: boolean;
  readonly dehydrated: boolean;
  readonly died: boolean;
}

export class Character {
  readonly id: string;
  name: string;
  attributes: AttributeSet;
  /** Onde o personagem está no mundo. */
  position: TileCoord;
  /** Cidade de origem — para onde volta numa morte não permanente. */
  homeSettlementId: string;
  level: CitizenLevel;
  credits: number;
  hp: number;
  hunger: number;
  thirst: number;
  /** Horas de trabalho disponíveis no dia. Energéticos aumentam. */
  energy: number;
  rerollsUsed: number;
  /** Resets consecutivos com Fome **e** Sede zeradas. */
  starvingStreak: number;
  dead: boolean;
  deathReason: string | null;
  readonly inventory: Inventory;
  /** Destino e dias restantes. Viajando, o jogador não age. */
  travellingTo: string | null;
  travelDaysRemaining: number;
  /** Status ganho ou perdido em jogo: combate, política, luxo. */
  statusOffset: number;

  constructor(options: CharacterOptions) {
    this.id = options.id;
    this.name = options.name;
    this.attributes = options.attributes;
    this.position = options.position;
    this.homeSettlementId = options.homeSettlementId;
    this.level = options.level ?? 'survivor';
    this.credits = options.credits ?? 250;
    this.hunger = options.hunger ?? SurvivalTables.maxVital;
    this.thirst = options.thirst ?? SurvivalTables.maxVital;
    this.energy = options.energy ?? 10;
    this.rerollsUsed = options.rerollsUsed ?? 0;
    this.starvingStreak = options.starvingStreak ?? 0;
    this.dead = options.dead ?? false;
    this.deathReason = options.deathReason ?? null;
    this.inventory = options.inventory ?? new Inventory();
    this.travellingTo = options.travellingTo ?? null;
    this.travelDaysRemaining = options.travelDaysRemaining ?? 0;
    this.statusOffset = options.statusOffset ?? 0;
    this.hp = options.hp ?? maxHpFor(options.attributes);
  }

  get isTravelling(): boolean {
    return this.travelDaysRemaining > 0;
  }

  get canAct(): boolean {
    return !this.dead && !this.isTravelling;
  }

  get maxHp(): number {
    return maxHpFor(this.attributes);
  }

  /** Status efetivo: o rolado na criação mais o que o jogo somou. */
  get effectiveStatus(): number {
    return this.attributes.get('status') + this.statusOffset;
  }

  get canReroll(): boolean {
    return this.rerollsUsed < MAX_REROLLS && this.level === 'survivor';
  }

  /**
   * Consome um item, aplicando restauração e custos.
   *
   * Devolve `false` quando o item não está no inventário — a interface usa isso
   * para não deixar clicar em item sem saldo.
   */
  consume(id: string): boolean {
    if (!this.inventory.remove(id, 1)) return false;
    const def = itemDef(id);

    this.hunger = clampVital(
      this.hunger + def.restoresHunger - def.hungerCost,
    );
    this.thirst = clampVital(this.thirst + def.restoresThirst - def.thirstCost);
    this.energy += def.energyBonus;
    this.statusOffset += def.statusBonus;
    return true;
  }

  /** Aplica o consumo do dia e devolve o que aconteceu. */
  applyUpkeep(upkeep: Upkeep): DayEndOutcome {
    this.hunger = clampVital(this.hunger - upkeep.hunger);
    this.thirst = clampVital(this.thirst - upkeep.thirst);

    const starving = this.hunger <= SurvivalTables.starvationThreshold;
    const dehydrated = this.thirst <= SurvivalTables.starvationThreshold;

    let damage = 0;
    if (starving) damage += SurvivalTables.starvationDamage;
    if (dehydrated) damage += SurvivalTables.starvationDamage;

    if (damage > 0) {
      this.hp = Math.min(this.maxHp, Math.max(0, this.hp - damage));
    }

    if (starving && dehydrated) {
      this.starvingStreak++;
    } else {
      this.starvingStreak = 0;
    }

    // Morte permanente é reservada ao abandono: dias seguidos com as duas
    // barras zeradas, ou HP em zero *por inanição*. HP zerado numa briga não
    // entra aqui — perder uma briga não mata, por decisão do GDD.
    const permanent =
      this.starvingStreak >= SurvivalTables.consecutiveDaysToDeath ||
      (this.hp <= 0 && (starving || dehydrated));

    if (permanent) {
      this.dead = true;
      this.deathReason = 'Morte permanente por abandono (fome e sede).';
    }

    return {
      hungerLost: upkeep.hunger,
      thirstLost: upkeep.thirst,
      hpLost: damage,
      starving,
      dehydrated,
      died: permanent,
    };
  }

  /** Requisitos de progressão do GDD, seção 5. */
  meetsRequirementsFor(target: CitizenLevel): boolean {
    switch (target) {
      case 'survivor':
        return true;
      case 'farmer':
        return this.credits >= 1500;
      case 'industrialist':
        return this.credits >= 12000 && this.inventory.estimatedValue >= 5000;
      case 'elite':
        return this.credits >= 60000 && this.effectiveStatus >= 12;
    }
  }

  promote(): boolean {
    const next = nextCitizenLevel(this.level);
    if (next === null) return false;
    if (!this.meetsRequirementsFor(next)) return false;
    this.level = next;
    return true;
  }

  toJson(): Record<string, unknown> {
    return {
      id: this.id,
      name: this.name,
      attributes: this.attributes.toJson(),
      position: this.position.toJson(),
      homeSettlementId: this.homeSettlementId,
      level: this.level,
      credits: this.credits,
      hp: this.hp,
      hunger: this.hunger,
      thirst: this.thirst,
      energy: this.energy,
      rerollsUsed: this.rerollsUsed,
      starvingStreak: this.starvingStreak,
      dead: this.dead,
      deathReason: this.deathReason,
      inventory: this.inventory.toJson(),
      travellingTo: this.travellingTo,
      travelDaysRemaining: this.travelDaysRemaining,
      statusOffset: this.statusOffset,
    };
  }

  static fromJson(json: Record<string, unknown>): Character {
    const inteiro = (v: unknown, padrao: number): number => {
      const bruto = Number(v);
      return Number.isFinite(bruto) ? Math.trunc(bruto) : padrao;
    };
    const attributes = AttributeSet.fromJson(
      (json.attributes ?? {}) as Record<string, unknown>,
    );

    return new Character({
      id: String(json.id ?? ''),
      name: String(json.name ?? ''),
      attributes,
      position: TileCoord.fromJson(json.position as { x?: unknown; y?: unknown }),
      homeSettlementId: String(json.homeSettlementId ?? ''),
      level: (json.level as CitizenLevel) ?? 'survivor',
      credits: inteiro(json.credits, 250),
      hp: inteiro(json.hp, maxHpFor(attributes)),
      hunger: inteiro(json.hunger, SurvivalTables.maxVital),
      thirst: inteiro(json.thirst, SurvivalTables.maxVital),
      energy: inteiro(json.energy, 10),
      rerollsUsed: inteiro(json.rerollsUsed, 0),
      starvingStreak: inteiro(json.starvingStreak, 0),
      dead: json.dead === true,
      deathReason: (json.deathReason as string | null) ?? null,
      inventory: Inventory.fromJson(
        (json.inventory ?? {}) as Parameters<typeof Inventory.fromJson>[0],
      ),
      travellingTo: (json.travellingTo as string | null) ?? null,
      travelDaysRemaining: inteiro(json.travelDaysRemaining, 0),
      statusOffset: inteiro(json.statusOffset, 0),
    });
  }
}

/** Prende um vital entre o mínimo e o máximo da tabela. */
function clampVital(valor: number): number {
  return Math.min(
    SurvivalTables.maxVital,
    Math.max(SurvivalTables.minVital, valor),
  );
}
