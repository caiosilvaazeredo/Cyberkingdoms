import 'dart:convert';
import 'dart:io';

import 'package:cyberkingdoms/domain/building/building_module.dart';
import 'package:cyberkingdoms/domain/building/building_type.dart';
import 'package:cyberkingdoms/domain/building/village_identity.dart';
import 'package:cyberkingdoms/domain/economy/item.dart';
import 'package:cyberkingdoms/domain/economy/recipe.dart';
import 'package:cyberkingdoms/domain/survival/survival_tables.dart';
import 'package:flutter_test/flutter_test.dart';

/// Exporta os catálogos de regras para `web3d/src/data/`.
///
/// ## Por que gerar em vez de transcrever
///
/// São 56 itens, 20 receitas e as tabelas de Fome/Sede — algumas centenas de
/// números que já foram conferidos contra o GDD e cobertos por teste. Copiar
/// isso à mão para TypeScript não é trabalho difícil, é trabalho *silencioso*:
/// um `baseValue` trocado de 18 para 8 não quebra nada, não aparece em
/// nenhuma tela, e só se manifesta meses depois como uma economia que não
/// fecha. Gerar elimina a classe inteira de erro.
///
/// Enquanto os dois clientes coexistem, o Dart é a fonte. Quando o cliente
/// Flutter for aposentado, estes JSON continuam sendo a fonte — dados como
/// dados, comportamento como código. O que sai daqui é catálogo, não lógica.
///
/// ```sh
/// flutter test test/catalog_export_test.dart
/// ```
void main() {
  test('exporta itens, receitas, construções e tabelas', () {
    final items = [
      for (final id in ItemId.values)
        () {
          final d = ItemCatalog.of(id);
          return {
            'id': d.id.name,
            'name': d.name,
            'tier': d.tier.name,
            'tierLevel': d.tier.level,
            'category': d.category.name,
            'baseValue': d.baseValue,
            'weight': d.weight,
            'legal': d.legal,
            'restoresHunger': d.restoresHunger,
            'restoresThirst': d.restoresThirst,
            'hungerCost': d.hungerCost,
            'thirstCost': d.thirstCost,
            'energyBonus': d.energyBonus,
            'strengthBonus': d.strengthBonus,
            'statusBonus': d.statusBonus,
            'enduranceBonus': d.enduranceBonus,
            'hungerUpkeepModifier': d.hungerUpkeepModifier,
            'thirstUpkeepModifier': d.thirstUpkeepModifier,
            'attackPower': d.attackPower,
            'defensePower': d.defensePower,
            'description': d.description,
          };
        }(),
    ];

    final recipes = [
      for (final r in RecipeBook.all)
        {
          'id': r.id,
          'output': r.output.name,
          'outputQuantity': r.outputQuantity,
          'inputs': {
            for (final e in r.inputs.entries) e.key.name: e.value,
          },
          'station': r.station.name,
          'days': r.days,
          'requiredLevel': r.requiredLevel.name,
          'intelligenceBonusPerPoint': r.intelligenceBonusPerPoint,
        },
    ];

    Map<String, int> upkeep(Upkeep u) => {'hunger': u.hunger, 'thirst': u.thirst};

    final survival = {
      'idleBase': upkeep(SurvivalTables.idleBase),
      'travelRoad': upkeep(SurvivalTables.travelRoad),
      'sleepOnRoad': upkeep(SurvivalTables.sleepOnRoad),
      'combatVictory': upkeep(SurvivalTables.combatVictory),
      'combatDefeat': upkeep(SurvivalTables.combatDefeat),
      'longCombatMultiplier': SurvivalTables.longCombatMultiplier,
      'longCombatRounds': SurvivalTables.longCombatRounds,
      'maxVital': SurvivalTables.maxVital,
      'minVital': SurvivalTables.minVital,
      'starvationThreshold': SurvivalTables.starvationThreshold,
      'starvationDamage': SurvivalTables.starvationDamage,
      'consecutiveDaysToDeath': SurvivalTables.consecutiveDaysToDeath,
      'publicWork': {
        for (final w in PublicWork.values)
          w.name: {'label': w.label, ...upkeep(w.upkeep)},
      },
      'playerFarmWork': {
        for (final w in PlayerFarmWork.values)
          w.name: {'label': w.label, ...upkeep(w.upkeep)},
      },
      'workshopWork': {
        for (final w in WorkshopWork.values)
          w.name: {'label': w.label, ...upkeep(w.upkeep)},
      },
      'weather': {
        for (final w in Weather.values)
          w.name: {
            'label': w.label,
            'hungerMultiplier': w.hungerMultiplier,
            'thirstMultiplier': w.thirstMultiplier,
          },
      },
    };

    final buildings = [
      for (final d in BuildingCatalog.all)
        {
          'id': d.id.name,
          'name': d.name,
          'category': d.category.name,
          'width': d.width,
          'height': d.height,
          'creditCost': d.creditCost,
          'materialCost': {
            for (final e in d.materialCost.entries) e.key.name: e.value,
          },
          'buildDays': d.buildDays,
          'spriteId': d.spriteId,
          'requiredLevel': d.requiredLevel.name,
          'jobSlots': d.jobSlots,
          'produces': d.produces?.name,
          'outputPerDay': d.outputPerDay,
          'consumes': {
            for (final e in d.consumes.entries) e.key.name: e.value,
          },
          'unlocksStation': d.unlocksStation?.name,
          'storageBonus': d.storageBonus,
          'defenseBonus': d.defenseBonus,
          'statusBonus': d.statusBonus,
          'populationCapacity': d.populationCapacity,
          'dailyUpkeep': d.dailyUpkeep,
          'hungerUpkeepModifier': d.hungerUpkeepModifier,
          'thirstUpkeepModifier': d.thirstUpkeepModifier,
          'legal': d.legal,
          'description': d.description,
        },
    ];

    final modules = [
      for (final m in BuildingModule.values)
        {
          'id': m.name,
          'label': m.label,
          'description': m.description,
          'creditCost': m.creditCost,
          'materialCost': {
            for (final e in m.materialCost.entries) e.key.name: e.value,
          },
          'categories': [for (final c in m.categories) c.name],
          'outputMultiplier': m.outputMultiplier,
          'storageBonus': m.storageBonus,
          'defenseBonus': m.defenseBonus,
          'statusBonus': m.statusBonus,
          'jobSlotBonus': m.jobSlotBonus,
          'populationBonus': m.populationBonus,
          'upkeepDelta': m.upkeepDelta,
          'upkeepMultiplier': m.upkeepMultiplier,
          'thirstUpkeepModifier': m.thirstUpkeepModifier,
          'hungerUpkeepModifier': m.hungerUpkeepModifier,
          'removesStaffingPenalty': m.removesStaffingPenalty,
        },
    ];

    final upgrade = {
      'maxLevel': BuildingUpgrade.maxLevel,
      'levels': [
        for (var level = 1; level <= BuildingUpgrade.maxLevel; level++)
          {
            'level': level,
            'outputMultiplier': BuildingUpgrade.outputMultiplierFor(level),
            'upkeepMultiplier': BuildingUpgrade.upkeepMultiplierFor(level),
            'flatMultiplier': BuildingUpgrade.flatMultiplierFor(level),
            'moduleSlots': BuildingUpgrade.moduleSlotsFor(level),
          },
      ],
    };

    final emblems = [
      for (final e in VillageEmblem.values)
        {'id': e.name, 'label': e.label, 'spriteId': e.spriteId},
    ];

    _write('buildings', buildings);
    _write('modules', modules);
    _write('buildingUpgrade', upgrade);
    _write('emblems', emblems);
    _write('items', items);
    _write('recipes', recipes);
    _write('survival', survival);

    // Guardas mínimas. Um exportador que grava lista vazia "passa" sem elas, e
    // o lado TypeScript herdaria um catálogo vazio sem ninguém notar.
    expect(items, hasLength(ItemId.values.length));
    expect(recipes, isNotEmpty);
    expect(items.where((i) => (i['baseValue'] as int) > 0), isNotEmpty);
    expect(buildings, hasLength(BuildingId.values.length));
    expect(modules, hasLength(BuildingModule.values.length));
    expect(emblems, isNotEmpty);
  });
}

void _write(String name, Object data) {
  final file = File('web3d/src/data/$name.json');
  file.parent.createSync(recursive: true);
  file.writeAsStringSync(
    '${const JsonEncoder.withIndent('  ').convert(data)}\n',
  );
}
