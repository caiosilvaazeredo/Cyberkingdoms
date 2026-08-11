import '../../core/seed/deterministic_random.dart';
import '../world/settlement.dart';
import 'item.dart';

/// Os dois mercados do GDD.
enum MarketKind {
  /// Legalizado — aceita apenas produtos lícitos, cobra imposto do governo.
  central('Feira Central'),

  /// Sem fiscalização — drogas, itens roubados, armas ilegais, contrabando.
  clandestine('Feira Furtiva');

  const MarketKind(this.label);
  final String label;

  bool accepts(ItemId item) =>
      this == MarketKind.clandestine || ItemCatalog.of(item).legal;
}

/// Uma ordem no livro. **Quem define o preço é o jogador** — não existe NPC
/// abastecendo o mercado, então tudo aqui saiu do inventário de alguém.
class MarketOrder {
  MarketOrder({
    required this.id,
    required this.sellerId,
    required this.sellerName,
    required this.item,
    required this.quantity,
    required this.unitPrice,
    required this.postedOnDay,
  });

  final String id;
  final String sellerId;
  final String sellerName;
  final ItemId item;
  int quantity;
  final int unitPrice;
  final int postedOnDay;

  int get totalPrice => quantity * unitPrice;

  Map<String, dynamic> toJson() => {
        'id': id,
        'sellerId': sellerId,
        'sellerName': sellerName,
        'item': item.name,
        'quantity': quantity,
        'unitPrice': unitPrice,
        'postedOnDay': postedOnDay,
      };

  factory MarketOrder.fromJson(Map<String, dynamic> json) => MarketOrder(
        id: json['id'] as String,
        sellerId: json['sellerId'] as String,
        sellerName: json['sellerName'] as String,
        item: ItemId.values.byName(json['item'] as String),
        quantity: (json['quantity'] as num).toInt(),
        unitPrice: (json['unitPrice'] as num).toInt(),
        postedOnDay: (json['postedOnDay'] as num).toInt(),
      );
}

/// Resultado de uma tentativa de compra.
sealed class TradeResult {
  const TradeResult();
}

class TradeSuccess extends TradeResult {
  const TradeSuccess({
    required this.item,
    required this.quantity,
    required this.totalPaid,
    required this.tax,
  });

  final ItemId item;
  final int quantity;
  final int totalPaid;
  final int tax;
}

class TradeFailure extends TradeResult {
  const TradeFailure(this.reason);
  final String reason;
}

/// Livro de ofertas de uma cidade. Cada assentamento tem o seu — é o que faz a
/// geografia importar: o mesmo chip custa preços diferentes em capitais
/// diferentes, e a diferença paga a viagem.
class Market {
  Market({
    required this.settlementId,
    required this.kind,
    List<MarketOrder>? orders,
  }) : _orders = [...?orders];

  final String settlementId;
  final MarketKind kind;
  final List<MarketOrder> _orders;

  List<MarketOrder> get orders => List.unmodifiable(_orders);

  List<MarketOrder> ordersFor(ItemId item) =>
      _orders.where((o) => o.item == item && o.quantity > 0).toList()
        ..sort((a, b) => a.unitPrice.compareTo(b.unitPrice));

  /// Menor preço pedido — a cotação que o jogador vê na lista.
  int? bestPrice(ItemId item) {
    final list = ordersFor(item);
    return list.isEmpty ? null : list.first.unitPrice;
  }

  /// Oferta total disponível de um item.
  int supplyOf(ItemId item) =>
      ordersFor(item).fold(0, (sum, o) => sum + o.quantity);

  List<ItemId> get listedItems {
    final seen = <ItemId>{};
    for (final order in _orders) {
      if (order.quantity > 0) seen.add(order.item);
    }
    return seen.toList();
  }

  /// Publica uma oferta. Devolve `null` se o mercado não aceita o item.
  MarketOrder? postOrder({
    required String sellerId,
    required String sellerName,
    required ItemId item,
    required int quantity,
    required int unitPrice,
    required int day,
  }) {
    if (!kind.accepts(item)) return null;
    if (quantity <= 0 || unitPrice <= 0) return null;

    final order = MarketOrder(
      id: 'ord_${settlementId}_${kind.name}_${day}_${_orders.length}',
      sellerId: sellerId,
      sellerName: sellerName,
      item: item,
      quantity: quantity,
      unitPrice: unitPrice,
      postedOnDay: day,
    );
    _orders.add(order);
    return order;
  }

  /// Compra [quantity] unidades varrendo as ofertas mais baratas primeiro.
  ///
  /// [availableCredits] é o saldo do comprador; [taxRate] é o imposto que o
  /// governo local cobra (só no Mercado Central — o clandestino não recolhe).
  TradeResult buy({
    required ItemId item,
    required int quantity,
    required int availableCredits,
    required double taxRate,
  }) {
    if (quantity <= 0) return const TradeFailure('Quantidade inválida.');
    if (!kind.accepts(item)) {
      return const TradeFailure('Este mercado não negocia esse item.');
    }

    final book = ordersFor(item);
    final supply = book.fold(0, (sum, o) => sum + o.quantity);
    if (supply < quantity) {
      return TradeFailure('Oferta insuficiente: só há $supply em estoque.');
    }

    // Simula antes de aplicar, para não deixar o livro em estado parcial se o
    // dinheiro acabar no meio da varredura.
    var remaining = quantity;
    var subtotal = 0;
    for (final order in book) {
      if (remaining == 0) break;
      final take = remaining < order.quantity ? remaining : order.quantity;
      subtotal += take * order.unitPrice;
      remaining -= take;
    }

    final tax = kind == MarketKind.central ? (subtotal * taxRate).round() : 0;
    final total = subtotal + tax;
    if (total > availableCredits) {
      return TradeFailure('Coroas insuficientes: precisa de $total.');
    }

    // Efetiva.
    remaining = quantity;
    for (final order in book) {
      if (remaining == 0) break;
      final take = remaining < order.quantity ? remaining : order.quantity;
      order.quantity -= take;
      remaining -= take;
    }
    _orders.removeWhere((o) => o.quantity <= 0);

    return TradeSuccess(
      item: item,
      quantity: quantity,
      totalPaid: total,
      tax: tax,
    );
  }

  /// Remove ofertas antigas para o livro não crescer sem limite ao longo de
  /// campanhas longas.
  void expireOrders(int currentDay, {int maxAgeInDays = 14}) {
    _orders.removeWhere(
      (o) => currentDay - o.postedOnDay > maxAgeInDays,
    );
  }

  /// Semeia o livro no início da campanha.
  ///
  /// Isto **não** contradiz "não existem NPCs abastecendo o mercado": é o
  /// estoque inicial dos colonos que já estavam ali quando a campanha começa.
  /// A partir do dia 1 nada mais entra sem um jogador ter produzido.
  void seed({
    required Settlement settlement,
    required DeterministicRandom rng,
  }) {
    final vocation = settlement.vocation;
    final catalog = kind == MarketKind.clandestine
        ? ItemCatalog.all.where((d) => !d.legal || d.category == ItemCategory.drug)
        : ItemCatalog.all.where((d) => d.legal);

    for (final def in catalog) {
      // Cidades produtoras têm estoque farto e barato; consumidoras, escasso e
      // caro. É a assimetria que cria a rota comercial.
      final produces = vocation.produces.contains(def.id);
      final demands = vocation.demands.contains(def.id);

      if (!produces && !demands && rng.chance(0.55)) continue;

      final scale = settlement.isCapital ? 1.0 : 0.45;
      final quantity = produces
          ? (rng.range(40, 140) * scale).round()
          : demands
              ? (rng.range(2, 12) * scale).round()
              : (rng.range(6, 40) * scale).round();
      if (quantity <= 0) continue;

      final priceFactor = produces
          ? rng.rangeDouble(0.62, 0.88)
          : demands
              ? rng.rangeDouble(1.25, 1.85)
              : rng.rangeDouble(0.90, 1.20);
      final blackMarketPremium =
          kind == MarketKind.clandestine ? rng.rangeDouble(1.15, 1.6) : 1.0;

      final unitPrice =
          (def.baseValue * priceFactor * blackMarketPremium).round().clamp(1, 999999);

      postOrder(
        sellerId: 'colonos',
        sellerName: 'Estoque dos Colonos',
        item: def.id,
        quantity: quantity,
        unitPrice: unitPrice,
        day: 0,
      );
    }
  }

  Map<String, dynamic> toJson() => {
        'settlementId': settlementId,
        'kind': kind.name,
        'orders': _orders.map((o) => o.toJson()).toList(),
      };

  factory Market.fromJson(Map<String, dynamic> json) => Market(
        settlementId: json['settlementId'] as String,
        kind: MarketKind.values.byName(json['kind'] as String),
        orders: (json['orders'] as List)
            .map((e) => MarketOrder.fromJson(e as Map<String, dynamic>))
            .toList(),
      );
}
