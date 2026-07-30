import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme.dart';
import '../../domain/campaign/quest.dart';
import '../../domain/character/attributes.dart';
import '../../state/providers.dart';
import '../widgets/sprite_ui.dart';
import '../widgets/vital_bar.dart';

/// A campanha principal: as quests dos Níveis 0→3 do GDD.
///
/// Nenhuma quest bloqueia o jogo. Elas dão nome e ordem à progressão econômica
/// que o GDD já define — servem de tutorial no começo e de lista de metas
/// depois. Quem quiser ignorar tudo e virar só comerciante pode.
class CampaignScreen extends ConsumerWidget {
  const CampaignScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final campaign = ref.watch(campaignControllerProvider);
    if (campaign == null) return const SizedBox.shrink();

    final log = QuestLog(campaign);
    final current = log.current;

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
      children: [
        // ---------------- Progresso geral ----------------
        SpritePanel.blue(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'CAMPANHA PRINCIPAL',
                style: TextStyle(
                  fontWeight: FontWeight.w900,
                  letterSpacing: 1.4,
                  fontSize: 14,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                '${log.completed.length} de ${QuestBook.all.length} quests · '
                '${campaign.character.level.label}',
                style: const TextStyle(
                  fontSize: 11,
                  color: CyberColors.textSecondary,
                ),
              ),
              const SizedBox(height: 12),
              SpriteBar(
                value: log.overallProgress,
                color: SpriteBarColor.green,
                height: 16,
              ),
            ],
          ),
        ),

        // ---------------- Objetivo atual ----------------
        if (current != null) ...[
          const SectionHeader('Agora'),
          _QuestCard(quest: current, campaign: campaign, highlighted: true),
        ] else ...[
          const SectionHeader('Agora'),
          SpriteFrame(
            tint: CyberColors.green,
            child: const Text(
              'Toda a campanha concluída. O império é seu — agora é mantê-lo.',
              style: TextStyle(fontSize: 12, color: CyberColors.green),
            ),
          ),
        ],

        // ---------------- Por estágio ----------------
        for (final stage in CitizenLevel.values) ...[
          SectionHeader(
            '${stage.label} — ${stage.goal}',
            trailing: Text(
              '${QuestBook.byStage(stage).where(log.isComplete).length}'
              '/${QuestBook.byStage(stage).length}',
              style: const TextStyle(
                fontSize: 11,
                color: CyberColors.textSecondary,
              ),
            ),
          ),
          for (final quest in QuestBook.byStage(stage))
            if (log.isComplete(quest))
              _QuestCard(quest: quest, campaign: campaign, completed: true)
            else if (log.isUnlocked(quest))
              _QuestCard(quest: quest, campaign: campaign)
            else
              _LockedQuestCard(quest: quest),
        ],
      ],
    );
  }
}

class _QuestCard extends StatelessWidget {
  const _QuestCard({
    required this.quest,
    required this.campaign,
    this.completed = false,
    this.highlighted = false,
  });

  final Quest quest;
  final dynamic campaign;
  final bool completed;
  final bool highlighted;

  @override
  Widget build(BuildContext context) {
    final progress = quest.completion(campaign);

    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Card(
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(14),
          side: BorderSide(
            color: completed
                ? CyberColors.green.withValues(alpha: 0.5)
                : highlighted
                    ? CyberColors.cyan
                    : CyberColors.outline,
            width: highlighted ? 1.8 : 1,
          ),
        ),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(
                    completed
                        ? Icons.check_circle
                        : Icons.radio_button_unchecked,
                    size: 18,
                    color: completed ? CyberColors.green : CyberColors.cyan,
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      quest.title,
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w800,
                        color: completed
                            ? CyberColors.green
                            : CyberColors.textPrimary,
                        decoration:
                            completed ? TextDecoration.lineThrough : null,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Text(
                quest.briefing,
                style: const TextStyle(
                  fontSize: 11,
                  height: 1.45,
                  color: CyberColors.textSecondary,
                ),
              ),
              const SizedBox(height: 12),

              // Objetivos com progresso individual.
              for (final objective in quest.objectives)
                Builder(
                  builder: (_) {
                    final (current, target) = objective.progress(campaign);
                    final met = objective.isMet(campaign);
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 6),
                      child: Row(
                        children: [
                          Icon(
                            met ? Icons.task_alt : Icons.circle_outlined,
                            size: 13,
                            color:
                                met ? CyberColors.green : CyberColors.outline,
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              objective.label,
                              style: TextStyle(
                                fontSize: 11,
                                color: met
                                    ? CyberColors.green
                                    : CyberColors.textPrimary,
                              ),
                            ),
                          ),
                          Text(
                            '$current/$target',
                            style: TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.w700,
                              color: met
                                  ? CyberColors.green
                                  : CyberColors.textSecondary,
                            ),
                          ),
                        ],
                      ),
                    );
                  },
                ),

              if (!completed) ...[
                const SizedBox(height: 6),
                SpriteBar(
                  value: progress,
                  color: SpriteBarColor.forRatio(progress),
                  height: 10,
                ),
              ],

              if (!quest.reward.isEmpty) ...[
                const SizedBox(height: 10),
                Row(
                  children: [
                    const Icon(Icons.card_giftcard,
                        size: 13, color: CyberColors.amber),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        quest.reward.summary,
                        style: const TextStyle(
                          fontSize: 11,
                          color: CyberColors.amber,
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _LockedQuestCard extends StatelessWidget {
  const _LockedQuestCard({required this.quest});

  final Quest quest;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Opacity(
        opacity: 0.45,
        child: Card(
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Row(
              children: [
                const Icon(Icons.lock_outline,
                    size: 16, color: CyberColors.outline),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        quest.title,
                        style: const TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      Text(
                        'Conclua as quests anteriores para destravar.',
                        style: const TextStyle(
                          fontSize: 10,
                          color: CyberColors.outline,
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
