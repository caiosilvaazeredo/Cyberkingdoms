import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/seed/deterministic_random.dart';
import '../data/campaign_repository.dart';
import '../domain/building/building_type.dart';
import '../domain/building/plot.dart';
import '../data/firebase_bootstrap.dart';
import '../domain/campaign/campaign.dart';
import '../domain/campaign/daily_tick.dart';
import '../domain/character/attributes.dart';
import '../domain/economy/item.dart';
import '../domain/economy/market.dart';
import '../domain/survival/daily_activity.dart';
import '../domain/survival/survival_tables.dart';
import '../domain/world/coords.dart';
import '../game/sprite_catalog.dart';

/// Bootstrap do backend. Resolve uma vez no início do app.
final bootstrapProvider = FutureProvider<BootstrapResult>((ref) async {
  return FirebaseBootstrap.start();
});

final campaignRepositoryProvider = Provider<CampaignRepository>((ref) {
  final bootstrap = ref.watch(bootstrapProvider);
  return bootstrap.maybeWhen(
    data: (result) => result.repository,
    orElse: () => LocalCampaignRepository(),
  );
});

/// Catálogo de sprites, carregado uma vez e compartilhado.
final spriteCatalogProvider = FutureProvider<SpriteCatalog>((ref) async {
  final catalog = await SpriteCatalog.load();
  await catalog.preloadUsedSprites();
  return catalog;
});

final campaignListProvider = FutureProvider<List<CampaignSummary>>((ref) async {
  return ref.watch(campaignRepositoryProvider).listCampaigns();
});

/// A campanha ativa e todas as ações que a modificam.
///
/// Toda mutação passa por aqui e termina com um save — perder progresso porque
/// o jogador fechou o app é inaceitável num jogo com morte permanente.
class CampaignController extends StateNotifier<Campaign?> {
  CampaignController(this._repository) : super(null);

  final CampaignRepository _repository;

  /// O que o jogador fez hoje, acumulando até o reset.
  DailyActivity _today = const DailyActivity();
  DailyActivity get today => _today;

  /// Relatório do último reset, para a UI exibir.
  TickReport? lastReport;

  Future<void> startNew({
    required String seedLabel,
    required String characterName,
  }) async {
    final campaign = Campaign.create(
      id: 'camp_${DateTime.now().millisecondsSinceEpoch}',
      seedLabel: seedLabel,
      characterName: characterName,
    );
    _today = const DailyActivity();
    lastReport = null;
    state = campaign;
    await _repository.saveCampaign(campaign);
  }

  Future<bool> open(String id) async {
    final campaign = await _repository.loadCampaign(id);
    if (campaign == null) return false;
    _today = const DailyActivity();
    lastReport = null;
    state = campaign;
    return true;
  }

  void close() {
    state = null;
    _today = const DailyActivity();
    lastReport = null;
  }

  Future<void> save() async {
    final campaign = state;
    if (campaign == null) return;
    await _repository.saveCampaign(campaign);
  }

  /// Notifica os ouvintes sem trocar a instância. A campanha é mutável por
  /// dentro (o mundo tem cache, o inventário muda in-place), então usamos um
  /// contador de revisão em vez de copiar o objeto inteiro a cada ação.
  void _bump() {
    final current = state;
    state = null;
    state = current;
  }

  // ---------------------------------------------------------------------------
  // Ações do dia
  // ---------------------------------------------------------------------------

  void chooseWork({
    PublicWork? publicWork,
    PlayerFarmWork? farmWork,
    WorkshopWork? workshopWork,
  }) {
    _today = _today.copyWith(
      clearWork: true,
    ).copyWith(
      publicWork: publicWork,
      farmWork: farmWork,
      workshopWork: workshopWork,
    );
    _bump();
  }

  void clearWork() {
    _today = _today.copyWith(clearWork: true);
    _bump();
  }

  /// Consome um item agora — restaura barras e registra o custo do dia.
  bool consume(ItemId item) {
    final campaign = state;
    if (campaign == null) return false;
    if (!campaign.character.consume(item)) return false;

    final def = ItemCatalog.of(item);
    if (def.hungerCost > 0 || def.thirstCost > 0) {
      _today = _today.copyWith(consumed: [..._today.consumed, item]);
    }
    campaign.log('Consumiu ${def.name}.');
    _bump();
    unawaited(save());
    return true;
  }

  /// Inicia viagem por uma estrada. Bloqueia ações até a chegada.
  String? travelTo(String destinationId) {
    final campaign = state;
    if (campaign == null) return 'Nenhuma campanha aberta.';

    final character = campaign.character;
    if (character.isTravelling) return 'Você já está em trânsito.';

    final fromId = campaign.currentSettlementId;
    if (fromId == null) return 'Você precisa estar numa cidade para viajar.';

    final connecting = campaign.world.layout
        .roadsFrom(fromId)
        .where((r) => r.fromId == destinationId || r.toId == destinationId)
        .toList();
    if (connecting.isEmpty) return 'Não há estrada direta para esse destino.';
    final road = connecting.first;

    character.travellingTo = destinationId;
    character.travelDaysRemaining = road.travelDays;
    final destination = campaign.world.layout.byId(destinationId);
    campaign.log(
      'Partiu para ${destination?.name ?? destinationId} '
      '(${road.travelDays} dia(s), risco ${(road.danger * 100).round()}%).',
    );
    _bump();
    unawaited(save());
    return null;
  }

  /// Compra num mercado.
  TradeResult buy({
    required MarketKind kind,
    required ItemId item,
    required int quantity,
  }) {
    final campaign = state;
    if (campaign == null) return const TradeFailure('Nenhuma campanha aberta.');

    final settlementId = campaign.currentSettlementId;
    if (settlementId == null) {
      return const TradeFailure('Você não está numa cidade.');
    }

    final market = campaign.marketOf(settlementId, kind);
    if (market == null) {
      return const TradeFailure('Este mercado não existe aqui.');
    }

    final government = campaign.governmentOf(settlementId);
    final result = market.buy(
      item: item,
      quantity: quantity,
      availableCredits: campaign.character.credits,
      taxRate: government.taxRate,
    );

    if (result is TradeSuccess) {
      campaign.character.credits -= result.totalPaid;
      campaign.character.inventory.add(result.item, result.quantity);
      government.collectTax(result.tax);
      campaign.log(
        'Comprou ${result.quantity}x ${ItemCatalog.of(result.item).name} '
        'por ${result.totalPaid} créditos.',
      );
      _bump();
      unawaited(save());
    }
    return result;
  }

  /// Publica uma oferta de venda. O preço é do jogador.
  String? sell({
    required MarketKind kind,
    required ItemId item,
    required int quantity,
    required int unitPrice,
  }) {
    final campaign = state;
    if (campaign == null) return 'Nenhuma campanha aberta.';

    final settlementId = campaign.currentSettlementId;
    if (settlementId == null) return 'Você não está numa cidade.';

    final market = campaign.marketOf(settlementId, kind);
    if (market == null) return 'Este mercado não existe aqui.';

    if (!campaign.character.inventory.has(item, quantity)) {
      return 'Você não tem $quantity unidades.';
    }
    if (!kind.accepts(item)) {
      return 'O ${kind.label} não aceita esse item.';
    }

    campaign.character.inventory.remove(item, quantity);
    market.postOrder(
      sellerId: campaign.character.id,
      sellerName: campaign.character.name,
      item: item,
      quantity: quantity,
      unitPrice: unitPrice,
      day: campaign.day,
    );
    campaign.log(
      'Anunciou ${quantity}x ${ItemCatalog.of(item).name} a $unitPrice cada.',
    );
    _bump();
    unawaited(save());
    return null;
  }

  // ---------------------------------------------------------------------------
  // Terreno
  // ---------------------------------------------------------------------------

  /// Inicia uma obra no terreno. Só funciona se o jogador estiver na cidade do
  /// terreno — construir à distância anularia o custo logístico do jogo.
  BuildResult build({
    required BuildingId type,
    required int x,
    required int y,
  }) {
    final campaign = state;
    if (campaign == null) {
      return const BuildRejected('Nenhuma campanha aberta.');
    }
    if (!campaign.character.canAct) {
      return const BuildRejected('Você não pode construir em trânsito.');
    }
    if (campaign.currentSettlementId != campaign.plot.settlementId) {
      return const BuildRejected(
        'Você precisa estar na cidade do terreno para construir.',
      );
    }

    final result = campaign.plot.build(
      type: type,
      x: x,
      y: y,
      inventory: campaign.character.inventory,
      credits: campaign.character.credits,
      level: campaign.character.level,
      day: campaign.day,
    );

    if (result is BuildAccepted) {
      campaign.character.credits -= result.building.def.creditCost;
      campaign.log('Obra iniciada: ${result.building.def.name}.');
      _bump();
      unawaited(save());
    }
    return result;
  }

  /// Demole e devolve metade dos materiais.
  Map<ItemId, int> demolish(String instanceId) {
    final campaign = state;
    if (campaign == null) return const {};

    final refund = campaign.plot.demolish(instanceId);
    for (final entry in refund.entries) {
      campaign.character.inventory.add(entry.key, entry.value);
    }
    _bump();
    unawaited(save());
    return refund;
  }

  bool assignWorkers(String instanceId, int count) {
    final campaign = state;
    if (campaign == null) return false;
    final ok = campaign.plot.assignWorkers(instanceId, count);
    if (ok) {
      _bump();
      unawaited(save());
    }
    return ok;
  }

  bool equip(ItemId item) {
    final campaign = state;
    if (campaign == null) return false;
    final ok = campaign.character.inventory.equip(item);
    if (ok) {
      _bump();
      unawaited(save());
    }
    return ok;
  }

  void unequip(ItemId item) {
    final campaign = state;
    if (campaign == null) return;
    campaign.character.inventory.unequip(item);
    _bump();
    unawaited(save());
  }

  /// Move o personagem no mundo aberto (dentro da mesma região).
  void moveTo(TileCoord tile) {
    final campaign = state;
    if (campaign == null || !campaign.character.canAct) return;
    if (!campaign.world.tileAt(tile.x, tile.y).isWalkable) return;
    campaign.character.position = tile;
    _bump();
  }

  /// Rerrola atributos. O GDD permite até 3 vezes.
  bool reroll() {
    final campaign = state;
    if (campaign == null) return false;
    final character = campaign.character;
    if (!character.canReroll) return false;

    character.rerollsUsed++;
    // A rerrolagem usa a seed da campanha + o número de tentativas, para que
    // seja reproduzível e não dependa do relógio.
    character.attributes = AttributeSet.roll(
      DeterministicRandom(
        DeterministicRandom.mix(campaign.seed, character.rerollsUsed * 977),
      ),
    );
    character.hp = character.maxHp;
    _bump();
    unawaited(save());
    return true;
  }

  /// Fecha o dia — o reset da meia-noite.
  TickReport endDay() {
    final campaign = state;
    if (campaign == null) {
      throw StateError('Nenhuma campanha aberta.');
    }

    final report = const DailyTick().run(campaign, _today);
    lastReport = report;
    _today = const DailyActivity();
    _bump();
    unawaited(save());
    return report;
  }
}

final campaignControllerProvider =
    StateNotifierProvider<CampaignController, Campaign?>((ref) {
  return CampaignController(ref.watch(campaignRepositoryProvider));
});
