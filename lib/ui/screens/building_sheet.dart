import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme.dart';
import '../../domain/building/building_module.dart';
import '../../domain/building/plot.dart';
import '../../domain/building/village_identity.dart';
import '../../domain/economy/item.dart';
import '../../state/providers.dart';
import '../widgets/sprite_ui.dart';
import '../widgets/vital_bar.dart';

/// Ficha de uma construção: renomear, pintar, evoluir de nível, instalar
/// módulos, alocar funcionários e demolir.
///
/// É uma folha rolável porque cada construção tem muita coisa — juntar tudo
/// numa tela cheia quebraria o fluxo de quem está só ajustando um detalhe.
Future<void> showBuildingSheet(
  BuildContext context,
  WidgetRef ref,
  String instanceId,
) async {
  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (sheetContext) => DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.82,
      maxChildSize: 0.95,
      builder: (_, scrollController) => _BuildingSheet(
        instanceId: instanceId,
        scrollController: scrollController,
      ),
    ),
  );
}

class _BuildingSheet extends ConsumerStatefulWidget {
  const _BuildingSheet({
    required this.instanceId,
    required this.scrollController,
  });

  final String instanceId;
  final ScrollController scrollController;

  @override
  ConsumerState<_BuildingSheet> createState() => _BuildingSheetState();
}

class _BuildingSheetState extends ConsumerState<_BuildingSheet> {
  late final TextEditingController _nameController;

  @override
  void initState() {
    super.initState();
    final building = ref
        .read(campaignControllerProvider)
        ?.plot
        .byInstanceId(widget.instanceId);
    _nameController = TextEditingController(text: building?.customName ?? '');
  }

  @override
  void dispose() {
    _nameController.dispose();
    super.dispose();
  }

  void _toast(String message) {
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    final campaign = ref.watch(campaignControllerProvider);
    final building = campaign?.plot.byInstanceId(widget.instanceId);

    if (campaign == null || building == null) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(32),
          child: Text('Construção não encontrada.'),
        ),
      );
    }

    final controller = ref.read(campaignControllerProvider.notifier);
    final def = building.def;
    final stats = building.stats;
    final accent = Color(building.accentColor ?? CyberColors.cyan.toARGB32());

    return ListView(
      controller: widget.scrollController,
      padding: const EdgeInsets.fromLTRB(20, 20, 20, 32),
      children: [
        // ---------------- Cabeçalho ----------------
        Row(
          children: [
            SizedBox(
              width: 52,
              height: 52,
              child: Image.asset(
                'assets/sprites/${def.spriteId.replaceFirst('/', '__')}.png',
                filterQuality: FilterQuality.medium,
                errorBuilder: (_, __, ___) =>
                    Icon(Icons.home_work, color: accent),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    building.displayName,
                    style: TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.w900,
                      color: accent,
                    ),
                  ),
                  Text(
                    '${def.name} · ${def.category.label} · '
                    'Nível ${BuildingUpgrade.romanFor(building.level)}',
                    style: const TextStyle(
                      fontSize: 11,
                      color: CyberColors.textSecondary,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        Text(
          def.description,
          style: const TextStyle(
            fontSize: 12,
            color: CyberColors.textSecondary,
          ),
        ),

        // ---------------- Estado ----------------
        const SizedBox(height: 14),
        if (!building.isReady)
          SpriteFrame(
            tint: CyberColors.amber,
            child: Text(
              building.upgrading
                  ? 'Evoluindo para nível ${BuildingUpgrade.romanFor(building.level)} — '
                      'faltam ${building.daysRemaining} dia(s). Não produz durante a obra.'
                  : 'Em obras — faltam ${building.daysRemaining} dia(s).',
              style: const TextStyle(fontSize: 11, color: CyberColors.amber),
            ),
          )
        else if (building.idle)
          SpriteFrame(
            tint: CyberColors.danger,
            child: const Text(
              'PARADA: faltou caixa ou insumo no último reset.',
              style: TextStyle(fontSize: 11, color: CyberColors.danger),
            ),
          )
        else
          SpriteFrame(
            tint: CyberColors.green,
            child: const Text(
              'Operando normalmente.',
              style: TextStyle(fontSize: 11, color: CyberColors.green),
            ),
          ),

        // ---------------- Números efetivos ----------------
        const SectionHeader('Rendimento atual'),
        Wrap(
          spacing: 6,
          runSpacing: 6,
          children: [
            if (def.produces != null)
              StatChip(
                label: '${ItemCatalog.of(def.produces!).name}/dia',
                value: '${stats.outputPerDay}',
                color: CyberColors.green,
              ),
            if (stats.jobSlots > 0)
              StatChip(
                label: 'vagas',
                value: '${building.workers}/${stats.jobSlots}',
                color: CyberColors.cyan,
              ),
            StatChip(
              label: '¢/dia',
              value: '-${stats.dailyUpkeep}',
              color: CyberColors.amber,
            ),
            if (stats.defenseBonus > 0)
              StatChip(
                label: 'defesa',
                value: '+${stats.defenseBonus}',
                color: CyberColors.pink,
              ),
            if (stats.storageBonus > 0)
              StatChip(
                label: 'estoque',
                value: '+${stats.storageBonus}',
                color: CyberColors.violet,
              ),
            if (stats.statusBonus > 0)
              StatChip(
                label: 'status',
                value: '+${stats.statusBonus}',
                color: CyberColors.pink,
              ),
          ],
        ),
        if (building.consumesPerDay.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(
              'Consome por dia: ${building.consumesPerDay.entries.map((e) => '${e.value}x ${ItemCatalog.of(e.key).name}').join(' · ')}',
              style: const TextStyle(fontSize: 11, color: CyberColors.amber),
            ),
          ),

        // ---------------- Funcionários ----------------
        if (stats.jobSlots > 0 && building.isReady) ...[
          const SectionHeader('Funcionários'),
          Slider(
            value: building.workers.toDouble().clamp(0, stats.jobSlots.toDouble()),
            max: stats.jobSlots.toDouble(),
            divisions: stats.jobSlots,
            label: '${building.workers}',
            onChanged: (v) => setState(
              () => controller.assignWorkers(widget.instanceId, v.round()),
            ),
          ),
          Text(
            stats.ignoresStaffing
                ? 'Núcleo de Automação instalado: rende 100% mesmo sem ninguém.'
                : 'Vaga vazia rende só 35%. Cheia, 100%.',
            style: TextStyle(
              fontSize: 10,
              color: stats.ignoresStaffing
                  ? CyberColors.green
                  : CyberColors.outline,
            ),
          ),
        ],

        // ---------------- Personalização ----------------
        const SectionHeader('Personalização'),
        TextField(
          controller: _nameController,
          decoration: InputDecoration(
            labelText: 'Nome próprio',
            hintText: def.name,
            prefixIcon: const Icon(Icons.edit_outlined),
            suffixIcon: IconButton(
              icon: const Icon(Icons.check),
              onPressed: () {
                controller.customizeBuilding(
                  widget.instanceId,
                  name: _nameController.text,
                );
                setState(() {});
                _toast('Renomeado.');
              },
            ),
          ),
          onSubmitted: (value) {
            controller.customizeBuilding(widget.instanceId, name: value);
            setState(() {});
          },
        ),
        const SizedBox(height: 14),
        const Text(
          'Cor do letreiro',
          style: TextStyle(fontSize: 11, color: CyberColors.textSecondary),
        ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final (label, argb) in VillagePalette.swatches)
              _Swatch(
                label: label,
                argb: argb,
                selected: building.accentColor == argb,
                onTap: () {
                  controller.customizeBuilding(
                    widget.instanceId,
                    accentColor: argb,
                  );
                  setState(() {});
                },
              ),
          ],
        ),

        // ---------------- Upgrade ----------------
        const SectionHeader('Nível'),
        _LevelTrack(level: building.level),
        const SizedBox(height: 10),
        if (!building.canUpgrade)
          const Text(
            'Nível máximo alcançado.',
            style: TextStyle(fontSize: 11, color: CyberColors.green),
          )
        else ...[
          Builder(
            builder: (_) {
              final cost = BuildingUpgrade.creditCost(def, building.level);
              final materials =
                  BuildingUpgrade.materialCost(def, building.level);
              final days = BuildingUpgrade.days(def, building.level);
              return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Nível ${BuildingUpgrade.romanFor(building.level + 1)}: '
                    'produção x${BuildingUpgrade.outputMultiplierFor(building.level + 1)}, '
                    '${BuildingUpgrade.moduleSlotsFor(building.level + 1)} slots de módulo.',
                    style: const TextStyle(fontSize: 11),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'Custo: $cost¢ · $days dia(s) · '
                    '${materials.entries.map((e) => '${e.value}x ${ItemCatalog.of(e.key).name}').join(' · ')}',
                    style: const TextStyle(
                      fontSize: 11,
                      color: CyberColors.green,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'Manutenção sobe para '
                    '${(def.dailyUpkeep * BuildingUpgrade.upkeepMultiplierFor(building.level + 1)).round()}¢/dia.',
                    style: const TextStyle(
                      fontSize: 11,
                      color: CyberColors.amber,
                    ),
                  ),
                  const SizedBox(height: 12),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton.icon(
                      onPressed: building.isReady
                          ? () {
                              final result =
                                  controller.upgradeBuilding(widget.instanceId);
                              setState(() {});
                              _toast(switch (result) {
                                BuildAccepted(:final building) =>
                                  'Upgrade iniciado: nível '
                                      '${BuildingUpgrade.romanFor(building.level)}.',
                                BuildRejected(:final reason) => reason,
                              });
                            }
                          : null,
                      icon: const Icon(Icons.upgrade, size: 18),
                      label: Text(
                        'EVOLUIR PARA ${BuildingUpgrade.romanFor(building.level + 1)}',
                      ),
                    ),
                  ),
                ],
              );
            },
          ),
        ],

        // ---------------- Módulos ----------------
        SectionHeader(
          'Módulos (${building.modules.length}/${building.moduleSlots})',
        ),
        if (building.modules.isNotEmpty) ...[
          for (final module in building.modules)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Row(
                children: [
                  const Icon(Icons.extension,
                      size: 15, color: CyberColors.green),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(module.label,
                            style: const TextStyle(fontSize: 12)),
                        Text(
                          module.description,
                          style: const TextStyle(
                            fontSize: 10,
                            color: CyberColors.outline,
                          ),
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.close, size: 16),
                    color: CyberColors.danger,
                    tooltip: 'Remover (sem devolução)',
                    onPressed: () {
                      controller.uninstallModule(widget.instanceId, module);
                      setState(() {});
                      _toast('${module.label} removido.');
                    },
                  ),
                ],
              ),
            ),
          const SizedBox(height: 8),
        ],
        if (!building.canAddModule)
          Text(
            'Sem slots livres. Evolua para nível '
            '${BuildingUpgrade.romanFor(building.level + 1)} para liberar mais.',
            style: const TextStyle(fontSize: 11, color: CyberColors.amber),
          )
        else
          for (final module in BuildingModule.values)
            if (module.fitsIn(def.category) &&
                !building.modules.contains(module))
              _ModuleOption(
                module: module,
                affordable: campaign.character.credits >= module.creditCost,
                onInstall: () {
                  final result =
                      controller.installModule(widget.instanceId, module);
                  setState(() {});
                  _toast(switch (result) {
                    BuildAccepted() => '${module.label} instalado.',
                    BuildRejected(:final reason) => reason,
                  });
                },
              ),

        // ---------------- Demolir ----------------
        const SizedBox(height: 24),
        OutlinedButton.icon(
          style: OutlinedButton.styleFrom(foregroundColor: CyberColors.danger),
          onPressed: () {
            final refund = controller.demolish(widget.instanceId);
            Navigator.pop(context);
            final summary = refund.isEmpty
                ? 'sem recuperação de material'
                : refund.entries
                    .map((e) => '${e.value}x ${ItemCatalog.of(e.key).name}')
                    .join(', ');
            _toast('Demolido — $summary.');
          },
          icon: const Icon(Icons.delete_forever, size: 16),
          label: const Text('DEMOLIR (metade do material base volta)'),
        ),
      ],
    );
  }
}

class _Swatch extends StatelessWidget {
  const _Swatch({
    required this.label,
    required this.argb,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final int argb;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final color = Color(argb);
    return Tooltip(
      message: label,
      child: GestureDetector(
        onTap: onTap,
        child: Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(
            color: color,
            borderRadius: BorderRadius.circular(9),
            border: Border.all(
              color: selected ? Colors.white : Colors.transparent,
              width: 2.5,
            ),
          ),
          child: selected
              ? const Icon(Icons.check, size: 18, color: Colors.black)
              : null,
        ),
      ),
    );
  }
}

/// Trilha visual dos três níveis.
class _LevelTrack extends StatelessWidget {
  const _LevelTrack({required this.level});

  final int level;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        for (var i = 1; i <= BuildingUpgrade.maxLevel; i++) ...[
          Expanded(
            child: Container(
              height: 34,
              decoration: BoxDecoration(
                color: i <= level
                    ? CyberColors.cyan.withValues(alpha: 0.20)
                    : CyberColors.surfaceHigh,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(
                  color: i <= level ? CyberColors.cyan : CyberColors.outline,
                ),
              ),
              alignment: Alignment.center,
              child: Text(
                BuildingUpgrade.romanFor(i),
                style: TextStyle(
                  fontWeight: FontWeight.w900,
                  color:
                      i <= level ? CyberColors.cyan : CyberColors.outline,
                ),
              ),
            ),
          ),
          if (i < BuildingUpgrade.maxLevel) const SizedBox(width: 6),
        ],
      ],
    );
  }
}

class _ModuleOption extends StatelessWidget {
  const _ModuleOption({
    required this.module,
    required this.affordable,
    required this.onInstall,
  });

  final BuildingModule module;
  final bool affordable;
  final VoidCallback onInstall;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Card(
        child: InkWell(
          borderRadius: BorderRadius.circular(14),
          onTap: onInstall,
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Row(
              children: [
                const Icon(Icons.extension_outlined,
                    size: 18, color: CyberColors.violet),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        module.label,
                        style: const TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      Text(
                        module.description,
                        style: const TextStyle(
                          fontSize: 10,
                          color: CyberColors.textSecondary,
                        ),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        '${module.creditCost}¢ · '
                        '${module.materialCost.entries.map((e) => '${e.value}x ${ItemCatalog.of(e.key).name}').join(' · ')}',
                        style: TextStyle(
                          fontSize: 10,
                          color: affordable
                              ? CyberColors.green
                              : CyberColors.danger,
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
    );
  }
}
