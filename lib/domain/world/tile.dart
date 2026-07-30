import '../economy/item.dart';
import 'biome.dart';

/// O que ocupa visualmente um tile além do chão. O renderizador traduz isso
/// para um sprite Kenney; a lógica de jogo usa para saber se dá para andar,
/// trabalhar ou saquear ali.
/// O chão nunca aparece aqui: **todo tile do mundo é mato**. O que muda de um
/// bioma para outro é a espécie da vegetação, a densidade e o tom — não o
/// pavimento. Não existem estradas nem rodovias no terreno; as rotas entre
/// cidades são uma abstração da `WorldLayout`, percorridas pela tela de viagem,
/// não pisadas tile a tile.
enum TileFeature {
  none,

  // Vegetação
  tree,
  denseTree,
  deadTree,
  bush,
  grassTuft,
  flowers,
  mushroom,
  stump,
  fallenLog,
  crops,
  cactus,
  lily,

  // Relevo
  rock,
  boulder,
  cliff,

  // Ocupação humana
  rubble,
  scrapPile,
  oilPump,
  building,
  tower,
  wall,
  fence,
  crate,
  extractionRig,
  marketStall,
  camp,
  campfire,
  wreck;

  /// Só o que um corpo não atravessa. Mato alto, flores e cogumelos são
  /// cenário: bloquear tudo que é vegetação transformaria a floresta num
  /// labirinto que o jogador não enxerga.
  bool get blocksMovement =>
      this == TileFeature.building ||
      this == TileFeature.tower ||
      this == TileFeature.wall ||
      this == TileFeature.denseTree ||
      this == TileFeature.boulder ||
      this == TileFeature.cliff;
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
  ///
  /// Não há mais bônus de estrada: o terreno é mato de ponta a ponta. Viajar
  /// depressa entre cidades continua existindo, mas pela rota da `WorldLayout`,
  /// que é uma decisão da tela de viagem — não uma faixa de asfalto no chão.
  double get travelCost {
    if (!isWalkable) return double.infinity;
    final slopePenalty = 1 + (elevation.abs() * 0.04);
    // Mato fechado atrasa quem corta caminho por dentro dele.
    final brushPenalty = switch (feature) {
      TileFeature.tree || TileFeature.bush || TileFeature.crops => 1.15,
      TileFeature.grassTuft => 1.05,
      _ => 1.0,
    };
    return biome.travelCost * slopePenalty * brushPenalty;
  }
}
