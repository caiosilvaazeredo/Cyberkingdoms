import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme.dart';
import '../../state/providers.dart';
import '../widgets/vital_bar.dart';
import 'campaign_screen.dart';
import 'character_screen.dart';
import 'city_screen.dart';
import 'market_screen.dart';
import 'plot_screen.dart';
import 'politics_screen.dart';
import 'world_screen.dart';

/// Casca do jogo: HUD fixo no topo, navegação por abas embaixo.
///
/// A navegação é por polegar — todas as abas ficam no alcance da mão numa tela
/// de celular, e o HUD com Fome/Sede está sempre visível porque descuidar dele
/// mata o personagem.
class GameShell extends ConsumerStatefulWidget {
  const GameShell({super.key});

  @override
  ConsumerState<GameShell> createState() => _GameShellState();
}

class _GameShellState extends ConsumerState<GameShell> {
  int _tab = 0;

  static const _tabs = [
    _TabSpec('Mundo', Icons.public),
    _TabSpec('Missões', Icons.flag),
    _TabSpec('Terreno', Icons.home_work),
    _TabSpec('Cidade', Icons.apartment),
    _TabSpec('Mercado', Icons.storefront),
    _TabSpec('Ficha', Icons.badge),
    _TabSpec('Política', Icons.account_balance),
  ];

  @override
  Widget build(BuildContext context) {
    final campaign = ref.watch(campaignControllerProvider);

    if (campaign == null) {
      return const Scaffold(
        body: Center(child: CircularProgressIndicator(color: CyberColors.cyan)),
      );
    }

    if (campaign.character.dead) {
      return const _DeathScreen();
    }

    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            const _Hud(),
            Expanded(
              child: IndexedStack(
                index: _tab,
                children: const [
                  WorldScreen(),
                  CampaignScreen(),
                  PlotScreen(),
                  CityScreen(),
                  MarketScreen(),
                  CharacterScreen(),
                  PoliticsScreen(),
                ],
              ),
            ),
          ],
        ),
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: (index) => setState(() => _tab = index),
        backgroundColor: CyberColors.surface,
        indicatorColor: CyberColors.cyan.withValues(alpha: 0.18),
        height: 64,
        labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
        destinations: [
          for (final tab in _tabs)
            NavigationDestination(
              icon: Icon(tab.icon, size: 22),
              label: tab.label,
            ),
        ],
      ),
    );
  }
}

class _TabSpec {
  const _TabSpec(this.label, this.icon);
  final String label;
  final IconData icon;
}

/// HUD persistente: barras vitais, créditos, dia e o botão de fechar o dia.
class _Hud extends ConsumerWidget {
  const _Hud();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final campaign = ref.watch(campaignControllerProvider);
    if (campaign == null) return const SizedBox.shrink();

    final character = campaign.character;
    final settlement = campaign.world.layout.byId(
      campaign.currentSettlementId ?? character.homeSettlementId,
    );

    return Container(
      padding: const EdgeInsets.fromLTRB(14, 10, 14, 12),
      decoration: const BoxDecoration(
        color: CyberColors.surface,
        border: Border(bottom: BorderSide(color: CyberColors.outline)),
      ),
      child: Column(
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      character.name,
                      style: const TextStyle(
                        fontWeight: FontWeight.w700,
                        fontSize: 14,
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                    Text(
                      character.isTravelling
                          ? 'Em trânsito · ${character.travelDaysRemaining}d restante(s)'
                          : settlement?.name ?? 'Zona selvagem',
                      style: TextStyle(
                        fontSize: 11,
                        color: character.isTravelling
                            ? CyberColors.amber
                            : CyberColors.textSecondary,
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
              StatChip(
                label: '¢',
                value: '${character.credits}',
                color: CyberColors.amber,
              ),
              const SizedBox(width: 6),
              StatChip(
                label: 'dia',
                value: '${campaign.day}',
                color: CyberColors.violet,
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: VitalBar(
                  label: 'FOME',
                  value: character.hunger,
                  max: 100,
                  compact: true,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: VitalBar(
                  label: 'SEDE',
                  value: character.thirst,
                  max: 100,
                  compact: true,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: VitalBar(
                  label: 'HP',
                  value: character.hp,
                  max: character.maxHp,
                  color: CyberColors.pink,
                  compact: true,
                ),
              ),
              const SizedBox(width: 12),
              SizedBox(
                height: 34,
                child: FilledButton(
                  style: FilledButton.styleFrom(
                    backgroundColor: CyberColors.pink,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    minimumSize: Size.zero,
                    textStyle: const TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  onPressed: () => _endDay(context, ref),
                  child: const Text('RESET'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Future<void> _endDay(BuildContext context, WidgetRef ref) async {
    final report = ref.read(campaignControllerProvider.notifier).endDay();
    if (!context.mounted) return;

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (sheetContext) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.72,
        maxChildSize: 0.92,
        builder: (_, controller) => ListView(
          controller: controller,
          padding: const EdgeInsets.fromLTRB(20, 20, 20, 32),
          children: [
            Text(
              'RESET DO DIA ${report.day}',
              style: const TextStyle(
                fontWeight: FontWeight.w900,
                letterSpacing: 1.5,
                fontSize: 16,
              ),
            ),
            const SizedBox(height: 4),
            const Text(
              'À meia-noite o servidor soma tudo que você fez.',
              style: TextStyle(color: CyberColors.textSecondary, fontSize: 12),
            ),

            const SectionHeader('Consumo do dia'),
            for (final line in report.upkeep.lines)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 3),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        line.label,
                        style: const TextStyle(fontSize: 12),
                      ),
                    ),
                    SizedBox(
                      width: 52,
                      child: Text(
                        line.upkeep.hunger == 0
                            ? '—'
                            : '${line.upkeep.hunger > 0 ? '-' : '+'}'
                                '${line.upkeep.hunger.abs()}',
                        textAlign: TextAlign.right,
                        style: const TextStyle(
                          fontSize: 12,
                          color: CyberColors.amber,
                        ),
                      ),
                    ),
                    SizedBox(
                      width: 52,
                      child: Text(
                        line.upkeep.thirst == 0
                            ? '—'
                            : '${line.upkeep.thirst > 0 ? '-' : '+'}'
                                '${line.upkeep.thirst.abs()}',
                        textAlign: TextAlign.right,
                        style: const TextStyle(
                          fontSize: 12,
                          color: CyberColors.cyan,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            const Divider(height: 20),
            Row(
              children: [
                const Expanded(
                  child: Text(
                    'TOTAL',
                    style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13),
                  ),
                ),
                SizedBox(
                  width: 52,
                  child: Text(
                    '-${report.upkeep.total.hunger}',
                    textAlign: TextAlign.right,
                    style: const TextStyle(
                      fontWeight: FontWeight.w800,
                      color: CyberColors.amber,
                    ),
                  ),
                ),
                SizedBox(
                  width: 52,
                  child: Text(
                    '-${report.upkeep.total.thirst}',
                    textAlign: TextAlign.right,
                    style: const TextStyle(
                      fontWeight: FontWeight.w800,
                      color: CyberColors.cyan,
                    ),
                  ),
                ),
              ],
            ),

            if (report.completedQuests.isNotEmpty) ...[
              const SectionHeader('Quests concluídas'),
              for (final quest in report.completedQuests)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Icon(Icons.check_circle,
                          size: 15, color: CyberColors.green),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              quest.title,
                              style: const TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.w700,
                                color: CyberColors.green,
                              ),
                            ),
                            if (!quest.reward.isEmpty)
                              Text(
                                quest.reward.summary,
                                style: const TextStyle(
                                  fontSize: 11,
                                  color: CyberColors.amber,
                                ),
                              ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
            ],

            if (report.events.isNotEmpty) ...[
              const SectionHeader('Acontecimentos'),
              for (final event in report.events)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('› ',
                          style: TextStyle(color: CyberColors.pink)),
                      Expanded(
                        child: Text(
                          event,
                          style: const TextStyle(fontSize: 12),
                        ),
                      ),
                    ],
                  ),
                ),
            ],

            if (report.combat case final combat?) ...[
              const SectionHeader('Relatório de combate'),
              for (final entry in combat.log.take(12))
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 2),
                  child: Text(
                    entry.toString(),
                    style: TextStyle(
                      fontSize: 11,
                      color: entry.critical
                          ? CyberColors.pink
                          : CyberColors.textSecondary,
                    ),
                  ),
                ),
            ],

            const SizedBox(height: 24),
            FilledButton(
              onPressed: () => Navigator.pop(sheetContext),
              child: const Text('CONTINUAR'),
            ),
          ],
        ),
      ),
    );
  }
}

class _DeathScreen extends ConsumerWidget {
  const _DeathScreen();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final campaign = ref.watch(campaignControllerProvider);

    return Scaffold(
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.dangerous, size: 64, color: CyberColors.danger),
              const SizedBox(height: 20),
              const Text(
                'MORTE PERMANENTE',
                style: TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.w900,
                  letterSpacing: 2,
                  color: CyberColors.danger,
                ),
              ),
              const SizedBox(height: 12),
              Text(
                campaign?.character.deathReason ??
                    'O personagem não sobreviveu.',
                textAlign: TextAlign.center,
                style: const TextStyle(color: CyberColors.textSecondary),
              ),
              const SizedBox(height: 8),
              Text(
                'Sobreviveu ${campaign?.day ?? 0} dias.',
                style: const TextStyle(color: CyberColors.outline, fontSize: 12),
              ),
              const SizedBox(height: 32),
              FilledButton(
                onPressed: () {
                  ref.read(campaignControllerProvider.notifier).close();
                  ref.invalidate(campaignListProvider);
                  Navigator.of(context).pop();
                },
                child: const Text('VOLTAR AO MENU'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
