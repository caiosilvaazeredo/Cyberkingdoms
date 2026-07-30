import 'dart:math' as math;

/// Coordenada de tile no mundo. O mundo é infinito nos dois eixos.
class TileCoord {
  const TileCoord(this.x, this.y);

  final int x;
  final int y;

  ChunkCoord get chunk => ChunkCoord(
        _floorDiv(x, WorldMetrics.chunkSize),
        _floorDiv(y, WorldMetrics.chunkSize),
      );

  /// Posição do tile dentro do seu chunk, sempre em `[0, chunkSize)`.
  int get localX => x - chunk.x * WorldMetrics.chunkSize;
  int get localY => y - chunk.y * WorldMetrics.chunkSize;

  TileCoord translate(int dx, int dy) => TileCoord(x + dx, y + dy);

  /// Distância de Chebyshev — o custo real de andar num grid com diagonais.
  int chebyshevTo(TileCoord other) =>
      math.max((x - other.x).abs(), (y - other.y).abs());

  double euclideanTo(TileCoord other) {
    final dx = (x - other.x).toDouble();
    final dy = (y - other.y).toDouble();
    return math.sqrt(dx * dx + dy * dy);
  }

  static int _floorDiv(int a, int b) => (a >= 0 ? a : a - b + 1) ~/ b;

  @override
  bool operator ==(Object other) =>
      other is TileCoord && other.x == x && other.y == y;

  @override
  int get hashCode => Object.hash(x, y);

  @override
  String toString() => 'Tile($x, $y)';

  Map<String, dynamic> toJson() => {'x': x, 'y': y};

  factory TileCoord.fromJson(Map<String, dynamic> json) =>
      TileCoord(json['x'] as int, json['y'] as int);
}

/// Coordenada de chunk. Chunks são geradas sob demanda e descartadas quando
/// saem do alcance da câmera — o terreno nunca é persistido porque é função
/// pura da seed.
class ChunkCoord {
  const ChunkCoord(this.x, this.y);

  final int x;
  final int y;

  TileCoord get origin =>
      TileCoord(x * WorldMetrics.chunkSize, y * WorldMetrics.chunkSize);

  ChunkCoord translate(int dx, int dy) => ChunkCoord(x + dx, y + dy);

  @override
  bool operator ==(Object other) =>
      other is ChunkCoord && other.x == x && other.y == y;

  @override
  int get hashCode => Object.hash(x, y, 'chunk');

  @override
  String toString() => 'Chunk($x, $y)';
}

/// Constantes que amarram geração, renderização e regras de jogo.
abstract final class WorldMetrics {
  /// Lado da chunk em tiles. 16 é o mesmo do Minecraft e cai bem em telas de
  /// celular: uma chunk inteira cabe na viewport em zoom médio.
  static const int chunkSize = 16;

  /// Largura do sprite de um tile em pixels lógicos. Os sprites foram
  /// renderizados em projeção 2:1, então a altura visual é metade disso.
  static const double tileWidth = 128;
  static const double tileHeight = 64;

  /// Quantos pixels de altura vale uma unidade de elevação do terreno.
  static const double elevationUnit = 16;

  /// Raio, em tiles, do mundo "jogável" onde as cidades são plantadas. Fora
  /// dele o terreno continua existindo (wasteland), mas sem assentamentos.
  static const int settledRadius = 900;
}

/// Projeção isométrica 2:1 entre grid e tela.
abstract final class IsoProjection {
  /// Converte coordenada de tile (com elevação) para pixels de mundo.
  ///
  /// O eixo X do grid cresce para a direita-e-baixo na tela, o Y para a
  /// esquerda-e-baixo. É a projeção "diamante" clássica.
  static (double, double) tileToWorld(double tx, double ty, {double elevation = 0}) {
    final wx = (tx - ty) * (WorldMetrics.tileWidth / 2);
    final wy = (tx + ty) * (WorldMetrics.tileHeight / 2) -
        elevation * WorldMetrics.elevationUnit;
    return (wx, wy);
  }

  /// Inverso de [tileToWorld] ignorando elevação — usado para descobrir qual
  /// tile o dedo do jogador tocou.
  static (double, double) worldToTile(double wx, double wy) {
    final halfW = WorldMetrics.tileWidth / 2;
    final halfH = WorldMetrics.tileHeight / 2;
    final tx = (wx / halfW + wy / halfH) / 2;
    final ty = (wy / halfH - wx / halfW) / 2;
    return (tx, ty);
  }

  /// Ordem de desenho: tiles com maior `x + y` ficam na frente. Como o
  /// renderizador usa prioridade inteira, escalamos para manter precisão em
  /// coordenadas grandes sem estourar o int.
  static int depthOf(int tx, int ty) => (tx + ty) * 8;
}
