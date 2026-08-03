import { describe, expect, it } from 'vitest';

import fixture from './rules-fixture.json';

import { DeterministicRandom } from '../src/core/rng';
import { AttributeSet, type Attribute } from '../src/character/attributes';
import { Character } from '../src/character/character';
import {
  Combatant,
  maxHpFor,
  resolveCombat,
  rollLoot,
} from '../src/combat/combat';
import { Inventory } from '../src/economy/inventory';
import { allRecipes, recipeById, recipeYield } from '../src/economy/recipe';
import {
  resolveUpkeep,
  type DailyActivity,
} from '../src/survival/dailyActivity';
import { TileCoord } from '../src/world/coords';

/**
 * O contrato entre as regras em Dart e as regras em TypeScript.
 *
 * O gerador de mundo já tinha um contrato assim, e este existe pelo mesmo
 * motivo, com aposta maior: o combate decide quem perde inventário, e o
 * servidor recalcula o combate do reset para conferir o que o cliente
 * reportou. Dois motores que discordam por **um ponto de dano** viram dois
 * jogos, e o segundo é o que dá para trapacear.
 *
 * A referência é gerada por `test/rules_fixture_export_test.dart` e versionada,
 * então o `vitest` roda sem precisar do Flutter.
 *
 * Cada bloco é verificado separadamente de propósito: uma quebra tem de dizer
 * **qual regra** divergiu, não só que alguma coisa mudou.
 */

interface RollCase {
  seed: number;
  values: Record<string, number>;
  total: number;
  maxHp: number;
}

interface CombatCase {
  name: string;
  seed: number;
  winnerId: string;
  loserId: string;
  rounds: number;
  statusLost: number;
  log: {
    round: number;
    attackerName: string;
    defenderName: string;
    damage: number;
    critical: boolean;
    defenderHpAfter: number;
  }[];
}

interface UpkeepCase {
  name: string;
  hungerModifier: number;
  thirstModifier: number;
  total: { hunger: number; thirst: number };
  lines: { label: string; upkeep: { hunger: number; thirst: number } }[];
}

interface DayCase {
  day: number;
  hunger: number;
  thirst: number;
  hp: number;
  starvingStreak: number;
  dead: boolean;
  hpLost: number;
  starving: boolean;
  dehydrated: boolean;
  died: boolean;
}

const ref = fixture as unknown as {
  attributeRolls: RollCase[];
  combat: CombatCase[];
  loot: { seed: number; loot: Record<string, number> }[];
  upkeep: UpkeepCase[];
  recipeYields: { recipe: string; intelligence: number; yield: number }[];
  characterDays: DayCase[];
};

const set = (values: Partial<Record<Attribute, number>>): AttributeSet =>
  new AttributeSet(values);

const plano = (intelligence: number): AttributeSet =>
  set({
    strength: 6,
    perception: 6,
    luck: 6,
    intelligence,
    endurance: 6,
    status: 6,
  });

describe('Sorteio de atributos', () => {
  it('reproduz o conjunto do Dart, valor a valor', () => {
    // A **ordem** das chamadas ao RNG faz parte do resultado: trocar a ordem
    // dos atributos mudaria todo personagem já criado. Comparar só o total
    // deixaria essa troca passar.
    for (const caso of ref.attributeRolls) {
      const rolado = AttributeSet.roll(new DeterministicRandom(caso.seed));
      expect(rolado.toJson()).toEqual(caso.values);
      expect(rolado.total).toBe(caso.total);
      expect(maxHpFor(rolado)).toBe(caso.maxHp);
    }
  });
});

describe('Combate determinístico', () => {
  const cenarios: Record<
    string,
    { a: Partial<Record<Attribute, number>>; b: Partial<Record<Attribute, number>>; bAtk?: number; bDef?: number; bDrones?: number }
  > = {
    equilibrado: {
      a: { strength: 7, perception: 8, luck: 6, intelligence: 6, endurance: 7, status: 6 },
      b: { strength: 7, perception: 5, luck: 9, intelligence: 6, endurance: 7, status: 6 },
    },
    tanque: {
      a: { strength: 3, perception: 4, luck: 3, intelligence: 5, endurance: 12, status: 5 },
      b: { strength: 12, perception: 10, luck: 12, intelligence: 8, endurance: 4, status: 7 },
      bAtk: 40,
      bDef: 30,
    },
    drones: {
      a: { strength: 6, perception: 6, luck: 6, intelligence: 6, endurance: 6, status: 6 },
      b: { strength: 6, perception: 6, luck: 6, intelligence: 6, endurance: 6, status: 6 },
      bDrones: 4,
    },
  };

  for (const caso of ref.combat) {
    it(`reproduz o combate "${caso.name}" rodada a rodada`, () => {
      const cenario = cenarios[caso.name]!;
      const a = new Combatant({
        id: 'a',
        name: 'a',
        attributes: set(cenario.a),
        attackPower: 0,
        defensePower: 0,
        hp: maxHpFor(set(cenario.a)),
      });
      const b = new Combatant({
        id: 'b',
        name: 'b',
        attributes: set(cenario.b),
        attackPower: cenario.bAtk ?? 0,
        defensePower: cenario.bDef ?? 0,
        hp: maxHpFor(set(cenario.b)),
        droneCount: cenario.bDrones ?? 0,
      });

      const relatorio = resolveCombat(a, b, caso.seed);

      expect(relatorio.winnerId).toBe(caso.winnerId);
      expect(relatorio.loserId).toBe(caso.loserId);
      expect(relatorio.rounds).toBe(caso.rounds);
      expect(relatorio.statusLost).toBe(caso.statusLost);
      // O registro inteiro, e não só o vencedor: dois motores podem chegar ao
      // mesmo vencedor por caminhos diferentes, e é o caminho que o servidor
      // recalcula.
      expect(relatorio.log).toEqual(caso.log);
    });
  }

  it('reproduz o loot da derrota', () => {
    for (const caso of ref.loot) {
      const inventory = new Inventory();
      inventory.add('scrap', 40);
      inventory.add('polymer', 17);
      inventory.add('chip', 9);
      inventory.add('water', 100);
      expect(rollLoot(inventory, caso.seed)).toEqual(caso.loot);
    }
  });
});

describe('Conta de Fome e Sede', () => {
  const atividades: Record<string, DailyActivity> = {
    ocioso: {},
    'ferro-velho no deserto': { publicWork: 'dump', weather: 'desert' },
    'viagem longa com combate': {
      roadsTravelled: 3,
      sleptOnRoad: true,
      combats: [{ won: false, rounds: 9 }],
    },
    'oficina com consumo na neve': {
      workshopWork: 'laboratory',
      consumed: ['redRush'],
      weather: 'snow',
    },
  };

  for (const caso of ref.upkeep) {
    it(`reproduz "${caso.name}"`, () => {
      const nome = caso.name.split(' · mods')[0]!;
      const conta = resolveUpkeep(atividades[nome]!, {
        hungerModifier: caso.hungerModifier,
        thirstModifier: caso.thirstModifier,
      });

      expect(conta.total).toEqual(caso.total);
      // As linhas também, e não só o total: a **ordem** delas é a fórmula do
      // GDD. Clima multiplica o subtotal e equipamento reduz por último;
      // trocar as duas etapas de lugar dá outro número, e um total conferido
      // isoladamente poderia bater por acaso num caso e não em outro.
      expect(conta.lines).toEqual(caso.lines);
    });
  }
});

describe('Rendimento das receitas', () => {
  it('reproduz o rendimento de toda receita em toda Inteligência', () => {
    for (const caso of ref.recipeYields) {
      const receita = recipeById(caso.recipe);
      expect(receita, `receita ausente na porta: ${caso.recipe}`).not.toBeNull();
      expect(recipeYield(receita!, plano(caso.intelligence))).toBe(caso.yield);
    }
  });

  it('o livro tem as mesmas receitas dos dois lados', () => {
    const naReferencia = new Set(ref.recipeYields.map((c) => c.recipe));
    const naPorta = new Set(allRecipes.map((r) => r.id));
    expect([...naPorta].sort()).toEqual([...naReferencia].sort());
  });
});

describe('Dias seguidos de um personagem', () => {
  it('reproduz oito resets, incluindo inanição e morte', () => {
    // O acúmulo é o que revela divergência de arredondamento; um dia isolado
    // fecha por acaso com facilidade.
    const attributes = set({
      strength: 6,
      perception: 6,
      luck: 6,
      intelligence: 6,
      endurance: 8,
      status: 6,
    });
    const personagem = new Character({
      id: 'ref',
      name: 'Referência',
      attributes,
      position: new TileCoord(0, 0),
      homeSettlementId: 'cap_0',
    });

    const atividade: DailyActivity = { publicWork: 'dump', weather: 'desert' };

    for (const esperado of ref.characterDays) {
      const conta = resolveUpkeep(atividade);
      const resultado = personagem.applyUpkeep(conta.total);

      expect({
        day: esperado.day,
        hunger: personagem.hunger,
        thirst: personagem.thirst,
        hp: personagem.hp,
        starvingStreak: personagem.starvingStreak,
        dead: personagem.dead,
        hpLost: resultado.hpLost,
        starving: resultado.starving,
        dehydrated: resultado.dehydrated,
        died: resultado.died,
      }).toEqual(esperado);
    }
  });
});
