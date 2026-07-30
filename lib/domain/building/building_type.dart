import '../character/attributes.dart';
import '../economy/item.dart';
import '../economy/recipe.dart';

/// Agrupamento das construções por função. Serve para organizar o catálogo na
/// UI e para regras que valem por categoria inteira.
enum BuildingCategory {
  housing('Moradia', 'Aumenta população e conforto do terreno.'),
  extraction('Extração', 'Camada 1: tira matéria-prima do solo.'),
  refining('Refino', 'Camada 2: transforma bruto em componente.'),
  manufacturing('Manufatura', 'Camada 3: produz o equipamento final.'),
  commerce('Comércio', 'Vende, estoca e escoa a produção.'),
  infrastructure('Infraestrutura', 'Sustenta o resto do terreno.'),
  defense('Defesa', 'Protege contra assaltos e milícias.'),
  civic('Social', 'Status, política e organização.');

  const BuildingCategory(this.label, this.description);
  final String label;
  final String description;
}

/// Identificadores estáveis das construções. **Nunca renomeie** um valor:
/// eles vão para o save e para o Firestore.
enum BuildingId {
  // Moradia
  shack,
  capsuleBlock,
  apartment,
  penthouse,

  // Extração
  oilDerrick,
  scrapYard,
  rareEarthShaft,
  hydroponicBay,
  bioreactor,
  biomassField,
  waterReclaimer,

  // Refino
  refinery,
  textileWorkshop,
  hardwareWorkshop,
  chemLab,
  foundry,

  // Manufatura
  gunsmithy,
  droneAssembly,
  implantClinic,
  industrialKitchen,
  tailorShop,

  // Comércio
  shopFront,
  warehouse,
  tradingPost,
  auctionHouse,
  blackMarketStall,

  // Infraestrutura
  generator,
  waterTower,
  commsAntenna,
  garage,
  greenhouse,
  wastePlant,

  // Defesa
  perimeterWall,
  watchtower,
  armoredGate,
  bunker,

  // Social
  plaza,
  bar,
  fightPit,
  militiaHall,
  committeeHall;
}

/// Definição imutável de um tipo de construção.
class BuildingDef {
  const BuildingDef({
    required this.id,
    required this.name,
    required this.category,
    required this.width,
    required this.height,
    required this.creditCost,
    required this.materialCost,
    required this.buildDays,
    required this.spriteId,
    this.requiredLevel = CitizenLevel.survivor,
    this.jobSlots = 0,
    this.produces,
    this.outputPerDay = 0,
    this.consumes = const {},
    this.unlocksStation,
    this.storageBonus = 0,
    this.defenseBonus = 0,
    this.statusBonus = 0,
    this.populationCapacity = 0,
    this.dailyUpkeep = 0,
    this.hungerUpkeepModifier = 0,
    this.thirstUpkeepModifier = 0,
    this.legal = true,
    required this.description,
  });

  final BuildingId id;
  final String name;
  final BuildingCategory category;

  /// Footprint em tiles do terreno.
  final int width;
  final int height;

  final int creditCost;

  /// Materiais consumidos na construção.
  final Map<ItemId, int> materialCost;

  /// Resets até ficar pronta.
  final int buildDays;

  /// Sprite Kenney usado no render isométrico.
  final String spriteId;

  final CitizenLevel requiredLevel;

  /// Vagas de emprego que a construção abre. É o que permite ao jogador
  /// "contratar funcionários" no Nível 2 do GDD.
  final int jobSlots;

  /// O que produz por dia, se produzir sozinha.
  final ItemId? produces;
  final int outputPerDay;

  /// Insumos que a produção diária consome.
  final Map<ItemId, int> consumes;

  /// Estação de fabricação que a construção destrava no terreno.
  final CraftStation? unlocksStation;

  final int storageBonus;
  final int defenseBonus;
  final int statusBonus;
  final int populationCapacity;

  /// Créditos por dia para manter a construção funcionando. Prédio parado por
  /// falta de caixa não produz.
  final int dailyUpkeep;

  /// Modificadores de consumo enquanto o jogador estiver no próprio terreno.
  final double hungerUpkeepModifier;
  final double thirstUpkeepModifier;

  /// `false` = construir isso é crime; o governo pode confiscar.
  final bool legal;

  final String description;

  int get tileArea => width * height;

  bool get isProducer => produces != null && outputPerDay > 0;
}

/// Catálogo das construções. São 40 tipos, cobrindo as três camadas
/// produtivas, comércio, infraestrutura, defesa e vida social — o suficiente
/// para que dois terrenos do mesmo nível pareçam decisões diferentes.
abstract final class BuildingCatalog {
  static const Map<BuildingId, BuildingDef> _defs = {
    // ======================= MORADIA =======================
    BuildingId.shack: BuildingDef(
      id: BuildingId.shack,
      name: 'Barraco',
      category: BuildingCategory.housing,
      width: 1, height: 1,
      creditCost: 120,
      materialCost: {ItemId.scrap: 6},
      buildDays: 1,
      spriteId: 'miniforest/building-structure',
      populationCapacity: 2,
      description: 'Abrigo mínimo. Todo terreno começa por aqui.',
    ),
    BuildingId.capsuleBlock: BuildingDef(
      id: BuildingId.capsuleBlock,
      name: 'Bloco de Cápsulas',
      category: BuildingCategory.housing,
      width: 2, height: 1,
      creditCost: 900,
      materialCost: {ItemId.scrap: 20, ItemId.polymer: 6},
      buildDays: 2,
      spriteId: 'city/building-small-b',
      requiredLevel: CitizenLevel.farmer,
      populationCapacity: 8,
      dailyUpkeep: 6,
      description: 'Dormitório vertical barato. Aloja a mão de obra.',
    ),
    BuildingId.apartment: BuildingDef(
      id: BuildingId.apartment,
      name: 'Edifício Residencial',
      category: BuildingCategory.housing,
      width: 2, height: 2,
      creditCost: 3600,
      materialCost: {ItemId.polymer: 24, ItemId.circuitBoard: 6},
      buildDays: 4,
      spriteId: 'city/building-small-a',
      requiredLevel: CitizenLevel.industrialist,
      populationCapacity: 24,
      statusBonus: 1,
      dailyUpkeep: 20,
      description: 'Moradia de verdade. Atrai trabalhadores melhores.',
    ),
    BuildingId.penthouse: BuildingDef(
      id: BuildingId.penthouse,
      name: 'Cobertura Corporativa',
      category: BuildingCategory.housing,
      width: 2, height: 2,
      creditCost: 14000,
      materialCost: {ItemId.chip: 8, ItemId.polymer: 40, ItemId.clothing: 6},
      buildDays: 6,
      spriteId: 'castlekit/tower-square-top-roof-high-windows',
      requiredLevel: CitizenLevel.elite,
      populationCapacity: 4,
      statusBonus: 6,
      dailyUpkeep: 90,
      description: 'Endereço de elite. Status alto pesa em eleição.',
    ),

    // ======================= EXTRAÇÃO =======================
    BuildingId.oilDerrick: BuildingDef(
      id: BuildingId.oilDerrick,
      name: 'Torre de Petróleo',
      category: BuildingCategory.extraction,
      width: 2, height: 2,
      creditCost: 2400,
      materialCost: {ItemId.scrap: 30, ItemId.polymer: 8},
      buildDays: 3,
      spriteId: 'minidungeon/wood-structure',
      requiredLevel: CitizenLevel.farmer,
      jobSlots: 4,
      produces: ItemId.oil,
      outputPerDay: 8,
      dailyUpkeep: 30,
      description: 'Só funciona se o terreno estiver sobre campo de petróleo.',
    ),
    BuildingId.scrapYard: BuildingDef(
      id: BuildingId.scrapYard,
      name: 'Pátio de Sucata',
      category: BuildingCategory.extraction,
      width: 2, height: 2,
      creditCost: 700,
      materialCost: {ItemId.scrap: 10},
      buildDays: 1,
      spriteId: 'castlekit/siege-catapult-demolished',
      jobSlots: 3,
      produces: ItemId.scrap,
      outputPerDay: 12,
      dailyUpkeep: 8,
      description: 'Reciclagem bruta. Barato e sempre útil.',
    ),
    BuildingId.rareEarthShaft: BuildingDef(
      id: BuildingId.rareEarthShaft,
      name: 'Poço de Terras Raras',
      category: BuildingCategory.extraction,
      width: 2, height: 2,
      creditCost: 6200,
      materialCost: {ItemId.scrap: 40, ItemId.circuitBoard: 6},
      buildDays: 5,
      spriteId: 'minidungeon/stairs',
      requiredLevel: CitizenLevel.industrialist,
      jobSlots: 6,
      produces: ItemId.rareEarth,
      outputPerDay: 4,
      dailyUpkeep: 80,
      description: 'O gargalo da economia. Quem controla isso, controla chips.',
    ),
    BuildingId.hydroponicBay: BuildingDef(
      id: BuildingId.hydroponicBay,
      name: 'Estufa Hidropônica',
      category: BuildingCategory.extraction,
      width: 2, height: 1,
      creditCost: 800,
      materialCost: {ItemId.polymer: 8, ItemId.scrap: 8},
      buildDays: 2,
      spriteId: 'city/grass-trees',
      jobSlots: 2,
      produces: ItemId.biomass,
      outputPerDay: 10,
      consumes: {ItemId.water: 2},
      dailyUpkeep: 10,
      description: 'Consome água e devolve biomassa.',
    ),
    BuildingId.bioreactor: BuildingDef(
      id: BuildingId.bioreactor,
      name: 'Biorreator',
      category: BuildingCategory.extraction,
      width: 2, height: 2,
      creditCost: 3200,
      materialCost: {ItemId.polymer: 18, ItemId.catalyst: 4},
      buildDays: 3,
      spriteId: 'castlekit/tower-hexagon-mid',
      requiredLevel: CitizenLevel.farmer,
      jobSlots: 3,
      produces: ItemId.culturedMeat,
      outputPerDay: 6,
      consumes: {ItemId.biomass: 4},
      dailyUpkeep: 35,
      description: 'Carne cultivada — base das refeições industriais.',
    ),
    BuildingId.biomassField: BuildingDef(
      id: BuildingId.biomassField,
      name: 'Campo de Biomassa',
      category: BuildingCategory.extraction,
      width: 3, height: 2,
      creditCost: 500,
      materialCost: {ItemId.scrap: 4},
      buildDays: 1,
      spriteId: 'miniforest/patch-dirt',
      jobSlots: 2,
      produces: ItemId.biomass,
      outputPerDay: 7,
      dailyUpkeep: 4,
      description: 'Ocupa muito espaço, custa quase nada.',
    ),
    BuildingId.waterReclaimer: BuildingDef(
      id: BuildingId.waterReclaimer,
      name: 'Recuperador de Água',
      category: BuildingCategory.extraction,
      width: 1, height: 1,
      creditCost: 1100,
      materialCost: {ItemId.polymer: 10, ItemId.circuitBoard: 2},
      buildDays: 2,
      spriteId: 'minidungeon/barrel',
      jobSlots: 1,
      produces: ItemId.water,
      outputPerDay: 9,
      dailyUpkeep: 14,
      description: 'Água é o item mais negociado do servidor.',
    ),

    // ======================= REFINO =======================
    BuildingId.refinery: BuildingDef(
      id: BuildingId.refinery,
      name: 'Refinaria',
      category: BuildingCategory.refining,
      width: 3, height: 2,
      creditCost: 4800,
      materialCost: {ItemId.scrap: 40, ItemId.polymer: 12},
      buildDays: 4,
      spriteId: 'castlekit/siege-tower',
      requiredLevel: CitizenLevel.farmer,
      jobSlots: 5,
      unlocksStation: CraftStation.refinery,
      dailyUpkeep: 55,
      description: 'Destrava as receitas de polímero, placa e chip.',
    ),
    BuildingId.textileWorkshop: BuildingDef(
      id: BuildingId.textileWorkshop,
      name: 'Oficina de Tecidos',
      category: BuildingCategory.refining,
      width: 2, height: 1,
      creditCost: 1400,
      materialCost: {ItemId.scrap: 12, ItemId.biomass: 8},
      buildDays: 2,
      spriteId: 'city/building-small-c',
      jobSlots: 3,
      unlocksStation: CraftStation.textileWorkshop,
      dailyUpkeep: 18,
      description: 'Tecido sintético, roupas e mochilas.',
    ),
    BuildingId.hardwareWorkshop: BuildingDef(
      id: BuildingId.hardwareWorkshop,
      name: 'Oficina de Hardware',
      category: BuildingCategory.refining,
      width: 2, height: 2,
      creditCost: 5200,
      materialCost: {ItemId.circuitBoard: 10, ItemId.polymer: 14},
      buildDays: 4,
      spriteId: 'city/building-small-d',
      requiredLevel: CitizenLevel.industrialist,
      jobSlots: 5,
      unlocksStation: CraftStation.hardwareWorkshop,
      dailyUpkeep: 60,
      description: 'Onde drones e eletrônica pesada são montados.',
    ),
    BuildingId.chemLab: BuildingDef(
      id: BuildingId.chemLab,
      name: 'Laboratório Químico',
      category: BuildingCategory.refining,
      width: 2, height: 2,
      creditCost: 4400,
      materialCost: {ItemId.polymer: 16, ItemId.chip: 2},
      buildDays: 4,
      spriteId: 'castlekit/tower-hexagon-base',
      requiredLevel: CitizenLevel.farmer,
      jobSlots: 4,
      unlocksStation: CraftStation.laboratory,
      dailyUpkeep: 50,
      description: 'Catalisadores, implantes — e, se quiser, drogas.',
    ),
    BuildingId.foundry: BuildingDef(
      id: BuildingId.foundry,
      name: 'Fundição',
      category: BuildingCategory.refining,
      width: 3, height: 2,
      creditCost: 3900,
      materialCost: {ItemId.scrap: 50},
      buildDays: 3,
      spriteId: 'minidungeon/wall-opening',
      requiredLevel: CitizenLevel.farmer,
      jobSlots: 5,
      produces: ItemId.circuitBoard,
      outputPerDay: 3,
      consumes: {ItemId.scrap: 8, ItemId.polymer: 2},
      dailyUpkeep: 45,
      description: 'Converte sucata em placa sem precisar de refinaria.',
    ),

    // ======================= MANUFATURA =======================
    BuildingId.gunsmithy: BuildingDef(
      id: BuildingId.gunsmithy,
      name: 'Armeiro',
      category: BuildingCategory.manufacturing,
      width: 2, height: 1,
      creditCost: 6800,
      materialCost: {ItemId.circuitBoard: 12, ItemId.scrap: 30},
      buildDays: 4,
      spriteId: 'arena/weapon-rack',
      requiredLevel: CitizenLevel.industrialist,
      jobSlots: 4,
      unlocksStation: CraftStation.gunsmith,
      dailyUpkeep: 70,
      description: 'Pistolas, rifles — e armas sem registro.',
    ),
    BuildingId.droneAssembly: BuildingDef(
      id: BuildingId.droneAssembly,
      name: 'Montadora de Drones',
      category: BuildingCategory.manufacturing,
      width: 3, height: 2,
      creditCost: 18000,
      materialCost: {ItemId.chip: 12, ItemId.circuitBoard: 20, ItemId.polymer: 30},
      buildDays: 7,
      spriteId: 'castlekit/tower-slant-roof',
      requiredLevel: CitizenLevel.elite,
      jobSlots: 8,
      produces: ItemId.drone,
      outputPerDay: 1,
      consumes: {ItemId.chip: 2, ItemId.circuitBoard: 3, ItemId.polymer: 4},
      dailyUpkeep: 220,
      description: 'Drone por dia. É o que decide guerra de milícia.',
    ),
    BuildingId.implantClinic: BuildingDef(
      id: BuildingId.implantClinic,
      name: 'Clínica de Implantes',
      category: BuildingCategory.manufacturing,
      width: 2, height: 2,
      creditCost: 22000,
      materialCost: {ItemId.chip: 16, ItemId.catalyst: 10, ItemId.culturedMeat: 20},
      buildDays: 8,
      spriteId: 'castlekit/tower-square-mid-door',
      requiredLevel: CitizenLevel.elite,
      jobSlots: 6,
      statusBonus: 3,
      unlocksStation: CraftStation.laboratory,
      dailyUpkeep: 260,
      description: 'Endgame do GDD: implantes ciberneticos.',
    ),
    BuildingId.industrialKitchen: BuildingDef(
      id: BuildingId.industrialKitchen,
      name: 'Cozinha Industrial',
      category: BuildingCategory.manufacturing,
      width: 2, height: 2,
      creditCost: 2600,
      materialCost: {ItemId.scrap: 18, ItemId.polymer: 8},
      buildDays: 3,
      spriteId: 'castlekit/tower-square-mid-color',
      jobSlots: 4,
      unlocksStation: CraftStation.kitchen,
      produces: ItemId.rationPack,
      outputPerDay: 5,
      consumes: {ItemId.culturedMeat: 2, ItemId.biomass: 2},
      dailyUpkeep: 30,
      description: 'Comida é demanda contínua — todo mundo precisa comer.',
    ),
    BuildingId.tailorShop: BuildingDef(
      id: BuildingId.tailorShop,
      name: 'Alfaiataria',
      category: BuildingCategory.manufacturing,
      width: 1, height: 1,
      creditCost: 2000,
      materialCost: {ItemId.fabric: 12},
      buildDays: 2,
      spriteId: 'castlekit/tower-square-mid',
      requiredLevel: CitizenLevel.farmer,
      jobSlots: 2,
      produces: ItemId.clothing,
      outputPerDay: 2,
      consumes: {ItemId.fabric: 3},
      statusBonus: 1,
      dailyUpkeep: 22,
      description: 'Roupa boa dá Status, e Status dá voto.',
    ),

    // ======================= COMÉRCIO =======================
    BuildingId.shopFront: BuildingDef(
      id: BuildingId.shopFront,
      name: 'Loja',
      category: BuildingCategory.commerce,
      width: 1, height: 1,
      creditCost: 900,
      materialCost: {ItemId.scrap: 8, ItemId.polymer: 4},
      buildDays: 2,
      spriteId: 'miniforest/tent',
      jobSlots: 2,
      storageBonus: 40,
      dailyUpkeep: 12,
      description: 'Ponto de venda no terreno. Escoa a produção.',
    ),
    BuildingId.warehouse: BuildingDef(
      id: BuildingId.warehouse,
      name: 'Armazém',
      category: BuildingCategory.commerce,
      width: 3, height: 2,
      creditCost: 2200,
      materialCost: {ItemId.scrap: 26, ItemId.polymer: 10},
      buildDays: 3,
      spriteId: 'city/building-garage',
      jobSlots: 1,
      storageBonus: 250,
      dailyUpkeep: 16,
      description: 'Sem estoque não há especulação de preço.',
    ),
    BuildingId.tradingPost: BuildingDef(
      id: BuildingId.tradingPost,
      name: 'Entreposto',
      category: BuildingCategory.commerce,
      width: 2, height: 2,
      creditCost: 5400,
      materialCost: {ItemId.polymer: 16, ItemId.circuitBoard: 6},
      buildDays: 4,
      spriteId: 'castlekit/tower-square-arch',
      requiredLevel: CitizenLevel.industrialist,
      jobSlots: 4,
      storageBonus: 120,
      statusBonus: 1,
      dailyUpkeep: 65,
      description: 'Reduz o custo de negociar entre cidades.',
    ),
    BuildingId.auctionHouse: BuildingDef(
      id: BuildingId.auctionHouse,
      name: 'Casa de Leilões',
      category: BuildingCategory.commerce,
      width: 2, height: 2,
      creditCost: 12000,
      materialCost: {ItemId.chip: 6, ItemId.clothing: 8, ItemId.polymer: 20},
      buildDays: 6,
      spriteId: 'castlekit/tower-square-mid-windows',
      requiredLevel: CitizenLevel.elite,
      jobSlots: 5,
      statusBonus: 4,
      storageBonus: 80,
      dailyUpkeep: 150,
      description: 'Onde os cartéis fecham negócio B2B.',
    ),
    BuildingId.blackMarketStall: BuildingDef(
      id: BuildingId.blackMarketStall,
      name: 'Banca Clandestina',
      category: BuildingCategory.commerce,
      width: 1, height: 1,
      creditCost: 3000,
      materialCost: {ItemId.scrap: 14, ItemId.fabric: 6},
      buildDays: 2,
      spriteId: 'minidungeon/gate',
      requiredLevel: CitizenLevel.farmer,
      jobSlots: 2,
      storageBonus: 60,
      dailyUpkeep: 40,
      legal: false,
      description: 'Escoa contrabando. Se o governo achar, confisca.',
    ),

    // ======================= INFRAESTRUTURA =======================
    BuildingId.generator: BuildingDef(
      id: BuildingId.generator,
      name: 'Gerador',
      category: BuildingCategory.infrastructure,
      width: 1, height: 1,
      creditCost: 1600,
      materialCost: {ItemId.scrap: 16, ItemId.circuitBoard: 3},
      buildDays: 2,
      spriteId: 'castlekit/wall-pillar',
      jobSlots: 1,
      consumes: {ItemId.oil: 2},
      dailyUpkeep: 5,
      description: 'Queima petróleo. Sem energia, oficina para.',
    ),
    BuildingId.waterTower: BuildingDef(
      id: BuildingId.waterTower,
      name: 'Torre de Água',
      category: BuildingCategory.infrastructure,
      width: 1, height: 1,
      creditCost: 1900,
      materialCost: {ItemId.scrap: 20, ItemId.polymer: 6},
      buildDays: 3,
      spriteId: 'castlekit/tower-base',
      thirstUpkeepModifier: -0.15,
      dailyUpkeep: 12,
      description: '-15% de consumo de Sede enquanto você estiver no terreno.',
    ),
    BuildingId.commsAntenna: BuildingDef(
      id: BuildingId.commsAntenna,
      name: 'Antena de Comunicação',
      category: BuildingCategory.infrastructure,
      width: 1, height: 1,
      creditCost: 4200,
      materialCost: {ItemId.chip: 4, ItemId.circuitBoard: 8},
      buildDays: 3,
      spriteId: 'castlekit/flag',
      requiredLevel: CitizenLevel.industrialist,
      statusBonus: 2,
      dailyUpkeep: 48,
      description: 'Acompanha preços de outras capitais em tempo real.',
    ),
    BuildingId.garage: BuildingDef(
      id: BuildingId.garage,
      name: 'Garagem',
      category: BuildingCategory.infrastructure,
      width: 2, height: 1,
      creditCost: 1500,
      materialCost: {ItemId.scrap: 18, ItemId.polymer: 6},
      buildDays: 2,
      spriteId: 'miniforest/building-platform',
      jobSlots: 1,
      storageBonus: 60,
      dailyUpkeep: 14,
      description: 'Reduz o tempo de viagem pelas estradas.',
    ),
    BuildingId.greenhouse: BuildingDef(
      id: BuildingId.greenhouse,
      name: 'Estufa',
      category: BuildingCategory.infrastructure,
      width: 2, height: 2,
      creditCost: 2100,
      materialCost: {ItemId.polymer: 14, ItemId.fabric: 6},
      buildDays: 3,
      spriteId: 'city/grass-trees-tall',
      jobSlots: 2,
      hungerUpkeepModifier: -0.12,
      produces: ItemId.biomass,
      outputPerDay: 4,
      dailyUpkeep: 20,
      description: '-12% de consumo de Fome e um pouco de biomassa.',
    ),
    BuildingId.wastePlant: BuildingDef(
      id: BuildingId.wastePlant,
      name: 'Usina de Resíduos',
      category: BuildingCategory.infrastructure,
      width: 2, height: 2,
      creditCost: 3400,
      materialCost: {ItemId.scrap: 34, ItemId.catalyst: 4},
      buildDays: 4,
      spriteId: 'castlekit/wall-corner-half-tower',
      requiredLevel: CitizenLevel.farmer,
      jobSlots: 3,
      produces: ItemId.scrap,
      outputPerDay: 9,
      consumes: {ItemId.biomass: 3},
      dailyUpkeep: 26,
      description: 'Fecha o ciclo: lixo orgânico vira metal reaproveitado.',
    ),

    // ======================= DEFESA =======================
    BuildingId.perimeterWall: BuildingDef(
      id: BuildingId.perimeterWall,
      name: 'Muro de Perímetro',
      category: BuildingCategory.defense,
      width: 1, height: 1,
      creditCost: 260,
      materialCost: {ItemId.scrap: 8},
      buildDays: 1,
      spriteId: 'castlekit/wall',
      defenseBonus: 2,
      description: 'Barato. Colocar vários é o ponto.',
    ),
    BuildingId.watchtower: BuildingDef(
      id: BuildingId.watchtower,
      name: 'Torre de Vigia',
      category: BuildingCategory.defense,
      width: 1, height: 1,
      creditCost: 1800,
      materialCost: {ItemId.scrap: 16, ItemId.circuitBoard: 3},
      buildDays: 2,
      spriteId: 'castlekit/tower-square-mid-open',
      jobSlots: 2,
      defenseBonus: 10,
      dailyUpkeep: 24,
      description: 'Reduz a chance de assalto ao terreno.',
    ),
    BuildingId.armoredGate: BuildingDef(
      id: BuildingId.armoredGate,
      name: 'Portão Blindado',
      category: BuildingCategory.defense,
      width: 2, height: 1,
      creditCost: 2600,
      materialCost: {ItemId.scrap: 24, ItemId.polymer: 10},
      buildDays: 3,
      spriteId: 'castlekit/metal-gate',
      requiredLevel: CitizenLevel.farmer,
      defenseBonus: 16,
      dailyUpkeep: 20,
      description: 'A entrada é o ponto fraco de qualquer terreno.',
    ),
    BuildingId.bunker: BuildingDef(
      id: BuildingId.bunker,
      name: 'Bunker',
      category: BuildingCategory.defense,
      width: 2, height: 2,
      creditCost: 9000,
      materialCost: {ItemId.scrap: 60, ItemId.polymer: 24, ItemId.circuitBoard: 8},
      buildDays: 6,
      spriteId: 'minidungeon/wall',
      requiredLevel: CitizenLevel.industrialist,
      defenseBonus: 40,
      storageBonus: 100,
      dailyUpkeep: 85,
      description: 'Protege o estoque mesmo num golpe de estado.',
    ),

    // ======================= SOCIAL =======================
    BuildingId.plaza: BuildingDef(
      id: BuildingId.plaza,
      name: 'Praça',
      category: BuildingCategory.civic,
      width: 2, height: 2,
      creditCost: 1200,
      materialCost: {ItemId.scrap: 10, ItemId.biomass: 8},
      buildDays: 2,
      spriteId: 'city/pavement-fountain',
      statusBonus: 2,
      dailyUpkeep: 10,
      description: 'Aparência pública. Ajuda em eleição.',
    ),
    BuildingId.bar: BuildingDef(
      id: BuildingId.bar,
      name: 'Bar',
      category: BuildingCategory.civic,
      width: 1, height: 1,
      creditCost: 2400,
      materialCost: {ItemId.polymer: 10, ItemId.fabric: 8},
      buildDays: 2,
      spriteId: 'minidungeon/table',
      jobSlots: 3,
      statusBonus: 2,
      produces: ItemId.glowVodka,
      outputPerDay: 3,
      consumes: {ItemId.biomass: 2},
      dailyUpkeep: 30,
      description: 'Onde os contratos B2B realmente são fechados.',
    ),
    BuildingId.fightPit: BuildingDef(
      id: BuildingId.fightPit,
      name: 'Arena de Combate',
      category: BuildingCategory.civic,
      width: 3, height: 3,
      creditCost: 8500,
      materialCost: {ItemId.scrap: 50, ItemId.polymer: 20},
      buildDays: 5,
      spriteId: 'arena/floor-detail',
      requiredLevel: CitizenLevel.industrialist,
      jobSlots: 4,
      statusBonus: 5,
      defenseBonus: 6,
      dailyUpkeep: 95,
      description: 'Renda de apostas e reputação de rua.',
    ),
    BuildingId.militiaHall: BuildingDef(
      id: BuildingId.militiaHall,
      name: 'Sede de Milícia',
      category: BuildingCategory.civic,
      width: 2, height: 2,
      creditCost: 11000,
      materialCost: {ItemId.scrap: 45, ItemId.pistol: 4, ItemId.circuitBoard: 10},
      buildDays: 6,
      spriteId: 'castlekit/tower-square-base-border',
      requiredLevel: CitizenLevel.elite,
      jobSlots: 10,
      defenseBonus: 35,
      statusBonus: 3,
      dailyUpkeep: 180,
      description: 'Recruta milícia própria — ou o braço armado da rebelião.',
    ),
    BuildingId.committeeHall: BuildingDef(
      id: BuildingId.committeeHall,
      name: 'Sede do Comitê',
      category: BuildingCategory.civic,
      width: 2, height: 2,
      creditCost: 7200,
      materialCost: {ItemId.polymer: 22, ItemId.chip: 3},
      buildDays: 5,
      spriteId: 'castlekit/tower-square-base-color',
      requiredLevel: CitizenLevel.industrialist,
      jobSlots: 4,
      statusBonus: 4,
      dailyUpkeep: 70,
      legal: false,
      description: 'Organiza o Comitê Revolucionário. Ilegal, obviamente.',
    ),
  };

  static BuildingDef of(BuildingId id) {
    final def = _defs[id];
    if (def == null) {
      throw StateError('Construção sem definição no catálogo: $id');
    }
    return def;
  }

  static Iterable<BuildingDef> get all => _defs.values;

  static int get count => _defs.length;

  static List<BuildingDef> byCategory(BuildingCategory category) =>
      _defs.values.where((d) => d.category == category).toList(growable: false);

  static List<BuildingDef> availableAt(CitizenLevel level) => _defs.values
      .where((d) => d.requiredLevel.rank <= level.rank)
      .toList(growable: false);

  static BuildingId? parse(String name) {
    for (final id in BuildingId.values) {
      if (id.name == name) return id;
    }
    return null;
  }
}
