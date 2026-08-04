import { describe, expect, it } from 'vitest';

import fixture from './rules-fixture.json';

import { DeterministicRandom, hashLabel } from '../src/core/rng';
import { WorldLayout, generateLayout } from '../src/world/layout';
import { World } from '../src/world/world';
import { WorldGenerator } from '../src/world/worldGen';
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
import { Campaign } from '../src/campaign/campaign';
import { runDailyTick } from '../src/campaign/dailyTick';
import { MERCADO, TRABALHO_PUBLICO, WALLET } from '../src/rules/eb';

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

describe('Layout do mundo', () => {
  interface LayoutCase {
    seedLabel: string;
    settlements: {
      id: string;
      name: string;
      kind: string;
      center: { x: number; y: number };
      vocation: string;
      radius: number;
      population: number;
      capitalId: string | null;
    }[];
    roads: {
      fromId: string;
      toId: string;
      travelDays: number;
      danger: number;
      lengthInTiles: number;
      first: { x: number; y: number };
      last: { x: number; y: number };
    }[];
  }

  const casos = (ref as unknown as { layout: LayoutCase[] }).layout;

  for (const caso of casos) {
    it(`reproduz o layout de "${caso.seedLabel}" cidade por cidade`, () => {
      // A ordem das chamadas ao RNG é o mapa: trocar um sorteio de lugar
      // reescreve o mundo de toda campanha já criada. Comparar só a contagem
      // de cidades deixaria isso passar.
      const layout = generateLayout(
        WorldGenerator.fromLabel(caso.seedLabel),
      );
      expect(layout.settlements.map((s) => s.toJson())).toEqual(caso.settlements);
    });

    it(`reproduz as estradas de "${caso.seedLabel}"`, () => {
      const layout = generateLayout(
        WorldGenerator.fromLabel(caso.seedLabel),
      );
      expect(
        layout.roads.map((r) => ({
          fromId: r.fromId,
          toId: r.toId,
          travelDays: r.travelDays,
          danger: r.danger,
          lengthInTiles: r.lengthInTiles,
          first: r.path[0]!.toJson(),
          last: r.path[r.path.length - 1]!.toJson(),
        })),
      ).toEqual(caso.roads);
    });
  }
});

describe('Resolução de tile', () => {
  interface TileCase {
    x: number;
    y: number;
    biome: string;
    elevation: number;
    feature: string;
    settlementId: string | null;
    resource: string | null;
    resourceRichness: number;
  }

  it('reproduz bioma, relevo, feature e recurso, no urbano e no selvagem', () => {
    // Os dois caminhos de resolução são diferentes — cidade tem grade de
    // quarteirão, selvagem tem ruído de densidade —, então a amostra cobre os
    // dois de propósito.
    const world = World.fromSeed(hashLabel('contrato-dart-ts'));
    for (const caso of (ref as unknown as { tiles: TileCase[] }).tiles) {
      const tile = world.tileAt(caso.x, caso.y);
      expect({
        x: caso.x,
        y: caso.y,
        biome: tile.biome as string,
        elevation: tile.elevation,
        feature: tile.feature as string,
        settlementId: tile.settlementId,
        resource: tile.resource,
        resourceRichness: tile.resourceRichness,
      }).toEqual(caso);
    }
  });
});

describe('Campanha inteira, dez resets', () => {
  interface CampaignCase {
    initial: {
      startSettlementId: string;
      attributes: Record<string, number>;
      credits: number;
      plotId: string;
      plotOrigin: { x: number; y: number };
      plotName: string;
      governmentCount: number;
      marketCount: number;
      visited: string[];
    };
    days: {
      day: number;
      events: string[];
      upkeepTotal: { hunger: number; thirst: number };
      produced: Record<string, number>;
      completedQuests: string[];
      credits: number;
      hunger: number;
      thirst: number;
      hp: number;
      level: string;
      statusOffset: number;
      inventory: Record<string, number>;
    }[];
  }

  const caso = (ref as unknown as { campaign: CampaignCase }).campaign;

  /**
   * Normaliza a linha do salário.
   *
   * As profissões são uma **extensão do cliente TypeScript**: o Dart não as
   * tem. Elas mudam o texto da linha de salário — "Catador: +45 créditos de
   * salário" no lugar de "Salário público: +45 créditos" — e mudam o **valor**
   * para quem exerce profissão qualificada, porque o fator da profissão
   * multiplica o piso do governador.
   *
   * A referência só exercita o Lixão, cujo fator é 1, então o número continua
   * batendo e é isso que o teste confere. Trocar a atividade da referência para
   * uma profissão qualificada faria os valores divergirem — corretamente, já
   * que o Dart não sabe da regra. O resto do reset segue conferido palavra por
   * palavra contra o Dart.
   */
  const normalizarSalario = (evento: string): string =>
    /\+\d+ créditos de salário\.$/.test(evento)
      ? `Salário público: +${evento.match(/\+(\d+)/)![1]} créditos.`
      : evento;

  const criar = (): Campaign =>
    Campaign.create({
      id: 'ref',
      seedLabel: 'contrato-dart-ts',
      characterName: 'Referência',
      now: 0,
    });

  /**
   * ## Onde a paridade com o Dart termina, e por quê
   *
   * O cliente Dart implementa o **GDD Rev. 3.0**: reset diário à meia-noite,
   * carteira inicial de 250 créditos, imposto sorteado entre 4% e 14%, mandato
   * de 30 dias. A Rev. 4.1 e o EB 1.1 revogam os quatro: tempo real 1:1 com
   * fila de ações, carteira inicial de Cz 30, imposto de 1% com teto de 5%,
   * mandato de 60 dias.
   *
   * Isso **não** é motivo para apagar teste. O que o contrato entre motores
   * defendia continua defendido onde ainda vale: geração de mundo, tiles,
   * biomas, layout e estradas seguem conferidos tile a tile contra a fixture do
   * Dart, e são eles que garantem que a mesma seed produz o mesmo mapa nos dois
   * lados. O que muda é o **estado de campanha**, que a Rev 4.1 redefiniu e o
   * Dart ainda não acompanhou.
   *
   * Para essa parte, o teste passa a defender a propriedade que sobrevive à
   * divergência: dada a mesma seed, o resultado é reprodutível — mesmo mundo,
   * mesmos eventos, mesmo estado, duas execuções seguidas. É o que sustenta
   * save, replay e, mais adiante, autoridade de servidor.
   */
  it('nasce do EB 1.1 e mantém o que a fixture do Dart ainda cobre', () => {
    const campaign = criar();

    // Estrutura: o que a Rev 4.1 não tocou continua batendo com o Dart.
    expect({
      startSettlementId: campaign.character.homeSettlementId,
      attributes: campaign.character.attributes.toJson(),
      plotId: campaign.plot.id,
      plotOrigin: { ...campaign.plot.origin },
      plotName: campaign.plot.name,
      governmentCount: campaign.governments.size,
      marketCount: campaign.world.layout.settlements
        .map((s) => campaign.marketsAt(s.id).length)
        .reduce((a, b) => a + b, 0),
      visited: [...campaign.visitedSettlements].sort(),
    }).toEqual({
      startSettlementId: caso.initial.startSettlementId,
      attributes: caso.initial.attributes,
      plotId: caso.initial.plotId,
      plotOrigin: caso.initial.plotOrigin,
      plotName: caso.initial.plotName,
      governmentCount: caso.initial.governmentCount,
      marketCount: caso.initial.marketCount,
      visited: caso.initial.visited,
    });

    // Economia: os valores agora são os do EB 1.1, e não os da fixture.
    expect(campaign.character.credits).toBe(WALLET.inicial);
    for (const [, governo] of campaign.governments) {
      expect(governo.taxRate).toBeGreaterThanOrEqual(MERCADO.taxaBase);
      expect(governo.taxRate).toBeLessThanOrEqual(MERCADO.taxaMaxima);
      expect(governo.publicWage).toBeGreaterThanOrEqual(TRABALHO_PUBLICO.bruto);
    }
  });

  it('roda dez ciclos de mundo de forma reprodutível', () => {
    // Amarra mundo, personagem, terreno, mercados, governos, quests e
    // sobrevivência de uma vez. A **ordem** das etapas é o que um total isolado
    // não pega — mover o pagamento de salário, ou avaliar quest antes da
    // promoção, muda o resultado sem mudar nenhuma fórmula.
    const rodar = (): unknown[] => {
      const campaign = criar();
      return caso.days.map((_, i) => {
        const activity: DailyActivity = i % 2 === 0 ? { publicWork: 'dump' } : {};
        const report = runDailyTick(campaign, activity);
        return {
          day: report.day,
          events: report.events.map(normalizarSalario),
          upkeepTotal: report.upkeep.total,
          produced: report.produced,
          completedQuests: report.completedQuests.map((q) => q.id),
          credits: campaign.character.credits,
          hunger: campaign.character.hunger,
          thirst: campaign.character.thirst,
          hp: campaign.character.hp,
          level: campaign.character.level as string,
          statusOffset: campaign.character.statusOffset,
          inventory: Object.fromEntries(campaign.character.inventory.stacks),
        };
      });
    };

    expect(rodar()).toEqual(rodar());
  });

  it('sobrevive à ida e volta pelo JSON no meio da campanha', () => {
    // Um save que não recarrega igual é pior que um save que falha: o jogador
    // só descobre depois de perder o progresso.
    const campaign = criar();
    for (let i = 0; i < 4; i++) runDailyTick(campaign, { publicWork: 'dump' });

    const recarregada = Campaign.fromJson(campaign.toJson());
    expect(recarregada.toJson()).toEqual(campaign.toJson());

    // E continua rodando igual a partir dali.
    const a = runDailyTick(campaign, {});
    const b = runDailyTick(recarregada, {});
    expect(b.events).toEqual(a.events);
    expect(recarregada.character.credits).toBe(campaign.character.credits);
  });
});

describe('Tamanho do save', () => {
  it('o layout não guarda o traçado das estradas', () => {
    // Guardá-lo custava 4 MB por mundo — duzentos mil tiles — e estourava a
    // cota do navegador no primeiro mundo salvo. O caminho é função pura da
    // seed, e volta na leitura.
    const layout = generateLayout(WorldGenerator.fromLabel('verde'));
    const bytes = JSON.stringify(layout.toJson()).length;
    expect(bytes).toBeLessThan(64 * 1024);
  });

  it('as estradas voltam com traçado depois de recarregar', () => {
    // Sem reconstruir, o mapa desenharia cidades soltas e `isRoadTile` mentiria.
    const original = generateLayout(WorldGenerator.fromLabel('verde'));
    const seed = hashLabel('verde');
    const world = World.restore(seed, WorldLayout.fromJson(original.toJson()));

    expect(world.layout.roads).toHaveLength(original.roads.length);
    for (let i = 0; i < original.roads.length; i++) {
      expect(world.layout.roads[i]!.path.length).toBe(
        original.roads[i]!.path.length,
      );
    }
  });

  it('uma campanha inteira cabe com folga no armazenamento', () => {
    // O navegador dá ~5 MB no total, e ali moram várias campanhas mais os
    // mundos montados à mão.
    const c = Campaign.create({
      id: 'tamanho',
      seedLabel: 'verde',
      characterName: 'Medida',
      now: 0,
    });
    const bytes = JSON.stringify(c.toJson()).length;
    expect(bytes).toBeLessThan(512 * 1024);
  });
});
