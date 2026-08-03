import type { DeterministicRandom } from '../core/rng';
import { citizenRank, type CitizenLevel } from '../building/buildingType';

/**
 * Os seis atributos do GDD, sorteados na criação do personagem.
 *
 * Não existe treinamento: a evolução vem de equipamentos e implantes. Por isso
 * o sorteio importa, e por isso o jogador tem exatamente três rerrolagens.
 *
 * ## `CitizenLevel` mora em `building/buildingType.ts`
 *
 * No Dart os quatro níveis são declarados aqui, junto dos atributos. Aqui eles
 * já existiam em `buildingType.ts`, porque o catálogo de construções precisa
 * deles para dizer o que cada nível libera — e uma segunda declaração seria uma
 * segunda verdade sobre a mesma coisa. Este arquivo importa e acrescenta o que
 * falta: rótulo, meta e a ordem de progressão.
 */

export type Attribute =
  | 'strength'
  | 'perception'
  | 'luck'
  | 'intelligence'
  | 'endurance'
  | 'status';

export interface AttributeDef {
  readonly id: Attribute;
  readonly label: string;
  readonly description: string;
}

export const allAttributes: readonly AttributeDef[] = [
  {
    id: 'strength',
    label: 'Força',
    description: 'Dano em combate e capacidade de carga.',
  },
  {
    id: 'perception',
    label: 'Percepção',
    description: 'Detecta emboscadas e avalia preços.',
  },
  {
    id: 'luck',
    label: 'Sorte',
    description: 'Loot raro, críticos e resultados de eleição apertada.',
  },
  {
    id: 'intelligence',
    label: 'Inteligência',
    description: 'Rendimento em refino e manufatura.',
  },
  {
    id: 'endurance',
    label: 'Resistência',
    description: 'HP, e quanto tempo aguenta fome e sede.',
  },
  {
    id: 'status',
    label: 'Status',
    description: 'Reputação: peso político e acesso a contratos.',
  },
];

export function attributeDef(id: Attribute): AttributeDef {
  const found = allAttributes.find((a) => a.id === id);
  if (!found) throw new Error(`atributo desconhecido: "${id}"`);
  return found;
}

export const MIN_ROLL = 3;
export const MAX_ROLL = 12;
/** O GDD permite rerrolar até três vezes; depois o valor é permanente. */
export const MAX_REROLLS = 3;

export type AttributeMap = Partial<Record<Attribute, number>>;

export class AttributeSet {
  constructor(private readonly values: AttributeMap) {}

  /**
   * Sorteia um conjunto novo.
   *
   * `2d5+1` e não uniforme em `[3, 12]`, e a diferença não é estética: a soma
   * de dois dados concentra a massa no meio, então valor médio é comum e
   * extremo é memorável. Uniforme faria um 12 valer tanto quanto um 7, e a
   * rerrolagem — que o GDD limita a três — deixaria de ser decisão.
   */
  static roll(rng: DeterministicRandom): AttributeSet {
    const values: AttributeMap = {};
    for (const def of allAttributes) {
      values[def.id] = rng.range(1, 5) + rng.range(1, 5) + 1;
    }
    return new AttributeSet(values);
  }

  get(attribute: Attribute): number {
    return this.values[attribute] ?? MIN_ROLL;
  }

  get total(): number {
    return allAttributes.reduce((soma, def) => soma + this.get(def.id), 0);
  }

  withBonus(bonuses: AttributeMap): AttributeSet {
    const merged: AttributeMap = { ...this.values };
    for (const [chave, bonus] of Object.entries(bonuses)) {
      const id = chave as Attribute;
      merged[id] = this.get(id) + (bonus ?? 0);
    }
    return new AttributeSet(merged);
  }

  toJson(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const def of allAttributes) out[def.id] = this.get(def.id);
    return out;
  }

  static fromJson(json: Record<string, unknown>): AttributeSet {
    const values: AttributeMap = {};
    for (const def of allAttributes) {
      const bruto = Number(json?.[def.id]);
      // Save adulterado ou de outra versão não pode derrubar a criação de
      // personagem: falta ou lixo vira o mínimo, que é um valor jogável.
      values[def.id] = Number.isFinite(bruto) ? Math.trunc(bruto) : MIN_ROLL;
    }
    return new AttributeSet(values);
  }

  toString(): string {
    return allAttributes
      .map((def) => `${def.label} ${this.get(def.id)}`)
      .join(', ');
  }
}

// -------------------------------------------------------- níveis de cidadão

export interface CitizenLevelDef {
  readonly id: CitizenLevel;
  readonly rank: number;
  readonly label: string;
  readonly goal: string;
}

export const allCitizenLevels: readonly CitizenLevelDef[] = [
  {
    id: 'survivor',
    rank: citizenRank.survivor,
    label: 'Nível 0',
    goal: 'Sobreviver e aprender a trabalhar.',
  },
  {
    id: 'farmer',
    rank: citizenRank.farmer,
    label: 'Nível 1',
    goal: 'Comprar a primeira fazenda e entrar na economia.',
  },
  {
    id: 'industrialist',
    rank: citizenRank.industrialist,
    label: 'Nível 2',
    goal: 'Abrir indústria e contratar funcionários.',
  },
  {
    id: 'elite',
    rank: citizenRank.elite,
    label: 'Nível 3',
    goal: 'Política, monopólios, milícias e implantes.',
  },
];

export function citizenLevelDef(id: CitizenLevel): CitizenLevelDef {
  const found = allCitizenLevels.find((l) => l.id === id);
  if (!found) throw new Error(`nível desconhecido: "${id}"`);
  return found;
}

/** O próximo nível, ou `null` no topo. */
export function nextCitizenLevel(id: CitizenLevel): CitizenLevel | null {
  return allCitizenLevels[citizenRank[id] + 1]?.id ?? null;
}

export type { CitizenLevel };
