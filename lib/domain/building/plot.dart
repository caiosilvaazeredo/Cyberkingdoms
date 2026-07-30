import '../character/attributes.dart';
import '../economy/inventory.dart';
import '../economy/item.dart';
import '../economy/recipe.dart';
import '../world/coords.dart';
import 'building_type.dart';

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
  });

  final String instanceId;
  final BuildingId type;

  /// Canto superior-esquerdo na grade do terreno.
  final int x;
  final int y;

  /// Resets restantes até ficar pronta. 0 = operando.
  int daysRemaining;

  /// Funcionários alocados. Limitado por [BuildingDef.jobSlots].
  int workers;

  /// `true` quando a construção não produziu no último tick (faltou insumo,
  /// caixa ou trabalhador). A UI mostra isso para o jogador entender por que a
  /// produção parou.
  bool idle;

  BuildingDef get def => BuildingCatalog.of(type);

  bool get isReady => daysRemaining <= 0;

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
/// Regra central pedida no design: **construções só existem dentro de um
/// terreno**, e todo terreno fica **dentro de uma metrópole** (uma capital ou
/// satélite). Não se constrói em terreno selvagem — o mundo aberto é para
/// explorar, extrair e viajar; a base é urbana.
class Plot {
  Plot({
    required this.id,
    required this.settlementId,
    required this.origin,
    required this.width,
    required this.height,
    List<PlacedBuilding>? buildings,
    this.name = 'Meu Terreno',
  }) : _buildings = [...?buildings];

  final String id;

  /// A metrópole que contém este terreno.
  final String settlementId;

  /// Canto do terreno em coordenadas de mundo, para o render isométrico.
  final TileCoord origin;

  final int width;
  final int height;

  String name;

  final List<PlacedBuilding> _buildings;

  /// Tamanho inicial de um terreno. Cresce com o nível do cidadão.
  static const int baseWidth = 8;
  static const int baseHeight = 8;

  List<PlacedBuilding> get buildings => List.unmodifiable(_buildings);

  List<PlacedBuilding> get operational =>
      _buildings.where((b) => b.isReady).toList(growable: false);

  List<PlacedBuilding> get underConstruction =>
      _buildings.where((b) => !b.isReady).toList(growable: false);

  int get tileCount => width * height;

  int get usedTiles =>
      _buildings.fold(0, (sum, b) => sum + b.def.tileArea);

  int get freeTiles => tileCount - usedTiles;

  /// Coordenada de mundo de uma célula da grade do terreno.
  TileCoord worldTileFor(int px, int py) =>
      TileCoord(origin.x + px, origin.y + py);

  PlacedBuilding? buildingAt(int px, int py) {
    for (final building in _buildings) {
      if (building.covers(px, py)) return building;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Agregados
  // ---------------------------------------------------------------------------

  int get totalJobSlots =>
      operational.fold(0, (sum, b) => sum + b.def.jobSlots);

  int get employedWorkers => operational.fold(0, (sum, b) => sum + b.workers);

  int get populationCapacity =>
      operational.fold(0, (sum, b) => sum + b.def.populationCapacity);

  int get storageCapacity =>
      200 + operational.fold(0, (sum, b) => sum + b.def.storageBonus);

  int get defense => operational.fold(0, (sum, b) => sum + b.def.defenseBonus);

  int get statusBonus =>
      operational.fold(0, (sum, b) => sum + b.def.statusBonus);

  int get dailyUpkeep =>
      operational.fold(0, (sum, b) => sum + b.def.dailyUpkeep);

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
      hunger += building.def.hungerUpkeepModifier;
      thirst += building.def.thirstUpkeepModifier;
    }
    return (hunger: hunger.clamp(-0.6, 0.0), thirst: thirst.clamp(-0.6, 0.0));
  }

  /// Construções ilegais presentes. Dá base para confisco pelo governo.
  List<PlacedBuilding> get illegalBuildings =>
      _buildings.where((b) => !b.def.legal).toList(growable: false);

  // ---------------------------------------------------------------------------
  // Construir e demolir
  // ---------------------------------------------------------------------------

  /// Valida e posiciona uma construção, debitando custo e materiais.
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
      return BuildRejected(
        '${def.name} exige ${def.requiredLevel.label}.',
      );
    }

    if (x < 0 || y < 0 || x + def.width > width || y + def.height > height) {
      return const BuildRejected('A construção não cabe dentro do terreno.');
    }

    for (final existing in _buildings) {
      if (existing.overlaps(def, x, y)) {
        return BuildRejected('O espaço já está ocupado por ${existing.def.name}.');
      }
    }

    if (credits < def.creditCost) {
      return BuildRejected(
        'Faltam ${def.creditCost - credits} créditos.',
      );
    }

    for (final entry in def.materialCost.entries) {
      if (!inventory.has(entry.key, entry.value)) {
        final missing = entry.value - inventory.quantityOf(entry.key);
        return BuildRejected(
          'Faltam $missing ${ItemCatalog.of(entry.key).name}.',
        );
      }
    }

    // Tudo validado: agora sim consome.
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

  /// Demole, devolvendo metade dos materiais. A perda é intencional: demolir
  /// não pode ser uma forma barata de estocar recurso.
  Map<ItemId, int> demolish(String instanceId) {
    final index =
        _buildings.indexWhere((b) => b.instanceId == instanceId);
    if (index < 0) return const {};

    final building = _buildings.removeAt(index);
    return {
      for (final entry in building.def.materialCost.entries)
        if (entry.value ~/ 2 > 0) entry.key: entry.value ~/ 2,
    };
  }

  /// Aloca funcionários numa construção, respeitando as vagas.
  bool assignWorkers(String instanceId, int count) {
    final building = _buildings
        .where((b) => b.instanceId == instanceId)
        .firstOrNull;
    if (building == null) return false;
    if (count < 0 || count > building.def.jobSlots) return false;
    building.workers = count;
    return true;
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
        'name': name,
        'buildings': _buildings.map((b) => b.toJson()).toList(),
      };

  factory Plot.fromJson(Map<String, dynamic> json) => Plot(
        id: json['id'] as String,
        settlementId: json['settlementId'] as String,
        origin: TileCoord.fromJson(json['origin'] as Map<String, dynamic>),
        width: (json['width'] as num).toInt(),
        height: (json['height'] as num).toInt(),
        name: json['name'] as String? ?? 'Meu Terreno',
        buildings: ((json['buildings'] as List?) ?? const [])
            .map((e) => PlacedBuilding.fromJson(e as Map<String, dynamic>))
            .whereType<PlacedBuilding>()
            .toList(),
      );
}

extension _FirstOrNull<T> on Iterable<T> {
  T? get firstOrNull {
    final it = iterator;
    return it.moveNext() ? it.current : null;
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

  /// Construções que ficaram prontas neste reset.
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

    // 1. Avança obras.
    for (final building in plot.buildings) {
      if (building.isReady) continue;
      building.daysRemaining--;
      if (building.isReady) completed.add(building);
    }

    // 2. Manutenção. Se o caixa não cobre tudo, as construções mais caras
    // param primeiro — quem não paga a conta, não opera.
    final operational = plot.operational.toList()
      ..sort((a, b) => b.def.dailyUpkeep.compareTo(a.def.dailyUpkeep));

    var remainingCredits = availableCredits;
    var upkeepPaid = 0;
    final funded = <PlacedBuilding>[];

    for (final building in operational) {
      final cost = building.def.dailyUpkeep;
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
      if (!def.isProducer) continue;

      // Uma construção com vagas precisa de gente para render. Sem ninguém
      // alocado, ela roda no mínimo (o próprio dono tocando o serviço).
      final staffing = def.jobSlots == 0
          ? 1.0
          : (0.35 + 0.65 * (building.workers / def.jobSlots)).clamp(0.35, 1.0);

      // Confere insumos antes de consumir.
      var hasInputs = true;
      for (final entry in def.consumes.entries) {
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

      for (final entry in def.consumes.entries) {
        inventory.remove(entry.key, entry.value);
        consumed[entry.key] = (consumed[entry.key] ?? 0) + entry.value;
      }

      final output = (def.outputPerDay * staffing).floor();
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
