import 'package:cyberkingdoms/core/seed/deterministic_random.dart';
import 'package:cyberkingdoms/domain/character/attributes.dart';
import 'package:cyberkingdoms/domain/economy/inventory.dart';
import 'package:cyberkingdoms/domain/economy/item.dart';
import 'package:cyberkingdoms/domain/economy/market.dart';
import 'package:cyberkingdoms/domain/economy/recipe.dart';
import 'package:cyberkingdoms/domain/world/coords.dart';
import 'package:cyberkingdoms/domain/world/settlement.dart';
import 'package:flutter_test/flutter_test.dart';

Settlement _capital(String id, CityVocation vocation) => Settlement(
      id: id,
      name: 'Teste $id',
      kind: SettlementKind.capital,
      center: const TileCoord(0, 0),
      vocation: vocation,
      radius: 30,
      population: 200000,
    );

final _testCapital = _capital('cap_0', CityVocation.foundry);
final _agroCapital = _capital('cap_agro', CityVocation.agroBio);
final _foundryCapital = _capital('cap_foundry', CityVocation.foundry);

void main() {
  group('Catálogo', () {
    test('todo item do enum tem definição', () {
      for (final id in ItemId.values) {
        expect(() => ItemCatalog.of(id), returnsNormally, reason: '$id');
      }
    });

    test('as três camadas produtivas estão povoadas', () {
      expect(ItemCatalog.byTier(ProductionTier.extraction), isNotEmpty);
      expect(ItemCatalog.byTier(ProductionTier.refining), isNotEmpty);
      expect(ItemCatalog.byTier(ProductionTier.manufacturing), isNotEmpty);
    });

    test('valor sobe conforme a camada', () {
      double average(ProductionTier tier) {
        final items = ItemCatalog.byTier(tier);
        return items.fold(0, (sum, d) => sum + d.baseValue) / items.length;
      }

      expect(average(ProductionTier.refining),
          greaterThan(average(ProductionTier.extraction)));
      expect(average(ProductionTier.manufacturing),
          greaterThan(average(ProductionTier.refining)));
    });

    test('os estimulantes seguem a tabela do GDD', () {
      final redRush = ItemCatalog.of(ItemId.redRush);
      expect(redRush.strengthBonus, 6);
      expect(redRush.thirstCost, 15);

      expect(ItemCatalog.of(ItemId.caffeine).thirstCost, 10);
      expect(ItemCatalog.of(ItemId.glowVodka).thirstCost, 8);
    });

    test('os equipamentos redutores seguem a tabela do GDD', () {
      expect(ItemCatalog.of(ItemId.hydrationPack).thirstUpkeepModifier, -0.20);
      expect(ItemCatalog.of(ItemId.thermalJacket).hungerUpkeepModifier, -0.15);
      expect(ItemCatalog.of(ItemId.metabolicImplant).hungerUpkeepModifier, -0.30);
      expect(ItemCatalog.of(ItemId.metabolicImplant).thirstUpkeepModifier, -0.30);
    });
  });

  group('Cadeia produtiva', () {
    test('dentro da cadeia, nenhuma receita puxa de camada superior', () {
      // A regra vale entre Extração/Refino/Manufatura. Itens `basic` (água,
      // comida de rua) ficam fora da cadeia: são bens de consumo produzidos a
      // partir dela, então naturalmente consomem insumos de camada 1.
      for (final recipe in RecipeBook.all) {
        final outputTier = ItemCatalog.of(recipe.output).tier;
        if (outputTier == ProductionTier.basic) continue;

        for (final input in recipe.inputs.keys) {
          final inputTier = ItemCatalog.of(input).tier;
          if (inputTier == ProductionTier.basic) continue;
          expect(inputTier.level, lessThanOrEqualTo(outputTier.level),
              reason: '${recipe.id} usa insumo de camada superior');
        }
      }
    });

    test('nenhuma receita se alimenta do próprio produto', () {
      for (final recipe in RecipeBook.all) {
        expect(recipe.inputs.keys, isNot(contains(recipe.output)),
            reason: '${recipe.id} é circular');
      }
    });

    test('chip depende de terras raras — o gargalo da economia', () {
      final chipRecipes = RecipeBook.producing(ItemId.chip);
      expect(chipRecipes, isNotEmpty);
      expect(chipRecipes.first.inputs.keys, contains(ItemId.rareEarth));
    });

    test('inteligência aumenta o rendimento da receita', () {
      final recipe = RecipeBook.producing(ItemId.polymer).first;
      final dull = AttributeSet({for (final a in Attribute.values) a: 3});
      final bright = AttributeSet({for (final a in Attribute.values) a: 12});

      expect(recipe.yieldFor(bright), greaterThan(recipe.yieldFor(dull)));
    });

    test('receitas de nível alto não aparecem para iniciantes', () {
      final available = RecipeBook.availableAt(CitizenLevel.survivor);
      for (final recipe in available) {
        expect(recipe.requiredLevel, CitizenLevel.survivor);
      }
      expect(
        RecipeBook.availableAt(CitizenLevel.elite).length,
        greaterThan(available.length),
      );
    });
  });

  group('Inventário', () {
    test('remover mais do que tem falha sem alterar o estado', () {
      final inventory = Inventory()..add(ItemId.water, 3);
      expect(inventory.remove(ItemId.water, 5), isFalse);
      expect(inventory.quantityOf(ItemId.water), 3);
    });

    test('zerar um stack desequipa o item', () {
      final inventory = Inventory()..add(ItemId.rifle, 1);
      expect(inventory.equip(ItemId.rifle), isTrue);
      expect(inventory.equipped, contains(ItemId.rifle));

      inventory.remove(ItemId.rifle, 1);
      expect(inventory.equipped, isEmpty);
    });

    test('não dá para equipar o que não é equipamento', () {
      final inventory = Inventory()..add(ItemId.water, 1);
      expect(inventory.equip(ItemId.water), isFalse);
    });

    test('modificadores de consumo somam mas travam em -80%', () {
      final inventory = Inventory()
        ..add(ItemId.metabolicImplant, 1)
        ..add(ItemId.hydrationPack, 1)
        ..add(ItemId.thermalJacket, 1);
      inventory.equip(ItemId.metabolicImplant);
      inventory.equip(ItemId.hydrationPack);
      inventory.equip(ItemId.thermalJacket);

      final modifiers = inventory.upkeepModifiers;
      expect(modifiers.hunger, closeTo(-0.45, 0.001));
      expect(modifiers.thirst, closeTo(-0.50, 0.001));
      expect(modifiers.hunger, greaterThanOrEqualTo(-0.8));
      expect(modifiers.thirst, greaterThanOrEqualTo(-0.8));
    });

    test('contrabando é identificado', () {
      final inventory = Inventory()
        ..add(ItemId.water, 1)
        ..add(ItemId.syntheticDrug, 2);
      expect(inventory.contraband, [ItemId.syntheticDrug]);
    });

    test('serializa e desserializa sem perder nada', () {
      final original = Inventory()
        ..add(ItemId.chip, 4)
        ..add(ItemId.rifle, 1);
      original.equip(ItemId.rifle);

      final restored = Inventory.fromJson(original.toJson());
      expect(restored.quantityOf(ItemId.chip), 4);
      expect(restored.equipped, contains(ItemId.rifle));
    });
  });

  group('Mercado', () {
    Market emptyMarket(MarketKind kind) =>
        Market(settlementId: 'cap_0', kind: kind);

    test('o Mercado Central recusa itens ilegais', () {
      final market = emptyMarket(MarketKind.central);
      final order = market.postOrder(
        sellerId: 'p',
        sellerName: 'P',
        item: ItemId.syntheticDrug,
        quantity: 5,
        unitPrice: 100,
        day: 1,
      );
      expect(order, isNull);
    });

    test('o Mercado Clandestino aceita tudo', () {
      final market = emptyMarket(MarketKind.clandestine);
      expect(
        market.postOrder(
          sellerId: 'p',
          sellerName: 'P',
          item: ItemId.syntheticDrug,
          quantity: 5,
          unitPrice: 100,
          day: 1,
        ),
        isNotNull,
      );
      expect(
        market.postOrder(
          sellerId: 'p',
          sellerName: 'P',
          item: ItemId.water,
          quantity: 5,
          unitPrice: 10,
          day: 1,
        ),
        isNotNull,
      );
    });

    test('a compra varre as ofertas mais baratas primeiro', () {
      final market = emptyMarket(MarketKind.central);
      market.postOrder(
        sellerId: 'a', sellerName: 'A', item: ItemId.water,
        quantity: 5, unitPrice: 20, day: 1,
      );
      market.postOrder(
        sellerId: 'b', sellerName: 'B', item: ItemId.water,
        quantity: 5, unitPrice: 10, day: 1,
      );

      final result = market.buy(
        item: ItemId.water,
        quantity: 7,
        availableCredits: 100000,
        taxRate: 0,
      );

      // 5 unidades a 10 + 2 a 20 = 90.
      expect(result, isA<TradeSuccess>());
      expect((result as TradeSuccess).totalPaid, 90);
    });

    test('imposto é somado e reportado à parte', () {
      final market = emptyMarket(MarketKind.central);
      market.postOrder(
        sellerId: 'a', sellerName: 'A', item: ItemId.water,
        quantity: 10, unitPrice: 10, day: 1,
      );

      final result = market.buy(
        item: ItemId.water,
        quantity: 10,
        availableCredits: 100000,
        taxRate: 0.10,
      ) as TradeSuccess;

      expect(result.tax, 10);
      expect(result.totalPaid, 110);
    });

    test('o mercado clandestino não recolhe imposto', () {
      final market = emptyMarket(MarketKind.clandestine);
      market.postOrder(
        sellerId: 'a', sellerName: 'A', item: ItemId.water,
        quantity: 10, unitPrice: 10, day: 1,
      );

      final result = market.buy(
        item: ItemId.water,
        quantity: 10,
        availableCredits: 100000,
        taxRate: 0.30,
      ) as TradeSuccess;

      expect(result.tax, 0);
      expect(result.totalPaid, 100);
    });

    test('crédito insuficiente não consome o livro de ofertas', () {
      final market = emptyMarket(MarketKind.central);
      market.postOrder(
        sellerId: 'a', sellerName: 'A', item: ItemId.water,
        quantity: 10, unitPrice: 100, day: 1,
      );

      final result = market.buy(
        item: ItemId.water,
        quantity: 10,
        availableCredits: 50,
        taxRate: 0,
      );

      expect(result, isA<TradeFailure>());
      // A oferta continua intacta — este era o risco de aplicar a varredura
      // antes de conferir o saldo.
      expect(market.supplyOf(ItemId.water), 10);
    });

    test('oferta insuficiente é recusada', () {
      final market = emptyMarket(MarketKind.central);
      market.postOrder(
        sellerId: 'a', sellerName: 'A', item: ItemId.water,
        quantity: 2, unitPrice: 10, day: 1,
      );

      final result = market.buy(
        item: ItemId.water,
        quantity: 5,
        availableCredits: 100000,
        taxRate: 0,
      );
      expect(result, isA<TradeFailure>());
      expect(market.supplyOf(ItemId.water), 2);
    });

    test('ofertas velhas expiram', () {
      final market = emptyMarket(MarketKind.central);
      market.postOrder(
        sellerId: 'a', sellerName: 'A', item: ItemId.water,
        quantity: 5, unitPrice: 10, day: 1,
      );

      market.expireOrders(10);
      expect(market.supplyOf(ItemId.water), 5);

      market.expireOrders(30);
      expect(market.supplyOf(ItemId.water), 0);
    });

    test('o estoque semeado é determinístico', () {
      Market seeded() {
        final market = Market(settlementId: 'cap_0', kind: MarketKind.central);
        market.seed(
          settlement: _testCapital,
          rng: DeterministicRandom(4242),
        );
        return market;
      }

      final a = seeded();
      final b = seeded();
      expect(a.orders.length, b.orders.length);
      for (var i = 0; i < a.orders.length; i++) {
        expect(a.orders[i].item, b.orders[i].item);
        expect(a.orders[i].unitPrice, b.orders[i].unitPrice);
        expect(a.orders[i].quantity, b.orders[i].quantity);
      }
    });

    test('a cidade produtora tem preço menor que a consumidora', () {
      // Agro-Bio produz biomassa; a Metalúrgica a importa. Escolher um par
      // produz/demanda garante que o item aparece nos dois livros — itens
      // neutros podem ser sorteados fora do estoque inicial.
      final producer = Market(settlementId: 'p', kind: MarketKind.central)
        ..seed(settlement: _agroCapital, rng: DeterministicRandom(1));
      final consumer = Market(settlementId: 'c', kind: MarketKind.central)
        ..seed(settlement: _foundryCapital, rng: DeterministicRandom(1));

      final producerPrice = producer.bestPrice(ItemId.biomass);
      final consumerPrice = consumer.bestPrice(ItemId.biomass);

      expect(producerPrice, isNotNull);
      expect(consumerPrice, isNotNull);
      expect(producerPrice!, lessThan(consumerPrice!));
    });
  });
}
