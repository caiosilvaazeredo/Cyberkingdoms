import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme.dart';
import '../../domain/building/building_module.dart';
import '../../domain/building/building_type.dart';
import '../../domain/building/plot.dart';
import '../../domain/economy/item.dart';
import '../../state/providers.dart';
import '../widgets/sprite_ui.dart';
import '../widgets/vital_bar.dart';
import 'building_sheet.dart';
import 'village_identity_sheet.dart';

/// O terreno do jogador: grade de construção, catálogo e gestão de obras.
///
/// Regra central: **só se constrói aqui**, e o terreno fica dentro de uma
/// metrópole. Se o jogador estiver em outra cidade, a tela mostra o estado do
/// terreno mas não deixa construir.
class PlotScreen extends ConsumerStatefulWidget {
  const PlotScreen({super.key});

  @override
  ConsumerState<PlotScreen> createState() => _PlotScreenState();
}

class _PlotScreenState extends ConsumerState<PlotScreen> {
  /// Construção escolhida no catálogo, aguardando um toque na grade.
  BuildingId? _pending;

  @override
  Widget build(BuildContext context) {
    final campaign = ref.watch(campaignControllerProvider);
    if (campaign == null) return const SizedBox.shrink();

    final plot = campaign.plot;
    final settlement = campaign.world.layout.byId(plot.settlementId);
    final onSite = campaign.currentSettlementId == plot.settlementId;

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
      children: [
        SpritePanel.blue(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    width: 44,
                    height: 44,
                    padding: const EdgeInsets.all(3),
                    decoration: BoxDecoration(
                      color: CyberColors.background.withValues(alpha: 0.45),
                      borderRadius: BorderRadius.circular(9),
                      border: Border.all(
                        color: Color(plot.identity.secondaryColor)
                            .withValues(alpha: 0.7),
                      ),
                    ),
                    child: Image.asset(
                      plot.identity.emblem.assetPath,
                      filterQuality: FilterQuality.medium,
                      errorBuilder: (_, __, ___) => const Icon(Icons.flag),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          plot.identity.name,
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w900,
                            color: Color(plot.identity.primaryColor),
                          ),
                          overflow: TextOverflow.ellipsis,
                        ),
                        if (plot.identity.motto.trim().isNotEmpty)
                          Text(
                            '"${plot.identity.motto.trim()}"',
                            style: TextStyle(
                              fontSize: 10,
                              fontStyle: FontStyle.italic,
                              color: Color(plot.identity.secondaryColor),
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                      ],
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.brush_outlined, size: 20),
                    color: CyberColors.cyan,
                    tooltip: 'Editar identidade',
                    onPressed: () async {
                      await showVillageIdentitySheet(context, ref);
                      if (mounted) setState(() {});
                    },
                  ),
                ],
              ),
              const SizedBox(height: 2),
              Text(
                'Dentro de ${settlement?.name ?? plot.settlementId} · '
                '${plot.width}x${plot.height} tiles',
                style: const TextStyle(
                  fontSize: 11,
                  color: CyberColors.textSecondary,
                ),
              ),
              const SizedBox(height: 12),
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [
                  StatChip(
                    label: 'livres',
                    value: '${plot.freeTiles}',
                    color: CyberColors.green,
                  ),
                  StatChip(
                    label: 'empregos',
                    value: '${plot.employedWorkers}/${plot.totalJobSlots}',
                    color: CyberColors.cyan,
                  ),
                  StatChip(
                    label: 'defesa',
                    value: '${plot.defense}',
                    color: CyberColors.pink,
                  ),
                  StatChip(
                    label: 'estoque',
                    value: '${plot.storageCapacity}',
                    color: CyberColors.amber,
                  ),
                  StatChip(
                    label: '¢/dia',
                    value: '-${plot.dailyUpkeep}',
                    color: CyberColors.violet,
                  ),
                  StatChip(
                    label: 'status',
                    value: '+${plot.statusBonus}',
                    color: CyberColors.pink,
                  ),
                ],
              ),
            ],
          ),
        ),

        if (!onSite)
          Padding(
            padding: const EdgeInsets.only(top: 12),
            child: SpriteFrame(
              tint: CyberColors.amber,
              child: Text(
                'Você está longe do terreno. Volte para '
                '${settlement?.name ?? 'sua cidade'} para construir. '
                'A produção continua rodando sem você.',
                style: const TextStyle(fontSize: 11, color: CyberColors.amber),
              ),
            ),
          ),

        SectionHeader(
          'Planta do terreno',
          trailing: _pending == null
              ? null
              : TextButton(
                  onPressed: () => setState(() => _pending = null),
                  child: const Text('CANCELAR', style: TextStyle(fontSize: 11)),
                ),
        ),
        if (_pending != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Text(
              'Toque numa célula livre para posicionar '
              '${BuildingCatalog.of(_pending!).name} '
              '(${BuildingCatalog.of(_pending!).width}x'
              '${BuildingCatalog.of(_pending!).height}).',
              style: const TextStyle(fontSize: 11, color: CyberColors.cyan),
            ),
          ),
        _PlotGrid(
          plot: plot,
          pending: _pending,
          onTapCell: onSite ? _placeAt : null,
          onTapBuilding: (building) async {
            await showBuildingSheet(context, ref, building.instanceId);
            if (mounted) setState(() {});
          },
        ),

        if (plot.underConstruction.isNotEmpty) ...[
          const SectionHeader('Em obras'),
          for (final building in plot.underConstruction)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Row(
                children: [
                  const Icon(Icons.construction,
                      size: 15, color: CyberColors.amber),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      building.upgrading
                          ? '${building.displayName} » nível '
                              '${BuildingUpgrade.romanFor(building.level)}'
                          : building.displayName,
                      style: const TextStyle(fontSize: 12),
                    ),
                  ),
                  Text(
                    '${building.daysRemaining}d',
                    style: const TextStyle(
                      fontSize: 12,
                      color: CyberColors.amber,
                    ),
                  ),
                ],
              ),
            ),
        ],

        const SectionHeader('Catálogo de construções'),
        Text(
          '${BuildingCatalog.count} tipos disponíveis · '
          'liberados no seu nível: '
          '${BuildingCatalog.availableAt(campaign.character.level).length}',
          style: const TextStyle(fontSize: 11, color: CyberColors.textSecondary),
        ),
        const SizedBox(height: 10),
        for (final category in BuildingCategory.values)
          _CategorySection(
            category: category,
            level: campaign.character.level,
            enabled: onSite,
            onPick: (id) => setState(() => _pending = id),
          ),
      ],
    );
  }

  void _placeAt(int x, int y) {
    final pending = _pending;
    if (pending == null) return;

    final campaign = ref.read(campaignControllerProvider);
    if (campaign == null) return;

    final result = ref.read(campaignControllerProvider.notifier).build(
          type: pending,
          x: x,
          y: y,
        );

    final message = switch (result) {
      BuildAccepted(:final building) =>
        'Obra iniciada: ${building.def.name} (${building.daysRemaining} dia(s)).',
      BuildRejected(:final reason) => reason,
    };

    if (result is BuildAccepted) setState(() => _pending = null);
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
  }

}

/// Grade do terreno vista de cima. É deliberadamente ortogonal, não
/// isométrica: posicionar prédio com o dedo num losango é frustrante, e esta
/// tela é sobre planejamento, não sobre contemplação — o mundo isométrico está
/// na aba Mundo.
class _PlotGrid extends StatelessWidget {
  const _PlotGrid({
    required this.plot,
    required this.pending,
    required this.onTapCell,
    required this.onTapBuilding,
  });

  final Plot plot;
  final BuildingId? pending;
  final void Function(int x, int y)? onTapCell;
  final void Function(PlacedBuilding building) onTapBuilding;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final cell = constraints.maxWidth / plot.width;

        return SizedBox(
          width: constraints.maxWidth,
          height: cell * plot.height,
          child: Stack(
            children: [
              // Células vazias.
              for (var y = 0; y < plot.height; y++)
                for (var x = 0; x < plot.width; x++)
                  Positioned(
                    left: x * cell,
                    top: y * cell,
                    width: cell,
                    height: cell,
                    child: _Cell(
                      highlight: pending != null && plot.buildingAt(x, y) == null,
                      onTap: onTapCell == null ? null : () => onTapCell!(x, y),
                    ),
                  ),

              // Construções, desenhadas por cima ocupando seu retângulo.
              for (final building in plot.buildings)
                Positioned(
                  left: building.x * cell,
                  top: building.y * cell,
                  width: building.def.width * cell,
                  height: building.def.height * cell,
                  child: _BuildingTile(
                    building: building,
                    onTap: () => onTapBuilding(building),
                  ),
                ),
            ],
          ),
        );
      },
    );
  }
}

class _Cell extends StatelessWidget {
  const _Cell({required this.highlight, required this.onTap});

  final bool highlight;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        margin: const EdgeInsets.all(1),
        decoration: BoxDecoration(
          color: highlight
              ? CyberColors.cyan.withValues(alpha: 0.10)
              : CyberColors.surface,
          border: Border.all(
            color: highlight ? CyberColors.cyan : CyberColors.outline,
            width: highlight ? 1.2 : 0.6,
          ),
          borderRadius: BorderRadius.circular(3),
        ),
      ),
    );
  }
}

class _BuildingTile extends StatelessWidget {
  const _BuildingTile({required this.building, required this.onTap});

  final PlacedBuilding building;
  final VoidCallback onTap;

  static const Map<BuildingCategory, Color> _categoryColors = {
    BuildingCategory.housing: CyberColors.violet,
    BuildingCategory.extraction: CyberColors.amber,
    BuildingCategory.refining: CyberColors.cyan,
    BuildingCategory.manufacturing: CyberColors.pink,
    BuildingCategory.commerce: CyberColors.green,
    BuildingCategory.infrastructure: Color(0xFF80CBC4),
    BuildingCategory.defense: CyberColors.danger,
    BuildingCategory.civic: Color(0xFFFFF176),
  };

  @override
  Widget build(BuildContext context) {
    final def = building.def;
    // A cor escolhida pelo jogador vence a cor da categoria.
    final color = building.accentColor != null
        ? Color(building.accentColor!)
        : (_categoryColors[def.category] ?? CyberColors.cyan);
    final ready = building.isReady;

    return GestureDetector(
      onTap: onTap,
      child: Container(
        margin: const EdgeInsets.all(1.5),
        decoration: BoxDecoration(
          color: color.withValues(alpha: ready ? 0.22 : 0.10),
          border: Border.all(
            color: building.idle ? CyberColors.danger : color,
            width: 1.4,
          ),
          borderRadius: BorderRadius.circular(4),
        ),
        child: Stack(
          children: [
            Center(
              child: Padding(
                padding: const EdgeInsets.all(2),
                child: FittedBox(
                  child: Image.asset(
                    _spriteAsset(def.spriteId),
                    filterQuality: FilterQuality.medium,
                    errorBuilder: (_, __, ___) => Icon(
                      ready ? Icons.home_work : Icons.construction,
                      color: color,
                    ),
                  ),
                ),
              ),
            ),
            if (!ready)
              Positioned(
                right: 2,
                top: 2,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 4),
                  decoration: BoxDecoration(
                    color: CyberColors.amber,
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: Text(
                    '${building.daysRemaining}',
                    style: const TextStyle(
                      fontSize: 9,
                      fontWeight: FontWeight.w900,
                      color: Colors.black,
                    ),
                  ),
                ),
              ),
            if (building.idle && ready)
              const Positioned(
                right: 2,
                top: 2,
                child: Icon(Icons.warning_amber,
                    size: 12, color: CyberColors.danger),
              ),
            // Nível e módulos: leitura rápida de quais prédios já foram
            // investidos, sem precisar abrir a ficha de cada um.
            if (building.level > 1)
              Positioned(
                left: 2,
                bottom: 2,
                child: Text(
                  BuildingUpgrade.romanFor(building.level),
                  style: TextStyle(
                    fontSize: 9,
                    fontWeight: FontWeight.w900,
                    color: color,
                  ),
                ),
              ),
            if (building.modules.isNotEmpty)
              Positioned(
                right: 2,
                bottom: 2,
                child: Row(
                  children: [
                    for (var i = 0; i < building.modules.length; i++)
                      Padding(
                        padding: const EdgeInsets.only(left: 1),
                        child: Container(
                          width: 4,
                          height: 4,
                          decoration: BoxDecoration(
                            color: color,
                            shape: BoxShape.circle,
                          ),
                        ),
                      ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }

  /// O manifesto usa `kit/nome`; os arquivos, `kit__nome.png`.
  static String _spriteAsset(String spriteId) =>
      'assets/sprites/${spriteId.replaceFirst('/', '__')}.png';
}

class _CategorySection extends ConsumerWidget {
  const _CategorySection({
    required this.category,
    required this.level,
    required this.enabled,
    required this.onPick,
  });

  final BuildingCategory category;
  final dynamic level;
  final bool enabled;
  final void Function(BuildingId) onPick;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final campaign = ref.watch(campaignControllerProvider);
    if (campaign == null) return const SizedBox.shrink();

    final defs = BuildingCatalog.byCategory(category);

    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            category.label.toUpperCase(),
            style: const TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w800,
              letterSpacing: 1.2,
              color: CyberColors.cyan,
            ),
          ),
          Text(
            category.description,
            style: const TextStyle(fontSize: 10, color: CyberColors.outline),
          ),
          const SizedBox(height: 8),
          for (final def in defs)
            _BuildingRow(
              def: def,
              affordable: campaign.character.credits >= def.creditCost,
              unlocked:
                  def.requiredLevel.rank <= campaign.character.level.rank,
              enabled: enabled,
              onPick: () => onPick(def.id),
            ),
        ],
      ),
    );
  }
}

class _BuildingRow extends StatelessWidget {
  const _BuildingRow({
    required this.def,
    required this.affordable,
    required this.unlocked,
    required this.enabled,
    required this.onPick,
  });

  final BuildingDef def;
  final bool affordable;
  final bool unlocked;
  final bool enabled;
  final VoidCallback onPick;

  @override
  Widget build(BuildContext context) {
    final selectable = enabled && unlocked;

    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Opacity(
        opacity: unlocked ? 1 : 0.45,
        child: Card(
          child: InkWell(
            borderRadius: BorderRadius.circular(14),
            onTap: selectable ? onPick : null,
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Row(
                children: [
                  SizedBox(
                    width: 38,
                    height: 38,
                    child: Image.asset(
                      _BuildingTile._spriteAsset(def.spriteId),
                      filterQuality: FilterQuality.medium,
                      errorBuilder: (_, __, ___) => const Icon(
                        Icons.home_work,
                        color: CyberColors.outline,
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Flexible(
                              child: Text(
                                def.name,
                                style: const TextStyle(
                                  fontSize: 13,
                                  fontWeight: FontWeight.w700,
                                ),
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                            if (!def.legal) ...[
                              const SizedBox(width: 6),
                              const Icon(Icons.gavel,
                                  size: 11, color: CyberColors.pink),
                            ],
                          ],
                        ),
                        Text(
                          def.description,
                          style: const TextStyle(
                            fontSize: 10,
                            color: CyberColors.textSecondary,
                          ),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 4),
                        Wrap(
                          spacing: 8,
                          children: [
                            _Tag('${def.width}x${def.height}',
                                CyberColors.textSecondary),
                            _Tag('${def.creditCost}¢',
                                affordable ? CyberColors.amber : CyberColors.danger),
                            _Tag('${def.buildDays}d', CyberColors.violet),
                            if (def.jobSlots > 0)
                              _Tag('${def.jobSlots} vagas', CyberColors.cyan),
                            if (def.dailyUpkeep > 0)
                              _Tag('-${def.dailyUpkeep}¢/dia',
                                  CyberColors.textSecondary),
                          ],
                        ),
                        if (def.materialCost.isNotEmpty)
                          Padding(
                            padding: const EdgeInsets.only(top: 3),
                            child: Text(
                              def.materialCost.entries
                                  .map((e) =>
                                      '${e.value}x ${ItemCatalog.of(e.key).name}')
                                  .join(' · '),
                              style: const TextStyle(
                                fontSize: 10,
                                color: CyberColors.green,
                              ),
                            ),
                          ),
                        if (!unlocked)
                          Padding(
                            padding: const EdgeInsets.only(top: 3),
                            child: Text(
                              'Requer ${def.requiredLevel.label}',
                              style: const TextStyle(
                                fontSize: 10,
                                color: CyberColors.amber,
                              ),
                            ),
                          ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _Tag extends StatelessWidget {
  const _Tag(this.text, this.color);

  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) => Text(
        text,
        style: TextStyle(fontSize: 10, color: color),
      );
}
