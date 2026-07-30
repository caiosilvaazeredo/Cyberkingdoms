import '../character/attributes.dart';
import '../survival/survival_tables.dart';
import 'item.dart';

/// Uma receita de fabricação. O canvas pede "receitas de fabricação em 3
/// passos": extrair → refinar → manufaturar. Cada receita declara em qual tipo
/// de local ela roda, o que consome e quanto tempo (em dias/ticks) leva.
class Recipe {
  const Recipe({
    required this.id,
    required this.output,
    required this.outputQuantity,
    required this.inputs,
    required this.station,
    required this.days,
    this.requiredLevel = CitizenLevel.survivor,
    this.intelligenceBonusPerPoint = 0.08,
  });

  final String id;
  final ItemId output;
  final int outputQuantity;

  /// Insumos consumidos por execução.
  final Map<ItemId, int> inputs;

  final CraftStation station;

  /// Dias (resets) que a produção leva para ficar pronta.
  final int days;

  final CitizenLevel requiredLevel;

  /// Quanto cada ponto de Inteligência acima de 6 aumenta o rendimento.
  ///
  /// 8% por ponto dá ±24% na faixa de rolagem (3..12). Precisa ser dessa ordem:
  /// com um valor pequeno demais, o arredondamento engolia a diferença em
  /// receitas de saída baixa e o atributo virava decoração.
  final double intelligenceBonusPerPoint;

  ProductionTier get tier => ItemCatalog.of(output).tier;

  /// Rendimento efetivo considerando Inteligência do trabalhador.
  int yieldFor(AttributeSet attributes) {
    final intelligence = attributes[Attribute.intelligence];
    final bonus = (intelligence - 6) * intelligenceBonusPerPoint;
    final multiplier = (1 + bonus).clamp(0.5, 2.0);
    return (outputQuantity * multiplier).round().clamp(1, 9999);
  }
}

/// Onde uma receita pode ser executada.
enum CraftStation {
  extractionSite('Jazida', ProductionTier.extraction),
  refinery('Refinaria', ProductionTier.refining),
  textileWorkshop('Oficina de Tecidos', ProductionTier.refining),
  hardwareWorkshop('Oficina de Hardware', ProductionTier.manufacturing),
  laboratory('Laboratório', ProductionTier.manufacturing),
  gunsmith('Armeiro', ProductionTier.manufacturing),
  kitchen('Cozinha Industrial', ProductionTier.manufacturing);

  const CraftStation(this.label, this.tier);
  final String label;
  final ProductionTier tier;

  /// Custo de Fome/Sede de um dia trabalhando nesta estação.
  Upkeep get upkeep => switch (this) {
        CraftStation.extractionSite => PublicWork.dump.upkeep,
        CraftStation.refinery => WorkshopWork.hardware.upkeep,
        CraftStation.textileWorkshop => WorkshopWork.textiles.upkeep,
        CraftStation.hardwareWorkshop => WorkshopWork.hardware.upkeep,
        CraftStation.laboratory => WorkshopWork.laboratory.upkeep,
        CraftStation.gunsmith => WorkshopWork.gunsmith.upkeep,
        CraftStation.kitchen => PlayerFarmWork.bioreactors.upkeep,
      };
}

/// Livro de receitas. A cadeia é deliberadamente estreita no gargalo (terras
/// raras → chip) porque é isso que cria cartel e monopólio — as dinâmicas que
/// o canvas lista como resultado esperado.
abstract final class RecipeBook {
  static const List<Recipe> all = [
    // ---------- Camada 2: Refino ----------
    Recipe(
      id: 'refine_polymer',
      output: ItemId.polymer,
      outputQuantity: 2,
      inputs: {ItemId.oil: 3},
      station: CraftStation.refinery,
      days: 1,
      requiredLevel: CitizenLevel.farmer,
    ),
    Recipe(
      id: 'refine_chip',
      output: ItemId.chip,
      outputQuantity: 1,
      inputs: {ItemId.rareEarth: 2, ItemId.catalyst: 1},
      station: CraftStation.refinery,
      days: 2,
      requiredLevel: CitizenLevel.industrialist,
    ),
    Recipe(
      id: 'refine_fabric',
      output: ItemId.fabric,
      outputQuantity: 3,
      inputs: {ItemId.biomass: 4},
      station: CraftStation.textileWorkshop,
      days: 1,
      requiredLevel: CitizenLevel.farmer,
    ),
    Recipe(
      id: 'refine_board',
      output: ItemId.circuitBoard,
      outputQuantity: 1,
      inputs: {ItemId.scrap: 4, ItemId.polymer: 1},
      station: CraftStation.refinery,
      days: 1,
      requiredLevel: CitizenLevel.farmer,
    ),
    Recipe(
      id: 'refine_catalyst',
      output: ItemId.catalyst,
      outputQuantity: 2,
      inputs: {ItemId.oil: 2, ItemId.biomass: 2},
      station: CraftStation.laboratory,
      days: 1,
      requiredLevel: CitizenLevel.farmer,
    ),

    // ---------- Camada 3: Manufatura ----------
    Recipe(
      id: 'craft_clothing',
      output: ItemId.clothing,
      outputQuantity: 1,
      inputs: {ItemId.fabric: 3},
      station: CraftStation.textileWorkshop,
      days: 1,
      requiredLevel: CitizenLevel.farmer,
    ),
    Recipe(
      id: 'craft_pistol',
      output: ItemId.pistol,
      outputQuantity: 1,
      inputs: {ItemId.scrap: 3, ItemId.circuitBoard: 1},
      station: CraftStation.gunsmith,
      days: 2,
      requiredLevel: CitizenLevel.industrialist,
    ),
    Recipe(
      id: 'craft_rifle',
      output: ItemId.rifle,
      outputQuantity: 1,
      inputs: {ItemId.scrap: 6, ItemId.circuitBoard: 2, ItemId.polymer: 2},
      station: CraftStation.gunsmith,
      days: 3,
      requiredLevel: CitizenLevel.industrialist,
    ),
    Recipe(
      id: 'craft_drone',
      output: ItemId.drone,
      outputQuantity: 1,
      inputs: {ItemId.chip: 2, ItemId.circuitBoard: 3, ItemId.polymer: 4},
      station: CraftStation.hardwareWorkshop,
      days: 4,
      requiredLevel: CitizenLevel.elite,
    ),
    Recipe(
      id: 'craft_metabolic_implant',
      output: ItemId.metabolicImplant,
      outputQuantity: 1,
      inputs: {ItemId.chip: 3, ItemId.catalyst: 2, ItemId.culturedMeat: 4},
      station: CraftStation.laboratory,
      days: 5,
      requiredLevel: CitizenLevel.elite,
    ),
    Recipe(
      id: 'craft_hydration_pack',
      output: ItemId.hydrationPack,
      outputQuantity: 1,
      inputs: {ItemId.fabric: 2, ItemId.polymer: 2},
      station: CraftStation.textileWorkshop,
      days: 2,
      requiredLevel: CitizenLevel.farmer,
    ),
    Recipe(
      id: 'craft_thermal_jacket',
      output: ItemId.thermalJacket,
      outputQuantity: 1,
      inputs: {ItemId.fabric: 3, ItemId.polymer: 1},
      station: CraftStation.textileWorkshop,
      days: 2,
      requiredLevel: CitizenLevel.farmer,
    ),
    Recipe(
      id: 'craft_ration',
      output: ItemId.rationPack,
      outputQuantity: 4,
      inputs: {ItemId.culturedMeat: 2, ItemId.biomass: 2},
      station: CraftStation.kitchen,
      days: 1,
    ),
    Recipe(
      id: 'craft_luxury_meal',
      output: ItemId.luxuryMeal,
      outputQuantity: 2,
      inputs: {ItemId.culturedMeat: 3, ItemId.catalyst: 1, ItemId.water: 2},
      station: CraftStation.kitchen,
      days: 2,
      requiredLevel: CitizenLevel.farmer,
    ),
    Recipe(
      id: 'craft_water',
      output: ItemId.water,
      outputQuantity: 6,
      inputs: {ItemId.biomass: 1},
      station: CraftStation.refinery,
      days: 1,
    ),
    Recipe(
      id: 'craft_street_food',
      output: ItemId.streetFood,
      outputQuantity: 5,
      inputs: {ItemId.biomass: 3},
      station: CraftStation.kitchen,
      days: 1,
    ),

    // ---------- Ilegais ----------
    Recipe(
      id: 'craft_red_rush',
      output: ItemId.redRush,
      outputQuantity: 3,
      inputs: {ItemId.catalyst: 2, ItemId.biomass: 2},
      station: CraftStation.laboratory,
      days: 2,
      requiredLevel: CitizenLevel.industrialist,
    ),
    Recipe(
      id: 'craft_synthetic_drug',
      output: ItemId.syntheticDrug,
      outputQuantity: 2,
      inputs: {ItemId.catalyst: 3, ItemId.chip: 1, ItemId.culturedMeat: 2},
      station: CraftStation.laboratory,
      days: 3,
      requiredLevel: CitizenLevel.elite,
    ),
    Recipe(
      id: 'craft_illegal_weapon',
      output: ItemId.illegalWeapon,
      outputQuantity: 1,
      inputs: {ItemId.scrap: 8, ItemId.circuitBoard: 2},
      station: CraftStation.gunsmith,
      days: 3,
      requiredLevel: CitizenLevel.industrialist,
    ),
  ];

  static Recipe? byId(String id) {
    for (final recipe in all) {
      if (recipe.id == id) return recipe;
    }
    return null;
  }

  static List<Recipe> producing(ItemId item) =>
      all.where((r) => r.output == item).toList(growable: false);

  static List<Recipe> atStation(CraftStation station) =>
      all.where((r) => r.station == station).toList(growable: false);

  static List<Recipe> availableAt(CitizenLevel level) => all
      .where((r) => r.requiredLevel.rank <= level.rank)
      .toList(growable: false);
}
