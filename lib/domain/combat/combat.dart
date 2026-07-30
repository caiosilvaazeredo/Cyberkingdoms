import 'dart:math' as math;

import '../../core/seed/deterministic_random.dart';
import '../character/attributes.dart';
import '../economy/inventory.dart';
import '../economy/item.dart';

/// Um combatente resolvido — atributos já somados com equipamentos e drogas.
class Combatant {
  Combatant({
    required this.id,
    required this.name,
    required this.attributes,
    required this.attackPower,
    required this.defensePower,
    required this.hp,
    this.droneCount = 0,
  });

  /// Monta um combatente a partir do estado do personagem.
  factory Combatant.fromCharacter({
    required String id,
    required String name,
    required AttributeSet attributes,
    required Inventory inventory,
    required int hp,
    List<ItemId> activeDrugs = const [],
  }) {
    var bonuses = <Attribute, int>{};
    for (final drug in activeDrugs) {
      final def = ItemCatalog.of(drug);
      if (def.strengthBonus != 0) {
        bonuses[Attribute.strength] =
            (bonuses[Attribute.strength] ?? 0) + def.strengthBonus;
      }
      if (def.enduranceBonus != 0) {
        bonuses[Attribute.endurance] =
            (bonuses[Attribute.endurance] ?? 0) + def.enduranceBonus;
      }
    }

    return Combatant(
      id: id,
      name: name,
      attributes: bonuses.isEmpty ? attributes : attributes.withBonus(bonuses),
      attackPower: inventory.attackPower,
      defensePower: inventory.defensePower,
      hp: hp,
      droneCount: inventory.quantityOf(ItemId.drone),
    );
  }

  final String id;
  final String name;
  final AttributeSet attributes;
  final int attackPower;
  final int defensePower;
  final int droneCount;

  int hp;

  /// Dano por rodada antes da defesa do alvo.
  double get offense =>
      attributes[Attribute.strength] * 1.6 +
      attackPower * 1.0 +
      droneCount * 6.0 +
      attributes[Attribute.perception] * 0.4;

  /// Mitigação por rodada.
  double get defense =>
      attributes[Attribute.endurance] * 1.1 + defensePower * 1.2;

  /// Chance de crítico, puxada por Sorte.
  double get critChance => (attributes[Attribute.luck] * 0.012).clamp(0.0, 0.35);

  /// HP máximo derivado de Resistência.
  static int maxHpFor(AttributeSet attributes) =>
      60 + attributes[Attribute.endurance] * 5;
}

/// Uma linha do relatório de combate. O canvas pede "relatórios de combate
/// determinístico" — o jogador precisa conseguir auditar por que perdeu.
class CombatLogEntry {
  const CombatLogEntry({
    required this.round,
    required this.attackerName,
    required this.defenderName,
    required this.damage,
    required this.critical,
    required this.defenderHpAfter,
  });

  final int round;
  final String attackerName;
  final String defenderName;
  final int damage;
  final bool critical;
  final int defenderHpAfter;

  @override
  String toString() =>
      'R$round · $attackerName » $defenderName: $damage'
      '${critical ? ' (CRÍTICO)' : ''} · HP $defenderHpAfter';
}

class CombatReport {
  const CombatReport({
    required this.winnerId,
    required this.loserId,
    required this.rounds,
    required this.log,
    required this.lootedItems,
    required this.statusLost,
  });

  final String winnerId;
  final String loserId;
  final int rounds;
  final List<CombatLogEntry> log;

  /// Itens que o perdedor deixou cair. O GDD determina perda **parcial**.
  final Map<ItemId, int> lootedItems;

  /// Status (reputação) que o perdedor perdeu.
  final int statusLost;

  bool get wasLong => rounds > 6;
}

/// Resolvedor de combate. É **determinístico**: mesma seed + mesmos
/// combatentes = mesmo resultado, sempre. Isso permite que o servidor recalcule
/// o combate do reset diário e valide o que o cliente reportou.
abstract final class CombatResolver {
  static const int maxRounds = 20;

  static CombatReport resolve({
    required Combatant a,
    required Combatant b,
    required int seed,
  }) {
    final rng = DeterministicRandom(seed);
    final log = <CombatLogEntry>[];

    // Iniciativa: Percepção decide quem ataca primeiro; empate vai para Sorte.
    var attacker = a;
    var defender = b;
    final aInit = a.attributes[Attribute.perception] * 2 + a.attributes[Attribute.luck];
    final bInit = b.attributes[Attribute.perception] * 2 + b.attributes[Attribute.luck];
    if (bInit > aInit) {
      attacker = b;
      defender = a;
    }

    var round = 0;
    while (round < maxRounds && a.hp > 0 && b.hp > 0) {
      round++;

      final critical = rng.nextDouble() < attacker.critChance;
      // Variação de +-15% mantém o combate imprevisível sem apagar a
      // vantagem de quem investiu em equipamento.
      final swing = rng.rangeDouble(0.85, 1.15);
      final raw = attacker.offense * swing * (critical ? 1.75 : 1.0);
      final mitigated = raw - defender.defense * 0.6;
      final damage = math.max(1, mitigated.round());

      defender.hp = math.max(0, defender.hp - damage);
      log.add(CombatLogEntry(
        round: round,
        attackerName: attacker.name,
        defenderName: defender.name,
        damage: damage,
        critical: critical,
        defenderHpAfter: defender.hp,
      ));

      if (defender.hp <= 0) break;

      final swap = attacker;
      attacker = defender;
      defender = swap;
    }

    // Se estourou o limite de rodadas, ganha quem tem mais HP proporcional.
    final Combatant winner;
    final Combatant loser;
    if (a.hp <= 0) {
      winner = b;
      loser = a;
    } else if (b.hp <= 0) {
      winner = a;
      loser = b;
    } else {
      final aRatio = a.hp / Combatant.maxHpFor(a.attributes);
      final bRatio = b.hp / Combatant.maxHpFor(b.attributes);
      winner = aRatio >= bRatio ? a : b;
      loser = aRatio >= bRatio ? b : a;
    }

    return CombatReport(
      winnerId: winner.id,
      loserId: loser.id,
      rounds: round,
      log: log,
      lootedItems: const {},
      statusLost: rng.range(1, 3),
    );
  }

  /// Escolhe o que o perdedor deixa cair: uma fração do inventário, nunca tudo.
  ///
  /// O GDD é claro: "a derrota normalmente não elimina o personagem; as
  /// penalidades incluem perda parcial de itens".
  static Map<ItemId, int> rollLoot({
    required Inventory loserInventory,
    required int seed,
    double fraction = 0.25,
  }) {
    final rng = DeterministicRandom(DeterministicRandom.mix(seed, 0x100));
    final loot = <ItemId, int>{};
    for (final entry in loserInventory.stacks.entries) {
      // Implantes são cirúrgicos: não caem.
      if (ItemCatalog.of(entry.key).category == ItemCategory.implant) continue;
      if (!rng.chance(0.5)) continue;
      final taken = (entry.value * fraction).floor();
      if (taken > 0) loot[entry.key] = taken;
    }
    return loot;
  }
}
