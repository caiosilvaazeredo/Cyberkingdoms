/// As três camadas produtivas do GDD. Todo item pertence a exatamente uma —
/// e a dependência entre elas é o que sustenta a economia dirigida por
/// jogadores: ninguém fabrica um drone sem que alguém tenha extraído sucata.
enum ProductionTier {
  /// Camada 1 — Extração. Matérias-primas tiradas do mundo.
  extraction(1, 'Extração'),

  /// Camada 2 — Refino. Componentes industriais.
  refining(2, 'Refino'),

  /// Camada 3 — Manufatura. Equipamentos finais.
  manufacturing(3, 'Manufatura'),

  /// Fora da cadeia: água, comida básica e itens que o mundo fornece direto.
  basic(0, 'Básico');

  const ProductionTier(this.level, this.label);
  final int level;
  final String label;
}

/// Categoria funcional — define em qual aba do inventário e de qual mercado o
/// item participa.
enum ItemCategory {
  rawMaterial('Matéria-prima'),
  component('Componente'),
  food('Alimento'),
  drink('Bebida'),
  drug('Estimulante'),
  weapon('Arma'),
  gear('Equipamento'),
  implant('Implante'),
  contraband('Contrabando');

  const ItemCategory(this.label);
  final String label;
}

/// Identificadores estáveis. Nunca renomeie um valor destes: eles vão para o
/// save local e para o Firestore.
enum ItemId {
  // ---- Camada 1: Extração ----
  oil,
  scrap,
  rareEarth,
  biomass,
  culturedMeat,

  // ---- Camada 2: Refino ----
  chip,
  polymer,
  fabric,
  circuitBoard,
  catalyst,

  // ---- Camada 3: Manufatura ----
  clothing,
  pistol,
  rifle,
  drone,
  metabolicImplant,
  hydrationPack,
  thermalJacket,
  rationPack,
  luxuryMeal,

  // ---- Básicos / consumo ----
  water,
  streetFood,
  energyDrink,

  // ---- Estimulantes (tabela do GDD, seção 13) ----
  redRush,
  caffeine,
  glowVodka,

  // ---- Contrabando ----
  stolenGoods,
  illegalWeapon,
  syntheticDrug;
}

/// Definição imutável de um item.
class ItemDef {
  const ItemDef({
    required this.id,
    required this.name,
    required this.tier,
    required this.category,
    required this.baseValue,
    this.weight = 1,
    this.legal = true,
    this.restoresHunger = 0,
    this.restoresThirst = 0,
    this.hungerCost = 0,
    this.thirstCost = 0,
    this.energyBonus = 0,
    this.strengthBonus = 0,
    this.statusBonus = 0,
    this.enduranceBonus = 0,
    this.hungerUpkeepModifier = 0,
    this.thirstUpkeepModifier = 0,
    this.attackPower = 0,
    this.defensePower = 0,
    this.description = '',
  });

  final ItemId id;
  final String name;
  final ProductionTier tier;
  final ItemCategory category;

  /// Preço de referência em créditos. **Não** é o preço de venda: os mercados
  /// são de ordem livre e quem define preço é o jogador. Serve só para
  /// semear o livro de ofertas inicial e para estimar patrimônio.
  final int baseValue;

  final int weight;

  /// `false` = só pode ser negociado no Mercado Clandestino.
  final bool legal;

  final int restoresHunger;
  final int restoresThirst;

  /// Custo de consumir o item (estimulantes cobram Sede — tabela do GDD).
  final int hungerCost;
  final int thirstCost;

  final int energyBonus;
  final int strengthBonus;
  final int statusBonus;
  final int enduranceBonus;

  /// Redução percentual de consumo enquanto equipado (valores negativos
  /// reduzem). Ex.: -0.20 = -20% de consumo de sede.
  final double hungerUpkeepModifier;
  final double thirstUpkeepModifier;

  final int attackPower;
  final int defensePower;

  final String description;

  bool get isConsumable =>
      restoresHunger > 0 ||
      restoresThirst > 0 ||
      energyBonus > 0 ||
      strengthBonus > 0;

  bool get isEquipment =>
      category == ItemCategory.gear ||
      category == ItemCategory.implant ||
      category == ItemCategory.weapon;
}

/// Catálogo global. É a fonte da verdade para preços-base, cadeia produtiva e
/// efeitos de consumo.
abstract final class ItemCatalog {
  static const Map<ItemId, ItemDef> _defs = {
    // ============ Camada 1 — Extração ============
    ItemId.oil: ItemDef(
      id: ItemId.oil,
      name: 'Breu',
      tier: ProductionTier.extraction,
      category: ItemCategory.rawMaterial,
      baseValue: 18,
      weight: 3,
      description: 'Extraído dos campos. Base de polímeros e combustível.',
    ),
    ItemId.scrap: ItemDef(
      id: ItemId.scrap,
      name: 'Minério de Ferro',
      tier: ProductionTier.extraction,
      category: ItemCategory.rawMaterial,
      baseValue: 8,
      weight: 2,
      description: 'Metal recuperado do lixão. Abundante e barato.',
    ),
    ItemId.rareEarth: ItemDef(
      id: ItemId.rareEarth,
      name: 'Prata Bruta',
      tier: ProductionTier.extraction,
      category: ItemCategory.rawMaterial,
      baseValue: 45,
      weight: 2,
      description: 'Insumo de chips e implantes. O gargalo da economia.',
    ),
    ItemId.biomass: ItemDef(
      id: ItemId.biomass,
      name: 'Cevada',
      tier: ProductionTier.extraction,
      category: ItemCategory.rawMaterial,
      baseValue: 10,
      weight: 2,
      description: 'Matéria orgânica para biorreatores e comida.',
    ),
    ItemId.culturedMeat: ItemDef(
      id: ItemId.culturedMeat,
      name: 'Carne Curada',
      tier: ProductionTier.extraction,
      category: ItemCategory.rawMaterial,
      baseValue: 22,
      weight: 2,
      description: 'Proteína de biorreator. Base das refeições industriais.',
    ),

    // ============ Camada 2 — Refino ============
    ItemId.chip: ItemDef(
      id: ItemId.chip,
      name: 'Prata Lavrada',
      tier: ProductionTier.refining,
      category: ItemCategory.component,
      baseValue: 120,
      description: 'Terras raras refinadas. Nada avançado existe sem ele.',
    ),
    ItemId.polymer: ItemDef(
      id: ItemId.polymer,
      name: 'Madeira Tratada',
      tier: ProductionTier.refining,
      category: ItemCategory.component,
      baseValue: 40,
      description: 'Petróleo craqueado. Estrutura de quase tudo.',
    ),
    ItemId.fabric: ItemDef(
      id: ItemId.fabric,
      name: 'Linho',
      tier: ProductionTier.refining,
      category: ItemCategory.component,
      baseValue: 35,
      description: 'Fibra de biomassa tratada.',
    ),
    ItemId.circuitBoard: ItemDef(
      id: ItemId.circuitBoard,
      name: 'Ferragem',
      tier: ProductionTier.refining,
      category: ItemCategory.component,
      baseValue: 90,
      description: 'Sucata + polímero. O esqueleto da eletrônica.',
    ),
    ItemId.catalyst: ItemDef(
      id: ItemId.catalyst,
      name: 'Salitre',
      tier: ProductionTier.refining,
      category: ItemCategory.component,
      baseValue: 75,
      description: 'Acelera reações. Usado em drogas e combustível.',
    ),

    // ============ Camada 3 — Manufatura ============
    ItemId.clothing: ItemDef(
      id: ItemId.clothing,
      name: 'Traje de Corte',
      tier: ProductionTier.manufacturing,
      category: ItemCategory.gear,
      baseValue: 110,
      defensePower: 2,
      statusBonus: 1,
      description: 'Aparência conta: pequeno bônus de Status.',
    ),
    ItemId.pistol: ItemDef(
      id: ItemId.pistol,
      name: 'Besta',
      tier: ProductionTier.manufacturing,
      category: ItemCategory.weapon,
      baseValue: 260,
      attackPower: 8,
      description: 'Arma leve e legal de portar nas capitais.',
    ),
    ItemId.rifle: ItemDef(
      id: ItemId.rifle,
      name: 'Arco Longo',
      tier: ProductionTier.manufacturing,
      category: ItemCategory.weapon,
      baseValue: 620,
      attackPower: 18,
      weight: 4,
      description: 'Poder de fogo de milícia.',
    ),
    ItemId.drone: ItemDef(
      id: ItemId.drone,
      name: 'Cão de Guerra',
      tier: ProductionTier.manufacturing,
      category: ItemCategory.weapon,
      baseValue: 1400,
      attackPower: 25,
      defensePower: 6,
      weight: 3,
      description: 'Ataca junto no reset diário.',
    ),
    ItemId.metabolicImplant: ItemDef(
      id: ItemId.metabolicImplant,
      name: 'Amuleto do Peregrino',
      tier: ProductionTier.manufacturing,
      category: ItemCategory.implant,
      baseValue: 2600,
      hungerUpkeepModifier: -0.30,
      thirstUpkeepModifier: -0.30,
      enduranceBonus: 2,
      description: '-30% de consumo de Fome e Sede. Endgame do Nível 3.',
    ),
    ItemId.hydrationPack: ItemDef(
      id: ItemId.hydrationPack,
      name: 'Cantil de Couro',
      tier: ProductionTier.manufacturing,
      category: ItemCategory.gear,
      baseValue: 380,
      thirstUpkeepModifier: -0.20,
      description: '-20% de consumo de Sede.',
    ),
    ItemId.thermalJacket: ItemDef(
      id: ItemId.thermalJacket,
      name: 'Manto de Lã',
      tier: ProductionTier.manufacturing,
      category: ItemCategory.gear,
      baseValue: 340,
      hungerUpkeepModifier: -0.15,
      defensePower: 3,
      description: '-15% de consumo de Fome.',
    ),
    ItemId.rationPack: ItemDef(
      id: ItemId.rationPack,
      name: 'Ração de Marcha',
      tier: ProductionTier.manufacturing,
      category: ItemCategory.food,
      baseValue: 55,
      restoresHunger: 45,
      energyBonus: 1,
      description: 'Restaura muita Fome e dá +1 Energia no próximo ciclo.',
    ),
    ItemId.luxuryMeal: ItemDef(
      id: ItemId.luxuryMeal,
      name: 'Banquete',
      tier: ProductionTier.manufacturing,
      category: ItemCategory.food,
      baseValue: 210,
      restoresHunger: 60,
      statusBonus: 2,
      enduranceBonus: 1,
      description: 'Cara, mas concede Status e Resistência temporários.',
    ),

    // ============ Básicos ============
    ItemId.water: ItemDef(
      id: ItemId.water,
      name: 'Água de Poço',
      tier: ProductionTier.basic,
      category: ItemCategory.drink,
      baseValue: 12,
      restoresThirst: 40,
      description: 'O item mais negociado do servidor.',
    ),
    ItemId.streetFood: ItemDef(
      id: ItemId.streetFood,
      name: 'Pão de Feira',
      tier: ProductionTier.basic,
      category: ItemCategory.food,
      baseValue: 20,
      restoresHunger: 35,
      description: 'Barata, enche a barra, sem nenhum bônus.',
    ),
    ItemId.energyDrink: ItemDef(
      id: ItemId.energyDrink,
      name: 'Cerveja de Cevada',
      tier: ProductionTier.basic,
      category: ItemCategory.drink,
      baseValue: 34,
      restoresThirst: 15,
      energyBonus: 2,
      description: 'Restaura pouca Sede, mas aumenta as horas de trabalho.',
    ),

    // ============ Estimulantes — tabela exata do GDD ============
    ItemId.redRush: ItemDef(
      id: ItemId.redRush,
      name: 'Aguardente Vermelha',
      tier: ProductionTier.manufacturing,
      category: ItemCategory.drug,
      baseValue: 150,
      strengthBonus: 6,
      thirstCost: 15,
      legal: false,
      description: '+6 Força, -15 Sede.',
    ),
    ItemId.caffeine: ItemDef(
      id: ItemId.caffeine,
      name: 'Chá Forte',
      tier: ProductionTier.refining,
      category: ItemCategory.drug,
      baseValue: 45,
      energyBonus: 2,
      thirstCost: 10,
      description: '+Energia, -10 Sede.',
    ),
    ItemId.glowVodka: ItemDef(
      id: ItemId.glowVodka,
      name: 'Hidromel',
      tier: ProductionTier.manufacturing,
      category: ItemCategory.drug,
      baseValue: 80,
      energyBonus: 1,
      thirstCost: 8,
      description: '+Energia, -8 Sede.',
    ),

    // ============ Contrabando ============
    ItemId.stolenGoods: ItemDef(
      id: ItemId.stolenGoods,
      name: 'Espólio Roubado',
      tier: ProductionTier.basic,
      category: ItemCategory.contraband,
      baseValue: 95,
      legal: false,
      description: 'Só circula na Feira Furtiva.',
    ),
    ItemId.illegalWeapon: ItemDef(
      id: ItemId.illegalWeapon,
      name: 'Lâmina Proibida',
      tier: ProductionTier.manufacturing,
      category: ItemCategory.weapon,
      baseValue: 900,
      attackPower: 22,
      legal: false,
      description: 'Poder de rifle sem registro. Porte é crime.',
    ),
    ItemId.syntheticDrug: ItemDef(
      id: ItemId.syntheticDrug,
      name: 'Elixir Proibido',
      tier: ProductionTier.manufacturing,
      category: ItemCategory.drug,
      baseValue: 320,
      strengthBonus: 4,
      energyBonus: 3,
      thirstCost: 20,
      legal: false,
      description: 'Muito potente, muito ilegal, muito lucrativa.',
    ),
  };

  static ItemDef of(ItemId id) {
    final def = _defs[id];
    if (def == null) {
      throw StateError('Item sem definição no catálogo: $id');
    }
    return def;
  }

  static Iterable<ItemDef> get all => _defs.values;

  static List<ItemDef> byTier(ProductionTier tier) =>
      _defs.values.where((d) => d.tier == tier).toList(growable: false);

  static List<ItemDef> byCategory(ItemCategory category) =>
      _defs.values.where((d) => d.category == category).toList(growable: false);

  /// Itens que só podem ser negociados no Mercado Clandestino.
  static List<ItemDef> get illegal =>
      _defs.values.where((d) => !d.legal).toList(growable: false);
}
