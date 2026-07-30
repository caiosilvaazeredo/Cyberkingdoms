import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/audio/audio_service.dart';
import '../../core/theme.dart';
import '../../domain/economy/item.dart';
import '../../domain/survival/survival_tables.dart';
import '../../domain/world/settlement.dart';
import '../../state/providers.dart';
import '../widgets/vital_bar.dart';

/// A cidade onde o jogador está: escolher o trabalho do dia, ver a vocação
/// econômica local e viajar para outras cidades pelas estradas.
class CityScreen extends ConsumerWidget {
  const CityScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final campaign = ref.watch(campaignControllerProvider);
    if (campaign == null) return const SizedBox.shrink();

    final controller = ref.read(campaignControllerProvider.notifier);
    final settlementId = campaign.currentSettlementId;
    final settlement =
        settlementId == null ? null : campaign.world.layout.byId(settlementId);

    if (campaign.character.isTravelling) {
      return _TravellingNotice(
        daysLeft: campaign.character.travelDaysRemaining,
        destination: campaign.world.layout
            .byId(campaign.character.travellingTo ?? '')
            ?.name,
      );
    }

    if (settlement == null) {
      return const _OutsideCityNotice();
    }

    final government = campaign.governmentOf(settlement.id);
    final today = controller.today;

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
      children: [
        _CityHeader(settlement: settlement),

        const SectionHeader('Governo local'),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _KeyValue(
                  'Governador',
                  government.governorName ??
                      'Vago — próxima eleição em '
                          '${_daysToElection(campaign.day)} dia(s)',
                ),
                _KeyValue(
                  'Imposto (Mercado Central)',
                  '${(government.taxRate * 100).toStringAsFixed(1)}%',
                ),
                _KeyValue('Salário público', '${government.publicWage}¢/dia'),
                _KeyValue('Tesouro', '${government.treasury}¢'),
                _KeyValue(
                  'Vagas públicas',
                  '${settlement.publicJobSlots} slots',
                ),
              ],
            ),
          ),
        ),

        const SectionHeader('Trabalho do dia'),
        Text(
          today.worked
              ? 'Escalado: ${today.workLabel}'
              : 'Você ainda não escolheu o que fazer hoje.',
          style: TextStyle(
            fontSize: 12,
            color: today.worked ? CyberColors.green : CyberColors.textSecondary,
          ),
        ),
        const SizedBox(height: 12),

        _WorkGroup(
          title: 'Serviços Públicos',
          subtitle: 'Vagas limitadas · paga salário do tesouro',
          color: CyberColors.cyan,
          entries: [
            for (final work in PublicWork.values)
              _WorkEntry(
                label: work.label,
                upkeep: work.upkeep,
                selected: today.publicWork == work,
                onTap: () {
                  AudioService.instance.play(Sfx.toggle);
                  controller.chooseWork(publicWork: work);
                },
              ),
          ],
        ),
        _WorkGroup(
          title: 'Fazenda Player',
          subtitle: 'Sem limite de vagas · produção é sua',
          color: CyberColors.green,
          entries: [
            for (final work in PlayerFarmWork.values)
              _WorkEntry(
                label: work.label,
                upkeep: work.upkeep,
                selected: today.farmWork == work,
                onTap: () {
                  AudioService.instance.play(Sfx.toggle);
                  controller.chooseWork(farmWork: work);
                },
              ),
          ],
        ),
        _WorkGroup(
          title: 'Oficinas',
          subtitle: 'Camadas 2 e 3 da cadeia produtiva',
          color: CyberColors.violet,
          entries: [
            for (final work in WorkshopWork.values)
              _WorkEntry(
                label: work.label,
                upkeep: work.upkeep,
                selected: today.workshopWork == work,
                onTap: () {
                  AudioService.instance.play(Sfx.toggle);
                  controller.chooseWork(workshopWork: work);
                },
              ),
          ],
        ),

        if (today.worked) ...[
          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: controller.clearWork,
            icon: const Icon(Icons.close, size: 16),
            label: const Text('Ficar ocioso hoje'),
          ),
        ],

        const SectionHeader('Estradas (zona PvP)'),
        const Text(
          'Viajar consome Fome e Sede e expõe você a emboscadas. '
          'Durante o trânsito não dá para trabalhar nem negociar.',
          style: TextStyle(fontSize: 11, color: CyberColors.textSecondary),
        ),
        const SizedBox(height: 10),
        for (final road in campaign.world.layout.roadsFrom(settlement.id))
          _RoadCard(
            destination: campaign.world.layout
                .byId(campaign.world.layout.otherEnd(road, settlement.id)),
            road: road,
            onTravel: () {
              final error = controller.travelTo(
                campaign.world.layout.otherEnd(road, settlement.id),
              );
              if (error != null) {
                ScaffoldMessenger.of(context)
                    .showSnackBar(SnackBar(content: Text(error)));
              }
            },
          ),
      ],
    );
  }

  int _daysToElection(int day) {
    final period = 30;
    return period - (day % period);
  }
}

class _CityHeader extends StatelessWidget {
  const _CityHeader({required this.settlement});

  final Settlement settlement;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                  settlement.isCapital ? Icons.location_city : Icons.holiday_village,
                  color: settlement.isCapital
                      ? CyberColors.cyan
                      : CyberColors.violet,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    settlement.name,
                    style: const TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              '${settlement.kind.label} · ${settlement.vocation.label} · '
              '${_formatPopulation(settlement.population)} hab.',
              style: const TextStyle(
                fontSize: 12,
                color: CyberColors.textSecondary,
              ),
            ),
            const SizedBox(height: 12),
            const Text(
              'PRODUZ',
              style: TextStyle(
                fontSize: 10,
                letterSpacing: 1.2,
                color: CyberColors.green,
              ),
            ),
            const SizedBox(height: 4),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final item in settlement.vocation.produces)
                  _Pill(
                    label: ItemCatalog.of(item).name,
                    color: CyberColors.green,
                  ),
              ],
            ),
            const SizedBox(height: 10),
            const Text(
              'IMPORTA',
              style: TextStyle(
                fontSize: 10,
                letterSpacing: 1.2,
                color: CyberColors.amber,
              ),
            ),
            const SizedBox(height: 4),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final item in settlement.vocation.demands)
                  _Pill(
                    label: ItemCatalog.of(item).name,
                    color: CyberColors.amber,
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  String _formatPopulation(int value) {
    if (value >= 1000000) return '${(value / 1000000).toStringAsFixed(1)}M';
    if (value >= 1000) return '${(value / 1000).round()}k';
    return '$value';
  }
}

class _Pill extends StatelessWidget {
  const _Pill({required this.label, required this.color});

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: color.withValues(alpha: 0.35)),
      ),
      child: Text(
        label,
        style: TextStyle(fontSize: 11, color: color),
      ),
    );
  }
}

class _WorkGroup extends StatelessWidget {
  const _WorkGroup({
    required this.title,
    required this.subtitle,
    required this.color,
    required this.entries,
  });

  final String title;
  final String subtitle;
  final Color color;
  final List<_WorkEntry> entries;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w700,
              color: color,
            ),
          ),
          Text(
            subtitle,
            style: const TextStyle(fontSize: 10, color: CyberColors.outline),
          ),
          const SizedBox(height: 8),
          ...entries,
        ],
      ),
    );
  }
}

class _WorkEntry extends StatelessWidget {
  const _WorkEntry({
    required this.label,
    required this.upkeep,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final Upkeep upkeep;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Material(
        color: selected
            ? CyberColors.cyan.withValues(alpha: 0.12)
            : CyberColors.surface,
        borderRadius: BorderRadius.circular(10),
        child: InkWell(
          borderRadius: BorderRadius.circular(10),
          onTap: onTap,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(10),
              border: Border.all(
                color: selected ? CyberColors.cyan : CyberColors.outline,
              ),
            ),
            child: Row(
              children: [
                Icon(
                  selected ? Icons.check_circle : Icons.circle_outlined,
                  size: 18,
                  color: selected ? CyberColors.cyan : CyberColors.outline,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(label, style: const TextStyle(fontSize: 13)),
                ),
                Text(
                  '-${upkeep.hunger}',
                  style: const TextStyle(
                    fontSize: 12,
                    color: CyberColors.amber,
                  ),
                ),
                const SizedBox(width: 10),
                Text(
                  '-${upkeep.thirst}',
                  style: const TextStyle(
                    fontSize: 12,
                    color: CyberColors.cyan,
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

class _RoadCard extends StatelessWidget {
  const _RoadCard({
    required this.destination,
    required this.road,
    required this.onTravel,
  });

  final Settlement? destination;
  final Road road;
  final VoidCallback onTravel;

  @override
  Widget build(BuildContext context) {
    final danger = road.danger;
    final dangerColor = danger > 0.5
        ? CyberColors.danger
        : danger > 0.3
            ? CyberColors.amber
            : CyberColors.green;

    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 12, 12, 12),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      destination?.name ?? 'Destino desconhecido',
                      style: const TextStyle(
                        fontWeight: FontWeight.w700,
                        fontSize: 13,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Row(
                      children: [
                        const Icon(Icons.schedule,
                            size: 12, color: CyberColors.textSecondary),
                        const SizedBox(width: 4),
                        Text(
                          '${road.travelDays}d',
                          style: const TextStyle(
                            fontSize: 11,
                            color: CyberColors.textSecondary,
                          ),
                        ),
                        const SizedBox(width: 12),
                        Icon(Icons.warning_amber,
                            size: 12, color: dangerColor),
                        const SizedBox(width: 4),
                        Text(
                          'risco ${(danger * 100).round()}%',
                          style: TextStyle(fontSize: 11, color: dangerColor),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              FilledButton(
                style: FilledButton.styleFrom(
                  minimumSize: const Size(0, 40),
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                ),
                onPressed: onTravel,
                child: const Text('VIAJAR', style: TextStyle(fontSize: 12)),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _KeyValue extends StatelessWidget {
  const _KeyValue(this.label, this.value);

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            flex: 4,
            child: Text(
              label,
              style: const TextStyle(
                fontSize: 12,
                color: CyberColors.textSecondary,
              ),
            ),
          ),
          Expanded(
            flex: 5,
            child: Text(
              value,
              textAlign: TextAlign.right,
              style: const TextStyle(fontSize: 12),
            ),
          ),
        ],
      ),
    );
  }
}

class _TravellingNotice extends StatelessWidget {
  const _TravellingNotice({required this.daysLeft, this.destination});

  final int daysLeft;
  final String? destination;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.local_shipping,
                size: 48, color: CyberColors.amber),
            const SizedBox(height: 16),
            Text(
              'Em trânsito para ${destination ?? 'outra cidade'}',
              textAlign: TextAlign.center,
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 8),
            Text(
              'Chega em $daysLeft reset(s). '
              'Ações ficam bloqueadas durante a viagem.',
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 12,
                color: CyberColors.textSecondary,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _OutsideCityNotice extends StatelessWidget {
  const _OutsideCityNotice();

  @override
  Widget build(BuildContext context) {
    return const Center(
      child: Padding(
        padding: EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.terrain, size: 48, color: CyberColors.outline),
            SizedBox(height: 16),
            Text(
              'Você está fora de uma cidade.',
              style: TextStyle(fontWeight: FontWeight.w700),
            ),
            SizedBox(height: 8),
            Text(
              'Volte para um assentamento na aba Mundo para trabalhar, '
              'negociar ou viajar.',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 12, color: CyberColors.textSecondary),
            ),
          ],
        ),
      ),
    );
  }
}
