import 'item.dart';

/// Inventário do personagem. Guarda quantidades por item e o que está
/// equipado.
class Inventory {
  Inventory({Map<ItemId, int>? stacks, Set<ItemId>? equipped})
      : _stacks = {...?stacks},
        _equipped = {...?equipped};

  final Map<ItemId, int> _stacks;
  final Set<ItemId> _equipped;

  Map<ItemId, int> get stacks => Map.unmodifiable(_stacks);
  Set<ItemId> get equipped => Set.unmodifiable(_equipped);

  int quantityOf(ItemId id) => _stacks[id] ?? 0;

  bool has(ItemId id, [int quantity = 1]) => quantityOf(id) >= quantity;

  void add(ItemId id, int quantity) {
    if (quantity <= 0) return;
    _stacks[id] = quantityOf(id) + quantity;
  }

  /// Remove [quantity] unidades. Devolve `false` e não altera nada se não
  /// houver saldo — chamadores tratam isso como "transação recusada".
  bool remove(ItemId id, int quantity) {
    if (quantity <= 0) return true;
    final current = quantityOf(id);
    if (current < quantity) return false;
    if (current == quantity) {
      _stacks.remove(id);
      _equipped.remove(id);
    } else {
      _stacks[id] = current - quantity;
    }
    return true;
  }

  bool equip(ItemId id) {
    if (!has(id)) return false;
    if (!ItemCatalog.of(id).isEquipment) return false;
    _equipped.add(id);
    return true;
  }

  void unequip(ItemId id) => _equipped.remove(id);

  int get totalWeight => _stacks.entries.fold(
        0,
        (sum, e) => sum + ItemCatalog.of(e.key).weight * e.value,
      );

  /// Patrimônio estimado a preço-base. Não é o que o mercado pagaria — serve
  /// para o placar e para o requisito de patrimônio das quests.
  int get estimatedValue => _stacks.entries.fold(
        0,
        (sum, e) => sum + ItemCatalog.of(e.key).baseValue * e.value,
      );

  /// Soma dos modificadores de consumo dos itens equipados.
  ({double hunger, double thirst}) get upkeepModifiers {
    var hunger = 0.0;
    var thirst = 0.0;
    for (final id in _equipped) {
      final def = ItemCatalog.of(id);
      hunger += def.hungerUpkeepModifier;
      thirst += def.thirstUpkeepModifier;
    }
    // Trava em -80% para que nenhuma combinação zere a sobrevivência.
    return (
      hunger: hunger.clamp(-0.8, 0.0),
      thirst: thirst.clamp(-0.8, 0.0),
    );
  }

  int get attackPower => _equipped.fold(
        0,
        (sum, id) => sum + ItemCatalog.of(id).attackPower,
      );

  int get defensePower => _equipped.fold(
        0,
        (sum, id) => sum + ItemCatalog.of(id).defensePower,
      );

  /// Itens ilegais carregados. Ser pego com eles numa capital é crime.
  List<ItemId> get contraband =>
      _stacks.keys.where((id) => !ItemCatalog.of(id).legal).toList();

  Inventory clone() => Inventory(stacks: _stacks, equipped: _equipped);

  Map<String, dynamic> toJson() => {
        'stacks': {for (final e in _stacks.entries) e.key.name: e.value},
        'equipped': _equipped.map((e) => e.name).toList(),
      };

  factory Inventory.fromJson(Map<String, dynamic> json) {
    final rawStacks = (json['stacks'] as Map?) ?? const {};
    final rawEquipped = (json['equipped'] as List?) ?? const [];
    return Inventory(
      stacks: {
        for (final e in rawStacks.entries)
          if (_parseItem(e.key as String) case final id?)
            id: (e.value as num).toInt(),
      },
      equipped: {
        for (final name in rawEquipped)
          if (_parseItem(name as String) case final id?) id,
      },
    );
  }

  /// Tolera itens desconhecidos: um save antigo com um item removido do
  /// catálogo carrega sem quebrar, apenas perdendo aquele stack.
  static ItemId? _parseItem(String name) {
    for (final id in ItemId.values) {
      if (id.name == name) return id;
    }
    return null;
  }
}
