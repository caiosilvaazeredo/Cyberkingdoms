import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flame/events.dart';
import 'package:flame/game.dart';
import 'package:flutter/material.dart';

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
    this.onTileTapped,
  });

  /// Renomeado para não colidir com `FlameGame.world`, que é o mundo de
  /// componentes do Flame — outro conceito.
  final domain.World gameWorld;
  final SpriteCatalog catalog;

  /// Onde o personagem está. O renderizador desenha um marcador aqui.
  TileCoord playerPosition;

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

  /// Centraliza a câmera num tile — usado ao trocar de cidade.
  void focusOn(TileCoord tile) {
    playerPosition = tile;
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
    final (wx, wy) = IsoProjection.tileToWorld(
      coord.x.toDouble(),
      coord.y.toDouble(),
      elevation: tile.elevation.toDouble(),
    );

    final ground = catalog.groundFor(tile.biome, coord.x, coord.y);
    if (ground != null) {
      _drawSprite(canvas, ground, wx, wy, tile.biome.primary);
    } else {
      _drawFallbackDiamond(canvas, wx, wy, tile.biome.primary);
    }

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

  /// Desenha um sprite ancorado na base do losango do tile.
  void _drawSprite(
    Canvas canvas,
    SpriteMeta meta,
    double wx,
    double wy,
    Color? tint,
  ) {
    final image = catalog.images.fromCache(meta.assetPath);

    // O sprite foi renderizado com o modelo centralizado; `baseY` diz onde o
    // chão do modelo caiu na imagem. Escalamos pela footprint em tiles e
    // deslocamos para que esse ponto coincida com o centro do losango.
    final targetWidth = WorldMetrics.tileWidth * meta.footprint;
    final scale = targetWidth / image.width;
    final targetHeight = image.height * scale;

    final dx = wx - targetWidth / 2;
    final dy = wy - targetHeight * meta.baseY;

    final paint = Paint()..filterQuality = FilterQuality.medium;
    if (tint != null) {
      // Tint sutil deixa o mesmo asset servir a vários biomas sem re-render.
      paint.colorFilter = ui.ColorFilter.mode(
        tint.withValues(alpha: 0.22),
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
