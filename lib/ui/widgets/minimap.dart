import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../domain/world/coords.dart';
import '../../domain/world/world.dart';

/// Minimapa do mundo gerado: mostra as 5 capitais, os 15 satélites, as estradas
/// PvP e onde o jogador está.
///
/// Amostra o bioma numa grade esparsa em vez de tile a tile — o mapa cobre
/// centenas de milhares de tiles e não faria sentido resolver todos.
class Minimap extends StatelessWidget {
  const Minimap({
    super.key,
    required this.world,
    required this.playerPosition,
    this.size = 260,
    this.onSettlementTap,
  });

  final World world;
  final TileCoord playerPosition;
  final double size;
  final void Function(String settlementId)? onSettlementTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTapUp: onSettlementTap == null
          ? null
          : (details) => _handleTap(details.localPosition),
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          color: CyberColors.background,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: CyberColors.outline),
        ),
        clipBehavior: Clip.antiAlias,
        child: CustomPaint(
          painter: _MinimapPainter(
            world: world,
            playerPosition: playerPosition,
          ),
        ),
      ),
    );
  }

  void _handleTap(Offset local) {
    final extent = WorldMetrics.settledRadius * 1.25;
    final tileX = ((local.dx / size) * 2 - 1) * extent;
    final tileY = ((local.dy / size) * 2 - 1) * extent;
    final tapped = TileCoord(tileX.round(), tileY.round());

    // Tolerância generosa: num minimapa de 260px, uma capital ocupa poucos
    // pixels, e o dedo é grosso.
    const toleranceInTiles = 70.0;
    String? bestId;
    var bestDistance = double.infinity;
    for (final settlement in world.layout.settlements) {
      final d = tapped.euclideanTo(settlement.center);
      if (d < bestDistance && d < toleranceInTiles) {
        bestDistance = d;
        bestId = settlement.id;
      }
    }
    if (bestId != null) onSettlementTap!(bestId);
  }
}

class _MinimapPainter extends CustomPainter {
  _MinimapPainter({required this.world, required this.playerPosition});

  final World world;
  final TileCoord playerPosition;

  /// Quantas amostras de bioma por lado. 64x64 = 4096 chamadas de ruído: roda
  /// em poucos milissegundos e só repinta quando algo muda.
  static const int _samples = 64;

  @override
  void paint(Canvas canvas, Size size) {
    final extent = WorldMetrics.settledRadius * 1.25;
    final cell = size.width / _samples;

    Offset project(num tileX, num tileY) => Offset(
          ((tileX / extent) + 1) / 2 * size.width,
          ((tileY / extent) + 1) / 2 * size.height,
        );

    // Camada 1: biomas.
    final paint = Paint()..style = PaintingStyle.fill;
    for (var iy = 0; iy < _samples; iy++) {
      for (var ix = 0; ix < _samples; ix++) {
        final tileX = (ix / _samples * 2 - 1) * extent;
        final tileY = (iy / _samples * 2 - 1) * extent;
        paint.color = world.generator.biomeAt(tileX.round(), tileY.round()).primary;
        canvas.drawRect(
          Rect.fromLTWH(ix * cell, iy * cell, cell + 0.5, cell + 0.5),
          paint,
        );
      }
    }

    // Camada 2: estradas PvP.
    final roadPaint = Paint()
      ..color = CyberColors.amber.withValues(alpha: 0.55)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.4;
    for (final road in world.layout.roads) {
      if (road.path.isEmpty) continue;
      final path = Path();
      // Uma amostra a cada 8 tiles é suficiente para o traço no minimapa.
      for (var i = 0; i < road.path.length; i += 8) {
        final point = project(road.path[i].x, road.path[i].y);
        if (i == 0) {
          path.moveTo(point.dx, point.dy);
        } else {
          path.lineTo(point.dx, point.dy);
        }
      }
      canvas.drawPath(path, roadPaint);
    }

    // Camada 3: assentamentos.
    for (final settlement in world.layout.settlements) {
      final center = project(settlement.center.x, settlement.center.y);
      final radius = settlement.isCapital ? 5.0 : 2.6;

      canvas.drawCircle(
        center,
        radius + 3,
        Paint()
          ..color = (settlement.isCapital ? CyberColors.cyan : CyberColors.violet)
              .withValues(alpha: 0.22),
      );
      canvas.drawCircle(
        center,
        radius,
        Paint()..color = settlement.isCapital ? CyberColors.cyan : CyberColors.violet,
      );
    }

    // Camada 4: jogador.
    final player = project(playerPosition.x, playerPosition.y);
    canvas.drawCircle(
      player,
      7,
      Paint()..color = CyberColors.pink.withValues(alpha: 0.30),
    );
    canvas.drawCircle(player, 3.5, Paint()..color = CyberColors.pink);
    canvas.drawCircle(
      player,
      3.5,
      Paint()
        ..color = Colors.white
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.2,
    );
  }

  @override
  bool shouldRepaint(_MinimapPainter oldDelegate) =>
      oldDelegate.playerPosition != playerPosition ||
      oldDelegate.world.seed != world.seed;
}
