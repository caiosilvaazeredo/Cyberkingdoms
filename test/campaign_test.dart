import 'dart:convert';

import 'package:cyberkingdoms/core/seed/deterministic_random.dart';
import 'package:cyberkingdoms/domain/campaign/campaign.dart';
import 'package:cyberkingdoms/domain/campaign/daily_tick.dart';
import 'package:cyberkingdoms/domain/character/attributes.dart';
import 'package:cyberkingdoms/domain/combat/combat.dart';
import 'package:cyberkingdoms/domain/economy/inventory.dart';
import 'package:cyberkingdoms/domain/economy/item.dart';
import 'package:cyberkingdoms/domain/politics/government.dart';
import 'package:cyberkingdoms/domain/survival/daily_activity.dart';
import 'package:cyberkingdoms/domain/survival/survival_tables.dart';
import 'package:flutter_test/flutter_test.dart';

Campaign newCampaign({String seed = 'teste-neon'}) => Campaign.create(
      id: 'camp_test',
      seedLabel: seed,
      characterName: 'Kaia',
    );

void main() {
  group('Criação de campanha', () {
    test('gera o mundo completo do GDD', () {
      final campaign = newCampaign();
      expect(campaign.world.layout.capitals.length, 5);
      expect(campaign.world.layout.satellites.length, 15);
      expect(campaign.day, 1);
    });

    test('o jogador nasce numa capital', () {
      final campaign = newCampaign();
      final home = campaign.world.layout.byId(campaign.character.homeSettlementId);
      expect(home, isNotNull);
      expect(home!.isCapital, isTrue);
      expect(campaign.character.position, home.center);
    });

    test('toda cidade tem Mercado Central; só algumas têm clandestino', () {
      final campaign = newCampaign();
      for (final settlement in campaign.world.layout.settlements) {
        expect(campaign.marketsAt(settlement.id), isNotEmpty);
      }
      for (final capital in campaign.world.layout.capitals) {
        expect(campaign.marketsAt(capital.id).length, 2,
            reason: 'capitais sempre têm os dois mercados');
      }
    });

    test('a mesma seed textual gera o mesmo mundo', () {
      final a = Campaign.create(id: 'a', seedLabel: 'orixá-9', characterName: 'X');
      final b = Campaign.create(id: 'b', seedLabel: 'orixá-9', characterName: 'Y');

      expect(a.seed, b.seed);
      for (var i = 0; i < a.world.layout.settlements.length; i++) {
        expect(a.world.layout.settlements[i].name,
            b.world.layout.settlements[i].name);
      }
    });

    test('o personagem começa vivo e com as barras cheias', () {
      final character = newCampaign().character;
      expect(character.dead, isFalse);
      expect(character.hunger, SurvivalTables.maxVital);
      expect(character.thirst, SurvivalTables.maxVital);
      expect(character.hp, character.maxHp);
      expect(character.level, CitizenLevel.survivor);
    });
  });

  group('Persistência', () {
    test('salvar e carregar preserva o estado', () {
      final original = newCampaign();
      original.character.credits = 7777;
      original.character.inventory.add(ItemId.chip, 5);
      original.day = 12;

      final restored =
          Campaign.fromJson(jsonDecode(jsonEncode(original.toJson())));

      expect(restored.seed, original.seed);
      expect(restored.day, 12);
      expect(restored.character.credits, 7777);
      expect(restored.character.inventory.quantityOf(ItemId.chip), 5);
      expect(restored.world.layout.capitals.length, 5);
    });

    test('o terreno é regenerado da seed, não lido do save', () {
      final original = newCampaign();
      final json = original.toJson();

      // O save não carrega tiles — só a seed e o layout.
      expect(json.containsKey('tiles'), isFalse);
      expect(json.containsKey('chunks'), isFalse);

      final restored = Campaign.fromJson(jsonDecode(jsonEncode(json)));
      for (var i = 0; i < 200; i++) {
        final x = i * 31 - 500;
        final y = i * -17 + 300;
        expect(restored.world.tileAt(x, y).biome,
            original.world.tileAt(x, y).biome);
      }
    });

    test('um save com item desconhecido carrega sem quebrar', () {
      final json = {
        'stacks': {'water': 3, 'item_que_nao_existe_mais': 9},
        'equipped': ['fantasma'],
      };
      final inventory = Inventory.fromJson(json);
      expect(inventory.quantityOf(ItemId.water), 3);
      expect(inventory.equipped, isEmpty);
    });
  });

  group('Reset diário', () {
    test('avança o dia e cobra o consumo', () {
      final campaign = newCampaign();
      final before = campaign.character.thirst;

      final report = const DailyTick().run(campaign, const DailyActivity());

      expect(campaign.day, 2);
      expect(report.day, 1);
      expect(campaign.character.thirst,
          before - SurvivalTables.idleBase.thirst);
    });

    test('trabalhar produz item e cobra mais que ficar parado', () {
      final campaign = newCampaign();
      final idle = const DailyTick()
          .run(newCampaign(), const DailyActivity())
          .upkeep
          .total;

      final report = const DailyTick().run(
        campaign,
        const DailyActivity(publicWork: PublicWork.oil),
      );

      expect(report.produced[ItemId.oil], greaterThan(0));
      expect(campaign.character.inventory.quantityOf(ItemId.oil),
          greaterThan(0));
      expect(report.upkeep.total.thirst, greaterThan(idle.thirst));
    });

    test('serviço público paga salário do tesouro local', () {
      final campaign = newCampaign();
      final government =
          campaign.governmentOf(campaign.currentSettlementId!);
      government.treasury = 10000;
      final creditsBefore = campaign.character.credits;

      const DailyTick().run(
        campaign,
        const DailyActivity(publicWork: PublicWork.dump),
      );

      expect(campaign.character.credits,
          creditsBefore + government.publicWage);
    });

    test('governo sem caixa não paga e o jogador não ganha nada', () {
      final campaign = newCampaign();
      campaign.governmentOf(campaign.currentSettlementId!).treasury = 0;
      final creditsBefore = campaign.character.credits;

      final report = const DailyTick().run(
        campaign,
        const DailyActivity(publicWork: PublicWork.dump),
      );

      expect(campaign.character.credits, creditsBefore);
      expect(report.events.any((e) => e.contains('não tinha caixa')), isTrue);
    });

    test('abandono leva à morte permanente', () {
      final campaign = newCampaign();
      // Zera as barras e deixa o tempo passar sem comer nem beber.
      campaign.character.hunger = 0;
      campaign.character.thirst = 0;

      for (var i = 0; i < SurvivalTables.consecutiveDaysToDeath; i++) {
        const DailyTick().run(campaign, const DailyActivity());
      }

      expect(campaign.character.dead, isTrue);
      expect(campaign.character.deathReason, contains('abandono'));
    });

    test('quem se alimenta não morre', () {
      final campaign = newCampaign();
      campaign.character.inventory.add(ItemId.water, 40);
      campaign.character.inventory.add(ItemId.streetFood, 40);

      for (var day = 0; day < 30; day++) {
        // Come e bebe sempre que a barra fica abaixo da metade.
        if (campaign.character.thirst < 60) {
          campaign.character.consume(ItemId.water);
        }
        if (campaign.character.hunger < 60) {
          campaign.character.consume(ItemId.streetFood);
        }
        const DailyTick().run(campaign, const DailyActivity());
      }

      expect(campaign.character.dead, isFalse);
      expect(campaign.day, 31);
    });

    test('o tick é determinístico para a mesma seed e atividade', () {
      List<String> runTwentyDays() {
        final campaign = newCampaign(seed: 'determinismo-1');
        campaign.character.inventory.add(ItemId.water, 100);
        campaign.character.inventory.add(ItemId.streetFood, 100);
        final events = <String>[];
        for (var day = 0; day < 20; day++) {
          campaign.character.consume(ItemId.water);
          campaign.character.consume(ItemId.streetFood);
          events.addAll(
            const DailyTick()
                .run(campaign, const DailyActivity(publicWork: PublicWork.oil))
                .events,
          );
        }
        return events;
      }

      expect(runTwentyDays(), runTwentyDays());
    });

    test('um personagem morto não continua sendo processado', () {
      final campaign = newCampaign();
      campaign.character.dead = true;
      final dayBefore = campaign.day;

      final report = const DailyTick().run(campaign, const DailyActivity());

      expect(campaign.day, dayBefore);
      expect(report.events.first, contains('morto'));
    });
  });

  group('Viagem', () {
    test('a viagem consome dias e bloqueia o trabalho', () {
      final campaign = newCampaign();
      final origin = campaign.world.layout.byId(campaign.character.homeSettlementId)!;
      final road = campaign.world.layout.roadsFrom(origin.id).first;
      final destinationId = campaign.world.layout.otherEnd(road, origin.id);

      campaign.character.travellingTo = destinationId;
      campaign.character.travelDaysRemaining = road.travelDays;

      // Mesmo escalando trabalho, o trânsito cancela.
      final report = const DailyTick().run(
        campaign,
        const DailyActivity(publicWork: PublicWork.oil),
      );

      expect(report.produced, isEmpty);
      expect(campaign.character.travelDaysRemaining, road.travelDays - 1);
    });

    test('ao chegar, a posição vira o centro do destino', () {
      final campaign = newCampaign();
      final origin = campaign.world.layout.byId(campaign.character.homeSettlementId)!;
      final road = campaign.world.layout.roadsFrom(origin.id).first;
      final destinationId = campaign.world.layout.otherEnd(road, origin.id);
      final destination = campaign.world.layout.byId(destinationId)!;

      campaign.character.travellingTo = destinationId;
      campaign.character.travelDaysRemaining = 1;

      const DailyTick().run(campaign, const DailyActivity());

      expect(campaign.character.position, destination.center);
      expect(campaign.character.travellingTo, isNull);
      expect(campaign.character.isTravelling, isFalse);
    });
  });

  group('Combate', () {
    AttributeSet flat(int value) =>
        AttributeSet({for (final a in Attribute.values) a: value});

    Combatant fighter(String id, int value, {int attack = 0}) => Combatant(
          id: id,
          name: id,
          attributes: flat(value),
          attackPower: attack,
          defensePower: 0,
          hp: Combatant.maxHpFor(flat(value)),
        );

    test('mesma seed e mesmos combatentes dão o mesmo resultado', () {
      CombatReport run() => CombatResolver.resolve(
            a: fighter('a', 8),
            b: fighter('b', 8),
            seed: 5150,
          );

      final first = run();
      final second = run();
      expect(first.winnerId, second.winnerId);
      expect(first.rounds, second.rounds);
      expect(first.log.map((e) => e.damage).toList(),
          second.log.map((e) => e.damage).toList());
    });

    test('equipamento melhor tende a vencer', () {
      var wins = 0;
      for (var seed = 0; seed < 40; seed++) {
        final report = CombatResolver.resolve(
          a: fighter('armado', 8, attack: 25),
          b: fighter('desarmado', 8),
          seed: seed,
        );
        if (report.winnerId == 'armado') wins++;
      }
      expect(wins, greaterThan(32), reason: 'progressão por equipamento');
    });

    test('o combate sempre termina e gera log auditável', () {
      final report = CombatResolver.resolve(
        a: fighter('a', 12),
        b: fighter('b', 12),
        seed: 7,
      );
      expect(report.rounds, greaterThan(0));
      expect(report.rounds, lessThanOrEqualTo(CombatResolver.maxRounds));
      expect(report.log, isNotEmpty);
      expect(report.winnerId, isNot(report.loserId));
    });

    test('o saque é parcial e nunca leva implantes', () {
      final inventory = Inventory()
        ..add(ItemId.scrap, 100)
        ..add(ItemId.chip, 40)
        ..add(ItemId.metabolicImplant, 1);

      final loot = CombatResolver.rollLoot(
        loserInventory: inventory,
        seed: 99,
      );

      expect(loot.keys, isNot(contains(ItemId.metabolicImplant)));
      for (final entry in loot.entries) {
        expect(entry.value, lessThan(inventory.quantityOf(entry.key)));
      }
    });
  });

  group('Política', () {
    test('a eleição elege quem tem a plataforma mais popular', () {
      final election = Election(settlementId: 'cap_0', scheduledForDay: 30);
      election.register(Candidacy(
        citizenId: 'popular',
        citizenName: 'Popular',
        platformTaxRate: 0.02,
        platformWage: 110,
      ));
      election.register(Candidacy(
        citizenId: 'impopular',
        citizenName: 'Impopular',
        platformTaxRate: 0.38,
        platformWage: 12,
      ));

      final winner = election.resolve(
        electorate: 5000,
        rng: DeterministicRandom(3),
        statusOf: (_) => 7,
      );

      expect(winner?.citizenId, 'popular');
      expect(election.resolved, isTrue);
    });

    test('não dá para registrar o mesmo candidato duas vezes', () {
      final election = Election(settlementId: 'cap_0', scheduledForDay: 30);
      final candidacy = Candidacy(
        citizenId: 'x',
        citizenName: 'X',
        platformTaxRate: 0.1,
        platformWage: 50,
      );
      expect(election.register(candidacy), isTrue);
      expect(election.register(candidacy), isFalse);
    });

    test('golpe vitorioso saqueia o tesouro e troca o governo', () {
      final government = Government(settlementId: 'cap_0', treasury: 50000);
      // Governo fraco: sem milícia e sem orçamento de segurança.
      final committee = RevolutionaryCommittee(
        settlementId: 'cap_0',
        leaderId: 'lider',
        leaderName: 'Líder',
      )..join('lider', 100);

      final result = committee.attemptCoup(government);

      expect(result.succeeded, isTrue);
      expect(result.lootedTreasury, 50000);
      expect(government.treasury, 0);
      expect(government.governorId, 'lider');
      expect(government.interim, isTrue);
    });

    test('golpe fracassado torna os rebeldes procurados', () {
      final government = Government(settlementId: 'cap_0', securityBudget: 100000);
      final committee = RevolutionaryCommittee(
        settlementId: 'cap_0',
        leaderId: 'lider',
        leaderName: 'Líder',
      )..join('aliado', 5);

      final result = committee.attemptCoup(government);

      expect(result.succeeded, isFalse);
      expect(government.isWanted('lider'), isTrue);
      expect(government.isWanted('aliado'), isTrue);
    });

    test('o imposto respeita o teto', () {
      final government = Government(settlementId: 'cap_0');
      government.setTaxRate(5);
      expect(government.taxRate, Government.maxTaxRate);
      government.setTaxRate(-1);
      expect(government.taxRate, Government.minTaxRate);
    });

    test('o governo paga só o que o caixa cobre', () {
      final government = Government(
        settlementId: 'cap_0',
        treasury: 100,
        publicWage: 40,
      );
      expect(government.payWages(10), 100);
      expect(government.treasury, 0);
    });
  });

  group('Progressão', () {
    test('sem patrimônio não há promoção', () {
      final campaign = newCampaign();
      campaign.character.credits = 10;
      expect(campaign.character.promote(), isFalse);
      expect(campaign.character.level, CitizenLevel.survivor);
    });

    test('com os requisitos, a promoção acontece', () {
      final campaign = newCampaign();
      campaign.character.credits = 5000;
      expect(campaign.character.promote(), isTrue);
      expect(campaign.character.level, CitizenLevel.farmer);
    });

    test('a rerrolagem é limitada a 3 vezes', () {
      final campaign = newCampaign();
      expect(campaign.character.canReroll, isTrue);
      campaign.character.rerollsUsed = AttributeSet.maxRerolls;
      expect(campaign.character.canReroll, isFalse);
    });
  });
}
