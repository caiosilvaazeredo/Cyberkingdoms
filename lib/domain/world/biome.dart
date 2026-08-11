import 'dart:ui' show Color;

import '../economy/item.dart';

/// Biomas do mundo. Cada um define o visual, quais recursos de Camada 1
/// (Extração) podem ser explorados ali, e o quanto custa atravessá-lo.
///
/// A escolha dos biomas segue a economia do GDD: petróleo, sucata, terras
/// raras, carne cultivada e biomassa precisam existir *em algum lugar* do mapa,
/// e a distribuição desigual é o que cria as rotas comerciais.
enum Biome {
  /// Núcleo urbano iluminado. Sem extração — é onde ficam mercado e política.
  neonCore(
    label: 'Cidadela',
    primary: Color(0xFF1B1F3A),
    accent: Color(0xFF00E5FF),
    travelCost: 1.0,
    resources: [],
  ),

  /// Cinturão de cortiços em volta das capitais. Mão de obra barata.
  sprawl(
    label: 'Arrabalde',
    primary: Color(0xFF241C2E),
    accent: Color(0xFFFF2D95),
    travelCost: 1.1,
    resources: [ItemId.scrap],
  ),

  /// Lixão. Fonte principal de sucata, e o trabalho público mais pesado.
  scrapyard(
    label: 'Pedreira',
    primary: Color(0xFF2E2A1F),
    accent: Color(0xFFFFB300),
    travelCost: 1.4,
    resources: [ItemId.scrap, ItemId.rareEarth],
  ),

  /// Campos de petróleo. Alto retorno, alto consumo de sede.
  oilFields(
    label: 'Veio de Breu',
    primary: Color(0xFF1A1614),
    accent: Color(0xFFFF6D00),
    travelCost: 1.3,
    resources: [ItemId.oil],
  ),

  /// Mina de terras raras. O recurso mais escasso e mais disputado.
  rareEarthMine(
    label: 'Veio de Prata',
    primary: Color(0xFF231A2E),
    accent: Color(0xFFB388FF),
    travelCost: 1.6,
    resources: [ItemId.rareEarth],
  ),

  /// Fazendas verticais e hidropônicos. Comida do servidor.
  bioFarm(
    label: 'Lavoura',
    primary: Color(0xFF13291F),
    accent: Color(0xFF00E676),
    travelCost: 1.0,
    resources: [ItemId.biomass, ItemId.culturedMeat],
  ),

  /// Mata reflorestada por corporações. Biomassa e cobertura para emboscadas.
  reclaimedForest(
    label: 'Floresta',
    primary: Color(0xFF14261C),
    accent: Color(0xFF69F0AE),
    travelCost: 1.5,
    resources: [ItemId.biomass],
  ),

  /// Pântano contaminado. Travessia cara, mas esconde contrabando.
  toxicMarsh(
    label: 'Charco',
    primary: Color(0xFF1B2A28),
    accent: Color(0xFF00BFA5),
    travelCost: 2.0,
    resources: [ItemId.biomass, ItemId.oil],
  ),

  /// Deserto de concreto. O vazio entre regiões.
  wasteland(
    label: 'Ermo',
    primary: Color(0xFF262024),
    accent: Color(0xFF8D6E63),
    travelCost: 1.7,
    resources: [ItemId.scrap],
  ),

  /// Ruínas do mundo pré-colapso. Loot raro, risco alto.
  ruins(
    label: 'Ruínas',
    primary: Color(0xFF2A2430),
    accent: Color(0xFFCE93D8),
    travelCost: 1.8,
    resources: [ItemId.scrap, ItemId.rareEarth],
  ),

  /// Água morta. Intransponível a pé.
  deadWater(
    label: 'Água Parada',
    primary: Color(0xFF0E1A2B),
    accent: Color(0xFF2979FF),
    travelCost: 999.0,
    resources: [],
  );

  const Biome({
    required this.label,
    required this.primary,
    required this.accent,
    required this.travelCost,
    required this.resources,
  });

  final String label;

  /// Cor de base usada no minimapa e no tint do terreno.
  final Color primary;

  /// Cor neon de destaque, usada em bordas e no HUD.
  final Color accent;

  /// Multiplicador de consumo de Fome/Sede ao atravessar este bioma.
  final double travelCost;

  /// Recursos de Camada 1 que podem ser extraídos aqui.
  final List<ItemId> resources;

  bool get isWalkable => travelCost < 100;

  /// Biomas onde faz sentido plantar uma cidade.
  bool get supportsSettlement =>
      isWalkable && this != Biome.toxicMarsh && this != Biome.ruins;
}
