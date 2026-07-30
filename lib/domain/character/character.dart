import '../combat/combat.dart';
import '../economy/inventory.dart';
import '../economy/item.dart';
import '../survival/survival_tables.dart';
import '../world/coords.dart';
import 'attributes.dart';

/// Estado de um personagem. É o que a campanha persiste — junto com o layout do
/// mundo, é tudo que precisa sair para disco.
class Character {
  Character({
    required this.id,
    required this.name,
    required this.attributes,
    required this.position,
    required this.homeSettlementId,
    this.level = CitizenLevel.survivor,
    this.credits = 250,
    int? hp,
    this.hunger = SurvivalTables.maxVital,
    this.thirst = SurvivalTables.maxVital,
    this.energy = 10,
    this.rerollsUsed = 0,
    this.starvingStreak = 0,
    this.dead = false,
    this.deathReason,
    Inventory? inventory,
    this.travellingTo,
    this.travelDaysRemaining = 0,
    this.statusOffset = 0,
  })  : inventory = inventory ?? Inventory(),
        hp = hp ?? Combatant.maxHpFor(attributes);

  final String id;
  String name;

  AttributeSet attributes;

  /// Onde o personagem está no mundo.
  TileCoord position;

  /// Cidade de origem — para onde ele volta se morrer de forma não permanente.
  String homeSettlementId;

  CitizenLevel level;

  int credits;
  int hp;
  int hunger;
  int thirst;

  /// Horas de trabalho disponíveis no dia. Energéticos aumentam.
  int energy;

  int rerollsUsed;

  /// Resets consecutivos com Fome **e** Sede zeradas. Chegando ao limite do
  /// GDD, é morte permanente por abandono.
  int starvingStreak;

  bool dead;
  String? deathReason;

  final Inventory inventory;

  /// Se estiver viajando: destino e dias restantes. Enquanto viaja, o jogador
  /// fica bloqueado para ações — restrição explícita do canvas.
  String? travellingTo;
  int travelDaysRemaining;

  /// Ajuste de Status ganho ou perdido em jogo (combate, política, luxo).
  int statusOffset;

  bool get isTravelling => travelDaysRemaining > 0;

  bool get canAct => !dead && !isTravelling;

  int get maxHp => Combatant.maxHpFor(attributes);

  /// Status efetivo: o rolado na criação mais o que o jogo somou.
  int get effectiveStatus => attributes[Attribute.status] + statusOffset;

  bool get canReroll =>
      rerollsUsed < AttributeSet.maxRerolls && level == CitizenLevel.survivor;

  /// Consome um item, aplicando restauração e custos.
  ///
  /// Devolve `false` se o item não está no inventário — a UI usa isso para não
  /// permitir clique em item sem saldo.
  bool consume(ItemId id) {
    if (!inventory.remove(id, 1)) return false;
    final def = ItemCatalog.of(id);

    hunger = (hunger + def.restoresHunger - def.hungerCost)
        .clamp(SurvivalTables.minVital, SurvivalTables.maxVital);
    thirst = (thirst + def.restoresThirst - def.thirstCost)
        .clamp(SurvivalTables.minVital, SurvivalTables.maxVital);
    energy += def.energyBonus;
    statusOffset += def.statusBonus;
    return true;
  }

  /// Aplica o consumo do dia e devolve o que aconteceu.
  DayEndOutcome applyUpkeep(Upkeep upkeep) {
    hunger = (hunger - upkeep.hunger).clamp(SurvivalTables.minVital, SurvivalTables.maxVital);
    thirst = (thirst - upkeep.thirst).clamp(SurvivalTables.minVital, SurvivalTables.maxVital);

    final starving = hunger <= SurvivalTables.starvationThreshold;
    final dehydrated = thirst <= SurvivalTables.starvationThreshold;

    var damage = 0;
    if (starving) damage += SurvivalTables.starvationDamage;
    if (dehydrated) damage += SurvivalTables.starvationDamage;

    if (damage > 0) {
      hp = (hp - damage).clamp(0, maxHp);
    }

    if (starving && dehydrated) {
      starvingStreak++;
    } else {
      starvingStreak = 0;
    }

    // Morte permanente é reservada ao abandono: exige dias seguidos com as
    // duas barras zeradas, ou HP em zero por inanição.
    final permanent = starvingStreak >= SurvivalTables.consecutiveDaysToDeath ||
        (hp <= 0 && (starving || dehydrated));

    if (permanent) {
      dead = true;
      deathReason = 'Morte permanente por abandono (fome e sede).';
    }

    return DayEndOutcome(
      hungerLost: upkeep.hunger,
      thirstLost: upkeep.thirst,
      hpLost: damage,
      starving: starving,
      dehydrated: dehydrated,
      died: permanent,
    );
  }

  /// Requisitos de progressão do GDD (seção 5).
  bool meetsRequirementsFor(CitizenLevel target) => switch (target) {
        CitizenLevel.survivor => true,
        CitizenLevel.farmer => credits >= 1500,
        CitizenLevel.industrialist =>
          credits >= 12000 && inventory.estimatedValue >= 5000,
        CitizenLevel.elite =>
          credits >= 60000 && effectiveStatus >= 12,
      };

  bool promote() {
    final next = level.next;
    if (next == null) return false;
    if (!meetsRequirementsFor(next)) return false;
    level = next;
    return true;
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'attributes': attributes.toJson(),
        'position': position.toJson(),
        'homeSettlementId': homeSettlementId,
        'level': level.name,
        'credits': credits,
        'hp': hp,
        'hunger': hunger,
        'thirst': thirst,
        'energy': energy,
        'rerollsUsed': rerollsUsed,
        'starvingStreak': starvingStreak,
        'dead': dead,
        'deathReason': deathReason,
        'inventory': inventory.toJson(),
        'travellingTo': travellingTo,
        'travelDaysRemaining': travelDaysRemaining,
        'statusOffset': statusOffset,
      };

  factory Character.fromJson(Map<String, dynamic> json) => Character(
        id: json['id'] as String,
        name: json['name'] as String,
        attributes:
            AttributeSet.fromJson(json['attributes'] as Map<String, dynamic>),
        position: TileCoord.fromJson(json['position'] as Map<String, dynamic>),
        homeSettlementId: json['homeSettlementId'] as String,
        level: CitizenLevel.values.byName(json['level'] as String),
        credits: (json['credits'] as num).toInt(),
        hp: (json['hp'] as num).toInt(),
        hunger: (json['hunger'] as num).toInt(),
        thirst: (json['thirst'] as num).toInt(),
        energy: (json['energy'] as num).toInt(),
        rerollsUsed: (json['rerollsUsed'] as num).toInt(),
        starvingStreak: (json['starvingStreak'] as num?)?.toInt() ?? 0,
        dead: json['dead'] as bool? ?? false,
        deathReason: json['deathReason'] as String?,
        inventory: Inventory.fromJson(json['inventory'] as Map<String, dynamic>),
        travellingTo: json['travellingTo'] as String?,
        travelDaysRemaining: (json['travelDaysRemaining'] as num?)?.toInt() ?? 0,
        statusOffset: (json['statusOffset'] as num?)?.toInt() ?? 0,
      );
}

/// O que aconteceu com o personagem no fechamento do dia.
class DayEndOutcome {
  const DayEndOutcome({
    required this.hungerLost,
    required this.thirstLost,
    required this.hpLost,
    required this.starving,
    required this.dehydrated,
    required this.died,
  });

  final int hungerLost;
  final int thirstLost;
  final int hpLost;
  final bool starving;
  final bool dehydrated;
  final bool died;
}
