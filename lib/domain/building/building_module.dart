import '../economy/item.dart';
import 'building_type.dart';

/// Módulos encaixáveis numa construção.
///
/// A ideia é multiplicar as possibilidades sem multiplicar o catálogo: duas
/// refinarias do mesmo tipo viram construções diferentes conforme o dono
/// escolhe priorizar produção, estoque, defesa ou economia de manutenção.
///
/// Cada módulo declara em quais categorias ele encaixa — um Núcleo de
/// Automação não faz sentido num muro.
enum BuildingModule {
  extraArm(
    label: 'Braço Industrial',
    description: '+30% de produção. Consome mais manutenção.',
    creditCost: 1800,
    materialCost: {ItemId.scrap: 20, ItemId.polymer: 8},
    categories: {
      BuildingCategory.extraction,
      BuildingCategory.refining,
      BuildingCategory.manufacturing,
    },
    outputMultiplier: 0.30,
    upkeepDelta: 18,
  ),

  storageAnnex(
    label: 'Anexo de Estoque',
    description: '+120 de capacidade de armazenamento.',
    creditCost: 1200,
    materialCost: {ItemId.scrap: 16, ItemId.polymer: 4},
    categories: {
      BuildingCategory.extraction,
      BuildingCategory.refining,
      BuildingCategory.manufacturing,
      BuildingCategory.commerce,
      BuildingCategory.infrastructure,
    },
    storageBonus: 120,
    upkeepDelta: 6,
  ),

  dedicatedGenerator(
    label: 'Gerador Dedicado',
    description: 'Corta 60% da manutenção — a construção se paga sozinha.',
    creditCost: 3200,
    materialCost: {ItemId.circuitBoard: 6, ItemId.scrap: 24},
    categories: {
      BuildingCategory.extraction,
      BuildingCategory.refining,
      BuildingCategory.manufacturing,
      BuildingCategory.commerce,
    },
    upkeepMultiplier: -0.60,
  ),

  automationCore(
    label: 'Núcleo de Automação',
    description: 'A construção rende cheio mesmo sem funcionários.',
    creditCost: 6500,
    materialCost: {ItemId.chip: 4, ItemId.circuitBoard: 8},
    categories: {
      BuildingCategory.extraction,
      BuildingCategory.refining,
      BuildingCategory.manufacturing,
    },
    removesStaffingPenalty: true,
    upkeepDelta: 40,
  ),

  securityGrid(
    label: 'Grade de Segurança',
    description: '+18 de defesa do terreno.',
    creditCost: 2200,
    materialCost: {ItemId.scrap: 22, ItemId.circuitBoard: 4},
    categories: {
      BuildingCategory.defense,
      BuildingCategory.commerce,
      BuildingCategory.housing,
      BuildingCategory.civic,
    },
    defenseBonus: 18,
    upkeepDelta: 14,
  ),

  neonSign(
    label: 'Letreiro Neon',
    description: '+2 de Status. Aparência é poder político.',
    creditCost: 900,
    materialCost: {ItemId.polymer: 6, ItemId.circuitBoard: 2},
    categories: {
      BuildingCategory.commerce,
      BuildingCategory.civic,
      BuildingCategory.housing,
    },
    statusBonus: 2,
    upkeepDelta: 8,
  ),

  filtrationUnit(
    label: 'Unidade de Filtragem',
    description: '-10% de consumo de Sede enquanto você estiver no terreno.',
    creditCost: 2600,
    materialCost: {ItemId.polymer: 12, ItemId.catalyst: 3},
    categories: {
      BuildingCategory.infrastructure,
      BuildingCategory.housing,
      BuildingCategory.extraction,
    },
    thirstUpkeepModifier: -0.10,
    upkeepDelta: 12,
  ),

  insulationLayer(
    label: 'Camada Térmica',
    description: '-10% de consumo de Fome enquanto você estiver no terreno.',
    creditCost: 2400,
    materialCost: {ItemId.fabric: 10, ItemId.polymer: 8},
    categories: {
      BuildingCategory.infrastructure,
      BuildingCategory.housing,
      BuildingCategory.civic,
    },
    hungerUpkeepModifier: -0.10,
    upkeepDelta: 12,
  ),

  workerQuarters(
    label: 'Alojamento Anexo',
    description: '+3 vagas de emprego e +6 de população.',
    creditCost: 1600,
    materialCost: {ItemId.scrap: 14, ItemId.fabric: 6},
    categories: {
      BuildingCategory.extraction,
      BuildingCategory.refining,
      BuildingCategory.manufacturing,
      BuildingCategory.civic,
    },
    jobSlotBonus: 3,
    populationBonus: 6,
    upkeepDelta: 10,
  );

  const BuildingModule({
    required this.label,
    required this.description,
    required this.creditCost,
    required this.materialCost,
    required this.categories,
    this.outputMultiplier = 0,
    this.storageBonus = 0,
    this.defenseBonus = 0,
    this.statusBonus = 0,
    this.jobSlotBonus = 0,
    this.populationBonus = 0,
    this.upkeepDelta = 0,
    this.upkeepMultiplier = 0,
    this.thirstUpkeepModifier = 0,
    this.hungerUpkeepModifier = 0,
    this.removesStaffingPenalty = false,
  });

  final String label;
  final String description;
  final int creditCost;
  final Map<ItemId, int> materialCost;

  /// Categorias de construção que aceitam este módulo.
  final Set<BuildingCategory> categories;

  /// Fração somada à produção (0.30 = +30%).
  final double outputMultiplier;

  final int storageBonus;
  final int defenseBonus;
  final int statusBonus;
  final int jobSlotBonus;
  final int populationBonus;

  /// Manutenção somada em créditos por dia.
  final int upkeepDelta;

  /// Fração aplicada à manutenção depois de [upkeepDelta] (-0.60 = -60%).
  final double upkeepMultiplier;

  final double thirstUpkeepModifier;
  final double hungerUpkeepModifier;

  /// Quando `true`, a construção produz no máximo mesmo com zero funcionários.
  final bool removesStaffingPenalty;

  bool fitsIn(BuildingCategory category) => categories.contains(category);

  static BuildingModule? parse(String name) {
    for (final module in BuildingModule.values) {
      if (module.name == name) return module;
    }
    return null;
  }
}

/// Regras de evolução de uma construção.
///
/// Três níveis multiplicam o conteúdo do catálogo sem exigir arte nova: o mesmo
/// prédio no nível III produz o dobro e emprega o dobro, mas custa manutenção
/// à altura — subir de nível é uma aposta, não um upgrade automático.
abstract final class BuildingUpgrade {
  static const int maxLevel = 3;

  /// Multiplicador de produção e de vagas por nível.
  static double outputMultiplierFor(int level) => switch (level) {
        1 => 1.0,
        2 => 1.6,
        _ => 2.4,
      };

  /// Multiplicador de manutenção por nível. Cresce mais rápido que a produção
  /// de propósito: uma indústria grande parada sangra caixa.
  static double upkeepMultiplierFor(int level) => switch (level) {
        1 => 1.0,
        2 => 1.8,
        _ => 3.0,
      };

  /// Bônus fixos (defesa, estoque, status) escalam de forma mais suave.
  static double flatMultiplierFor(int level) => switch (level) {
        1 => 1.0,
        2 => 1.5,
        _ => 2.0,
      };

  /// Quantos módulos cabem numa construção do nível dado.
  static int moduleSlotsFor(int level) => switch (level) {
        1 => 1,
        2 => 2,
        _ => 3,
      };

  /// Custo em créditos para subir de [fromLevel] para `fromLevel + 1`.
  static int creditCost(BuildingDef def, int fromLevel) =>
      (def.creditCost * (fromLevel == 1 ? 1.2 : 2.0)).round();

  /// Materiais para subir de nível.
  static Map<ItemId, int> materialCost(BuildingDef def, int fromLevel) {
    final factor = fromLevel == 1 ? 0.8 : 1.5;
    return {
      for (final entry in def.materialCost.entries)
        entry.key: (entry.value * factor).ceil(),
    };
  }

  /// Dias de obra para subir de nível.
  static int days(BuildingDef def, int fromLevel) =>
      (def.buildDays * (fromLevel == 1 ? 0.8 : 1.4)).ceil().clamp(1, 30);

  static String romanFor(int level) => switch (level) {
        1 => 'I',
        2 => 'II',
        _ => 'III',
      };
}
