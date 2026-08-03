import 'dart:convert';
import 'dart:io';

import 'package:cyberkingdoms/core/seed/deterministic_random.dart';
import 'package:cyberkingdoms/domain/character/attributes.dart';
import 'package:cyberkingdoms/domain/character/character.dart';
import 'package:cyberkingdoms/domain/combat/combat.dart';
import 'package:cyberkingdoms/domain/economy/inventory.dart';
import 'package:cyberkingdoms/domain/economy/item.dart';
import 'package:cyberkingdoms/domain/economy/recipe.dart';
import 'package:cyberkingdoms/domain/survival/daily_activity.dart';
import 'package:cyberkingdoms/domain/survival/survival_tables.dart';
import 'package:cyberkingdoms/domain/world/coords.dart';
import 'package:flutter_test/flutter_test.dart';

/// Exporta a saída das **regras** para `web3d/test/rules-fixture.json`.
///
/// O gerador de mundo já tinha esse contrato (`fixture_export_test.dart`), e
/// pelo mesmo motivo: uma porta só vale se produzir os mesmos números, e
/// "parecido" não serve. Aqui a aposta é ainda maior — o combate decide quem
/// perde inventário, e o servidor recalcula o combate do reset para validar o
/// que o cliente reportou. Dois motores que discordam por um ponto de dano
/// viram dois jogos.
///
/// ```sh
/// flutter test test/rules_fixture_export_test.dart
/// ```
/// O arquivo é versionado, então o `vitest` roda sem precisar do Flutter.
void main() {
  test('exporta a referência de regras para a porta TypeScript', () {
    final fixture = <String, Object>{
      'attributeRolls': _attributeRolls(),
      'combat': _combat(),
      'loot': _loot(),
      'upkeep': _upkeep(),
      'recipeYields': _recipeYields(),
      'characterDays': _characterDays(),
    };

    final file = File('web3d/test/rules-fixture.json');
    file.parent.createSync(recursive: true);
    file.writeAsStringSync(
      const JsonEncoder.withIndent('  ').convert(fixture),
    );

    expect(file.existsSync(), isTrue);
  });
}

/// O sorteio é `2d5+1` por atributo, e a **ordem** das chamadas ao RNG faz
/// parte do resultado. Trocar a ordem dos atributos muda todo personagem já
/// criado — por isso a referência guarda o conjunto inteiro, não só a soma.
List<Map<String, Object>> _attributeRolls() {
  final out = <Map<String, Object>>[];
  for (final seed in [1, 7, 42, 1337, 90210]) {
    final rng = DeterministicRandom(seed);
    final set = AttributeSet.roll(rng);
    out.add({
      'seed': seed,
      'values': set.toJson(),
      'total': set.total,
      'maxHp': Combatant.maxHpFor(set),
    });
  }
  return out;
}

AttributeSet _set(Map<Attribute, int> values) => AttributeSet(values);

Combatant _combatant(
  String id,
  Map<Attribute, int> values, {
  int attack = 0,
  int defense = 0,
  int drones = 0,
}) {
  final attributes = _set(values);
  return Combatant(
    id: id,
    name: id,
    attributes: attributes,
    attackPower: attack,
    defensePower: defense,
    hp: Combatant.maxHpFor(attributes),
    droneCount: drones,
  );
}

List<Map<String, Object>> _combat() {
  final casos = <Map<String, Object>>[];

  final cenarios = <List<Object>>[
    // Equilibrado: quem começa decide, e quem começa é Percepção.
    [
      'equilibrado',
      {
        Attribute.strength: 7,
        Attribute.perception: 8,
        Attribute.luck: 6,
        Attribute.intelligence: 6,
        Attribute.endurance: 7,
        Attribute.status: 6,
      },
      {
        Attribute.strength: 7,
        Attribute.perception: 5,
        Attribute.luck: 9,
        Attribute.intelligence: 6,
        Attribute.endurance: 7,
        Attribute.status: 6,
      },
      0,
      0,
      0,
      0,
      991,
    ],
    // Tanque contra atacante: exercita o piso de dano 1.
    [
      'tanque',
      {
        Attribute.strength: 3,
        Attribute.perception: 4,
        Attribute.luck: 3,
        Attribute.intelligence: 5,
        Attribute.endurance: 12,
        Attribute.status: 5,
      },
      {
        Attribute.strength: 12,
        Attribute.perception: 10,
        Attribute.luck: 12,
        Attribute.intelligence: 8,
        Attribute.endurance: 4,
        Attribute.status: 7,
      },
      0,
      40,
      30,
      0,
      2024,
    ],
    // Drones: entram na ofensiva com peso alto.
    [
      'drones',
      {
        Attribute.strength: 6,
        Attribute.perception: 6,
        Attribute.luck: 6,
        Attribute.intelligence: 6,
        Attribute.endurance: 6,
        Attribute.status: 6,
      },
      {
        Attribute.strength: 6,
        Attribute.perception: 6,
        Attribute.luck: 6,
        Attribute.intelligence: 6,
        Attribute.endurance: 6,
        Attribute.status: 6,
      },
      0,
      0,
      0,
      4,
      55,
    ],
  ];

  for (final cenario in cenarios) {
    final nome = cenario[0] as String;
    final a = _combatant(
      'a',
      cenario[1] as Map<Attribute, int>,
      attack: cenario[3] as int,
    );
    final b = _combatant(
      'b',
      cenario[2] as Map<Attribute, int>,
      attack: cenario[4] as int,
      defense: cenario[5] as int,
      drones: cenario[6] as int,
    );
    final report = CombatResolver.resolve(a: a, b: b, seed: cenario[7] as int);

    casos.add({
      'name': nome,
      'seed': cenario[7] as int,
      'winnerId': report.winnerId,
      'loserId': report.loserId,
      'rounds': report.rounds,
      'statusLost': report.statusLost,
      'log': report.log
          .map((e) => {
                'round': e.round,
                'attackerName': e.attackerName,
                'defenderName': e.defenderName,
                'damage': e.damage,
                'critical': e.critical,
                'defenderHpAfter': e.defenderHpAfter,
              })
          .toList(),
    });
  }

  return casos;
}

List<Map<String, Object>> _loot() {
  final inventory = Inventory()
    ..add(ItemId.scrap, 40)
    ..add(ItemId.polymer, 17)
    ..add(ItemId.chip, 9)
    ..add(ItemId.water, 100);

  final out = <Map<String, Object>>[];
  for (final seed in [3, 77, 5150]) {
    final loot = CombatResolver.rollLoot(
      loserInventory: inventory,
      seed: seed,
    );
    out.add({
      'seed': seed,
      'loot': {for (final e in loot.entries) e.key.name: e.value},
    });
  }
  return out;
}

Map<String, Object> _upkeepJson(Upkeep u) =>
    {'hunger': u.hunger, 'thirst': u.thirst};

List<Map<String, Object>> _upkeep() {
  final casos = <Map<String, Object>>[
    {'name': 'ocioso', 'activity': const DailyActivity()},
    {
      'name': 'ferro-velho no deserto',
      'activity': const DailyActivity(
        publicWork: PublicWork.dump,
        weather: Weather.desert,
      ),
    },
    {
      'name': 'viagem longa com combate',
      'activity': const DailyActivity(
        roadsTravelled: 3,
        sleptOnRoad: true,
        combats: [CombatOutcome(won: false, rounds: 9)],
      ),
    },
    {
      'name': 'oficina com consumo na neve',
      'activity': const DailyActivity(
        workshopWork: WorkshopWork.laboratory,
        consumed: [ItemId.redRush],
        weather: Weather.snow,
      ),
    },
  ];

  final out = <Map<String, Object>>[];
  for (final caso in casos) {
    final activity = caso['activity'] as DailyActivity;
    for (final mods in [
      [0.0, 0.0],
      [-0.30, -0.15],
    ]) {
      final breakdown = SurvivalResolver.resolve(
        activity,
        hungerModifier: mods[0],
        thirstModifier: mods[1],
      );
      out.add({
        'name': '${caso['name']} · mods ${mods[0]}/${mods[1]}',
        'hungerModifier': mods[0],
        'thirstModifier': mods[1],
        'total': _upkeepJson(breakdown.total),
        'lines': breakdown.lines
            .map((l) => {'label': l.label, 'upkeep': _upkeepJson(l.upkeep)})
            .toList(),
      });
    }
  }
  return out;
}

List<Map<String, Object>> _recipeYields() {
  final out = <Map<String, Object>>[];
  for (final intelligence in [3, 6, 9, 12]) {
    final attributes = _set({
      Attribute.strength: 6,
      Attribute.perception: 6,
      Attribute.luck: 6,
      Attribute.intelligence: intelligence,
      Attribute.endurance: 6,
      Attribute.status: 6,
    });
    for (final recipe in RecipeBook.all) {
      out.add({
        'recipe': recipe.id,
        'intelligence': intelligence,
        'yield': recipe.yieldFor(attributes),
      });
    }
  }
  return out;
}

/// Vários dias seguidos de um mesmo personagem: é o acúmulo que revela
/// divergência de arredondamento, não um dia isolado.
List<Map<String, Object>> _characterDays() {
  final attributes = _set({
    Attribute.strength: 6,
    Attribute.perception: 6,
    Attribute.luck: 6,
    Attribute.intelligence: 6,
    Attribute.endurance: 8,
    Attribute.status: 6,
  });
  final character = Character(
    id: 'ref',
    name: 'Referência',
    attributes: attributes,
    position: const TileCoord(0, 0),
    homeSettlementId: 'cap_0',
  );

  const activity = DailyActivity(
    publicWork: PublicWork.dump,
    weather: Weather.desert,
  );

  final dias = <Map<String, Object>>[];
  for (var dia = 1; dia <= 8; dia++) {
    final breakdown = SurvivalResolver.resolve(activity);
    final outcome = character.applyUpkeep(breakdown.total);
    dias.add({
      'day': dia,
      'hunger': character.hunger,
      'thirst': character.thirst,
      'hp': character.hp,
      'starvingStreak': character.starvingStreak,
      'dead': character.dead,
      'hpLost': outcome.hpLost,
      'starving': outcome.starving,
      'dehydrated': outcome.dehydrated,
      'died': outcome.died,
    });
  }
  return dias;
}
