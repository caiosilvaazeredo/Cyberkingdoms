import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/seed/deterministic_random.dart';
import '../../core/theme.dart';
import '../../domain/character/attributes.dart';
import '../../domain/politics/government.dart';
import '../../state/providers.dart';
import '../widgets/vital_bar.dart';

/// Política: candidatar-se a governador, alistar-se na milícia e organizar
/// rebeliões. Qualquer jogador pode disputar eleições, independente do nível.
class PoliticsScreen extends ConsumerStatefulWidget {
  const PoliticsScreen({super.key});

  @override
  ConsumerState<PoliticsScreen> createState() => _PoliticsScreenState();
}

class _PoliticsScreenState extends ConsumerState<PoliticsScreen> {
  /// Eleições e comitês vivem na sessão até o backend existir — a economia
  /// compartilhada precisa de escrita transacional, que o modo offline não tem.
  final Map<String, Election> _elections = {};
  final Map<String, RevolutionaryCommittee> _committees = {};

  @override
  Widget build(BuildContext context) {
    final campaign = ref.watch(campaignControllerProvider);
    if (campaign == null) return const SizedBox.shrink();

    final settlementId = campaign.currentSettlementId;
    if (settlementId == null) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(32),
          child: Text(
            'Política só se faz dentro de uma cidade.',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 12, color: CyberColors.textSecondary),
          ),
        ),
      );
    }

    final settlement = campaign.world.layout.byId(settlementId)!;
    final government = campaign.governmentOf(settlementId);
    final character = campaign.character;
    final election = _elections[settlementId];
    final committee = _committees[settlementId];

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
      children: [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const Icon(Icons.account_balance,
                        color: CyberColors.violet, size: 20),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        settlement.name,
                        style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                    if (government.interim)
                      const _Tag(label: 'PROVISÓRIO', color: CyberColors.amber),
                  ],
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: StatChip(
                        label: 'tesouro',
                        value: '${government.treasury}¢',
                        color: CyberColors.amber,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: StatChip(
                        label: 'milícia',
                        value: '${government.militiaIds.length}',
                        color: CyberColors.pink,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                Text(
                  'Governador: ${government.governorName ?? 'vago'}',
                  style: const TextStyle(fontSize: 12),
                ),
                Text(
                  'Força de defesa: ${government.defenseStrength.toStringAsFixed(1)}',
                  style: const TextStyle(
                    fontSize: 11,
                    color: CyberColors.textSecondary,
                  ),
                ),
                if (government.isWanted(character.id)) ...[
                  const SizedBox(height: 8),
                  const _Tag(
                    label: 'VOCÊ ESTÁ PROCURADO NESTA CIDADE',
                    color: CyberColors.danger,
                  ),
                ],
              ],
            ),
          ),
        ),

        const SectionHeader('Eleição'),
        if (election == null)
          Card(
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Nenhuma eleição convocada.',
                    style: TextStyle(fontSize: 12),
                  ),
                  const SizedBox(height: 4),
                  const Text(
                    'Qualquer cidadão pode convocar e disputar, '
                    'independente do nível.',
                    style: TextStyle(
                      fontSize: 11,
                      color: CyberColors.textSecondary,
                    ),
                  ),
                  const SizedBox(height: 12),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton(
                      onPressed: () => setState(() {
                        _elections[settlementId] = Election(
                          settlementId: settlementId,
                          scheduledForDay:
                              campaign.day + Election.termLengthInDays,
                        );
                      }),
                      child: const Text('CONVOCAR ELEIÇÃO'),
                    ),
                  ),
                ],
              ),
            ),
          )
        else
          _ElectionCard(
            election: election,
            characterName: character.name,
            characterId: character.id,
            onRegister: (taxRate, wage) {
              setState(() {
                election.register(Candidacy(
                  citizenId: character.id,
                  citizenName: character.name,
                  platformTaxRate: taxRate,
                  platformWage: wage,
                ));
              });
            },
            onResolve: () {
              final winner = election.resolve(
                electorate: settlement.population ~/ 1000,
                rng: DeterministicRandom(
                  DeterministicRandom.mix(campaign.seed, campaign.day * 7),
                ),
                statusOf: (id) => id == character.id
                    ? character.effectiveStatus
                    : DeterministicRandom(
                        DeterministicRandom.hashLabel(id),
                      ).range(3, 12),
              );
              if (winner == null) return;

              setState(() {
                government.governorId = winner.citizenId;
                government.governorName = winner.citizenName;
                government.setTaxRate(winner.platformTaxRate);
                government.publicWage = winner.platformWage;
                government.interim = false;
              });

              campaign.log(
                '${winner.citizenName} venceu a eleição em ${settlement.name} '
                'com ${winner.votes} votos.',
              );
              ref.read(campaignControllerProvider.notifier).save();

              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text(
                    '${winner.citizenName} eleito com ${winner.votes} votos.',
                  ),
                ),
              );
            },
          ),

        if (government.governorId == character.id) ...[
          const SectionHeader('Você governa'),
          _GovernorPanel(
            government: government,
            onChanged: () => setState(() {}),
          ),
        ],

        const SectionHeader('Milícia'),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'A milícia defende o governo contra rebeliões e reprime '
                  'assaltos nas estradas próximas.',
                  style: TextStyle(
                    fontSize: 11,
                    color: CyberColors.textSecondary,
                  ),
                ),
                const SizedBox(height: 12),
                SizedBox(
                  width: double.infinity,
                  child: government.militiaIds.contains(character.id)
                      ? OutlinedButton(
                          onPressed: () => setState(
                            () => government.dismissMilitia(character.id),
                          ),
                          child: const Text('SAIR DA MILÍCIA'),
                        )
                      : FilledButton(
                          onPressed: () => setState(
                            () => government.enlistMilitia(character.id),
                          ),
                          child: const Text('ALISTAR-SE'),
                        ),
                ),
              ],
            ),
          ),
        ),

        const SectionHeader('Comitê Revolucionário'),
        _RebellionCard(
          committee: committee,
          government: government,
          onForm: () => setState(() {
            _committees[settlementId] = RevolutionaryCommittee(
              settlementId: settlementId,
              leaderId: character.id,
              leaderName: character.name,
            )..join(
                character.id,
                _combatStrength(character.attributes) +
                    character.inventory.attackPower.toDouble(),
              );
          }),
          onRecruit: () => setState(() {
            // Recrutamento de simpatizantes: o Status do líder define quantos
            // aderem. Quando houver outros jogadores, isso vira convite real.
            final rng = DeterministicRandom(
              DeterministicRandom.mix(campaign.seed, campaign.day * 13),
            );
            final recruits = (character.effectiveStatus / 2).round();
            for (var i = 0; i < recruits; i++) {
              committee!.join('sympathizer_${campaign.day}_$i',
                  rng.rangeDouble(4, 18));
            }
          }),
          onCoup: () {
            final result = committee!.attemptCoup(government);
            final message = result.succeeded
                ? 'GOLPE BEM-SUCEDIDO: ${committee.leaderName} assume o governo '
                    'e saqueia ${result.lootedTreasury}¢ do tesouro.'
                : 'GOLPE FRACASSADO: força rebelde '
                    '${result.rebelStrength.toStringAsFixed(1)} contra '
                    '${result.governmentStrength.toStringAsFixed(1)}. '
                    'Os rebeldes viraram procurados.';

            if (result.succeeded) {
              campaign.character.credits += result.lootedTreasury;
            }
            campaign.log(message);
            ref.read(campaignControllerProvider.notifier).save();

            setState(() => _committees.remove(settlementId));
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(content: Text(message)),
            );
          },
        ),
      ],
    );
  }

  double _combatStrength(AttributeSet attributes) =>
      attributes[Attribute.strength] * 1.6 +
      attributes[Attribute.endurance] * 1.1;
}

class _ElectionCard extends StatefulWidget {
  const _ElectionCard({
    required this.election,
    required this.characterId,
    required this.characterName,
    required this.onRegister,
    required this.onResolve,
  });

  final Election election;
  final String characterId;
  final String characterName;
  final void Function(double taxRate, int wage) onRegister;
  final VoidCallback onResolve;

  @override
  State<_ElectionCard> createState() => _ElectionCardState();
}

class _ElectionCardState extends State<_ElectionCard> {
  double _taxRate = 0.10;
  double _wage = 45;

  @override
  Widget build(BuildContext context) {
    final election = widget.election;
    final registered =
        election.candidates.any((c) => c.citizenId == widget.characterId);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              election.resolved
                  ? 'Eleição encerrada'
                  : 'Eleição aberta · ${election.candidates.length} candidato(s)',
              style: const TextStyle(
                fontWeight: FontWeight.w700,
                fontSize: 13,
              ),
            ),
            const SizedBox(height: 10),
            for (final candidate in election.candidates)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Row(
                  children: [
                    Icon(
                      candidate.citizenId == widget.characterId
                          ? Icons.person
                          : Icons.person_outline,
                      size: 15,
                      color: candidate.citizenId == widget.characterId
                          ? CyberColors.cyan
                          : CyberColors.textSecondary,
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        candidate.citizenName,
                        style: const TextStyle(fontSize: 12),
                      ),
                    ),
                    Text(
                      'imposto ${(candidate.platformTaxRate * 100).round()}% · '
                      'salário ${candidate.platformWage}¢',
                      style: const TextStyle(
                        fontSize: 10,
                        color: CyberColors.textSecondary,
                      ),
                    ),
                    if (election.resolved) ...[
                      const SizedBox(width: 8),
                      Text(
                        '${candidate.votes}',
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w800,
                          color: election.winnerId == candidate.citizenId
                              ? CyberColors.green
                              : CyberColors.textSecondary,
                        ),
                      ),
                    ],
                  ],
                ),
              ),

            if (!election.resolved && !registered) ...[
              const Divider(height: 24),
              const Text(
                'Sua plataforma',
                style: TextStyle(fontSize: 11, color: CyberColors.textSecondary),
              ),
              Row(
                children: [
                  const SizedBox(
                    width: 70,
                    child: Text('Imposto', style: TextStyle(fontSize: 11)),
                  ),
                  Expanded(
                    child: Slider(
                      value: _taxRate,
                      max: Government.maxTaxRate,
                      divisions: 40,
                      label: '${(_taxRate * 100).round()}%',
                      onChanged: (v) => setState(() => _taxRate = v),
                    ),
                  ),
                  SizedBox(
                    width: 42,
                    child: Text(
                      '${(_taxRate * 100).round()}%',
                      textAlign: TextAlign.right,
                      style: const TextStyle(fontSize: 12),
                    ),
                  ),
                ],
              ),
              Row(
                children: [
                  const SizedBox(
                    width: 70,
                    child: Text('Salário', style: TextStyle(fontSize: 11)),
                  ),
                  Expanded(
                    child: Slider(
                      value: _wage,
                      min: 10,
                      max: 120,
                      divisions: 22,
                      label: '${_wage.round()}¢',
                      onChanged: (v) => setState(() => _wage = v),
                    ),
                  ),
                  SizedBox(
                    width: 42,
                    child: Text(
                      '${_wage.round()}¢',
                      textAlign: TextAlign.right,
                      style: const TextStyle(fontSize: 12),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: () => widget.onRegister(_taxRate, _wage.round()),
                  child: const Text('CANDIDATAR-SE'),
                ),
              ),
            ],

            if (!election.resolved && election.candidates.isNotEmpty) ...[
              const SizedBox(height: 8),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton(
                  onPressed: widget.onResolve,
                  child: const Text('APURAR VOTOS'),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _GovernorPanel extends StatelessWidget {
  const _GovernorPanel({required this.government, required this.onChanged});

  final Government government;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Você controla impostos, salários e o orçamento de segurança.',
              style: TextStyle(fontSize: 11, color: CyberColors.textSecondary),
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                const SizedBox(
                  width: 76,
                  child: Text('Imposto', style: TextStyle(fontSize: 11)),
                ),
                Expanded(
                  child: Slider(
                    value: government.taxRate,
                    max: Government.maxTaxRate,
                    divisions: 40,
                    label: '${(government.taxRate * 100).round()}%',
                    onChanged: (v) {
                      government.setTaxRate(v);
                      onChanged();
                    },
                  ),
                ),
                SizedBox(
                  width: 42,
                  child: Text(
                    '${(government.taxRate * 100).round()}%',
                    textAlign: TextAlign.right,
                    style: const TextStyle(fontSize: 12),
                  ),
                ),
              ],
            ),
            Row(
              children: [
                const SizedBox(
                  width: 76,
                  child: Text('Salário', style: TextStyle(fontSize: 11)),
                ),
                Expanded(
                  child: Slider(
                    value: government.publicWage.toDouble(),
                    min: 10,
                    max: 120,
                    divisions: 22,
                    label: '${government.publicWage}¢',
                    onChanged: (v) {
                      government.publicWage = v.round();
                      onChanged();
                    },
                  ),
                ),
                SizedBox(
                  width: 42,
                  child: Text(
                    '${government.publicWage}¢',
                    textAlign: TextAlign.right,
                    style: const TextStyle(fontSize: 12),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: government.treasury < 1000
                    ? null
                    : () {
                        government.treasury -= 1000;
                        government.securityBudget += 1000;
                        onChanged();
                      },
                icon: const Icon(Icons.security, size: 16),
                label: const Text('INVESTIR 1.000¢ EM SEGURANÇA'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _RebellionCard extends StatelessWidget {
  const _RebellionCard({
    required this.committee,
    required this.government,
    required this.onForm,
    required this.onRecruit,
    required this.onCoup,
  });

  final RevolutionaryCommittee? committee;
  final Government government;
  final VoidCallback onForm;
  final VoidCallback onRecruit;
  final VoidCallback onCoup;

  @override
  Widget build(BuildContext context) {
    if (committee == null) {
      return Card(
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Insatisfeito com o governo? Forme um comitê. Se a força '
                'rebelde superar a do governo, é golpe de estado: o tesouro é '
                'saqueado e você assume. Se fracassar, todos viram procurados.',
                style: TextStyle(
                  fontSize: 11,
                  color: CyberColors.textSecondary,
                ),
              ),
              const SizedBox(height: 12),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton(
                  onPressed: onForm,
                  child: const Text('FORMAR COMITÊ REVOLUCIONÁRIO'),
                ),
              ),
            ],
          ),
        ),
      );
    }

    final rebel = committee!.strength;
    final loyal = government.defenseStrength;
    final favoured = rebel > loyal;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Comitê de ${committee!.leaderName}',
              style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13),
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: StatChip(
                    label: 'rebeldes',
                    value: rebel.toStringAsFixed(1),
                    color: CyberColors.pink,
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: StatChip(
                    label: 'governo',
                    value: loyal.toStringAsFixed(1),
                    color: CyberColors.cyan,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Text(
              favoured
                  ? 'Vocês têm vantagem. O golpe deve funcionar.'
                  : 'O governo é mais forte. Recrute mais antes de tentar.',
              style: TextStyle(
                fontSize: 11,
                color: favoured ? CyberColors.green : CyberColors.amber,
              ),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: onRecruit,
                    child: const Text('RECRUTAR', style: TextStyle(fontSize: 12)),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: FilledButton(
                    style: FilledButton.styleFrom(
                      backgroundColor: CyberColors.danger,
                      foregroundColor: Colors.white,
                    ),
                    onPressed: onCoup,
                    child: const Text('DAR O GOLPE',
                        style: TextStyle(fontSize: 12)),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _Tag extends StatelessWidget {
  const _Tag({required this.label, required this.color});

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: color.withValues(alpha: 0.5)),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 9,
          fontWeight: FontWeight.w800,
          letterSpacing: 0.8,
          color: color,
        ),
      ),
    );
  }
}
