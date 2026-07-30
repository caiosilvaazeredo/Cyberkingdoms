import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/seed/deterministic_random.dart';
import '../../core/theme.dart';
import '../../domain/campaign/campaign.dart';
import '../../state/providers.dart';
import 'game_shell.dart';

/// Tela inicial: escolher campanha existente ou criar um mundo novo.
///
/// "Gere um mundo novo a cada nova campanha" — a seed fica visível e editável
/// porque compartilhar seed é metade da graça de um mundo procedural.
class CampaignSelectScreen extends ConsumerWidget {
  const CampaignSelectScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final campaigns = ref.watch(campaignListProvider);
    final bootstrap = ref.watch(bootstrapProvider);

    return Scaffold(
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const _Header(),
            bootstrap.maybeWhen(
              data: (result) => result.online
                  ? const SizedBox.shrink()
                  : _OfflineBanner(message: result.message),
              orElse: () => const SizedBox.shrink(),
            ),
            Expanded(
              child: campaigns.when(
                loading: () => const Center(
                  child: CircularProgressIndicator(color: CyberColors.cyan),
                ),
                error: (error, _) => Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Text(
                      'Não foi possível carregar as campanhas.\n$error',
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: CyberColors.textSecondary),
                    ),
                  ),
                ),
                data: (list) => list.isEmpty
                    ? const _EmptyState()
                    : ListView.separated(
                        padding: const EdgeInsets.fromLTRB(16, 8, 16, 100),
                        itemCount: list.length,
                        separatorBuilder: (_, __) => const SizedBox(height: 10),
                        itemBuilder: (context, index) =>
                            _CampaignCard(summary: list[index]),
                      ),
              ),
            ),
          ],
        ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _showNewCampaignSheet(context, ref),
        backgroundColor: CyberColors.pink,
        foregroundColor: Colors.white,
        icon: const Icon(Icons.add),
        label: const Text('NOVA CAMPANHA'),
      ),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 24, 20, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ShaderMask(
            shaderCallback: (bounds) => const LinearGradient(
              colors: [CyberColors.cyan, CyberColors.pink],
            ).createShader(bounds),
            child: const Text(
              'CYBERKINGDOMS',
              style: TextStyle(
                fontSize: 30,
                fontWeight: FontWeight.w900,
                letterSpacing: 2,
                color: Colors.white,
                height: 1.1,
              ),
            ),
          ),
          const SizedBox(height: 6),
          const Text(
            'Economia viva · Política · Sobrevivência',
            style: TextStyle(color: CyberColors.textSecondary, fontSize: 13),
          ),
        ],
      ),
    );
  }
}

class _OfflineBanner extends StatelessWidget {
  const _OfflineBanner({this.message});

  final String? message;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 0, 16, 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: CyberColors.amber.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: CyberColors.amber.withValues(alpha: 0.4)),
      ),
      child: Row(
        children: [
          const Icon(Icons.cloud_off, size: 16, color: CyberColors.amber),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              message ?? 'Jogando offline.',
              style: const TextStyle(fontSize: 11, color: CyberColors.amber),
            ),
          ),
        ],
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState();

  @override
  Widget build(BuildContext context) {
    return const Center(
      child: Padding(
        padding: EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.public_off, size: 48, color: CyberColors.outline),
            SizedBox(height: 16),
            Text(
              'Nenhum mundo gerado ainda.',
              style: TextStyle(color: CyberColors.textSecondary),
            ),
            SizedBox(height: 6),
            Text(
              'Cada campanha gera um mundo novo:\n5 capitais, 15 satélites e as estradas entre elas.',
              textAlign: TextAlign.center,
              style: TextStyle(color: CyberColors.outline, fontSize: 12),
            ),
          ],
        ),
      ),
    );
  }
}

class _CampaignCard extends ConsumerWidget {
  const _CampaignCard({required this.summary});

  final CampaignSummary summary;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: summary.dead ? null : () => _open(context, ref),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: (summary.dead ? CyberColors.danger : CyberColors.cyan)
                      .withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(
                  summary.dead ? Icons.dangerous : Icons.travel_explore,
                  color: summary.dead ? CyberColors.danger : CyberColors.cyan,
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      summary.characterName,
                      style: const TextStyle(
                        fontWeight: FontWeight.w700,
                        fontSize: 15,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      summary.dead
                          ? 'Morto · seed "${summary.seedLabel}"'
                          : 'Dia ${summary.day} · ${summary.level.label} · '
                              '${summary.credits}¢',
                      style: const TextStyle(
                        color: CyberColors.textSecondary,
                        fontSize: 12,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'seed: ${summary.seedLabel}',
                      style: const TextStyle(
                        color: CyberColors.outline,
                        fontSize: 10,
                      ),
                    ),
                  ],
                ),
              ),
              IconButton(
                icon: const Icon(Icons.delete_outline, size: 20),
                color: CyberColors.textSecondary,
                onPressed: () => _confirmDelete(context, ref),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _open(BuildContext context, WidgetRef ref) async {
    final navigator = Navigator.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final ok = await ref.read(campaignControllerProvider.notifier).open(summary.id);
    if (!ok) {
      messenger.showSnackBar(
        const SnackBar(content: Text('Não foi possível abrir essa campanha.')),
      );
      return;
    }
    navigator.push(
      MaterialPageRoute<void>(builder: (_) => const GameShell()),
    );
  }

  Future<void> _confirmDelete(BuildContext context, WidgetRef ref) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: CyberColors.surface,
        title: const Text('Apagar campanha?'),
        content: Text(
          'O mundo de "${summary.seedLabel}" e o progresso de '
          '${summary.characterName} serão perdidos.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: CyberColors.danger),
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Apagar'),
          ),
        ],
      ),
    );

    if (confirmed != true) return;
    await ref.read(campaignRepositoryProvider).deleteCampaign(summary.id);
    ref.invalidate(campaignListProvider);
  }
}

Future<void> _showNewCampaignSheet(BuildContext context, WidgetRef ref) async {
  final seedController = TextEditingController(text: _randomSeedLabel());
  final nameController = TextEditingController();

  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (sheetContext) => Padding(
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 20,
        bottom: MediaQuery.of(sheetContext).viewInsets.bottom + 24,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text(
            'NOVO MUNDO',
            style: TextStyle(
              fontWeight: FontWeight.w900,
              letterSpacing: 1.5,
              fontSize: 16,
            ),
          ),
          const SizedBox(height: 6),
          const Text(
            'A seed define todo o mundo: relevo, biomas, onde caem as 5 '
            'capitais, os 15 satélites e as estradas. A mesma seed gera '
            'sempre o mesmo mapa.',
            style: TextStyle(color: CyberColors.textSecondary, fontSize: 12),
          ),
          const SizedBox(height: 20),
          TextField(
            controller: nameController,
            textCapitalization: TextCapitalization.words,
            decoration: const InputDecoration(
              labelText: 'Nome do personagem',
              prefixIcon: Icon(Icons.person_outline),
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: seedController,
            decoration: InputDecoration(
              labelText: 'Seed do mundo',
              prefixIcon: const Icon(Icons.casino_outlined),
              suffixIcon: IconButton(
                icon: const Icon(Icons.refresh),
                onPressed: () => seedController.text = _randomSeedLabel(),
              ),
            ),
          ),
          const SizedBox(height: 20),
          FilledButton(
            onPressed: () async {
              final name = nameController.text.trim();
              final seed = seedController.text.trim();
              if (name.isEmpty || seed.isEmpty) {
                ScaffoldMessenger.of(sheetContext).showSnackBar(
                  const SnackBar(content: Text('Preencha nome e seed.')),
                );
                return;
              }

              final navigator = Navigator.of(sheetContext);
              await ref.read(campaignControllerProvider.notifier).startNew(
                    seedLabel: seed,
                    characterName: name,
                  );
              ref.invalidate(campaignListProvider);

              navigator.pop();
              navigator.push(
                MaterialPageRoute<void>(builder: (_) => const GameShell()),
              );
            },
            child: const Text('GERAR MUNDO'),
          ),
        ],
      ),
    ),
  );
}

const _seedWords = [
  'neon', 'ferro', 'petroleo', 'cortiço', 'orixá', 'sabiá', 'krom',
  'vidro', 'aurora', 'corvo', 'pantanal', 'ronin', 'âmbar', 'cinza',
];

String _randomSeedLabel() {
  final rng = DeterministicRandom(DateTime.now().microsecondsSinceEpoch);
  return '${rng.pick(_seedWords)}-${rng.pick(_seedWords)}-${rng.range(100, 999)}';
}
