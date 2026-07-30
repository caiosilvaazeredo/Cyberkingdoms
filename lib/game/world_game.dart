import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flame/events.dart';
import 'package:flame/game.dart';
import 'package:flutter/material.dart';

import '../domain/building/plot.dart';
import '../domain/world/biome.dart';
import '../domain/world/coords.dart';
import '../domain/world/tile.dart';
import '../domain/world/world.dart' as domain;
import 'sprite_catalog.dart';

/// O jogo Flame que desenha o mundo isométrico.
///
/// Estratégia de render: em vez de criar um componente por tile (o que colocaria
/// dezenas de milhares de objetos na árvore e derrubaria o frame rate no
/// celular), desenhamos direto no canvas em `render`, iterando apenas as chunks
/// visíveis. É o padrão de tilemap: um só componente, culling manual.
class CyberWorldGame extends FlameGame with ScaleDetector, TapCallbacks {
  CyberWorldGame({
    required this.gameWorld,
    required this.catalog,
    required this.playerPosition,
    this.plot,
    this.onTileTapped,
  });

  /// Renomeado para não colidir com `FlameGame.world`, que é o mundo de
  /// componentes do Flame — outro conceito.
  final domain.World gameWorld;
  final SpriteCatalog catalog;

  /// Onde o personagem está. O renderizador desenha um marcador aqui.
  TileCoord playerPosition;

  /// O terreno do jogador. Quando presente, as construções são desenhadas por
  /// cima do terreno gerado — é assim que o jogador vê a base dele crescendo
  /// no mundo, em vez de só na planta baixa.
  Plot? plot;

  final void Function(TileCoord tile, WorldTile data)? onTileTapped;

  /// Câmera em coordenadas de mundo (pixels).
  late Vector2 _cameraTarget;

  double _zoom = 0.55;
  static const double _minZoom = 0.22;
  static const double _maxZoom = 1.4;

  double _scaleStart = 1;

  /// Tile atualmente sob o dedo/cursor, destacado no render.
  TileCoord? highlighted;

  @override
  Color backgroundColor() => const Color(0xFF07070C);

  @override
  Future<void> onLoad() async {
    final (px, py) = IsoProjection.tileToWorld(
      playerPosition.x.toDouble(),
      playerPosition.y.toDouble(),
    );
    _cameraTarget = Vector2(px, py);
  }

  /// Centraliza a câmera num tile — usado ao trocar de cidade, ao tocar no
  /// minimapa e nos botões de foco.
  ///
  /// Move **só a câmera**. Antes daqui também movia `playerPosition`, o que
  /// fazia o pino do jogador saltar para onde a câmera olhasse: tocar um ponto
  /// distante no minimapa desenhava o personagem lá até o próximo rebuild.
  void focusOn(TileCoord tile) {
    final (px, py) = IsoProjection.tileToWorld(
      tile.x.toDouble(),
      tile.y.toDouble(),
    );
    _cameraTarget = Vector2(px, py);
  }

  double get zoom => _zoom;

  set zoom(double value) => _zoom = value.clamp(_minZoom, _maxZoom);

  // ===========================================================================
  // Entrada (touch mobile-first)
  // ===========================================================================

  @override
  void onScaleStart(ScaleStartInfo info) {
    _scaleStart = _zoom;
  }

  @override
  void onScaleUpdate(ScaleUpdateInfo info) {
    final scale = info.scale.global;
    // Um dedo = pan; dois dedos = zoom. Distinguimos pelo fator de escala.
    if ((scale.x - 1).abs() < 0.01) {
      final delta = info.delta.global;
      _cameraTarget -= Vector2(delta.x, delta.y) / _zoom;
    } else {
      zoom = _scaleStart * scale.x;
    }
  }

  @override
  void onTapUp(TapUpEvent event) {
    final tile = _screenToTile(event.localPosition);
    highlighted = tile;
    onTileTapped?.call(tile, gameWorld.tileAt(tile.x, tile.y));
  }

  TileCoord _screenToTile(Vector2 screenPosition) {
    final worldPoint = (screenPosition - size / 2) / _zoom + _cameraTarget;
    final (tx, ty) = IsoProjection.worldToTile(worldPoint.x, worldPoint.y);
    return TileCoord(tx.floor(), ty.floor());
  }

  // ===========================================================================
  // Render
  // ===========================================================================

  @override
  void render(Canvas canvas) {
    super.render(canvas);

    canvas.save();
    canvas.translate(size.x / 2, size.y / 2);
    canvas.scale(_zoom);
    canvas.translate(-_cameraTarget.x, -_cameraTarget.y);

    _renderVisibleChunks(canvas);
    _renderPlot(canvas);
    _renderPlayerMarker(canvas);
    _renderHighlight(canvas);

    canvas.restore();
  }

  /// Descobre quais chunks tocam a viewport e desenha na ordem de profundidade
  /// isométrica correta (chunks de trás para a frente, tiles idem).
  void _renderVisibleChunks(Canvas canvas) {
    final halfWidth = size.x / (2 * _zoom);
    final halfHeight = size.y / (2 * _zoom);

    // Cantos da viewport em coordenadas de mundo.
    final left = _cameraTarget.x - halfWidth;
    final right = _cameraTarget.x + halfWidth;
    final top = _cameraTarget.y - halfHeight;
    final bottom = _cameraTarget.y + halfHeight;

    // Converte os 4 cantos para o espaço de tiles e pega o bounding box. A
    // projeção isométrica gira o retângulo 45°, então o box em tiles é maior
    // que a viewport — daí a margem extra abaixo.
    final corners = [
      IsoProjection.worldToTile(left, top),
      IsoProjection.worldToTile(right, top),
      IsoProjection.worldToTile(left, bottom),
      IsoProjection.worldToTile(right, bottom),
    ];

    var minTileX = double.infinity;
    var maxTileX = double.negativeInfinity;
    var minTileY = double.infinity;
    var maxTileY = double.negativeInfinity;
    for (final (tx, ty) in corners) {
      minTileX = math.min(minTileX, tx);
      maxTileX = math.max(maxTileX, tx);
      minTileY = math.min(minTileY, ty);
      maxTileY = math.max(maxTileY, ty);
    }

    // Margem para cobrir sprites altos (torres) cuja base está fora da tela mas
    // cujo topo aparece, e a elevação do terreno.
    const margin = 4;
    final startChunkX =
        ((minTileX - margin) / WorldMetrics.chunkSize).floor();
    final endChunkX = ((maxTileX + margin) / WorldMetrics.chunkSize).ceil();
    final startChunkY =
        ((minTileY - margin) / WorldMetrics.chunkSize).floor();
    final endChunkY = ((maxTileY + margin) / WorldMetrics.chunkSize).ceil();

    // Teto de segurança: se o zoom mínimo abrir demais, não tente desenhar o
    // mundo inteiro.
    final chunkCount =
        (endChunkX - startChunkX + 1) * (endChunkY - startChunkY + 1);
    if (chunkCount > 400) return;

    // Ordem de profundidade entre chunks: soma das coordenadas crescente.
    final chunks = <ChunkCoord>[];
    for (var cy = startChunkY; cy <= endChunkY; cy++) {
      for (var cx = startChunkX; cx <= endChunkX; cx++) {
        chunks.add(ChunkCoord(cx, cy));
      }
    }
    chunks.sort((a, b) => (a.x + a.y).compareTo(b.x + b.y));

    for (final coord in chunks) {
      final chunk = gameWorld.chunkAt(coord);
      for (final (tileCoord, tile) in chunk.tilesInDepthOrder) {
        _renderTile(canvas, tileCoord, tile);
      }
    }
  }

  void _renderTile(Canvas canvas, TileCoord coord, WorldTile tile) {
    // Dentro do terreno o mundo é terraplenado: a mesma altura para todos os
    // tiles do lote. Sem isso as construções ficam em degraus diferentes
    // enquanto o contorno do lote é plano, e o conjunto parece quebrado.
    final insidePlot = plot?.containsWorldTile(coord) ?? false;
    final elevation = insidePlot ? _plotElevation : tile.elevation;

    final (wx, wy) = IsoProjection.tileToWorld(
      coord.x.toDouble(),
      coord.y.toDouble(),
      elevation: elevation.toDouble(),
    );

    // Terra por baixo, losango por cima — nesta ordem, sempre.
    //
    // Não é fallback: é o que fecha as costuras. O renderizador de sprites
    // enquadra cada modelo com 6% de folga, então a arte do chão nunca encosta
    // na borda do losango; e um degrau de elevação abre 16px entre um tile e o
    // vizinho mais baixo. A primeira captura com chão de mato saiu com o fundo
    // preto vazando pelos dois buracos. O losango também é onde a cor do bioma
    // aparece de verdade: com o chão inteiro virando grama, o tom é o que
    // diferencia o Charco do Descampado.
    final base = _groundColor(tile.biome);
    _drawTileSides(canvas, wx, wy, base);
    _drawFallbackDiamond(canvas, wx, wy, base);

    // Dentro do lote o chão é grama aparada: uma única variante, tingida com a
    // cor do vilarejo. Quando o mundo inteiro virou mato, o terreno do jogador
    // deixou de se distinguir da cidade em volta — o contorno sozinho não
    // bastava. Um gramado uniforme no meio do mato irregular resolve sem
    // pavimentar nada.
    final ground = insidePlot
        ? catalog.mowedGrass
        : catalog.groundFor(tile.biome, coord.x, coord.y);
    if (ground != null) {
      _drawSprite(
        canvas,
        ground,
        wx,
        wy,
        insidePlot ? Color(plot!.identity.primaryColor) : tile.biome.primary,
        // Mesma grama em todo o mapa, com a força do tint variando de tile
        // para tile. É o que dá textura ao chão sem misturar artes de kits
        // diferentes: três modelos de grama sorteados produziam um xadrez,
        // porque o verde do Nature Kit é bem mais escuro que o do Tower
        // Defense.
        tintStrength: insidePlot ? 0.30 : 0.36 + _mottle(coord) * 0.14,
        // Um pouco maior que o tile, para cobrir a folga de enquadramento do
        // renderizador de sprites — sem isso sobra um fio da cor de terra na
        // divisa de cada tile.
        overdraw: 1.16,
      );
    }

    // O lote é terreno limpo. A cidade procedural continua gerando prédios,
    // postes e barracas ali — desenhá-los enterraria as construções do jogador
    // no meio do cenário, que foi exatamente o que a primeira captura mostrou:
    // o próprio terreno era impossível de achar no mapa.
    if (insidePlot) return;

    final feature = catalog.featureFor(tile.feature, coord.x, coord.y);
    if (feature != null) {
      _drawSprite(canvas, feature, wx, wy, null);
    }

    // Jazidas ganham um brilho neon para o jogador enxergar onde trabalhar.
    if (tile.hasResource && tile.resourceRichness > 0.45) {
      final paint = Paint()
        ..color = tile.biome.accent.withValues(alpha: 0.30 * tile.resourceRichness)
        ..maskFilter = const ui.MaskFilter.blur(ui.BlurStyle.normal, 8);
      canvas.drawCircle(Offset(wx, wy), WorldMetrics.tileWidth * 0.22, paint);
    }
  }

  /// Altura única do lote, tirada do tile de origem.
  ///
  /// Recalculada quando o terreno muda de lugar (o jogador pode se mudar de
  /// cidade), e não a cada tile: `tileAt` gera a chunk inteira na primeira
  /// consulta.
  int get _plotElevation {
    final plot = this.plot!;
    if (_plotElevationOrigin != plot.origin) {
      _plotElevationOrigin = plot.origin;
      _plotElevationCache =
          gameWorld.tileAt(plot.origin.x, plot.origin.y).elevation;
    }
    return _plotElevationCache;
  }

  TileCoord? _plotElevationOrigin;
  int _plotElevationCache = 0;

  /// Desenha um sprite ancorado na base do losango do tile.
  void _drawSprite(
    Canvas canvas,
    SpriteMeta meta,
    double wx,
    double wy,
    Color? tint, {
    double opacity = 1,
    int? footprint,
    double tintStrength = 0.22,
    double overdraw = 1,
  }) {
    // Um sprite fora do cache lançaria e derrubaria o frame inteiro.
    if (!catalog.isLoaded(meta)) return;
    final image = catalog.images.fromCache(meta.assetPath);

    // O sprite foi renderizado com o modelo centralizado; `baseY` diz onde o
    // chão do modelo caiu na imagem. Escalamos pela footprint em tiles e
    // deslocamos para que esse ponto coincida com o centro do losango.
    //
    // Para as construções do terreno quem manda é a footprint declarada na
    // regra do jogo, não o tamanho do modelo: uma refinaria ocupa 3x2 tiles e
    // precisa parecer que ocupa. Antes disso ela era desenhada com a largura do
    // `.glb` — do tamanho de um barril, sobre um lote de 3 tiles vazios.
    final targetWidth =
        WorldMetrics.tileWidth * (footprint ?? meta.footprint) * overdraw;
    final scale = targetWidth / image.width;
    final targetHeight = image.height * scale;

    final dx = wx - targetWidth / 2;
    final dy = wy - targetHeight * meta.baseY;

    final paint = Paint()..filterQuality = FilterQuality.medium;
    if (opacity < 1) {
      paint.color = Color.fromRGBO(0, 0, 0, opacity.clamp(0.0, 1.0));
    }
    if (tint != null) {
      // O tint deixa o mesmo asset servir a vários biomas sem re-render. No
      // chão ele é forte, porque a grama é a mesma em todo o mapa e a cor é a
      // única coisa que separa um bioma do outro; nos objetos é sutil, para
      // não apagar a arte.
      paint.colorFilter = ui.ColorFilter.mode(
        tint.withValues(alpha: tintStrength),
        BlendMode.srcATop,
      );
    }

    canvas.drawImageRect(
      image,
      Rect.fromLTWH(0, 0, image.width.toDouble(), image.height.toDouble()),
      Rect.fromLTWH(dx, dy, targetWidth, targetHeight),
      paint,
    );
  }

  /// Variação estável de 0 a 1 por tile, para manchar a grama.
  ///
  /// Sem guardar nada: o mesmo tile devolve sempre o mesmo valor, dois
  /// vizinhos quase nunca devolvem o mesmo.
  double _mottle(TileCoord coord) {
    final hash = (coord.x * 374761393) ^ (coord.y * 668265263);
    return ((hash >>> 8) & 0xFF) / 255.0;
  }

  /// Cor do bloco de terra sob a grama.
  ///
  /// Não é `biome.primary` cru. As cores dos biomas foram escolhidas para
  /// *tingir* arte — são quase pretas de propósito — e usar uma delas como
  /// chão exposto abria um buraco na tela onde deveria haver barranco. Aqui a
  /// cor do bioma entra como tempero de uma terra que já é terra.
  Color _groundColor(Biome biome) =>
      Color.lerp(const Color(0xFF4E7A3A), biome.primary, 0.42)!;

  /// As duas faces laterais do bloco de terra sob o tile.
  ///
  /// Desenhadas com profundidade fixa, maior que o maior desnível possível
  /// entre dois tiles do mapa (9 degraus de elevação). Sobra muito pano
  /// embaixo, e é de propósito: como os tiles são pintados de trás para a
  /// frente e a saia só cresce *para baixo na tela* — que é para onde ficam os
  /// tiles desenhados depois —, o excesso é sempre coberto por quem vem na
  /// frente. É o mesmo truque de um tilemap de cubos.
  ///
  /// A primeira versão usava 3 degraus e parecia certa até a captura da Terra
  /// Devastada, onde o relevo é mais quebrado: cada barranco de 4 degraus ou
  /// mais virava uma fatia preta no meio do mato.
  static const double _sideDepth = WorldMetrics.elevationUnit * 12;

  void _drawTileSides(Canvas canvas, double wx, double wy, Color color) {
    final halfW = WorldMetrics.tileWidth / 2;
    final halfH = WorldMetrics.tileHeight / 2;

    // Terra: a cor do bioma escurecida, não preta. Preto puro faria o relevo
    // parecer um buraco em vez de um barranco.
    final soil = Color.lerp(color, const Color(0xFF120E0A), 0.45)!;

    // A face esquerda pega menos luz que a direita — é o que dá volume ao
    // degrau sem precisar de sombra calculada.
    canvas.drawPath(
      Path()
        ..moveTo(wx - halfW, wy)
        ..lineTo(wx, wy + halfH)
        ..lineTo(wx, wy + halfH + _sideDepth)
        ..lineTo(wx - halfW, wy + _sideDepth)
        ..close(),
      Paint()..color = Color.lerp(soil, Colors.black, 0.28)!,
    );
    canvas.drawPath(
      Path()
        ..moveTo(wx, wy + halfH)
        ..lineTo(wx + halfW, wy)
        ..lineTo(wx + halfW, wy + _sideDepth)
        ..lineTo(wx, wy + halfH + _sideDepth)
        ..close(),
      Paint()..color = soil,
    );
  }

  /// Losango sólido para quando o sprite ainda não carregou.
  void _drawFallbackDiamond(Canvas canvas, double wx, double wy, Color color) {
    final path = Path()
      ..moveTo(wx, wy - WorldMetrics.tileHeight / 2)
      ..lineTo(wx + WorldMetrics.tileWidth / 2, wy)
      ..lineTo(wx, wy + WorldMetrics.tileHeight / 2)
      ..lineTo(wx - WorldMetrics.tileWidth / 2, wy)
      ..close();
    canvas.drawPath(path, Paint()..color = color);
  }

  /// Desenha o contorno do terreno e as construções sobre o mundo.
  ///
  /// As construções são desenhadas depois das chunks, em ordem de profundidade
  /// própria. Isso pode fazer um prédio do terreno aparecer na frente de algo
  /// que deveria ocultá-lo, mas o terreno é uma área pequena e contígua, e o
  /// custo de intercalar isso na varredura de chunks não compensa.
  void _renderPlot(Canvas canvas) {
    final plot = this.plot;
    if (plot == null) return;

    final primary = Color(plot.identity.primaryColor);
    final elevation = _plotElevation.toDouble();

    // Contorno do lote, para o jogador achar o próprio terreno no mapa.
    final corners = [
      IsoProjection.tileToWorld(plot.origin.x.toDouble() - 0.5,
          plot.origin.y.toDouble() - 0.5, elevation: elevation),
      IsoProjection.tileToWorld(plot.origin.x + plot.width - 0.5,
          plot.origin.y.toDouble() - 0.5, elevation: elevation),
      IsoProjection.tileToWorld(plot.origin.x + plot.width - 0.5,
          plot.origin.y + plot.height - 0.5, elevation: elevation),
      IsoProjection.tileToWorld(plot.origin.x.toDouble() - 0.5,
          plot.origin.y + plot.height - 0.5, elevation: elevation),
    ];

    final outline = Path()..moveTo(corners.first.$1, corners.first.$2);
    for (final corner in corners.skip(1)) {
      outline.lineTo(corner.$1, corner.$2);
    }
    outline.close();

    canvas.drawPath(
      outline,
      Paint()..color = primary.withValues(alpha: 0.07),
    );
    canvas.drawPath(
      outline,
      Paint()
        ..color = primary.withValues(alpha: 0.75)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 3,
    );

    // Construções, do fundo para a frente.
    final buildings = plot.buildings.toList()
      ..sort((a, b) => (a.x + a.y).compareTo(b.x + b.y));

    for (final building in buildings) {
      final tile = plot.worldTileFor(building.x, building.y);

      // Ancora no centro da footprint para prédios maiores que 1x1.
      final centerX = tile.x + (building.def.width - 1) / 2;
      final centerY = tile.y + (building.def.height - 1) / 2;
      final (wx, wy) = IsoProjection.tileToWorld(
        centerX,
        centerY,
        elevation: elevation,
      );

      final meta = catalog.byId(building.def.spriteId);
      if (meta == null) continue;

      // Prédios altos (torres) usam a footprint declarada; prédios largos e
      // baixos ficariam esticados se usassem a largura cheia, então a diagonal
      // média das duas dimensões dá um resultado mais próximo do esperado.
      final span = ((building.def.width + building.def.height) / 2).round();

      if (!building.isReady) {
        // Obra em andamento: silhueta translúcida em âmbar.
        _drawSprite(canvas, meta, wx, wy, const Color(0xFFFFB300),
            opacity: 0.45, footprint: span);
        continue;
      }

      _drawSprite(
        canvas,
        meta,
        wx,
        wy,
        building.accentColor == null ? null : Color(building.accentColor!),
        footprint: span,
      );

      // Prédio parado ganha um alerta visível de longe.
      if (building.idle) {
        canvas.drawCircle(
          Offset(wx, wy - WorldMetrics.tileHeight * 0.9),
          6,
          Paint()..color = const Color(0xFFFF5252),
        );
      }
    }
  }

  void _renderPlayerMarker(Canvas canvas) {
    final tile = gameWorld.tileAt(playerPosition.x, playerPosition.y);
    final (wx, wy) = IsoProjection.tileToWorld(
      playerPosition.x.toDouble(),
      playerPosition.y.toDouble(),
      elevation: tile.elevation.toDouble(),
    );

    // Halo pulsante na base.
    final halo = Paint()
      ..color = const Color(0xFF00E5FF).withValues(alpha: 0.35)
      ..maskFilter = const ui.MaskFilter.blur(ui.BlurStyle.normal, 10);
    canvas.drawCircle(Offset(wx, wy), WorldMetrics.tileWidth * 0.26, halo);

    // Pino vertical, legível em qualquer zoom.
    final pin = Paint()
      ..color = const Color(0xFFFF2D95)
      ..strokeWidth = 4
      ..strokeCap = StrokeCap.round;
    canvas.drawLine(
      Offset(wx, wy - 8),
      Offset(wx, wy - WorldMetrics.tileHeight * 1.1),
      pin,
    );
    canvas.drawCircle(
      Offset(wx, wy - WorldMetrics.tileHeight * 1.1),
      7,
      Paint()..color = const Color(0xFFFF2D95),
    );
  }

  void _renderHighlight(Canvas canvas) {
    final tile = highlighted;
    if (tile == null) return;

    final data = gameWorld.tileAt(tile.x, tile.y);
    final (wx, wy) = IsoProjection.tileToWorld(
      tile.x.toDouble(),
      tile.y.toDouble(),
      elevation: data.elevation.toDouble(),
    );

    final path = Path()
      ..moveTo(wx, wy - WorldMetrics.tileHeight / 2)
      ..lineTo(wx + WorldMetrics.tileWidth / 2, wy)
      ..lineTo(wx, wy + WorldMetrics.tileHeight / 2)
      ..lineTo(wx - WorldMetrics.tileWidth / 2, wy)
      ..close();

    canvas.drawPath(
      path,
      Paint()
        ..color = const Color(0xFF00E5FF)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 3,
    );
  }
}
