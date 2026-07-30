import 'package:flame/game.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme.dart';
import '../../domain/economy/item.dart';
import '../../domain/world/coords.dart';
import '../../domain/world/tile.dart';
import '../../game/world_game.dart';
import '../../state/providers.dart';
import '../widgets/minimap.dart';

/// A tela do mundo: render isométrico em Flame, minimapa sobreposto e um painel
/// com o que há no tile tocado.
class WorldScreen extends ConsumerStatefulWidget {
  const WorldScreen({super.key});

  @override
  ConsumerState<WorldScreen> createState() => _WorldScreenState();
}

class _WorldScreenState extends ConsumerState<WorldScreen> {
  CyberWorldGame? _game;
  TileCoord? _selected;
  WorldTile? _selectedData;
  bool _showMinimap = true;

  @override
  Widget build(BuildContext context) {
    final campaign = ref.watch(campaignControllerProvider);
    final catalogAsync = ref.watch(spriteCatalogProvider);

    if (campaign == null) return const SizedBox.shrink();

    return catalogAsync.when(
      loading: () => const Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            CircularProgressIndicator(color: CyberColors.cyan),
            SizedBox(height: 16),
            Text(
              'Carregando o mundo…',
              style: TextStyle(color: CyberColors.textSecondary, fontSize: 12),
            ),
          ],
        ),
      ),
      error: (error, _) => Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(
            'Falha ao carregar os sprites.\n$error',
            textAlign: TextAlign.center,
            style: const TextStyle(color: CyberColors.textSecondary),
          ),
        ),
      ),
      data: (catalog) {
        // O jogo é criado uma vez e reaproveitado; trocar a instância a cada
        // rebuild descartaria o cache de chunks e piscaria a tela.
        final game = _game ??= CyberWorldGame(
          gameWorld: campaign.world,
          catalog: catalog,
          playerPosition: campaign.character.position,
          plot: campaign.plot,
          onTileTapped: (tile, data) {
            setState(() {
              _selected = tile;
              _selectedData = data;
            });
          },
        );
        game.playerPosition = campaign.character.position;
        game.plot = campaign.plot;

        return Stack(
          children: [
            Positioned.fill(child: GameWidget(game: game)),

            // Controles de zoom — dedo grande, botões grandes.
            Positioned(
              right: 12,
              bottom: 12,
              child: Column(
                children: [
                  _RoundButton(
                    icon: Icons.add,
                    onTap: () => setState(() => game.zoom = game.zoom * 1.25),
                  ),
                  const SizedBox(height: 8),
                  _RoundButton(
                    icon: Icons.remove,
                    onTap: () => setState(() => game.zoom = game.zoom * 0.8),
                  ),
                  const SizedBox(height: 8),
                  _RoundButton(
                    icon: Icons.my_location,
                    onTap: () => setState(
                      () => game.focusOn(campaign.character.position),
                    ),
                  ),
                  const SizedBox(height: 8),
                  _RoundButton(
                    icon: Icons.home_work_outlined,
                    onTap: () => setState(
                      () => game.focusOn(campaign.plot.origin),
                    ),
                  ),
                  const SizedBox(height: 8),
                  _RoundButton(
                    icon: _showMinimap ? Icons.map : Icons.map_outlined,
                    onTap: () => setState(() => _showMinimap = !_showMinimap),
                  ),
                ],
              ),
            ),

            if (_showMinimap)
              Positioned(
                left: 12,
                top: 12,
                child: Minimap(
                  world: campaign.world,
                  playerPosition: campaign.character.position,
                  size: 150,
                  onSettlementTap: (id) {
                    final settlement = campaign.world.layout.byId(id);
                    if (settlement == null) return;
                    game.focusOn(settlement.center);
                    setState(() {});
                  },
                ),
              ),

            if (_selected case final tile?)
              Positioned(
                left: 12,
                right: 12,
                bottom: 12,
                child: _TileInspector(
                  tile: tile,
                  data: _selectedData!,
                  onClose: () => setState(() {
                    _selected = null;
                    _selectedData = null;
                  }),
                  onMove: () {
                    ref.read(campaignControllerProvider.notifier).moveTo(tile);
                    game.focusOn(tile);
                    setState(() {});
                  },
                ),
              ),
          ],
        );
      },
    );
  }
}

class _RoundButton extends StatelessWidget {
  const _RoundButton({required this.icon, required this.onTap});

  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: CyberColors.surface.withValues(alpha: 0.92),
      shape: const CircleBorder(
        side: BorderSide(color: CyberColors.outline),
      ),
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: onTap,
        // 46px: acima do mínimo de alvo de toque recomendado.
        child: SizedBox(
          width: 46,
          height: 46,
          child: Icon(icon, color: CyberColors.cyan, size: 20),
        ),
      ),
    );
  }
}

/// Painel do tile selecionado — bioma, relevo, recurso e ação de mover.
class _TileInspector extends StatelessWidget {
  const _TileInspector({
    required this.tile,
    required this.data,
    required this.onClose,
    required this.onMove,
  });

  final TileCoord tile;
  final WorldTile data;
  final VoidCallback onClose;
  final VoidCallback onMove;

  @override
  Widget build(BuildContext context) {
    return Card(
      color: CyberColors.surface.withValues(alpha: 0.96),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 12, 8, 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              children: [
                Container(
                  width: 10,
                  height: 10,
                  decoration: BoxDecoration(
                    color: data.biome.accent,
                    shape: BoxShape.circle,
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    data.biome.label,
                    style: const TextStyle(
                      fontWeight: FontWeight.w700,
                      fontSize: 14,
                    ),
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.close, size: 18),
                  color: CyberColors.textSecondary,
                  onPressed: onClose,
                ),
              ],
            ),
            Text(
              '(${tile.x}, ${tile.y}) · elevação ${data.elevation} · '
              'custo ${data.travelCost.isFinite ? data.travelCost.toStringAsFixed(1) : '∞'}',
              style: const TextStyle(
                fontSize: 11,
                color: CyberColors.textSecondary,
              ),
            ),
            if (data.hasResource) ...[
              const SizedBox(height: 8),
              Row(
                children: [
                  const Icon(Icons.diamond_outlined,
                      size: 14, color: CyberColors.green),
                  const SizedBox(width: 6),
                  Text(
                    '${ItemCatalog.of(data.resource!).name} · '
                    'riqueza ${(data.resourceRichness * 100).round()}%',
                    style: const TextStyle(
                      fontSize: 12,
                      color: CyberColors.green,
                    ),
                  ),
                ],
              ),
            ],
            const SizedBox(height: 10),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: data.isWalkable ? onMove : null,
                icon: const Icon(Icons.directions_walk, size: 16),
                label: Text(
                  data.isWalkable ? 'Ir para cá' : 'Intransponível',
                  style: const TextStyle(fontSize: 13),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
