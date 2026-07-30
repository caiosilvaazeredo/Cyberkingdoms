import '../economy/item.dart';
import 'biome.dart';

/// O que ocupa visualmente um tile além do chão. O renderizador traduz isso
/// para um sprite Kenney; a lógica de jogo usa para saber se dá para andar,
/// trabalhar ou saquear ali.
enum TileFeature {
  none,
  tree,
  denseTree,
  rock,
  rubble,
  scrapPile,
  oilPump,
  building,
  tower,
  wall,
  road,
  roadJunction,
  fence,
  crate,
  extractionRig,
  marketStall;

  bool get blocksMovement =>
      this == TileFeature.building ||
      this == TileFeature.tower ||
      this == TileFeature.wall ||
      this == TileFeature.denseTree ||
      this == TileFeature.rock;

  bool get isRoad => this == TileFeature.road || this == TileFeature.roadJunction;
}

/// Um tile totalmente resolvido. É um value object barato: gerado sob demanda
/// e descartado quando a chunk sai de vista.
class WorldTile {
  const WorldTile({
    required this.biome,
    required this.elevation,
    required this.feature,
    this.settlementId,
    this.resource,
    this.resourceRichness = 0,
  });

  final Biome biome;

  /// Altura em unidades de elevação. Usada tanto no visual (deslocamento
  /// vertical do sprite) quanto no custo de travessia.
  final int elevation;

  final TileFeature feature;

  /// Id do assentamento que ocupa este tile, se houver.
  final String? settlementId;

  /// Recurso de Camada 1 extraível aqui.
  final ItemId? resource;

  /// 0..1. Multiplica o rendimento de um dia de trabalho neste tile.
  final double resourceRichness;

  bool get isWalkable => biome.isWalkable && !feature.blocksMovement;

  bool get isUrban => settlementId != null;

  bool get hasResource => resource != null && resourceRichness > 0;

  /// Custo de atravessar este tile, combinando bioma e relevo.
  double get travelCost {
    if (!isWalkable) return double.infinity;
    final slopePenalty = 1 + (elevation.abs() * 0.04);
    final roadBonus = feature.isRoad ? 0.5 : 1.0;
    return biome.travelCost * slopePenalty * roadBonus;
  }
}
