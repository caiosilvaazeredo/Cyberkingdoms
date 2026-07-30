import '../../core/seed/deterministic_random.dart';
import '../building/plot.dart';
import '../character/attributes.dart';
import '../character/character.dart';
import '../combat/combat.dart';
import '../economy/item.dart';
import '../politics/government.dart';
import '../survival/daily_activity.dart';
import '../survival/survival_tables.dart';
import 'campaign.dart';
import 'quest.dart';

/// O reset diário da meia-noite — o coração do jogo.
///
/// O GDD concentra quase tudo neste momento: consumo de Fome/Sede, resolução de
/// combate, chegada de viagens, pagamento de salários, apuração de eleições.
/// Manter tudo num único motor determinístico é o que vai permitir, quando o
/// backend existir, que um cron job de 24h recalcule o dia no servidor e
/// compare com o que o cliente reportou.
class DailyTick {
  const DailyTick();

  /// Executa o fechamento do dia. [activity] é o que o jogador fez.
  TickReport run(Campaign campaign, DailyActivity activity) {
    final events = <String>[];
    final character = campaign.character;

    if (character.dead) {
      return TickReport(
        day: campaign.day,
        events: const ['O personagem está morto. A campanha acabou.'],
        upkeep: const UpkeepBreakdown(lines: [], total: Upkeep.zero),
        outcome: null,
      );
    }

    // Cada dia tem sua própria seed derivada — reprodutível e independente.
    final dayRng = DeterministicRandom(
      DeterministicRandom.mix(campaign.seed, campaign.day),
    );

    // --- 1. Viagem em curso -------------------------------------------------
    var effectiveActivity = activity;
    if (character.isTravelling) {
      character.travelDaysRemaining--;
      // Enquanto viaja o jogador não trabalha: o canvas bloqueia ações durante
      // o trânsito. A viagem em si já é cobrada como atividade.
      effectiveActivity = activity.copyWith(
        clearWork: true,
        roadsTravelled: 1,
        sleptOnRoad: character.travelDaysRemaining > 0,
      );

      if (character.travelDaysRemaining <= 0) {
        final destinationId = character.travellingTo;
        final destination = destinationId == null
            ? null
            : campaign.world.layout.byId(destinationId);
        if (destination != null) {
          character.position = destination.center;
          events.add('Você chegou em ${destination.name}.');
        }
        character.travellingTo = null;
      } else {
        events.add(
          'Em trânsito — faltam ${character.travelDaysRemaining} dia(s).',
        );
      }
    }

    // --- 2. Combate ---------------------------------------------------------
    final combats = <CombatOutcome>[...effectiveActivity.combats];
    CombatReport? roadCombat;

    if (character.isTravelling || effectiveActivity.roadsTravelled > 0) {
      roadCombat = _rollRoadEncounter(campaign, dayRng, events);
      if (roadCombat != null) {
        combats.add(CombatOutcome(
          won: roadCombat.winnerId == character.id,
          rounds: roadCombat.rounds,
        ));
      }
    }
    effectiveActivity = effectiveActivity.copyWith(combats: combats);

    // --- 3. Produção do trabalho do dia ------------------------------------
    // Cópia mutável: `_resolveWork` devolve um mapa constante quando o dia foi
    // ocioso, e a produção do terreno é somada aqui em cima.
    final produced = <ItemId, int>{
      ..._resolveWork(campaign, effectiveActivity, events),
    };

    // --- 3b. O terreno trabalha sozinho ------------------------------------
    final plotResult = _runPlot(campaign, events);
    for (final entry in plotResult.produced.entries) {
      produced[entry.key] = (produced[entry.key] ?? 0) + entry.value;
    }

    // --- 4. Consumo de Fome e Sede -----------------------------------------
    // Equipamentos e construções do terreno somam; o teto de cada fonte já é
    // aplicado separadamente, então nem a soma zera a sobrevivência.
    final gearModifiers = character.inventory.upkeepModifiers;
    final plotModifiers = campaign.plot.upkeepModifiers;
    final atHome = campaign.currentSettlementId == campaign.plot.settlementId;

    final breakdown = SurvivalResolver.resolve(
      effectiveActivity,
      hungerModifier: gearModifiers.hunger +
          (atHome ? plotModifiers.hunger : 0),
      thirstModifier: gearModifiers.thirst +
          (atHome ? plotModifiers.thirst : 0),
    );
    final outcome = character.applyUpkeep(breakdown.total);

    if (outcome.starving) events.add('Você passou o dia com fome. -25 HP.');
    if (outcome.dehydrated) events.add('Você passou o dia com sede. -25 HP.');
    if (outcome.died) {
      events.add('MORTE PERMANENTE: abandono por fome e sede.');
    }

    // --- 5. Economia e política --------------------------------------------
    if (!character.dead) {
      _payWages(campaign, effectiveActivity, events);
      _expireMarketOrders(campaign);
      _tickElections(campaign, dayRng, events);

      if (character.promote()) {
        events.add('PROMOÇÃO: agora você é ${character.level.label}.');
      }
    }

    // --- 5b. Quests -------------------------------------------------------
    // Depois de tudo: a promoção e a produção do dia contam para os objetivos.
    campaign.markCurrentSettlementVisited();
    final claimedQuests = QuestLog(campaign).claimNewlyCompleted();
    for (final quest in claimedQuests) {
      events.add(
        'QUEST CONCLUÍDA: ${quest.title}'
        '${quest.reward.isEmpty ? '' : ' — recompensa: ${quest.reward.summary}'}.',
      );
    }

    // --- 6. Avança o calendário --------------------------------------------
    campaign.day++;
    // Energia volta ao base todo reset; energéticos somam por cima no dia.
    character.energy = 10;

    for (final event in events) {
      campaign.log(event);
    }

    return TickReport(
      day: campaign.day - 1,
      events: events,
      upkeep: breakdown,
      outcome: outcome,
      combat: roadCombat,
      produced: produced,
      completedQuests: claimedQuests,
    );
  }

  /// Processa o terreno: avança obras, cobra manutenção e roda a produção das
  /// construções. Isto acontece mesmo com o jogador viajando — a base continua
  /// operando sem ele, que é o ponto de ter funcionários.
  PlotTickResult _runPlot(Campaign campaign, List<String> events) {
    final character = campaign.character;
    final result = PlotTick.run(
      campaign.plot,
      inventory: character.inventory,
      availableCredits: character.credits,
    );

    character.credits -= result.upkeepPaid;

    if (result.upkeepPaid > 0) {
      events.add('Manutenção do terreno: -${result.upkeepPaid} créditos.');
    }
    for (final building in result.completed) {
      events.add('Obra concluída: ${building.def.name}.');
    }
    if (result.produced.isNotEmpty) {
      final summary = result.produced.entries
          .map((e) => '${e.value}x ${ItemCatalog.of(e.key).name}')
          .join(', ');
      events.add('Terreno produziu: $summary.');
    }
    if (result.idled.isNotEmpty) {
      events.add(
        '${result.idled.length} construção(ões) pararam por falta de '
        'caixa ou insumo.',
      );
    }

    return result;
  }

  /// Resolve o que o trabalho do dia produziu.
  Map<ItemId, int> _resolveWork(
    Campaign campaign,
    DailyActivity activity,
    List<String> events,
  ) {
    if (!activity.worked) return const {};

    final character = campaign.character;
    final intelligence = character.attributes[Attribute.intelligence];
    final strength = character.attributes[Attribute.strength];

    // Rendimento base do dia, modulado pelos atributos relevantes.
    final produced = <ItemId, int>{};

    if (activity.publicWork case final work?) {
      final item = switch (work) {
        PublicWork.publicFarming => ItemId.biomass,
        PublicWork.dump => ItemId.scrap,
        PublicWork.oil => ItemId.oil,
        PublicWork.rareEarth => ItemId.rareEarth,
      };
      // Trabalho público paga salário, não entrega o produto ao trabalhador:
      // a produção é do governo. Mas o jogador leva uma fração como "sobra".
      final amount = (2 + strength * 0.25).round();
      produced[item] = amount;
      character.inventory.add(item, amount);
      events.add('Serviço público (${work.label}): +$amount ${ItemCatalog.of(item).name}.');
    }

    if (activity.farmWork case final work?) {
      final item = switch (work) {
        PlayerFarmWork.hydroponics => ItemId.biomass,
        PlayerFarmWork.biomass => ItemId.biomass,
        PlayerFarmWork.bioreactors => ItemId.culturedMeat,
      };
      final amount = (4 + intelligence * 0.4).round();
      produced[item] = (produced[item] ?? 0) + amount;
      character.inventory.add(item, amount);
      events.add('Fazenda (${work.label}): +$amount ${ItemCatalog.of(item).name}.');
    }

    if (activity.workshopWork case final work?) {
      final item = switch (work) {
        WorkshopWork.textiles => ItemId.fabric,
        WorkshopWork.hardware => ItemId.circuitBoard,
        WorkshopWork.laboratory => ItemId.catalyst,
        WorkshopWork.gunsmith => ItemId.pistol,
      };
      // Oficinas exigem insumo; sem insumo o dia rende metade.
      final amount = (1 + intelligence * 0.3).round().clamp(1, 99);
      produced[item] = (produced[item] ?? 0) + amount;
      character.inventory.add(item, amount);
      events.add('Oficina (${work.label}): +$amount ${ItemCatalog.of(item).name}.');
    }

    return produced;
  }

  /// Salário de Serviços Públicos, pago pelo governo local.
  void _payWages(
    Campaign campaign,
    DailyActivity activity,
    List<String> events,
  ) {
    if (activity.publicWork == null) return;
    final settlementId = campaign.currentSettlementId;
    if (settlementId == null) return;

    final government = campaign.governmentOf(settlementId);
    final paid = government.payWages(1);
    if (paid > 0) {
      campaign.character.credits += paid;
      events.add('Salário público: +$paid créditos.');
    } else {
      events.add('O governo não tinha caixa para pagar o salário.');
    }
  }

  void _expireMarketOrders(Campaign campaign) {
    for (final settlement in campaign.world.layout.settlements) {
      for (final market in campaign.marketsAt(settlement.id)) {
        market.expireOrders(campaign.day);
      }
    }
  }

  /// Marca e apura eleições. Cada capital elege a cada [Election.termLengthInDays].
  void _tickElections(
    Campaign campaign,
    DeterministicRandom rng,
    List<String> events,
  ) {
    if (campaign.day % Election.termLengthInDays != 0) return;

    for (final capital in campaign.world.layout.capitals) {
      final government = campaign.governmentOf(capital.id);
      // Sem disputa do jogador, um administrador local assume por inércia.
      if (!government.hasGovernor) {
        government.governorId = 'npc_${capital.id}';
        government.governorName = 'Administração Provisória';
        government.interim = true;
        events.add(
          '${capital.name}: sem candidatos, a Administração Provisória assumiu.',
        );
      } else if (government.interim) {
        government.interim = false;
        events.add('${capital.name}: mandato de ${government.governorName} confirmado.');
      }
      // Um pouco do tesouro vira orçamento de segurança a cada mandato.
      final allocation = (government.treasury * 0.10).round();
      government.treasury -= allocation;
      government.securityBudget += allocation;
    }
  }

  /// Encontro hostil na estrada. Estradas são zonas PvP — enquanto não há
  /// outros jogadores online, o oponente é um assaltante gerado.
  CombatReport? _rollRoadEncounter(
    Campaign campaign,
    DeterministicRandom rng,
    List<String> events,
  ) {
    final character = campaign.character;
    final destinationId = character.travellingTo;
    if (destinationId == null) return null;

    final roads = campaign.world.layout.roadsFrom(character.homeSettlementId);
    final road = roads.where((r) =>
        r.fromId == destinationId || r.toId == destinationId);
    final danger = road.isEmpty ? 0.25 : road.first.danger;

    // Percepção alta evita a emboscada antes dela acontecer.
    final evade = character.attributes[Attribute.perception] * 0.015;
    if (!rng.chance((danger - evade).clamp(0.02, 0.9))) return null;

    final raiderRng = rng.fork('raider_${campaign.day}');
    final raiderAttributes = AttributeSet.roll(raiderRng);
    final raider = Combatant(
      id: 'raider',
      name: 'Assaltante de Estrada',
      attributes: raiderAttributes,
      attackPower: raiderRng.range(4, 16),
      defensePower: raiderRng.range(0, 8),
      hp: Combatant.maxHpFor(raiderAttributes),
    );

    final player = Combatant.fromCharacter(
      id: character.id,
      name: character.name,
      attributes: character.attributes,
      inventory: character.inventory,
      hp: character.hp,
    );

    final report = CombatResolver.resolve(
      a: player,
      b: raider,
      seed: DeterministicRandom.mix(campaign.seed, campaign.day * 31),
    );

    // O combate mexeu no HP do combatente; devolve ao personagem.
    character.hp = player.hp.clamp(1, character.maxHp);

    if (report.winnerId == character.id) {
      final reward = raiderRng.range(60, 320);
      character.credits += reward;
      events.add(
        'Emboscada na estrada: você venceu em ${report.rounds} rodadas. +$reward créditos.',
      );
    } else {
      final loot = CombatResolver.rollLoot(
        loserInventory: character.inventory,
        seed: DeterministicRandom.mix(campaign.seed, campaign.day * 17),
      );
      for (final entry in loot.entries) {
        character.inventory.remove(entry.key, entry.value);
      }
      final creditsLost = (character.credits * 0.15).round();
      character.credits -= creditsLost;
      character.statusOffset -= report.statusLost;
      events.add(
        'Emboscada na estrada: você perdeu em ${report.rounds} rodadas. '
        '-$creditsLost créditos, -${report.statusLost} Status'
        '${loot.isEmpty ? '' : ', ${loot.length} tipo(s) de item saqueado(s)'}.',
      );
    }

    return report;
  }
}

/// O relatório que a UI mostra depois do reset.
class TickReport {
  const TickReport({
    required this.day,
    required this.events,
    required this.upkeep,
    required this.outcome,
    this.combat,
    this.produced = const {},
    this.completedQuests = const [],
  });

  /// O dia que acabou de ser fechado.
  final int day;

  final List<String> events;
  final UpkeepBreakdown upkeep;
  final DayEndOutcome? outcome;
  final CombatReport? combat;
  final Map<ItemId, int> produced;

  /// Quests que fecharam neste reset, com a recompensa já paga.
  final List<Quest> completedQuests;
}
