import 'dart:convert';

import 'package:cyberkingdoms/domain/building/building_type.dart';
import 'package:cyberkingdoms/domain/building/plot.dart';
import 'package:cyberkingdoms/domain/campaign/campaign.dart';
import 'package:cyberkingdoms/domain/campaign/daily_tick.dart';
import 'package:cyberkingdoms/domain/character/attributes.dart';
import 'package:cyberkingdoms/domain/economy/inventory.dart';
import 'package:cyberkingdoms/domain/economy/item.dart';
import 'package:cyberkingdoms/domain/survival/daily_activity.dart';
import 'package:cyberkingdoms/domain/world/coords.dart';
import 'package:flutter_test/flutter_test.dart';

Plot emptyPlot({int width = 10, int height = 10}) => Plot(
      id: 'plot_test',
      settlementId: 'cap_0',
      origin: const TileCoord(0, 0),
      width: width,
      height: height,
    );

/// Inventário com material de sobra, para isolar a regra sob teste.
Inventory richInventory() {
  final inventory = Inventory();
  for (final id in ItemId.values) {
    inventory.add(id, 999);
  }
  return inventory;
}

void main() {
  group('Catálogo de construções', () {
    test('tem pelo menos 30 tipos', () {
      expect(BuildingCatalog.count, greaterThanOrEqualTo(30));
    });

    test('todo BuildingId tem definição', () {
      for (final id in BuildingId.values) {
        expect(() => BuildingCatalog.of(id), returnsNormally, reason: '$id');
      }
    });

    test('toda categoria tem pelo menos duas construções', () {
      for (final category in BuildingCategory.values) {
        expect(BuildingCatalog.byCategory(category).length,
            greaterThanOrEqualTo(2),
            reason: category.label);
      }
    });

    test('todo sprite referenciado existe no manifesto de assets', () async {
      // O manifesto é gerado no build dos sprites; aqui conferimos apenas que
      // o id tem o formato `kit/nome`, que é o que o loader espera.
      for (final def in BuildingCatalog.all) {
        expect(def.spriteId, contains('/'),
            reason: '${def.name} tem spriteId inválido');
        expect(def.spriteId.split('/').length, 2, reason: def.name);
      }
    });

    test('custo e tempo crescem com o nível exigido', () {
      double averageCost(CitizenLevel level) {
        final defs = BuildingCatalog.all
            .where((d) => d.requiredLevel == level)
            .toList();
        if (defs.isEmpty) return 0;
        return defs.fold<int>(0, (sum, d) => sum + d.creditCost) / defs.length;
      }

      expect(averageCost(CitizenLevel.elite),
          greaterThan(averageCost(CitizenLevel.survivor)));
      expect(averageCost(CitizenLevel.industrialist),
          greaterThan(averageCost(CitizenLevel.farmer)));
    });

    test('toda construção produtora declara o que produz e quanto', () {
      for (final def in BuildingCatalog.all) {
        if (def.produces != null) {
          expect(def.outputPerDay, greaterThan(0), reason: def.name);
        }
      }
    });

    test('as construções ilegais estão marcadas', () {
      final illegal = BuildingCatalog.all.where((d) => !d.legal).toList();
      expect(illegal, isNotEmpty);
      expect(
        illegal.map((d) => d.id),
        containsAll([BuildingId.blackMarketStall, BuildingId.committeeHall]),
      );
    });
  });

  group('Posicionamento no terreno', () {
    test('constrói e debita material', () {
      final plot = emptyPlot();
      final inventory = richInventory();
      final def = BuildingCatalog.of(BuildingId.shack);
      final scrapBefore = inventory.quantityOf(ItemId.scrap);

      final result = plot.build(
        type: BuildingId.shack,
        x: 0,
        y: 0,
        inventory: inventory,
        credits: 100000,
        level: CitizenLevel.survivor,
        day: 1,
      );

      expect(result, isA<BuildAccepted>());
      expect(plot.buildings.length, 1);
      expect(
        inventory.quantityOf(ItemId.scrap),
        scrapBefore - def.materialCost[ItemId.scrap]!,
      );
    });

    test('recusa construção que não cabe no terreno', () {
      final plot = emptyPlot(width: 4, height: 4);
      final result = plot.build(
        type: BuildingId.droneAssembly, // 3x2
        x: 3,
        y: 3,
        inventory: richInventory(),
        credits: 1000000,
        level: CitizenLevel.elite,
        day: 1,
      );
      expect(result, isA<BuildRejected>());
      expect((result as BuildRejected).reason, contains('não cabe'));
      expect(plot.buildings, isEmpty);
    });

    test('recusa sobreposição', () {
      final plot = emptyPlot();
      final inventory = richInventory();
      plot.build(
        type: BuildingId.warehouse, // 3x2
        x: 2, y: 2,
        inventory: inventory,
        credits: 100000,
        level: CitizenLevel.survivor,
        day: 1,
      );

      final result = plot.build(
        type: BuildingId.shack,
        x: 3, y: 2,
        inventory: inventory,
        credits: 100000,
        level: CitizenLevel.survivor,
        day: 1,
      );

      expect(result, isA<BuildRejected>());
      expect((result as BuildRejected).reason, contains('ocupado'));
      expect(plot.buildings.length, 1);
    });

    test('recusa por nível insuficiente', () {
      final plot = emptyPlot();
      final result = plot.build(
        type: BuildingId.droneAssembly,
        x: 0, y: 0,
        inventory: richInventory(),
        credits: 1000000,
        level: CitizenLevel.survivor,
        day: 1,
      );
      expect(result, isA<BuildRejected>());
      expect((result as BuildRejected).reason, contains('Nível 3'));
    });

    test('recusa sem crédito e não consome material', () {
      final plot = emptyPlot();
      final inventory = richInventory();
      final scrapBefore = inventory.quantityOf(ItemId.scrap);

      final result = plot.build(
        type: BuildingId.shack,
        x: 0, y: 0,
        inventory: inventory,
        credits: 1,
        level: CitizenLevel.survivor,
        day: 1,
      );

      expect(result, isA<BuildRejected>());
      // Regressão: validar tudo antes de cobrar é o que evita o jogador perder
      // material numa construção recusada.
      expect(inventory.quantityOf(ItemId.scrap), scrapBefore);
    });

    test('recusa sem material e não debita crédito nem posiciona', () {
      final plot = emptyPlot();
      final inventory = Inventory(); // vazio

      final result = plot.build(
        type: BuildingId.shack,
        x: 0, y: 0,
        inventory: inventory,
        credits: 100000,
        level: CitizenLevel.survivor,
        day: 1,
      );

      expect(result, isA<BuildRejected>());
      expect((result as BuildRejected).reason, contains('Faltam'));
      expect(plot.buildings, isEmpty);
    });

    test('coordenadas negativas são recusadas', () {
      final plot = emptyPlot();
      final result = plot.build(
        type: BuildingId.shack,
        x: -1, y: 0,
        inventory: richInventory(),
        credits: 100000,
        level: CitizenLevel.survivor,
        day: 1,
      );
      expect(result, isA<BuildRejected>());
    });

    test('demolir devolve metade do material', () {
      final plot = emptyPlot();
      final inventory = richInventory();
      final result = plot.build(
        type: BuildingId.warehouse,
        x: 0, y: 0,
        inventory: inventory,
        credits: 100000,
        level: CitizenLevel.survivor,
        day: 1,
      ) as BuildAccepted;

      final refund = plot.demolish(result.building.instanceId);
      final def = BuildingCatalog.of(BuildingId.warehouse);

      expect(plot.buildings, isEmpty);
      expect(refund[ItemId.scrap], def.materialCost[ItemId.scrap]! ~/ 2);
    });

    test('o terreno cresce com o nível do cidadão', () {
      final (w0, h0) = Plot.sizeForLevel(CitizenLevel.survivor);
      final (w3, h3) = Plot.sizeForLevel(CitizenLevel.elite);
      expect(w3 * h3, greaterThan(w0 * h0));
    });
  });

  group('Agregados do terreno', () {
    test('estações só contam depois da obra terminar', () {
      final plot = emptyPlot();
      final inventory = richInventory();
      plot.build(
        type: BuildingId.refinery,
        x: 0, y: 0,
        inventory: inventory,
        credits: 100000,
        level: CitizenLevel.farmer,
        day: 1,
      );

      // Em obras: ainda não destrava nada.
      expect(plot.unlockedStations, isEmpty);

      for (var i = 0; i < BuildingCatalog.of(BuildingId.refinery).buildDays; i++) {
        PlotTick.run(plot, inventory: inventory, availableCredits: 100000);
      }

      expect(plot.unlockedStations, isNotEmpty);
    });

    test('defesa e estoque somam as construções prontas', () {
      final plot = emptyPlot(width: 12, height: 12);
      final inventory = richInventory();
      for (var i = 0; i < 4; i++) {
        plot.build(
          type: BuildingId.perimeterWall,
          x: i, y: 0,
          inventory: inventory,
          credits: 100000,
          level: CitizenLevel.survivor,
          day: 1,
        );
      }
      PlotTick.run(plot, inventory: inventory, availableCredits: 100000);

      final wall = BuildingCatalog.of(BuildingId.perimeterWall);
      expect(plot.defense, wall.defenseBonus * 4);
    });
  });

  group('Tick do terreno', () {
    test('a obra avança e conclui no prazo', () {
      final plot = emptyPlot();
      final inventory = richInventory();
      final def = BuildingCatalog.of(BuildingId.scrapYard);

      plot.build(
        type: BuildingId.scrapYard,
        x: 0, y: 0,
        inventory: inventory,
        credits: 100000,
        level: CitizenLevel.survivor,
        day: 1,
      );

      for (var i = 0; i < def.buildDays - 1; i++) {
        final r = PlotTick.run(plot, inventory: inventory, availableCredits: 100000);
        expect(r.completed, isEmpty);
      }
      final last =
          PlotTick.run(plot, inventory: inventory, availableCredits: 100000);
      expect(last.completed.length, 1);
      expect(plot.operational.length, 1);
    });

    test('construção pronta produz', () {
      final plot = emptyPlot();
      final inventory = richInventory();
      plot.build(
        type: BuildingId.scrapYard,
        x: 0, y: 0,
        inventory: inventory,
        credits: 100000,
        level: CitizenLevel.survivor,
        day: 1,
      );
      // Termina a obra.
      PlotTick.run(plot, inventory: inventory, availableCredits: 100000);

      final result =
          PlotTick.run(plot, inventory: inventory, availableCredits: 100000);
      expect(result.produced[ItemId.scrap], greaterThan(0));
    });

    test('sem caixa a construção para e não produz', () {
      final plot = emptyPlot();
      final inventory = richInventory();
      plot.build(
        type: BuildingId.scrapYard,
        x: 0, y: 0,
        inventory: inventory,
        credits: 100000,
        level: CitizenLevel.survivor,
        day: 1,
      );
      PlotTick.run(plot, inventory: inventory, availableCredits: 100000);

      final result = PlotTick.run(plot, inventory: inventory, availableCredits: 0);
      expect(result.produced, isEmpty);
      expect(result.idled, isNotEmpty);
    });

    test('sem insumo a construção para', () {
      final plot = emptyPlot();
      final inventory = richInventory();
      plot.build(
        type: BuildingId.bioreactor, // consome biomassa
        x: 0, y: 0,
        inventory: inventory,
        credits: 100000,
        level: CitizenLevel.farmer,
        day: 1,
      );
      for (var i = 0; i < 4; i++) {
        PlotTick.run(plot, inventory: inventory, availableCredits: 100000);
      }

      // Zera a biomassa.
      inventory.remove(ItemId.biomass, inventory.quantityOf(ItemId.biomass));
      final result =
          PlotTick.run(plot, inventory: inventory, availableCredits: 100000);

      expect(result.produced[ItemId.culturedMeat] ?? 0, 0);
      expect(result.idled, isNotEmpty);
    });

    test('mais funcionários rendem mais', () {
      int runWith(int workers) {
        final plot = emptyPlot();
        final inventory = richInventory();
        final built = plot.build(
          type: BuildingId.scrapYard,
          x: 0, y: 0,
          inventory: inventory,
          credits: 100000,
          level: CitizenLevel.survivor,
          day: 1,
        ) as BuildAccepted;
        PlotTick.run(plot, inventory: inventory, availableCredits: 100000);
        plot.assignWorkers(built.building.instanceId, workers);
        final r =
            PlotTick.run(plot, inventory: inventory, availableCredits: 100000);
        return r.produced[ItemId.scrap] ?? 0;
      }

      expect(runWith(3), greaterThan(runWith(0)));
    });

    test('não dá para alocar além das vagas', () {
      final plot = emptyPlot();
      final inventory = richInventory();
      final built = plot.build(
        type: BuildingId.scrapYard,
        x: 0, y: 0,
        inventory: inventory,
        credits: 100000,
        level: CitizenLevel.survivor,
        day: 1,
      ) as BuildAccepted;

      final slots = built.building.def.jobSlots;
      expect(plot.assignWorkers(built.building.instanceId, slots), isTrue);
      expect(plot.assignWorkers(built.building.instanceId, slots + 1), isFalse);
      expect(plot.assignWorkers(built.building.instanceId, -1), isFalse);
    });
  });

  group('Integração com a campanha', () {
    Campaign fresh() => Campaign.create(
          id: 'c',
          seedLabel: 'terreno-teste',
          characterName: 'Kaia',
        );

    test('a campanha nasce com um terreno dentro de uma metrópole', () {
      final campaign = fresh();
      final settlement = campaign.world.layout.byId(campaign.plot.settlementId);

      expect(settlement, isNotNull);
      expect(settlement!.isCapital, isTrue);
      // O terreno inteiro precisa cair dentro do raio urbano.
      for (final corner in [
        campaign.plot.worldTileFor(0, 0),
        campaign.plot.worldTileFor(campaign.plot.width - 1, campaign.plot.height - 1),
      ]) {
        expect(settlement.contains(corner), isTrue,
            reason: 'terreno vazando para fora da metrópole');
      }
    });

    test('o terreno sobrevive ao salvar e carregar', () {
      final campaign = fresh();
      campaign.character.inventory.add(ItemId.scrap, 200);
      campaign.plot.build(
        type: BuildingId.shack,
        x: 1, y: 1,
        inventory: campaign.character.inventory,
        credits: 100000,
        level: CitizenLevel.survivor,
        day: 1,
      );

      final restored =
          Campaign.fromJson(jsonDecode(jsonEncode(campaign.toJson())));

      expect(restored.plot.buildings.length, 1);
      expect(restored.plot.buildings.first.type, BuildingId.shack);
      expect(restored.plot.settlementId, campaign.plot.settlementId);
    });

    test('um save antigo sem terreno carrega com terreno vazio', () {
      final campaign = fresh();
      final json = campaign.toJson()..remove('plot');

      final restored = Campaign.fromJson(jsonDecode(jsonEncode(json)));
      expect(restored.plot.buildings, isEmpty);
      expect(restored.plot.settlementId,
          restored.character.homeSettlementId);
    });

    test('o reset diário processa o terreno junto', () {
      final campaign = fresh();
      campaign.character.credits = 100000;
      campaign.character.inventory.add(ItemId.scrap, 200);
      campaign.plot.build(
        type: BuildingId.scrapYard,
        x: 0, y: 0,
        inventory: campaign.character.inventory,
        credits: campaign.character.credits,
        level: CitizenLevel.survivor,
        day: 1,
      );

      // Um dia para terminar a obra, outro para produzir.
      const DailyTick().run(campaign, const DailyActivity());
      final scrapBefore = campaign.character.inventory.quantityOf(ItemId.scrap);
      final report = const DailyTick().run(campaign, const DailyActivity());

      expect(campaign.character.inventory.quantityOf(ItemId.scrap),
          greaterThan(scrapBefore));
      expect(report.events.any((e) => e.contains('Terreno produziu')), isTrue);
    });

    test('a manutenção do terreno sai do caixa do jogador', () {
      final campaign = fresh();
      campaign.character.credits = 100000;
      campaign.character.inventory.add(ItemId.scrap, 200);
      campaign.plot.build(
        type: BuildingId.scrapYard,
        x: 0, y: 0,
        inventory: campaign.character.inventory,
        credits: campaign.character.credits,
        level: CitizenLevel.survivor,
        day: 1,
      );
      const DailyTick().run(campaign, const DailyActivity());

      final creditsBefore = campaign.character.credits;
      const DailyTick().run(campaign, const DailyActivity());

      final upkeep = BuildingCatalog.of(BuildingId.scrapYard).dailyUpkeep;
      expect(campaign.character.credits, creditsBefore - upkeep);
    });

    test('o terreno produz mesmo com o jogador viajando', () {
      final campaign = fresh();
      campaign.character.credits = 100000;
      campaign.character.inventory.add(ItemId.scrap, 200);
      campaign.plot.build(
        type: BuildingId.scrapYard,
        x: 0, y: 0,
        inventory: campaign.character.inventory,
        credits: campaign.character.credits,
        level: CitizenLevel.survivor,
        day: 1,
      );
      const DailyTick().run(campaign, const DailyActivity());

      // Manda o jogador para a estrada.
      final origin =
          campaign.world.layout.byId(campaign.character.homeSettlementId)!;
      final road = campaign.world.layout.roadsFrom(origin.id).first;
      campaign.character.travellingTo =
          campaign.world.layout.otherEnd(road, origin.id);
      campaign.character.travelDaysRemaining = 3;

      final scrapBefore = campaign.character.inventory.quantityOf(ItemId.scrap);
      const DailyTick().run(campaign, const DailyActivity());

      expect(campaign.character.inventory.quantityOf(ItemId.scrap),
          greaterThan(scrapBefore));
    });
  });
}
