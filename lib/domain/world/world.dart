import 'coords.dart';
import 'settlement.dart';
import 'tile.dart';
import 'world_gen.dart';

/// Um bloco de tiles já resolvidos, pronto para o renderizador consumir.
class WorldChunk {
  WorldChunk({required this.coord, required List<WorldTile> tiles})
      : _tiles = tiles,
        assert(
          tiles.length == WorldMetrics.chunkSize * WorldMetrics.chunkSize,
          'chunk deve ter chunkSize^2 tiles',
        );

  final ChunkCoord coord;
  final List<WorldTile> _tiles;

  WorldTile tileAt(int localX, int localY) =>
      _tiles[localY * WorldMetrics.chunkSize + localX];

  /// Itera os tiles em ordem de profundidade isométrica (do fundo para a
  /// frente), que é a ordem em que o renderizador precisa desenhar.
  Iterable<(TileCoord, WorldTile)> get tilesInDepthOrder sync* {
    final origin = coord.origin;
    const size = WorldMetrics.chunkSize;
    for (var sum = 0; sum <= (size - 1) * 2; sum++) {
      for (var ly = 0; ly < size; ly++) {
        final lx = sum - ly;
        if (lx < 0 || lx >= size) continue;
        yield (
          TileCoord(origin.x + lx, origin.y + ly),
          _tiles[ly * size + lx],
        );
      }
    }
  }
}

/// Fachada sobre o gerador: resolve tiles sob demanda e mantém um cache LRU de
/// chunks para que o pan da câmera não regenere ruído a cada frame.
class World {
  World({required this.generator, required this.layout});

  /// Cria o mundo de uma campanha nova a partir da seed.
  factory World.fromSeed(int seed) {
    final generator = WorldGenerator(seed: seed);
    return World(generator: generator, layout: generator.generateLayout());
  }

  /// Recria o mundo de uma campanha salva. O terreno é regenerado da seed; só
  /// o layout vem do save.
  factory World.restore({required int seed, required WorldLayout layout}) =>
      World(generator: WorldGenerator(seed: seed), layout: layout);

  final WorldGenerator generator;
  final WorldLayout layout;

  /// 256 chunks ~= 65k tiles. Cobre várias telas de pan em celular sem
  /// pressionar a memória.
  static const int _maxCachedChunks = 256;

  final Map<ChunkCoord, WorldChunk> _cache = {};
  final List<ChunkCoord> _lru = [];

  int get seed => generator.seed;

  WorldTile tileAt(int x, int y) {
    final coord = TileCoord(x, y);
    final chunk = chunkAt(coord.chunk);
    return chunk.tileAt(coord.localX, coord.localY);
  }

  WorldChunk chunkAt(ChunkCoord coord) {
    final cached = _cache[coord];
    if (cached != null) {
      _touch(coord);
      return cached;
    }

    final chunk = _generateChunk(coord);
    _cache[coord] = chunk;
    _lru.add(coord);
    _evictIfNeeded();
    return chunk;
  }

  void _touch(ChunkCoord coord) {
    _lru.remove(coord);
    _lru.add(coord);
  }

  void _evictIfNeeded() {
    while (_lru.length > _maxCachedChunks) {
      _cache.remove(_lru.removeAt(0));
    }
  }

  WorldChunk _generateChunk(ChunkCoord coord) {
    const size = WorldMetrics.chunkSize;
    final origin = coord.origin;
    final tiles = <WorldTile>[];
    for (var ly = 0; ly < size; ly++) {
      for (var lx = 0; lx < size; lx++) {
        tiles.add(generator.tileAt(origin.x + lx, origin.y + ly, layout));
      }
    }
    return WorldChunk(coord: coord, tiles: tiles);
  }

  /// Descarta o cache. Útil ao trocar de campanha.
  void clearCache() {
    _cache.clear();
    _lru.clear();
  }

  int get cachedChunkCount => _cache.length;

  // ---------------------------------------------------------------------------
  // Consultas de jogo
  // ---------------------------------------------------------------------------

  Settlement? settlementAt(TileCoord tile) => layout.settlementAt(tile);

  /// Assentamento mais próximo de um tile, em linha reta.
  Settlement nearestSettlement(TileCoord tile) {
    var best = layout.settlements.first;
    var bestDistance = double.infinity;
    for (final s in layout.settlements) {
      final d = tile.euclideanTo(s.center);
      if (d < bestDistance) {
        bestDistance = d;
        best = s;
      }
    }
    return best;
  }

  /// Recursos extraíveis num raio, agregados por item. Alimenta a tela de
  /// "o que dá para trabalhar por aqui".
  Map<String, double> surveyResources(TileCoord center, {int radius = 12}) {
    final totals = <String, double>{};
    for (var dy = -radius; dy <= radius; dy++) {
      for (var dx = -radius; dx <= radius; dx++) {
        final tile = tileAt(center.x + dx, center.y + dy);
        if (!tile.hasResource) continue;
        final key = tile.resource!.name;
        totals[key] = (totals[key] ?? 0) + tile.resourceRichness;
      }
    }
    return totals;
  }
}
