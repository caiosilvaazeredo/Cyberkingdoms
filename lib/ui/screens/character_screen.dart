import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme.dart';
import '../../domain/character/attributes.dart';
import '../../domain/economy/item.dart';
import '../../state/providers.dart';
import '../widgets/vital_bar.dart';

/// Ficha do personagem: atributos, progressão, inventário e equipamentos.
class CharacterScreen extends ConsumerWidget {
  const CharacterScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final campaign = ref.watch(campaignControllerProvider);
    if (campaign == null) return const SizedBox.shrink();

    final controller = ref.read(campaignControllerProvider.notifier);
    final character = campaign.character;
    final inventory = character.inventory;
    final modifiers = inventory.upkeepModifiers;

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
      children: [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  character.name,
                  style: const TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  '${character.level.label} · ${character.level.goal}',
                  style: const TextStyle(
                    fontSize: 12,
                    color: CyberColors.textSecondary,
                  ),
                ),
                const SizedBox(height: 14),
                Row(
                  children: [
                    Expanded(
                      child: VitalBar(
                        label: 'ENERGIA',
                        value: character.energy,
                        max: 20,
                        color: CyberColors.violet,
                      ),
                    ),
                    const SizedBox(width: 12),
                    StatChip(
                      label: 'Status',
                      value: '${character.effectiveStatus}',
                      color: CyberColors.pink,
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),

        SectionHeader(
          'Atributos',
          trailing: character.canReroll
              ? TextButton(
                  onPressed: () {
                    controller.reroll();
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(
                        content: Text(
                          'Rerrolagem ${character.rerollsUsed}/'
                          '${AttributeSet.maxRerolls}.',
                        ),
                      ),
                    );
                  },
                  child: Text(
                    'RERROLAR (${AttributeSet.maxRerolls - character.rerollsUsed})',
                    style: const TextStyle(fontSize: 11),
                  ),
                )
              : null,
        ),
        const Text(
          'Não existe treinamento: atributos só melhoram com equipamentos e '
          'implantes.',
          style: TextStyle(fontSize: 11, color: CyberColors.textSecondary),
        ),
        const SizedBox(height: 10),
        for (final attribute in Attribute.values)
          _AttributeRow(
            attribute: attribute,
            value: character.attributes[attribute],
          ),

        const SectionHeader('Próximo nível'),
        _ProgressionCard(character: character),

        const SectionHeader('Equipado'),
        if (inventory.equipped.isEmpty)
          const Text(
            'Nada equipado.',
            style: TextStyle(fontSize: 12, color: CyberColors.textSecondary),
          )
        else ...[
          for (final id in inventory.equipped)
            _EquippedRow(
              item: id,
              onUnequip: () => controller.unequip(id),
            ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: _ModifierChip(
                  label: 'Consumo de fome',
                  value: modifiers.hunger,
                  color: CyberColors.amber,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _ModifierChip(
                  label: 'Consumo de sede',
                  value: modifiers.thirst,
                  color: CyberColors.cyan,
                ),
              ),
            ],
          ),
        ],

        SectionHeader(
          'Inventário',
          trailing: Text(
            '${inventory.estimatedValue}¢ · ${inventory.totalWeight} kg',
            style: const TextStyle(
              fontSize: 11,
              color: CyberColors.textSecondary,
            ),
          ),
        ),
        if (inventory.stacks.isEmpty)
          const Text(
            'Inventário vazio.',
            style: TextStyle(fontSize: 12, color: CyberColors.textSecondary),
          )
        else
          for (final entry in inventory.stacks.entries)
            _InventoryRow(
              item: entry.key,
              quantity: entry.value,
              equipped: inventory.equipped.contains(entry.key),
              onConsume: () {
                final def = ItemCatalog.of(entry.key);
                controller.consume(entry.key);
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(content: Text('Consumiu ${def.name}.')),
                );
              },
              onEquip: () => controller.equip(entry.key),
            ),

        const SectionHeader('Diário'),
        for (final line in campaign.journal.reversed.take(25))
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 3),
            child: Text(
              line,
              style: const TextStyle(
                fontSize: 11,
                color: CyberColors.textSecondary,
              ),
            ),
          ),
      ],
    );
  }
}

class _AttributeRow extends StatelessWidget {
  const _AttributeRow({required this.attribute, required this.value});

  final Attribute attribute;
  final int value;

  @override
  Widget build(BuildContext context) {
    // 3..12 é a faixa de rolagem; normalizamos para a barra.
    final ratio = ((value - 3) / 9).clamp(0.0, 1.0);

    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  attribute.label,
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              Text(
                '$value',
                style: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w800,
                  color: CyberColors.cyan,
                ),
              ),
            ],
          ),
          Text(
            attribute.description,
            style: const TextStyle(fontSize: 10, color: CyberColors.outline),
          ),
          const SizedBox(height: 4),
          ClipRRect(
            borderRadius: BorderRadius.circular(3),
            child: LinearProgressIndicator(
              value: ratio,
              minHeight: 4,
              backgroundColor: CyberColors.surfaceHigh,
              valueColor: const AlwaysStoppedAnimation(CyberColors.cyan),
            ),
          ),
        ],
      ),
    );
  }
}

class _ProgressionCard extends StatelessWidget {
  const _ProgressionCard({required this.character});

  final dynamic character;

  @override
  Widget build(BuildContext context) {
    final CitizenLevel? next = character.level.next as CitizenLevel?;
    if (next == null) {
      return const Card(
        child: Padding(
          padding: EdgeInsets.all(14),
          child: Text(
            'Endgame alcançado. Agora é manter o monopólio.',
            style: TextStyle(fontSize: 12, color: CyberColors.green),
          ),
        ),
      );
    }

    final requirement = switch (next) {
      CitizenLevel.farmer => '1.500¢ em caixa',
      CitizenLevel.industrialist => '12.000¢ e 5.000¢ em itens',
      CitizenLevel.elite => '60.000¢ e Status 12+',
      CitizenLevel.survivor => '—',
    };
    final met = character.meetsRequirementsFor(next) as bool;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Row(
          children: [
            Icon(
              met ? Icons.check_circle : Icons.lock_outline,
              color: met ? CyberColors.green : CyberColors.outline,
              size: 20,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    next.label,
                    style: const TextStyle(
                      fontWeight: FontWeight.w700,
                      fontSize: 13,
                    ),
                  ),
                  Text(
                    next.goal,
                    style: const TextStyle(
                      fontSize: 11,
                      color: CyberColors.textSecondary,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'Requisito: $requirement',
                    style: TextStyle(
                      fontSize: 11,
                      color: met ? CyberColors.green : CyberColors.amber,
                    ),
                  ),
                  if (met)
                    const Text(
                      'A promoção acontece no próximo reset.',
                      style: TextStyle(fontSize: 10, color: CyberColors.green),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _EquippedRow extends StatelessWidget {
  const _EquippedRow({required this.item, required this.onUnequip});

  final ItemId item;
  final VoidCallback onUnequip;

  @override
  Widget build(BuildContext context) {
    final def = ItemCatalog.of(item);
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        children: [
          const Icon(Icons.shield_outlined,
              size: 16, color: CyberColors.green),
          const SizedBox(width: 10),
          Expanded(
            child: Text(def.name, style: const TextStyle(fontSize: 13)),
          ),
          if (def.attackPower > 0)
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: Text(
                'ATK ${def.attackPower}',
                style: const TextStyle(fontSize: 11, color: CyberColors.pink),
              ),
            ),
          if (def.defensePower > 0)
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: Text(
                'DEF ${def.defensePower}',
                style: const TextStyle(fontSize: 11, color: CyberColors.cyan),
              ),
            ),
          TextButton(
            onPressed: onUnequip,
            child: const Text('TIRAR', style: TextStyle(fontSize: 11)),
          ),
        ],
      ),
    );
  }
}

class _ModifierChip extends StatelessWidget {
  const _ModifierChip({
    required this.label,
    required this.value,
    required this.color,
  });

  final String label;
  final double value;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: CyberColors.surfaceHigh,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: const TextStyle(fontSize: 10, color: CyberColors.textSecondary),
          ),
          const SizedBox(height: 2),
          Text(
            value == 0 ? '—' : '${(value * 100).round()}%',
            style: TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w800,
              color: value == 0 ? CyberColors.outline : color,
            ),
          ),
        ],
      ),
    );
  }
}

class _InventoryRow extends StatelessWidget {
  const _InventoryRow({
    required this.item,
    required this.quantity,
    required this.equipped,
    required this.onConsume,
    required this.onEquip,
  });

  final ItemId item;
  final int quantity;
  final bool equipped;
  final VoidCallback onConsume;
  final VoidCallback onEquip;

  @override
  Widget build(BuildContext context) {
    final def = ItemCatalog.of(item);

    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 10, 8, 10),
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
                              fontSize: 13,
                              fontWeight: FontWeight.w600,
                            ),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        const SizedBox(width: 6),
                        Text(
                          'x$quantity',
                          style: const TextStyle(
                            fontSize: 12,
                            color: CyberColors.amber,
                            fontWeight: FontWeight.w700,
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
                      '${def.tier.label} · ${def.category.label}',
                      style: const TextStyle(
                        fontSize: 10,
                        color: CyberColors.outline,
                      ),
                    ),
                    if (def.restoresHunger > 0 || def.restoresThirst > 0)
                      Text(
                        [
                          if (def.restoresHunger > 0) '+${def.restoresHunger} fome',
                          if (def.restoresThirst > 0) '+${def.restoresThirst} sede',
                          if (def.thirstCost > 0) '-${def.thirstCost} sede',
                        ].join(' · '),
                        style: const TextStyle(
                          fontSize: 10,
                          color: CyberColors.green,
                        ),
                      ),
                  ],
                ),
              ),
              if (def.isConsumable)
                IconButton(
                  icon: const Icon(Icons.restaurant, size: 18),
                  color: CyberColors.green,
                  tooltip: 'Consumir',
                  onPressed: onConsume,
                ),
              if (def.isEquipment && !equipped)
                IconButton(
                  icon: const Icon(Icons.shield_outlined, size: 18),
                  color: CyberColors.cyan,
                  tooltip: 'Equipar',
                  onPressed: onEquip,
                ),
            ],
          ),
        ),
      ),
    );
  }
}
