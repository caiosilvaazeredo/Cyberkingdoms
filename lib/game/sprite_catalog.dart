import 'dart:convert';

import 'package:flame/cache.dart';
import 'package:flame/flame.dart';
import 'package:flutter/services.dart' show rootBundle;

import '../domain/building/building_type.dart';
import '../domain/building/village_identity.dart';
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
  /// = 1 tile.
  ///
  /// Arredondar para o inteiro **mais próximo**, não para cima: quase todo
  /// modelo de 1 tile passa um pouco do cubo (um telhado que avança, a lança de
  /// uma balista). Com `ceil`, uma barraca de 1,26 unidade virava um sprite de
  /// dois tiles de largura — na captura do mundo ela aparecia como um borrão
  /// azul cobrindo os vizinhos.
  int get footprint => sizeX.round().clamp(1, 4);

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

    // O `Images` do Flame prefixa tudo com `assets/images/` por padrão. Os
    // sprites deste projeto vivem em `assets/sprites/`, então o prefixo precisa
    // ser reduzido a `assets/` — sem isso todo carregamento falha com
    // "Unable to load asset: assets/images/sprites/...".
    Flame.images.prefix = 'assets/';
    return SpriteCatalog._(byId, Flame.images);
  }

  SpriteMeta? byId(String id) => _byId[id];

  Iterable<SpriteMeta> get all => _byId.values;

  /// Pré-carrega apenas os sprites que o jogo realmente usa: chão, features do
  /// mundo, construções e brasões. Carregar os 165 de uma vez desperdiçaria
  /// dezenas de MB de memória de textura no celular.
  Future<void> preloadUsedSprites() async {
    final needed = <String>{};
    for (final candidates in _featureSprites.values) {
      needed.addAll(candidates);
    }
    for (final candidates in _groundSprites.values) {
      needed.addAll(candidates);
    }
    // Construções e brasões: sem isso o render do terreno no mundo procura no
    // cache um sprite que nunca foi carregado.
    for (final def in BuildingCatalog.all) {
      needed.add(def.spriteId);
    }
    for (final emblem in VillageEmblem.values) {
      needed.add(emblem.spriteId);
    }

    final paths = needed
        .map((id) => _byId[id]?.assetPath)
        .whereType<String>()
        .toList();
    await images.loadAll(paths);
    _loaded.addAll(paths);
  }

  final Set<String> _loaded = {};

  /// `true` se o sprite já está no cache de imagens. O renderizador consulta
  /// isto antes de desenhar: `Images.fromCache` lança se o asset não foi
  /// carregado, e um sprite faltando não pode derrubar o frame.
  bool isLoaded(SpriteMeta meta) => _loaded.contains(meta.assetPath);

  /// Escolhe o sprite do chão de um tile.
  SpriteMeta? groundFor(Biome biome, int x, int y) =>
      _pick(_groundSprites[biome] ?? const [], x, y, salt: 11);

  /// Grama aparada: o chão do terreno do jogador. Sempre a mesma, de propósito
  /// — é a uniformidade que faz o lote se destacar do mato em volta.
  SpriteMeta? get mowedGrass => _byId['towerdefense/tile'];

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

  /// **O chão do mundo inteiro é mato.** Não há pavimento, asfalto nem laje em
  /// nenhum bioma — nem dentro das cidades.
  ///
  /// O que separa um bioma do outro não é o material do chão, é o tom: o
  /// renderizador tinge cada tile com a cor primária do bioma, então o mesmo
  /// bloco de grama sai roxo no Núcleo Neon, ocre no Descampado e verde-ácido
  /// no Charco. Uma paleta por bioma custaria dez vezes mais arte para dizer a
  /// mesma coisa.
  ///
  /// Um único bloco de grama para o mundo inteiro.
  ///
  /// Duas tentativas ficaram pelo caminho, e as duas apareceram na captura.
  /// `survival/patch-grass-large` é uma moita sobre fundo transparente, não um
  /// tile: um em cada quatro tiles do mundo mostrava o chão nu por baixo.
  /// Depois vieram três modelos de grama sorteados por posição — e o verde do
  /// Nature Kit é tão mais escuro que o do Tower Defense que o mapa virou um
  /// xadrez. A variação do chão agora vem de duas fontes que não brigam entre
  /// si: a mancha por tile, aplicada no tint, e as moitas (`grassTuft`)
  /// desenhadas por cima.
  static const List<String> _grass = ['towerdefense/tile'];

  static const Map<Biome, List<String>> _groundSprites = {
    Biome.neonCore: _grass,
    Biome.sprawl: _grass,
    Biome.scrapyard: _grass,
    Biome.oilFields: _grass,
    Biome.rareEarthMine: _grass,
    Biome.bioFarm: _grass,
    Biome.reclaimedForest: _grass,
    Biome.toxicMarsh: _grass,
    Biome.wasteland: _grass,
    Biome.ruins: _grass,
    // A única exceção: água não é mato. Os dois candidatos são tiles inteiros
    // do Tower Defense Kit — a vitória-régia, que também ficou aqui por um
    // tempo, é pequena demais para servir de chão e deixava metade do lago
    // preta.
    Biome.deadWater: [
      'towerdefense/tile-river-straight',
      'towerdefense/tile-river-corner',
    ],
  };

  /// Arte de cada feature. Listas longas de propósito: a variedade dentro de
  /// um bioma vem daqui, não de mais biomas.
  static const Map<TileFeature, List<String>> _featureSprites = {
    // --------------------------------------------------------------- vegetação
    TileFeature.tree: [
      'nature/tree_default',
      'nature/tree_oak',
      'nature/tree_detailed',
      'nature/tree_simple',
      'nature/tree_small',
      'nature/tree_fat',
      'nature/tree_thin',
      'survival/tree',
      'towerdefense/detail-tree',
    ],
    TileFeature.denseTree: [
      'nature/tree_tall',
      'nature/tree_pineTallA',
      'nature/tree_pineDefaultA',
      'nature/tree_plateau',
      'nature/tree_blocks',
      'nature/tree_cone',
      'survival/tree-tall',
      'towerdefense/detail-tree-large',
    ],
    // Árvore morta: as variantes "dark" e "fall" do Nature Kit têm folhagem
    // marrom e âmbar — é o que dá ao Campo de Petróleo e ao Charco a cor de
    // vegetação envenenada sem precisar de outro kit.
    TileFeature.deadTree: [
      'nature/tree_default_dark',
      'nature/tree_oak_fall',
      'nature/tree_thin_dark',
      'nature/tree_small_fall',
      'survival/tree-autumn',
      'survival/tree-trunk',
    ],
    TileFeature.bush: [
      'nature/plant_bush',
      'nature/plant_bushDetailed',
      'nature/plant_bushLarge',
      'nature/plant_bushSmall',
      'nature/grass_leafsLarge',
    ],
    TileFeature.grassTuft: [
      'nature/grass',
      'nature/grass_large',
      'nature/grass_leafs',
      'survival/grass',
      'survival/grass-large',
      'nature/plant_flatShort',
    ],
    TileFeature.flowers: [
      'nature/flower_redA',
      'nature/flower_yellowA',
      'nature/flower_purpleA',
      'nature/flower_purpleC',
    ],
    TileFeature.mushroom: [
      'nature/mushroom_red',
      'nature/mushroom_redGroup',
      'nature/mushroom_tan',
      'nature/mushroom_tanTall',
    ],
    TileFeature.stump: [
      'nature/stump_round',
      'nature/stump_old',
      'nature/stump_square',
      'nature/stump_oldTall',
    ],
    TileFeature.fallenLog: [
      'nature/log',
      'nature/log_large',
      'nature/log_stack',
      'survival/tree-log',
      'survival/tree-log-small',
    ],
    TileFeature.crops: [
      'nature/crops_wheatStageB',
      'nature/crops_cornStageC',
      'nature/crops_leafsStageB',
      'nature/crops_dirtRow',
    ],
    TileFeature.cactus: ['nature/cactus_short', 'nature/cactus_tall'],
    TileFeature.lily: ['nature/lily_large', 'nature/lily_small'],

    // ----------------------------------------------------------------- relevo
    TileFeature.rock: [
      'nature/rock_smallA',
      'nature/rock_smallB',
      'nature/stone_smallA',
      'nature/rock_smallFlatA',
      'survival/rock-a',
      'survival/rock-flat-grass',
      'towerdefense/detail-rocks',
    ],
    TileFeature.boulder: [
      'nature/rock_largeA',
      'nature/rock_largeB',
      'nature/rock_tallA',
      'nature/stone_largeA',
      'survival/rock-c',
      'towerdefense/detail-rocks-large',
    ],
    TileFeature.cliff: [
      'nature/cliff_rock',
      'nature/cliff_stone',
      'nature/cliff_block_rock',
      'towerdefense/tile-rock',
    ],

    // ------------------------------------------------------ ocupação humana
    TileFeature.rubble: [
      'nature/stone_smallFlatA',
      'survival/resource-stone',
      'minidungeon/stones',
      'castlekit/rocks-small',
    ],
    TileFeature.scrapPile: [
      'survival/barrel',
      'survival/barrel-open',
      'survival/metal-panel-screws',
      'survival/resource-planks',
      'minidungeon/barrel',
    ],
    TileFeature.wreck: [
      'survival/metal-panel',
      'survival/structure-metal-wall',
      'survival/floor-hole',
      'castlekit/siege-catapult-demolished',
    ],
    TileFeature.oilPump: [
      'towerdefense/weapon-turret',
      'towerdefense/wood-structure-high',
      'minidungeon/wood-structure',
    ],
    TileFeature.building: [
      'city/building-small-a',
      'city/building-small-b',
      'city/building-small-c',
      'city/building-small-d',
      'city/building-garage',
      'towerdefense/tower-square-bottom-a',
      'towerdefense/tower-square-middle-a',
    ],
    TileFeature.tower: [
      'towerdefense/tower-round-bottom-a',
      'towerdefense/tower-round-middle-a',
      'towerdefense/tower-square-build-a',
      'castlekit/tower-square-mid-windows',
      'castlekit/tower-hexagon-base',
    ],
    TileFeature.wall: [
      'castlekit/wall',
      'castlekit/wall-half',
      'survival/structure-metal',
      'survival/metal-panel-narrow',
    ],
    TileFeature.fence: [
      'nature/fence_simple',
      'nature/fence_planks',
      'nature/fence_gate',
      'survival/fence',
      'survival/fence-fortified',
    ],
    TileFeature.crate: [
      'survival/box',
      'survival/box-large',
      'survival/chest',
      'survival/resource-wood',
      'minidungeon/chest',
    ],
    TileFeature.extractionRig: [
      'towerdefense/wood-structure',
      'towerdefense/tower-round-base',
      'survival/workbench-grind',
      'minidungeon/wood-support',
    ],
    TileFeature.marketStall: [
      'survival/tent-canvas',
      'nature/tent_detailedOpen',
      'survival/workbench',
      'miniforest/tent',
    ],
    TileFeature.camp: [
      'survival/tent',
      'nature/tent_smallClosed',
      'survival/campfire-stand',
      'survival/bedroll-frame',
      'survival/structure-canvas',
    ],
    TileFeature.campfire: [
      'nature/campfire_logs',
      'nature/campfire_stones',
      'survival/campfire-pit',
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
