import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme.dart';
import '../../domain/economy/item.dart';
import '../../domain/economy/market.dart';
import '../../state/providers.dart';
import '../widgets/vital_bar.dart';

/// Mercado Central e Clandestino. Os preços são de jogadores — não há NPC
/// abastecendo, só o estoque inicial dos colonos e o que os jogadores anunciam.
class MarketScreen extends ConsumerStatefulWidget {
  const MarketScreen({super.key});

  @override
  ConsumerState<MarketScreen> createState() => _MarketScreenState();
}

class _MarketScreenState extends ConsumerState<MarketScreen> {
  MarketKind _kind = MarketKind.central;

  @override
  Widget build(BuildContext context) {
    final campaign = ref.watch(campaignControllerProvider);
    if (campaign == null) return const SizedBox.shrink();

    if (campaign.character.isTravelling) {
      return const _Blocked(
        icon: Icons.local_shipping,
        message: 'Você não negocia em trânsito.',
      );
    }

    final settlementId = campaign.currentSettlementId;
    if (settlementId == null) {
      return const _Blocked(
        icon: Icons.storefront_outlined,
        message: 'Não há mercado fora das cidades.',
      );
    }

    final market = campaign.marketOf(settlementId, _kind);
    final government = campaign.governmentOf(settlementId);

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
          child: SegmentedButton<MarketKind>(
            segments: const [
              ButtonSegment(
                value: MarketKind.central,
                label: Text('Central', style: TextStyle(fontSize: 12)),
                icon: Icon(Icons.verified, size: 15),
              ),
              ButtonSegment(
                value: MarketKind.clandestine,
                label: Text('Clandestino', style: TextStyle(fontSize: 12)),
                icon: Icon(Icons.visibility_off, size: 15),
              ),
            ],
            selected: {_kind},
            onSelectionChanged: (selection) =>
                setState(() => _kind = selection.first),
            style: SegmentedButton.styleFrom(
              backgroundColor: CyberColors.surface,
              selectedBackgroundColor:
                  (_kind == MarketKind.clandestine
                          ? CyberColors.pink
                          : CyberColors.cyan)
                      .withValues(alpha: 0.18),
            ),
          ),
        ),
        if (_kind == MarketKind.central)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Text(
              'Imposto de ${(government.taxRate * 100).toStringAsFixed(1)}% '
              'sobre cada compra vai para o tesouro local.',
              style: const TextStyle(
                fontSize: 11,
                color: CyberColors.textSecondary,
              ),
            ),
          )
        else
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 16),
            child: Text(
              'Sem fiscalização e sem imposto. Carregar contrabando é crime '
              'nas capitais.',
              style: TextStyle(fontSize: 11, color: CyberColors.pink),
            ),
          ),
        Expanded(
          child: market == null
              ? const _Blocked(
                  icon: Icons.block,
                  message: 'Esta cidade não tem mercado clandestino organizado.',
                )
              : _MarketBook(market: market, kind: _kind),
        ),
      ],
    );
  }
}

class _MarketBook extends ConsumerWidget {
  const _MarketBook({required this.market, required this.kind});

  final Market market;
  final MarketKind kind;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final campaign = ref.watch(campaignControllerProvider)!;
    final items = market.listedItems
      ..sort((a, b) => ItemCatalog.of(a).tier.level
          .compareTo(ItemCatalog.of(b).tier.level));

    final byTier = <ProductionTier, List<ItemId>>{};
    for (final item in items) {
      byTier.putIfAbsent(ItemCatalog.of(item).tier, () => []).add(item);
    }

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
      children: [
        SizedBox(
          width: double.infinity,
          child: OutlinedButton.icon(
            onPressed: () => _showSellSheet(context, ref, kind),
            icon: const Icon(Icons.sell_outlined, size: 16),
            label: const Text('ANUNCIAR VENDA'),
          ),
        ),
        if (items.isEmpty)
          const Padding(
            padding: EdgeInsets.all(32),
            child: Text(
              'Livro de ofertas vazio. Alguém precisa produzir.',
              textAlign: TextAlign.center,
              style: TextStyle(color: CyberColors.textSecondary, fontSize: 12),
            ),
          ),
        for (final tier in ProductionTier.values)
          if (byTier[tier]?.isNotEmpty ?? false) ...[
            SectionHeader(
              tier == ProductionTier.basic
                  ? 'Básicos'
                  : 'Camada ${tier.level} — ${tier.label}',
            ),
            for (final item in byTier[tier]!)
              _OrderRow(
                item: item,
                market: market,
                kind: kind,
                credits: campaign.character.credits,
              ),
          ],
      ],
    );
  }
}

class _OrderRow extends ConsumerWidget {
  const _OrderRow({
    required this.item,
    required this.market,
    required this.kind,
    required this.credits,
  });

  final ItemId item;
  final Market market;
  final MarketKind kind;
  final int credits;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final def = ItemCatalog.of(item);
    final price = market.bestPrice(item);
    final supply = market.supplyOf(item);
    if (price == null || supply == 0) return const SizedBox.shrink();

    // Sinal de barganha: comparar com o preço-base diz se vale comprar aqui
    // para revender em outra capital.
    final delta = (price - def.baseValue) / def.baseValue;
    final deltaColor = delta < -0.1
        ? CyberColors.green
        : delta > 0.15
            ? CyberColors.danger
            : CyberColors.textSecondary;

    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Card(
        child: InkWell(
          borderRadius: BorderRadius.circular(14),
          onTap: () => _showBuySheet(context, ref, item, market, kind, credits),
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Row(
              children: [
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
                                fontWeight: FontWeight.w700,
                                fontSize: 13,
                              ),
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                          if (!def.legal) ...[
                            const SizedBox(width: 6),
                            const Icon(Icons.gavel,
                                size: 12, color: CyberColors.pink),
                          ],
                        ],
                      ),
                      const SizedBox(height: 2),
                      Text(
                        '$supply em estoque · base ${def.baseValue}¢',
                        style: const TextStyle(
                          fontSize: 11,
                          color: CyberColors.textSecondary,
                        ),
                      ),
                    ],
                  ),
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(
                      '$price¢',
                      style: const TextStyle(
                        fontWeight: FontWeight.w800,
                        fontSize: 15,
                        color: CyberColors.amber,
                      ),
                    ),
                    Text(
                      '${delta >= 0 ? '+' : ''}${(delta * 100).round()}%',
                      style: TextStyle(fontSize: 10, color: deltaColor),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

Future<void> _showBuySheet(
  BuildContext context,
  WidgetRef ref,
  ItemId item,
  Market market,
  MarketKind kind,
  int credits,
) async {
  var quantity = 1;
  final def = ItemCatalog.of(item);
  final maxQuantity = market.supplyOf(item);

  await showModalBottomSheet<void>(
    context: context,
    builder: (sheetContext) => StatefulBuilder(
      builder: (_, setSheetState) {
        final price = market.bestPrice(item) ?? def.baseValue;
        final estimate = price * quantity;

        return Padding(
          padding: const EdgeInsets.fromLTRB(20, 20, 20, 32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                def.name.toUpperCase(),
                style: const TextStyle(
                  fontWeight: FontWeight.w900,
                  letterSpacing: 1.2,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                def.description,
                style: const TextStyle(
                  fontSize: 12,
                  color: CyberColors.textSecondary,
                ),
              ),
              const SizedBox(height: 20),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  _StepButton(
                    icon: Icons.remove,
                    onTap: () => setSheetState(
                      () => quantity = (quantity - 1).clamp(1, maxQuantity),
                    ),
                  ),
                  SizedBox(
                    width: 90,
                    child: Text(
                      '$quantity',
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        fontSize: 26,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ),
                  _StepButton(
                    icon: Icons.add,
                    onTap: () => setSheetState(
                      () => quantity = (quantity + 1).clamp(1, maxQuantity),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Text(
                'Estimado: $estimate¢ (antes do imposto) · '
                'você tem $credits¢',
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 11,
                  color: CyberColors.textSecondary,
                ),
              ),
              const SizedBox(height: 20),
              FilledButton(
                onPressed: () {
                  final result = ref
                      .read(campaignControllerProvider.notifier)
                      .buy(kind: kind, item: item, quantity: quantity);
                  final messenger = ScaffoldMessenger.of(context);
                  Navigator.pop(sheetContext);
                  messenger.showSnackBar(
                    SnackBar(
                      content: Text(
                        switch (result) {
                          TradeSuccess(:final totalPaid, :final tax) =>
                            'Comprou ${quantity}x ${def.name} por $totalPaid¢'
                                '${tax > 0 ? ' (imposto $tax¢)' : ''}.',
                          TradeFailure(:final reason) => reason,
                        },
                      ),
                    ),
                  );
                },
                child: const Text('COMPRAR'),
              ),
            ],
          ),
        );
      },
    ),
  );
}

Future<void> _showSellSheet(
  BuildContext context,
  WidgetRef ref,
  MarketKind kind,
) async {
  final campaign = ref.read(campaignControllerProvider);
  if (campaign == null) return;

  final owned = campaign.character.inventory.stacks.entries
      .where((e) => kind.accepts(e.key))
      .toList();

  if (owned.isEmpty) {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Nada no inventário que este mercado aceite.')),
    );
    return;
  }

  ItemId selected = owned.first.key;
  var quantity = 1;
  final priceController = TextEditingController(
    text: '${ItemCatalog.of(selected).baseValue}',
  );

  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (sheetContext) => StatefulBuilder(
      builder: (_, setSheetState) {
        final maxQuantity = campaign.character.inventory.quantityOf(selected);

        return Padding(
          padding: EdgeInsets.only(
            left: 20,
            right: 20,
            top: 20,
            bottom: MediaQuery.of(sheetContext).viewInsets.bottom + 32,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                'ANUNCIAR VENDA',
                style: TextStyle(
                  fontWeight: FontWeight.w900,
                  letterSpacing: 1.2,
                ),
              ),
              const SizedBox(height: 4),
              const Text(
                'Você define o preço. A oferta fica no livro por 14 dias.',
                style: TextStyle(
                  fontSize: 12,
                  color: CyberColors.textSecondary,
                ),
              ),
              const SizedBox(height: 16),
              // `DropdownButton` dentro de um `InputDecorator`, e não
              // `DropdownButtonFormField`.
              //
              // O campo do formulário renomeou o parâmetro de seleção: até o
              // Flutter 3.32 é `value`, do 3.35 em diante é `initialValue` e
              // `value` virou deprecado. Não existe grafia que passe limpo nas
              // duas versões, e o projeto precisa compilar em ambas. O
              // `DropdownButton` cru não mexeu nesse nome em nenhuma delas; o
              // `InputDecorator` devolve a moldura e o rótulo que o
              // `FormField` desenhava.
              InputDecorator(
                decoration: const InputDecoration(labelText: 'Item'),
                child: DropdownButtonHideUnderline(
                  child: DropdownButton<ItemId>(
                    value: selected,
                    isDense: true,
                    isExpanded: true,
                    dropdownColor: CyberColors.surfaceHigh,
                    items: [
                      for (final entry in owned)
                        DropdownMenuItem(
                          value: entry.key,
                          child: Text(
                            '${ItemCatalog.of(entry.key).name} (${entry.value})',
                            style: const TextStyle(fontSize: 13),
                          ),
                        ),
                    ],
                    onChanged: (value) {
                      if (value == null) return;
                      setSheetState(() {
                        selected = value;
                        quantity = 1;
                        priceController.text =
                            '${ItemCatalog.of(value).baseValue}';
                      });
                    },
                  ),
                ),
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  _StepButton(
                    icon: Icons.remove,
                    onTap: () => setSheetState(
                      () => quantity = (quantity - 1).clamp(1, maxQuantity),
                    ),
                  ),
                  Expanded(
                    child: Text(
                      '$quantity de $maxQuantity',
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                  _StepButton(
                    icon: Icons.add,
                    onTap: () => setSheetState(
                      () => quantity = (quantity + 1).clamp(1, maxQuantity),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              TextField(
                controller: priceController,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(
                  labelText: 'Preço por unidade (¢)',
                  prefixIcon: Icon(Icons.attach_money),
                ),
              ),
              const SizedBox(height: 20),
              FilledButton(
                onPressed: () {
                  final unitPrice = int.tryParse(priceController.text.trim());
                  final messenger = ScaffoldMessenger.of(context);
                  if (unitPrice == null || unitPrice <= 0) {
                    messenger.showSnackBar(
                      const SnackBar(content: Text('Preço inválido.')),
                    );
                    return;
                  }
                  final error =
                      ref.read(campaignControllerProvider.notifier).sell(
                            kind: kind,
                            item: selected,
                            quantity: quantity,
                            unitPrice: unitPrice,
                          );
                  Navigator.pop(sheetContext);
                  messenger.showSnackBar(
                    SnackBar(
                      content: Text(
                        error ??
                            'Anunciou ${quantity}x '
                                '${ItemCatalog.of(selected).name} a $unitPrice¢.',
                      ),
                    ),
                  );
                },
                child: const Text('ANUNCIAR'),
              ),
            ],
          ),
        );
      },
    ),
  );
}

class _StepButton extends StatelessWidget {
  const _StepButton({required this.icon, required this.onTap});

  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: CyberColors.surfaceHigh,
      borderRadius: BorderRadius.circular(10),
      child: InkWell(
        borderRadius: BorderRadius.circular(10),
        onTap: onTap,
        child: SizedBox(
          width: 48,
          height: 48,
          child: Icon(icon, color: CyberColors.cyan),
        ),
      ),
    );
  }
}

class _Blocked extends StatelessWidget {
  const _Blocked({required this.icon, required this.message});

  final IconData icon;
  final String message;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 44, color: CyberColors.outline),
            const SizedBox(height: 14),
            Text(
              message,
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
