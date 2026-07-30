import 'dart:convert';

import 'package:flame/cache.dart';
import 'package:flame/flame.dart';
import 'package:flutter/services.dart' show rootBundle;

import '../domain/world/biome.dart';
import '../domain/world/tile.dart';

/// Metadados de um sprite pré-renderizado.
///
/// Os sprites vêm dos kits 3D da Kenney (Castle Kit, Mini Dungeon, Mini Forest,
/// e os modelos dos dois starter kits) renderizados offline em projeção
/// isométrica 2:1. Guardamos o tamanho original do modelo para conseguir
/// ancorar cada sprite corretamente sobre o losango do tile.
class SpriteMeta {
  const SpriteMeta({
    required this.id,
    required this.kit,
    required this.name,
    required this.file,
    required this.sizeX,
    required this.sizeY,
    required this.sizeZ,
    required this.baseY,
  });

  final String id;
  final String kit;
  final String name;
  final String file;

  /// Dimensões do modelo 3D original, em unidades de Blender.
  final double sizeX;
  final double sizeY;
  final double sizeZ;

  /// Onde o plano do chão do modelo cai na imagem, em `[0, 1]` de cima para
  /// baixo. É o que permite alinhar a base do prédio com o tile.
  final double baseY;

  /// Quantos tiles de largura o modelo ocupa. Os kits da Kenney usam 1 unidade
  /// = 1 tile, então arredondar para cima dá a footprint correta.
  int get footprint => sizeX.ceil().clamp(1, 4);

  String get assetPath => 'sprites/$file';

  factory SpriteMeta.fromJson(Map<String, dynamic> json) => SpriteMeta(
        id: json['id'] as String,
        kit: json['kit'] as String,
        name: json['name'] as String,
        file: json['file'] as String,
        sizeX: (json['sizeX'] as num).toDouble(),
        sizeY: (json['sizeY'] as num).toDouble(),
        sizeZ: (json['sizeZ'] as num).toDouble(),
        baseY: (json['baseY'] as num).toDouble(),
      );
}

/// Carrega o manifesto de sprites e mapeia features do mundo para arte.
///
/// O mapeamento é intencionalmente por *lista de candidatos*: cada feature tem
/// várias artes possíveis, e o gerador escolhe uma de forma determinística pela
/// posição do tile. É isso que evita que uma floresta inteira use a mesma
/// árvore.
class SpriteCatalog {
  SpriteCatalog._(this._byId, this.images);

  final Map<String, SpriteMeta> _byId;
  final Images images;

  static const String _manifestPath = 'assets/data/sprites_manifest.json';

  static Future<SpriteCatalog> load() async {
    final raw = await rootBundle.loadString(_manifestPath);
    final decoded = jsonDecode(raw) as Map<String, dynamic>;
    final models = (decoded['models'] as List)
        .map((e) => SpriteMeta.fromJson(e as Map<String, dynamic>))
        .toList();

    final byId = {for (final m in models) m.id: m};
    return SpriteCatalog._(byId, Flame.images);
  }

  SpriteMeta? byId(String id) => _byId[id];

  Iterable<SpriteMeta> get all => _byId.values;

  /// Pré-carrega apenas os sprites que o mundo realmente usa. Carregar os 165
  /// de uma vez desperdiça memória de textura no celular.
  Future<void> preloadUsedSprites() async {
    final needed = <String>{};
    for (final candidates in _featureSprites.values) {
      needed.addAll(candidates);
    }
    for (final candidates in _groundSprites.values) {
      needed.addAll(candidates);
    }

    final paths = needed
        .map((id) => _byId[id]?.assetPath)
        .whereType<String>()
        .toList();
    await images.loadAll(paths);
  }

  /// Escolhe o sprite do chão de um tile.
  SpriteMeta? groundFor(Biome biome, int x, int y) =>
      _pick(_groundSprites[biome] ?? const [], x, y, salt: 11);

  /// Escolhe o sprite da feature de um tile, se houver.
  SpriteMeta? featureFor(TileFeature feature, int x, int y) {
    if (feature == TileFeature.none) return null;
    return _pick(_featureSprites[feature] ?? const [], x, y, salt: 29);
  }

  /// Seleção estável por posição: o mesmo tile sempre recebe a mesma arte,
  /// sem precisar guardar nada.
  SpriteMeta? _pick(List<String> candidates, int x, int y, {required int salt}) {
    if (candidates.isEmpty) return null;
    final hash = (x * 73856093) ^ (y * 19349663) ^ salt;
    final index = (hash.abs()) % candidates.length;
    return _byId[candidates[index]];
  }

  // ===========================================================================
  // Mapeamento bioma/feature -> arte Kenney
  // ===========================================================================

  static const Map<Biome, List<String>> _groundSprites = {
    Biome.neonCore: ['city/pavement', 'minidungeon/floor', 'minidungeon/floor-detail'],
    Biome.sprawl: ['city/pavement', 'minidungeon/floor', 'city/grass'],
    Biome.scrapyard: ['minidungeon/dirt', 'miniforest/patch-dirt', 'arena/floor'],
    Biome.oilFields: ['minidungeon/dirt', 'arena/floor', 'arena/floor-detail'],
    Biome.rareEarthMine: ['minidungeon/floor', 'minidungeon/dirt', 'arena/floor-detail'],
    Biome.bioFarm: ['city/grass', 'miniforest/patch-grass', 'miniforest/platform'],
    Biome.reclaimedForest: ['city/grass', 'miniforest/patch-grass'],
    Biome.toxicMarsh: ['miniforest/patch-dirt', 'minidungeon/dirt'],
    Biome.wasteland: ['minidungeon/dirt', 'miniforest/patch-dirt', 'arena/floor'],
    Biome.ruins: ['minidungeon/floor', 'minidungeon/floor-detail', 'arena/bricks'],
    Biome.deadWater: ['arena/floor'],
  };

  static const Map<TileFeature, List<String>> _featureSprites = {
    TileFeature.tree: ['miniforest/tree', 'castlekit/tree-small', 'city/grass-trees'],
    TileFeature.denseTree: [
      'miniforest/tree-high',
      'castlekit/tree-large',
      'city/grass-trees-tall',
    ],
    TileFeature.rock: [
      'miniforest/rocks-high',
      'miniforest/rocks-low',
      'castlekit/rocks-large',
      'minidungeon/rocks',
    ],
    TileFeature.rubble: [
      'castlekit/rocks-small',
      'minidungeon/stones',
      'miniforest/stones',
    ],
    TileFeature.scrapPile: [
      'minidungeon/barrel',
      'minidungeon/pot',
      'castlekit/rocks-small',
    ],
    TileFeature.oilPump: ['castlekit/siege-catapult', 'minidungeon/wood-structure'],
    TileFeature.building: [
      'city/building-small-a',
      'city/building-small-b',
      'city/building-small-c',
      'city/building-small-d',
      'city/building-garage',
      'miniforest/building-structure',
    ],
    TileFeature.tower: [
      'castlekit/tower-square-base',
      'castlekit/tower-square-mid-windows',
      'castlekit/tower-hexagon-base',
      'arena/column',
    ],
    TileFeature.wall: [
      'castlekit/wall',
      'castlekit/wall-half',
      'minidungeon/wall',
      'arena/border-straight',
    ],
    TileFeature.road: ['city/road-straight', 'city/road-straight-lightposts'],
    TileFeature.roadJunction: ['city/road-intersection', 'city/road-corner', 'city/road-split'],
    TileFeature.fence: ['miniforest/fence', 'castlekit/wall-narrow-wood-fence'],
    TileFeature.crate: ['minidungeon/chest', 'minidungeon/barrel', 'arena/block'],
    TileFeature.extractionRig: [
      'castlekit/siege-ballista',
      'minidungeon/wood-support',
      'miniforest/platform',
    ],
    TileFeature.marketStall: [
      'miniforest/tent',
      'city/pavement-fountain',
      'minidungeon/table',
    ],
  };

  /// Sprites de personagem disponíveis nos kits.
  static const List<String> characterSprites = [
    'minidungeon/character-human',
    'minidungeon/character-orc',
    'miniforest/character-archer',
    'arena/character-soldier',
  ];
}
