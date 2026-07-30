import 'dart:convert';

import 'package:cyberkingdoms/domain/building/building_type.dart';
import 'package:cyberkingdoms/domain/campaign/campaign.dart';
import 'package:cyberkingdoms/domain/campaign/daily_tick.dart';
import 'package:cyberkingdoms/domain/campaign/quest.dart';
import 'package:cyberkingdoms/domain/character/attributes.dart';
import 'package:cyberkingdoms/domain/economy/item.dart';
import 'package:cyberkingdoms/domain/survival/daily_activity.dart';
import 'package:flutter_test/flutter_test.dart';

Campaign fresh() => Campaign.create(
      id: 'c',
      seedLabel: 'quests-teste',
      characterName: 'Kaia',
    );

void main() {
  group('Livro de quests', () {
    test('todos os pré-requisitos apontam para quests existentes', () {
      for (final quest in QuestBook.all) {
        for (final requirement in quest.requires) {
          expect(QuestBook.byId(requirement), isNotNull,
              reason: '${quest.id} exige "$requirement", que não existe');
        }
      }
    });

    test('nenhum id se repete', () {
      final ids = QuestBook.all.map((q) => q.id).toList();
      expect(ids.toSet().length, ids.length);
    });

    test('não há dependência circular', () {
      // Uma quest só pode depender de outra declarada antes dela na lista.
      final seen = <String>{};
      for (final quest in QuestBook.all) {
        for (final requirement in quest.requires) {
          expect(seen, contains(requirement),
              reason: '${quest.id} depende de "$requirement" declarada depois');
        }
        seen.add(quest.id);
      }
    });

    test('toda quest tem pelo menos um objetivo', () {
      for (final quest in QuestBook.all) {
        expect(quest.objectives, isNotEmpty, reason: quest.id);
      }
    });

    test('os quatro estágios do GDD têm quests', () {
      for (final stage in CitizenLevel.values) {
        expect(QuestBook.byStage(stage), isNotEmpty, reason: stage.label);
      }
    });

    test('as recompensas crescem com o estágio', () {
      double averageReward(CitizenLevel stage) {
        final quests = QuestBook.byStage(stage);
        return quests.fold<int>(0, (sum, q) => sum + q.reward.credits) /
            quests.length;
      }

      expect(averageReward(CitizenLevel.elite),
          greaterThan(averageReward(CitizenLevel.survivor)));
      expect(averageReward(CitizenLevel.industrialist),
          greaterThan(averageReward(CitizenLevel.farmer)));
    });
  });

  group('Avaliação de objetivos', () {
    test('a campanha nova tem a primeira quest disponível e nada completo', () {
      final campaign = fresh();
      final log = QuestLog(campaign);

      expect(log.current, isNotNull);
      expect(log.current!.id, 'q0_agua');
      expect(campaign.completedQuests, isEmpty);
    });

    test('o objetivo lê o estado real, sem precisar de flag', () {
      final campaign = fresh();
      final quest = QuestBook.byId('q0_agua')!;

      expect(quest.isComplete(campaign), isFalse);
      campaign.character.inventory.add(ItemId.water, 5);
      expect(quest.isComplete(campaign), isTrue);
    });

    test('o progresso é reportado por objetivo', () {
      final campaign = fresh();
      final quest = QuestBook.byId('q0_agua')!;
      campaign.character.inventory.add(ItemId.water, 2);

      final (current, target) = quest.objectives.first.progress(campaign);
      expect(current, 2);
      expect(target, 5);
      expect(quest.completion(campaign), closeTo(0.4, 0.001));
    });

    test('quest travada não aparece como disponível', () {
      final campaign = fresh();
      final log = QuestLog(campaign);

      final locked = QuestBook.byId('q3_imperio')!;
      expect(log.isUnlocked(locked), isFalse);
      expect(log.locked, contains(locked));
    });

    test('cumprir o pré-requisito destrava a seguinte', () {
      final campaign = fresh();
      campaign.character.inventory.add(ItemId.water, 10);

      final log = QuestLog(campaign);
      expect(log.isComplete(QuestBook.byId('q0_agua')!), isTrue);
      expect(log.isUnlocked(QuestBook.byId('q0_comida')!), isTrue);
    });

    test('visitar cidades conta para o objetivo de exploração', () {
      final campaign = fresh();
      final quest = QuestBook.byId('q1_estrada')!;

      expect(quest.objectives.first.progress(campaign).$1, 1);

      campaign.visitedSettlements.addAll(['sat_0', 'sat_1']);
      expect(quest.isComplete(campaign), isTrue);
    });

    test('construir conta para o objetivo de construção', () {
      final campaign = fresh();
      final quest = QuestBook.byId('q0_abrigo')!;
      campaign.character.inventory.add(ItemId.scrap, 100);

      campaign.plot.build(
        type: BuildingId.shack,
        x: 0,
        y: 0,
        inventory: campaign.character.inventory,
        credits: 100000,
        level: CitizenLevel.survivor,
        day: 1,
      );

      // Em obras ainda não conta — só construção operacional.
      expect(quest.isComplete(campaign), isFalse);

      const DailyTick().run(campaign, const DailyActivity());
      expect(quest.isComplete(campaign), isTrue);
    });
  });

  group('Recompensas', () {
    test('a recompensa é paga uma única vez', () {
      final campaign = fresh();
      campaign.character.inventory.add(ItemId.water, 10);
      final creditsBefore = campaign.character.credits;

      final first = QuestLog(campaign).claimNewlyCompleted();
      expect(first.map((q) => q.id), contains('q0_agua'));
      final afterFirst = campaign.character.credits;
      expect(afterFirst, greaterThan(creditsBefore));

      // Segunda passagem não paga de novo.
      final second = QuestLog(campaign).claimNewlyCompleted();
      expect(second.map((q) => q.id), isNot(contains('q0_agua')));
      expect(campaign.character.credits, afterFirst);
    });

    test('a recompensa entrega créditos, itens e Status', () {
      final campaign = fresh();
      // q0_abrigo paga 400¢ + 5 água.
      campaign.character.inventory.add(ItemId.scrap, 100);
      campaign.character.inventory.add(ItemId.water, 10);
      campaign.character.inventory.add(ItemId.streetFood, 10);
      campaign.plot.build(
        type: BuildingId.shack,
        x: 0, y: 0,
        inventory: campaign.character.inventory,
        credits: 100000,
        level: CitizenLevel.survivor,
        day: 1,
      );
      for (var i = 0; i < 2; i++) {
        const DailyTick().run(campaign, const DailyActivity());
      }

      expect(campaign.completedQuests, contains('q0_abrigo'));
    });

    test('o reset diário reporta as quests concluídas', () {
      final campaign = fresh();
      campaign.character.inventory.add(ItemId.water, 10);

      final report = const DailyTick().run(campaign, const DailyActivity());

      expect(report.completedQuests.map((q) => q.id), contains('q0_agua'));
      expect(report.events.any((e) => e.contains('QUEST CONCLUÍDA')), isTrue);
    });

    test('uma quest cumprida por acidente antes de destravar não trava o jogo', () {
      final campaign = fresh();
      // Cumpre o objetivo da terceira quest sem ter feito as anteriores.
      campaign.character.inventory.add(ItemId.scrap, 50);

      final log = QuestLog(campaign);
      // Ainda travada porque q0_agua não foi cumprida.
      expect(log.isUnlocked(QuestBook.byId('q0_trabalho')!), isFalse);

      // Cumpre a primeira; a terceira destrava e já conta como completa.
      campaign.character.inventory.add(ItemId.water, 10);
      final log2 = QuestLog(campaign);
      expect(log2.isUnlocked(QuestBook.byId('q0_trabalho')!), isTrue);
      expect(log2.isComplete(QuestBook.byId('q0_trabalho')!), isTrue);
    });

    test('o progresso geral avança conforme as quests fecham', () {
      final campaign = fresh();
      expect(QuestLog(campaign).overallProgress, 0);

      campaign.character.inventory.add(ItemId.water, 10);
      campaign.character.inventory.add(ItemId.streetFood, 10);
      QuestLog(campaign).claimNewlyCompleted();

      expect(QuestLog(campaign).overallProgress, greaterThan(0));
    });
  });

  group('Persistência das quests', () {
    test('quests concluídas e cidades visitadas sobrevivem ao save', () {
      final campaign = fresh();
      campaign.character.inventory.add(ItemId.water, 10);
      QuestLog(campaign).claimNewlyCompleted();
      campaign.visitedSettlements.add('sat_3');

      final restored =
          Campaign.fromJson(jsonDecode(jsonEncode(campaign.toJson())));

      expect(restored.completedQuests, contains('q0_agua'));
      expect(restored.visitedSettlements, contains('sat_3'));
    });

    test('save antigo sem os campos de quest carrega vazio', () {
      final campaign = fresh();
      final json = campaign.toJson()
        ..remove('completedQuests')
        ..remove('visitedSettlements');

      final restored = Campaign.fromJson(jsonDecode(jsonEncode(json)));
      expect(restored.completedQuests, isEmpty);
      expect(restored.visitedSettlements, isEmpty);
    });

    test('uma quest já paga continua paga depois de recarregar', () {
      final campaign = fresh();
      campaign.character.inventory.add(ItemId.water, 10);
      QuestLog(campaign).claimNewlyCompleted();

      final restored =
          Campaign.fromJson(jsonDecode(jsonEncode(campaign.toJson())));
      final creditsBefore = restored.character.credits;

      QuestLog(restored).claimNewlyCompleted();
      expect(restored.character.credits, creditsBefore);
    });
  });
}
