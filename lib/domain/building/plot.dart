import '../character/attributes.dart';
import '../economy/inventory.dart';
import '../economy/item.dart';
import '../economy/recipe.dart';
import '../world/coords.dart';
import 'building_module.dart';
import 'building_type.dart';
import 'village_identity.dart';

/// Os números de uma construção **depois** de aplicar nível e módulos.
///
/// Existe para que nenhum chamador precise lembrar de somar módulo por módulo:
/// [PlacedBuilding.stats] é a única fonte da verdade sobre o que aquele prédio
/// específico produz, emprega e custa.
class BuildingStats {
  const BuildingStats({
    required this.outputPerDay,
    required this.jobSlots,
    required this.storageBonus,
    required this.defenseBonus,
    required this.statusBonus,
    required this.populationCapacity,
    required this.dailyUpkeep,
    required this.hungerUpkeepModifier,
    required this.thirstUpkeepModifier,
    required this.ignoresStaffing,
  });

  final int outputPerDay;
  final int jobSlots;
  final int storageBonus;
  final int defenseBonus;
  final int statusBonus;
  final int populationCapacity;
  final int dailyUpkeep;
  final double hungerUpkeepModifier;
  final double thirstUpkeepModifier;

  /// `true` quando um Núcleo de Automação dispensa funcionários.
  final bool ignoresStaffing;
}

/// Uma construção posicionada no terreno.
class PlacedBuilding {
  PlacedBuilding({
    required this.instanceId,
    required this.type,
    required this.x,
    required this.y,
    required this.daysRemaining,
    this.workers = 0,
    this.idle = false,
    this.level = 1,
    this.customName,
    this.accentColor,
    Set<BuildingModule>? modules,
    this.upgrading = false,
  }) : _modules = {...?modules};

  final String instanceId;
  final BuildingId type;

  /// Canto superior-esquerdo na grade do terreno.
  final int x;
  final int y;

  /// Resets restantes até a obra (ou o upgrade) terminar. 0 = operando.
  int daysRemaining;

  /// Funcionários alocados. Limitado por [BuildingStats.jobSlots].
  int workers;

  /// `true` quando a construção não produziu no último tick (faltou insumo,
  /// caixa ou trabalhador).
  bool idle;

  /// Nível I, II ou III.
  int level;

  /// Nome dado pelo jogador. `null` usa o nome do catálogo.
  String? customName;

  /// Cor de destaque em ARGB. `null` usa a cor da categoria.
  int? accentColor;

  final Set<BuildingModule> _modules;

  /// `true` quando os dias restantes são de um upgrade, não da obra inicial.
  /// A distinção importa: durante um upgrade a construção **já existe** e
  /// continua ocupando espaço, mas para de produzir.
  bool upgrading;

  BuildingDef get def => BuildingCatalog.of(type);

  Set<BuildingModule> get modules => Set.unmodifiable(_modules);

  bool get isReady => daysRemaining <= 0;

  /// Nome que a UI mostra.
  String get displayName => customName?.trim().isNotEmpty == true
      ? customName!.trim()
      : def.name;

  /// Nome com o algarismo do nível, para listas.
  String get displayNameWithLevel =>
      '$displayName ${BuildingUpgrade.romanFor(level)}';

  int get moduleSlots => BuildingUpgrade.moduleSlotsFor(level);

  bool get canAddModule => _modules.length < moduleSlots;

  bool get canUpgrade => level < BuildingUpgrade.maxLevel;

  /// Números efetivos: catálogo × nível × módulos.
  BuildingStats get stats {
    final levelOutput = BuildingUpgrade.outputMultiplierFor(level);
    final levelFlat = BuildingUpgrade.flatMultiplierFor(level);
    final levelUpkeep = BuildingUpgrade.upkeepMultiplierFor(level);

    var outputBonus = 0.0;
    var storage = 0;
    var defense = 0;
    var status = 0;
    var jobs = 0;
    var population = 0;
    var upkeepDelta = 0;
    var upkeepFactor = 0.0;
    var hunger = 0.0;
    var thirst = 0.0;
    var ignoresStaffing = false;

    for (final module in _modules) {
      outputBonus += module.outputMultiplier;
      storage += module.storageBonus;
      defense += module.defenseBonus;
      status += module.statusBonus;
      jobs += module.jobSlotBonus;
      population += module.populationBonus;
      upkeepDelta += module.upkeepDelta;
      upkeepFactor += module.upkeepMultiplier;
      hunger += module.hungerUpkeepModifier;
      thirst += module.thirstUpkeepModifier;
      ignoresStaffing |= module.removesStaffingPenalty;
    }

    final baseUpkeep = (def.dailyUpkeep * levelUpkeep).round() + upkeepDelta;
    final upkeep = (baseUpkeep * (1 + upkeepFactor)).round().clamp(0, 999999);

    return BuildingStats(
      outputPerDay:
          (def.outputPerDay * levelOutput * (1 + outputBonus)).round(),
      jobSlots: (def.jobSlots * levelOutput).round() + jobs,
      storageBonus: (def.storageBonus * levelFlat).round() + storage,
      defenseBonus: (def.defenseBonus * levelFlat).round() + defense,
      statusBonus: (def.statusBonus * levelFlat).round() + status,
      populationCapacity:
          (def.populationCapacity * levelFlat).round() + population,
      dailyUpkeep: upkeep,
      hungerUpkeepModifier: def.hungerUpkeepModifier + hunger,
      thirstUpkeepModifier: def.thirstUpkeepModifier + thirst,
      ignoresStaffing: ignoresStaffing,
    );
  }

  /// Insumos por dia, escalados pelo nível.
  Map<ItemId, int> get consumesPerDay {
    final factor = BuildingUpgrade.outputMultiplierFor(level);
    return {
      for (final entry in def.consumes.entries)
        entry.key: (entry.value * factor).ceil(),
    };
  }

  bool addModule(BuildingModule module) {
    if (!canAddModule) return false;
    if (!module.fitsIn(def.category)) return false;
    return _modules.add(module);
  }

  bool removeModule(BuildingModule module) => _modules.remove(module);

  /// Retângulo ocupado na grade.
  bool covers(int px, int py) =>
      px >= x && px < x + def.width && py >= y && py < y + def.height;

  bool overlaps(BuildingDef other, int ox, int oy) {
    final def = this.def;
    return ox < x + def.width &&
        ox + other.width > x &&
        oy < y + def.height &&
        oy + other.height > y;
  }

  Map<String, dynamic> toJson() => {
        'instanceId': instanceId,
        'type': type.name,
        'x': x,
        'y': y,
        'daysRemaining': daysRemaining,
        'workers': workers,
        'idle': idle,
        'level': level,
        'customName': customName,
        'accentColor': accentColor,
        'modules': _modules.map((m) => m.name).toList(),
        'upgrading': upgrading,
      };

  static PlacedBuilding? fromJson(Map<String, dynamic> json) {
    final type = BuildingCatalog.parse(json['type'] as String);
    // Um save com uma construção que saiu do catálogo carrega sem quebrar —
    // aquele prédio simplesmente some do terreno.
    if (type == null) return null;
    return PlacedBuilding(
      instanceId: json['instanceId'] as String,
      type: type,
      x: (json['x'] as num).toInt(),
      y: (json['y'] as num).toInt(),
      daysRemaining: (json['daysRemaining'] as num).toInt(),
      workers: (json['workers'] as num?)?.toInt() ?? 0,
      idle: json['idle'] as bool? ?? false,
      level: (json['level'] as num?)?.toInt().clamp(1, BuildingUpgrade.maxLevel) ?? 1,
      customName: json['customName'] as String?,
      accentColor: (json['accentColor'] as num?)?.toInt(),
      modules: ((json['modules'] as List?) ?? const [])
          .map((e) => BuildingModule.parse(e as String))
          .whereType<BuildingModule>()
          .toSet(),
      upgrading: json['upgrading'] as bool? ?? false,
    );
  }
}

/// Por que uma construção foi recusada. Devolver o motivo (em vez de só
/// `false`) é o que permite à UI dizer ao jogador o que falta.
sealed class BuildResult {
  const BuildResult();
}

class BuildAccepted extends BuildResult {
  const BuildAccepted(this.building);
  final PlacedBuilding building;
}

class BuildRejected extends BuildResult {
  const BuildRejected(this.reason);
  final String reason;
}

/// O terreno (vilarejo) do jogador.
///
/// Regra central: **construções só existem dentro de um terreno**, e todo
/// terreno fica **dentro de uma metrópole** (uma capital ou satélite). Não se
/// constrói em terreno selvagem — o mundo aberto é para explorar, extrair e
/// viajar; a base é urbana.
class Plot {
  Plot({
    required this.id,
    required this.settlementId,
    required this.origin,
    required this.width,
    required this.height,
    List<PlacedBuilding>? buildings,
    VillageIdentity? identity,
  })  : _buildings = [...?buildings],
        identity = identity ?? const VillageIdentity();

  final String id;

  /// A metrópole que contém este terreno.
  final String settlementId;

  /// Canto do terreno em coordenadas de mundo, para o render isométrico.
  final TileCoord origin;

  final int width;
  final int height;

  /// Nome, brasão, cores e lema do vilarejo.
  VillageIdentity identity;

  final List<PlacedBuilding> _buildings;

  /// Tamanho inicial de um terreno. Cresce com o nível do cidadão.
  static const int baseWidth = 8;
  static const int baseHeight = 8;

  String get name => identity.name;

  List<PlacedBuilding> get buildings => List.unmodifiable(_buildings);

  List<PlacedBuilding> get operational =>
      _buildings.where((b) => b.isReady).toList(growable: false);

  List<PlacedBuilding> get underConstruction =>
      _buildings.where((b) => !b.isReady).toList(growable: false);

  int get tileCount => width * height;

  int get usedTiles => _buildings.fold(0, (sum, b) => sum + b.def.tileArea);

  int get freeTiles => tileCount - usedTiles;

  /// Coordenada de mundo de uma célula da grade do terreno.
  TileCoord worldTileFor(int px, int py) =>
      TileCoord(origin.x + px, origin.y + py);

  /// Célula da grade correspondente a um tile do mundo, ou `null` se estiver
  /// fora do terreno.
  (int, int)? gridCellFor(TileCoord tile) {
    final px = tile.x - origin.x;
    final py = tile.y - origin.y;
    if (px < 0 || py < 0 || px >= width || py >= height) return null;
    return (px, py);
  }

  bool containsWorldTile(TileCoord tile) => gridCellFor(tile) != null;

  PlacedBuilding? buildingAt(int px, int py) {
    for (final building in _buildings) {
      if (building.covers(px, py)) return building;
    }
    return null;
  }

  PlacedBuilding? byInstanceId(String instanceId) {
    for (final building in _buildings) {
      if (building.instanceId == instanceId) return building;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Agregados
  // ---------------------------------------------------------------------------

  int get totalJobSlots =>
      operational.fold(0, (sum, b) => sum + b.stats.jobSlots);

  int get employedWorkers => operational.fold(0, (sum, b) => sum + b.workers);

  int get populationCapacity =>
      operational.fold(0, (sum, b) => sum + b.stats.populationCapacity);

  int get storageCapacity =>
      200 + operational.fold(0, (sum, b) => sum + b.stats.storageBonus);

  int get defense =>
      operational.fold(0, (sum, b) => sum + b.stats.defenseBonus);

  int get statusBonus =>
      identity.statusBonus +
      operational.fold(0, (sum, b) => sum + b.stats.statusBonus);

  int get dailyUpkeep =>
      operational.fold(0, (sum, b) => sum + b.stats.dailyUpkeep);

  /// Estações de fabricação destravadas pelo que está construído.
  Set<CraftStation> get unlockedStations => {
        for (final building in operational)
          if (building.def.unlocksStation case final station?) station,
      };

  /// Modificadores de consumo concedidos pelas construções.
  ({double hunger, double thirst}) get upkeepModifiers {
    var hunger = 0.0;
    var thirst = 0.0;
    for (final building in operational) {
      hunger += building.stats.hungerUpkeepModifier;
      thirst += building.stats.thirstUpkeepModifier;
    }
    return (hunger: hunger.clamp(-0.6, 0.0), thirst: thirst.clamp(-0.6, 0.0));
  }

  /// Construções ilegais presentes. Dá base para confisco pelo governo.
  List<PlacedBuilding> get illegalBuildings =>
      _buildings.where((b) => !b.def.legal).toList(growable: false);

  // ---------------------------------------------------------------------------
  // Construir, evoluir e demolir
  // ---------------------------------------------------------------------------

  /// Valida e posiciona uma construção, debitando materiais.
  ///
  /// Só cobra se **tudo** passar: um terreno cheio não pode consumir o material
  /// do jogador e devolver erro.
  BuildResult build({
    required BuildingId type,
    required int x,
    required int y,
    required Inventory inventory,
    required int credits,
    required CitizenLevel level,
    required int day,
  }) {
    final def = BuildingCatalog.of(type);

    if (level.rank < def.requiredLevel.rank) {
      return BuildRejected('${def.name} exige ${def.requiredLevel.label}.');
    }

    if (x < 0 || y < 0 || x + def.width > width || y + def.height > height) {
      return const BuildRejected('A construção não cabe dentro do terreno.');
    }

    for (final existing in _buildings) {
      if (existing.overlaps(def, x, y)) {
        return BuildRejected(
            'O espaço já está ocupado por ${existing.displayName}.');
      }
    }

    if (credits < def.creditCost) {
      return BuildRejected('Faltam ${def.creditCost - credits} créditos.');
    }

    final missing = _missingMaterials(def.materialCost, inventory);
    if (missing != null) return BuildRejected(missing);

    for (final entry in def.materialCost.entries) {
      inventory.remove(entry.key, entry.value);
    }

    final building = PlacedBuilding(
      instanceId: '${type.name}_${day}_${_buildings.length}',
      type: type,
      x: x,
      y: y,
      daysRemaining: def.buildDays,
    );
    _buildings.add(building);
    return BuildAccepted(building);
  }

  /// Inicia o upgrade de uma construção para o próximo nível.
  ///
  /// Durante a obra a construção continua no terreno mas para de produzir —
  /// subir de nível tem custo de oportunidade, não é ganho puro.
  BuildResult upgrade({
    required String instanceId,
    required Inventory inventory,
    required int credits,
  }) {
    final building = byInstanceId(instanceId);
    if (building == null) return const BuildRejected('Construção não encontrada.');
    if (!building.isReady) return const BuildRejected('A obra ainda não terminou.');
    if (!building.canUpgrade) {
      return const BuildRejected('Já está no nível máximo (III).');
    }

    final def = building.def;
    final cost = BuildingUpgrade.creditCost(def, building.level);
    if (credits < cost) {
      return BuildRejected('Faltam ${cost - credits} créditos.');
    }

    final materials = BuildingUpgrade.materialCost(def, building.level);
    final missing = _missingMaterials(materials, inventory);
    if (missing != null) return BuildRejected(missing);

    for (final entry in materials.entries) {
      inventory.remove(entry.key, entry.value);
    }

    building.level++;
    building.daysRemaining = BuildingUpgrade.days(def, building.level - 1);
    building.upgrading = true;
    // Vagas novas começam vazias; o jogador realoca depois.
    building.workers = building.workers.clamp(0, building.stats.jobSlots);
    return BuildAccepted(building);
  }

  /// Instala um módulo numa construção pronta.
  BuildResult installModule({
    required String instanceId,
    required BuildingModule module,
    required Inventory inventory,
    required int credits,
  }) {
    final building = byInstanceId(instanceId);
    if (building == null) return const BuildRejected('Construção não encontrada.');
    if (!building.isReady) return const BuildRejected('A obra ainda não terminou.');
    if (building.modules.contains(module)) {
      return BuildRejected('${module.label} já está instalado.');
    }
    if (!module.fitsIn(building.def.category)) {
      return BuildRejected(
          '${module.label} não encaixa em ${building.def.category.label}.');
    }
    if (!building.canAddModule) {
      return BuildRejected(
        'Sem espaço: nível ${BuildingUpgrade.romanFor(building.level)} '
        'aceita ${building.moduleSlots} módulo(s).',
      );
    }
    if (credits < module.creditCost) {
      return BuildRejected('Faltam ${module.creditCost - credits} créditos.');
    }

    final missing = _missingMaterials(module.materialCost, inventory);
    if (missing != null) return BuildRejected(missing);

    for (final entry in module.materialCost.entries) {
      inventory.remove(entry.key, entry.value);
    }
    building.addModule(module);
    return BuildAccepted(building);
  }

  /// Remove um módulo. Não devolve nada — desinstalar é descarte.
  bool uninstallModule(String instanceId, BuildingModule module) {
    final building = byInstanceId(instanceId);
    if (building == null) return false;
    return building.removeModule(module);
  }

  /// Renomeia e/ou pinta uma construção.
  bool customize(String instanceId, {String? name, int? accentColor}) {
    final building = byInstanceId(instanceId);
    if (building == null) return false;
    if (name != null) {
      final trimmed = name.trim();
      building.customName = trimmed.isEmpty ? null : trimmed;
    }
    if (accentColor != null) building.accentColor = accentColor;
    return true;
  }

  /// Demole, devolvendo metade dos materiais da construção base. Módulos e
  /// níveis não voltam: a perda é intencional para que demolir não vire uma
  /// forma barata de estocar recurso.
  Map<ItemId, int> demolish(String instanceId) {
    final index = _buildings.indexWhere((b) => b.instanceId == instanceId);
    if (index < 0) return const {};

    final building = _buildings.removeAt(index);
    return {
      for (final entry in building.def.materialCost.entries)
        if (entry.value ~/ 2 > 0) entry.key: entry.value ~/ 2,
    };
  }

  /// Aloca funcionários numa construção, respeitando as vagas efetivas.
  bool assignWorkers(String instanceId, int count) {
    final building = byInstanceId(instanceId);
    if (building == null) return false;
    if (count < 0 || count > building.stats.jobSlots) return false;
    building.workers = count;
    return true;
  }

  /// Devolve a primeira falta de material, ou `null` se houver tudo.
  String? _missingMaterials(Map<ItemId, int> cost, Inventory inventory) {
    for (final entry in cost.entries) {
      if (!inventory.has(entry.key, entry.value)) {
        final missing = entry.value - inventory.quantityOf(entry.key);
        return 'Faltam $missing ${ItemCatalog.of(entry.key).name}.';
      }
    }
    return null;
  }

  /// Terrenos crescem conforme o cidadão sobe de nível — o jogador de Nível 3
  /// tem espaço para uma indústria de verdade.
  static (int, int) sizeForLevel(CitizenLevel level) => switch (level) {
        CitizenLevel.survivor => (baseWidth, baseHeight),
        CitizenLevel.farmer => (10, 10),
        CitizenLevel.industrialist => (13, 13),
        CitizenLevel.elite => (16, 16),
      };

  Map<String, dynamic> toJson() => {
        'id': id,
        'settlementId': settlementId,
        'origin': origin.toJson(),
        'width': width,
        'height': height,
        'identity': identity.toJson(),
        'buildings': _buildings.map((b) => b.toJson()).toList(),
      };

  factory Plot.fromJson(Map<String, dynamic> json) {
    // Saves anteriores à identidade guardavam apenas `name`.
    final rawIdentity = json['identity'] as Map<String, dynamic>?;
    final identity = rawIdentity != null
        ? VillageIdentity.fromJson(rawIdentity)
        : VillageIdentity(name: json['name'] as String? ?? 'Meu Terreno');

    return Plot(
      id: json['id'] as String,
      settlementId: json['settlementId'] as String,
      origin: TileCoord.fromJson(json['origin'] as Map<String, dynamic>),
      width: (json['width'] as num).toInt(),
      height: (json['height'] as num).toInt(),
      identity: identity,
      buildings: ((json['buildings'] as List?) ?? const [])
          .map((e) => PlacedBuilding.fromJson(e as Map<String, dynamic>))
          .whereType<PlacedBuilding>()
          .toList(),
    );
  }
}

/// Resultado do processamento diário de um terreno.
class PlotTickResult {
  const PlotTickResult({
    required this.produced,
    required this.consumed,
    required this.upkeepPaid,
    required this.completed,
    required this.idled,
  });

  final Map<ItemId, int> produced;
  final Map<ItemId, int> consumed;
  final int upkeepPaid;

  /// Construções que ficaram prontas neste reset (obra ou upgrade).
  final List<PlacedBuilding> completed;

  /// Construções que pararam por falta de insumo, caixa ou trabalhador.
  final List<PlacedBuilding> idled;
}

/// Processa um terreno no reset diário: avança obras, cobra manutenção e roda
/// a produção das construções.
abstract final class PlotTick {
  static PlotTickResult run(
    Plot plot, {
    required Inventory inventory,
    required int availableCredits,
  }) {
    final produced = <ItemId, int>{};
    final consumed = <ItemId, int>{};
    final completed = <PlacedBuilding>[];
    final idled = <PlacedBuilding>[];

    // 1. Avança obras e upgrades.
    for (final building in plot.buildings) {
      if (building.isReady) continue;
      building.daysRemaining--;
      if (building.isReady) {
        building.upgrading = false;
        completed.add(building);
      }
    }

    // 2. Manutenção. Se o caixa não cobre tudo, as construções mais caras
    // param primeiro — quem não paga a conta, não opera.
    final operational = plot.operational.toList()
      ..sort((a, b) => b.stats.dailyUpkeep.compareTo(a.stats.dailyUpkeep));

    var remainingCredits = availableCredits;
    var upkeepPaid = 0;
    final funded = <PlacedBuilding>[];

    for (final building in operational) {
      final cost = building.stats.dailyUpkeep;
      if (cost <= remainingCredits) {
        remainingCredits -= cost;
        upkeepPaid += cost;
        funded.add(building);
        building.idle = false;
      } else {
        building.idle = true;
        idled.add(building);
      }
    }

    // 3. Produção.
    for (final building in funded) {
      final def = building.def;
      if (def.produces == null) continue;

      final stats = building.stats;
      if (stats.outputPerDay <= 0) continue;

      // Uma construção com vagas precisa de gente para render. Sem ninguém
      // alocado, roda no mínimo — a menos que tenha Núcleo de Automação.
      final staffing = stats.ignoresStaffing || stats.jobSlots == 0
          ? 1.0
          : (0.35 + 0.65 * (building.workers / stats.jobSlots)).clamp(0.35, 1.0);

      // Confere insumos antes de consumir.
      final needs = building.consumesPerDay;
      var hasInputs = true;
      for (final entry in needs.entries) {
        if (!inventory.has(entry.key, entry.value)) {
          hasInputs = false;
          break;
        }
      }
      if (!hasInputs) {
        building.idle = true;
        idled.add(building);
        continue;
      }

      for (final entry in needs.entries) {
        inventory.remove(entry.key, entry.value);
        consumed[entry.key] = (consumed[entry.key] ?? 0) + entry.value;
      }

      final output = (stats.outputPerDay * staffing).floor();
      if (output > 0) {
        inventory.add(def.produces!, output);
        produced[def.produces!] = (produced[def.produces!] ?? 0) + output;
      }
    }

    return PlotTickResult(
      produced: produced,
      consumed: consumed,
      upkeepPaid: upkeepPaid,
      completed: completed,
      idled: idled,
    );
  }
}
