import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme.dart';
import '../../domain/building/village_identity.dart';
import '../../state/providers.dart';
import '../widgets/vital_bar.dart';

/// Editor da identidade do vilarejo: nome, lema, brasão e cores.
///
/// É cosmético por enquanto, mas modelado desde já como identidade **pública**
/// — quando o multiplayer existir, é assim que os outros jogadores vão
/// reconhecer o terreno no mapa e as ofertas no mercado.
Future<void> showVillageIdentitySheet(
  BuildContext context,
  WidgetRef ref,
) async {
  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (sheetContext) => DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.85,
      maxChildSize: 0.95,
      builder: (_, scrollController) =>
          _VillageIdentitySheet(scrollController: scrollController),
    ),
  );
}

class _VillageIdentitySheet extends ConsumerStatefulWidget {
  const _VillageIdentitySheet({required this.scrollController});

  final ScrollController scrollController;

  @override
  ConsumerState<_VillageIdentitySheet> createState() =>
      _VillageIdentitySheetState();
}

class _VillageIdentitySheetState
    extends ConsumerState<_VillageIdentitySheet> {
  late VillageIdentity _draft;
  late final TextEditingController _nameController;
  late final TextEditingController _mottoController;

  @override
  void initState() {
    super.initState();
    _draft = ref.read(campaignControllerProvider)?.plot.identity ??
        const VillageIdentity();
    _nameController = TextEditingController(text: _draft.name);
    _mottoController = TextEditingController(text: _draft.motto);
  }

  @override
  void dispose() {
    _nameController.dispose();
    _mottoController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final primary = Color(_draft.primaryColor);
    final secondary = Color(_draft.secondaryColor);

    return ListView(
      controller: widget.scrollController,
      padding: const EdgeInsets.fromLTRB(20, 20, 20, 32),
      children: [
        const Text(
          'IDENTIDADE DO VILAREJO',
          style: TextStyle(
            fontWeight: FontWeight.w900,
            letterSpacing: 1.4,
            fontSize: 15,
          ),
        ),
        const SizedBox(height: 4),
        const Text(
          'Nome próprio e lema rendem Status — no CyberKingdoms, aparência é '
          'capital político.',
          style: TextStyle(fontSize: 11, color: CyberColors.textSecondary),
        ),

        // ---------------- Prévia ----------------
        const SectionHeader('Prévia'),
        _IdentityBanner(identity: _draft),

        // ---------------- Nome e lema ----------------
        const SectionHeader('Nome e lema'),
        TextField(
          controller: _nameController,
          textCapitalization: TextCapitalization.words,
          maxLength: 28,
          decoration: const InputDecoration(
            labelText: 'Nome do vilarejo',
            prefixIcon: Icon(Icons.location_city_outlined),
            counterText: '',
          ),
          onChanged: (value) =>
              setState(() => _draft = _draft.copyWith(name: value)),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _mottoController,
          maxLength: 60,
          decoration: const InputDecoration(
            labelText: 'Lema (opcional)',
            hintText: 'Ex.: "Nada se perde, tudo se revende."',
            prefixIcon: Icon(Icons.format_quote),
            counterText: '',
          ),
          onChanged: (value) =>
              setState(() => _draft = _draft.copyWith(motto: value)),
        ),
        Row(
          children: [
            const Icon(Icons.star, size: 13, color: CyberColors.pink),
            const SizedBox(width: 6),
            Text(
              'Status ganho com a identidade: +${_draft.statusBonus}',
              style: const TextStyle(fontSize: 11, color: CyberColors.pink),
            ),
          ],
        ),

        // ---------------- Brasão ----------------
        const SectionHeader('Brasão'),
        GridView.count(
          crossAxisCount: 4,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: 8,
          crossAxisSpacing: 8,
          children: [
            for (final emblem in VillageEmblem.values)
              _EmblemTile(
                emblem: emblem,
                selected: _draft.emblem == emblem,
                tint: primary,
                onTap: () =>
                    setState(() => _draft = _draft.copyWith(emblem: emblem)),
              ),
          ],
        ),

        // ---------------- Cores ----------------
        const SectionHeader('Cor primária'),
        _Palette(
          selected: _draft.primaryColor,
          onPick: (argb) =>
              setState(() => _draft = _draft.copyWith(primaryColor: argb)),
        ),
        const SectionHeader('Cor secundária'),
        _Palette(
          selected: _draft.secondaryColor,
          onPick: (argb) =>
              setState(() => _draft = _draft.copyWith(secondaryColor: argb)),
        ),

        const SizedBox(height: 24),
        FilledButton(
          style: FilledButton.styleFrom(
            backgroundColor: primary,
            foregroundColor: Colors.black,
          ),
          onPressed: () {
            final name = _draft.name.trim();
            if (name.isEmpty) {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('O vilarejo precisa de um nome.')),
              );
              return;
            }
            ref
                .read(campaignControllerProvider.notifier)
                .updateVillageIdentity(_draft.copyWith(name: name));
            Navigator.pop(context);
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(content: Text('Vilarejo "$name" atualizado.')),
            );
          },
          child: const Text('SALVAR IDENTIDADE'),
        ),
        const SizedBox(height: 8),
        Center(
          child: Text(
            'Cores: ${VillagePalette.labelFor(_draft.primaryColor)} / '
            '${VillagePalette.labelFor(_draft.secondaryColor)}',
            style: TextStyle(fontSize: 10, color: secondary),
          ),
        ),
      ],
    );
  }
}

/// Faixa com brasão, nome e lema — a "cara" do vilarejo.
class _IdentityBanner extends StatelessWidget {
  const _IdentityBanner({required this.identity});

  final VillageIdentity identity;

  @override
  Widget build(BuildContext context) {
    final primary = Color(identity.primaryColor);
    final secondary = Color(identity.secondaryColor);

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            primary.withValues(alpha: 0.18),
            secondary.withValues(alpha: 0.10),
          ],
        ),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: primary.withValues(alpha: 0.6), width: 1.5),
      ),
      child: Row(
        children: [
          Container(
            width: 56,
            height: 56,
            decoration: BoxDecoration(
              color: CyberColors.background.withValues(alpha: 0.5),
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: secondary.withValues(alpha: 0.7)),
            ),
            padding: const EdgeInsets.all(4),
            child: Image.asset(
              identity.emblem.assetPath,
              filterQuality: FilterQuality.medium,
              errorBuilder: (_, __, ___) => Icon(Icons.flag, color: primary),
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  identity.name,
                  style: TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w900,
                    color: primary,
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
                if (identity.motto.trim().isNotEmpty)
                  Text(
                    '"${identity.motto.trim()}"',
                    style: TextStyle(
                      fontSize: 11,
                      fontStyle: FontStyle.italic,
                      color: secondary,
                    ),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _EmblemTile extends StatelessWidget {
  const _EmblemTile({
    required this.emblem,
    required this.selected,
    required this.tint,
    required this.onTap,
  });

  final VillageEmblem emblem;
  final bool selected;
  final Color tint;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        decoration: BoxDecoration(
          color: selected
              ? tint.withValues(alpha: 0.16)
              : CyberColors.surfaceHigh,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(
            color: selected ? tint : CyberColors.outline,
            width: selected ? 2 : 1,
          ),
        ),
        padding: const EdgeInsets.all(6),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Expanded(
              child: Image.asset(
                emblem.assetPath,
                filterQuality: FilterQuality.medium,
                errorBuilder: (_, __, ___) =>
                    Icon(Icons.flag_outlined, color: tint),
              ),
            ),
            const SizedBox(height: 2),
            Text(
              emblem.label,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 8),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ),
      ),
    );
  }
}

class _Palette extends StatelessWidget {
  const _Palette({required this.selected, required this.onPick});

  final int selected;
  final void Function(int argb) onPick;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        for (final (label, argb) in VillagePalette.swatches)
          Tooltip(
            message: label,
            child: GestureDetector(
              onTap: () => onPick(argb),
              child: Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: Color(argb),
                  borderRadius: BorderRadius.circular(9),
                  border: Border.all(
                    color: selected == argb ? Colors.white : Colors.transparent,
                    width: 2.5,
                  ),
                ),
                child: selected == argb
                    ? const Icon(Icons.check, size: 18, color: Colors.black)
                    : null,
              ),
            ),
          ),
      ],
    );
  }
}
