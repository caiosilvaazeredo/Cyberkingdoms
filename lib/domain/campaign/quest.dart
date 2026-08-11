import '../building/building_type.dart';
import '../character/attributes.dart';
import '../economy/item.dart';
import 'campaign.dart';

/// Uma condição verificável do estado da campanha.
///
/// Objetivos são **funções puras do estado**, não flags que alguém precisa
/// lembrar de marcar. Isso significa que uma quest fica completa no instante em
/// que a condição passa a valer — inclusive se o jogador cumpriu por acidente,
/// antes de a quest ser oferecida — e que carregar um save antigo recalcula
/// tudo corretamente sem migração.
sealed class QuestObjective {
  const QuestObjective();

  /// Texto mostrado ao jogador.
  String get label;

  /// Progresso atual e alvo, para a barra.
  (int current, int target) progress(Campaign campaign);

  bool isMet(Campaign campaign) {
    final (current, target) = progress(campaign);
    return current >= target;
  }
}

/// Ter uma quantidade de coroas.
class HaveCredits extends QuestObjective {
  const HaveCredits(this.amount);
  final int amount;

  @override
  String get label => 'Acumular $amount coroas';

  @override
  (int, int) progress(Campaign campaign) =>
      (campaign.character.credits.clamp(0, amount), amount);
}

/// Ter itens no inventário.
class HaveItem extends QuestObjective {
  const HaveItem(this.item, this.quantity);
  final ItemId item;
  final int quantity;

  @override
  String get label =>
      'Ter $quantity ${ItemCatalog.of(item).name}';

  @override
  (int, int) progress(Campaign campaign) => (
        campaign.character.inventory.quantityOf(item).clamp(0, quantity),
        quantity,
      );
}

/// Ter construções de um tipo prontas no terreno.
class HaveBuilding extends QuestObjective {
  const HaveBuilding(this.type, {this.count = 1});
  final BuildingId type;
  final int count;

  @override
  String get label => count == 1
      ? 'Construir: ${BuildingCatalog.of(type).name}'
      : 'Construir $count x ${BuildingCatalog.of(type).name}';

  @override
  (int, int) progress(Campaign campaign) {
    final built = campaign.plot.operational
        .where((b) => b.type == type)
        .length;
    return (built.clamp(0, count), count);
  }
}

/// Ter construções prontas de uma categoria inteira.
class HaveBuildingCategory extends QuestObjective {
  const HaveBuildingCategory(this.category, this.count);
  final BuildingCategory category;
  final int count;

  @override
  String get label =>
      'Ter $count construção(ões) de ${category.label} no terreno';

  @override
  (int, int) progress(Campaign campaign) {
    final built = campaign.plot.operational
        .where((b) => b.def.category == category)
        .length;
    return (built.clamp(0, count), count);
  }
}

/// Empregar trabalhadores no terreno.
class EmployWorkers extends QuestObjective {
  const EmployWorkers(this.count);
  final int count;

  @override
  String get label => 'Empregar $count trabalhador(es) no terreno';

  @override
  (int, int) progress(Campaign campaign) =>
      (campaign.plot.employedWorkers.clamp(0, count), count);
}

/// Sobreviver até um certo dia.
class SurviveUntilDay extends QuestObjective {
  const SurviveUntilDay(this.day);
  final int day;

  @override
  String get label => 'Sobreviver até o dia $day';

  @override
  (int, int) progress(Campaign campaign) =>
      (campaign.day.clamp(0, day), day);
}

/// Visitar cidades diferentes — força o jogador a usar as estradas.
class VisitSettlements extends QuestObjective {
  const VisitSettlements(this.count);
  final int count;

  @override
  String get label => 'Visitar $count cidades diferentes';

  @override
  (int, int) progress(Campaign campaign) =>
      (campaign.visitedSettlements.length.clamp(0, count), count);
}

/// Alcançar um nível de cidadania.
class ReachLevel extends QuestObjective {
  const ReachLevel(this.level);
  final CitizenLevel level;

  @override
  String get label => 'Chegar a ${level.label}';

  @override
  (int, int) progress(Campaign campaign) =>
      (campaign.character.level.rank.clamp(0, level.rank), level.rank);
}

/// Alcançar um valor de Status.
class ReachStatus extends QuestObjective {
  const ReachStatus(this.value);
  final int value;

  @override
  String get label => 'Chegar a Status $value';

  @override
  (int, int) progress(Campaign campaign) =>
      (campaign.character.effectiveStatus.clamp(0, value), value);
}

/// Assumir o governo de uma cidade.
class BecomeGovernor extends QuestObjective {
  const BecomeGovernor();

  @override
  String get label => 'Assumir o governo de uma cidade';

  @override
  (int, int) progress(Campaign campaign) {
    final governs = campaign.governments.values
        .any((g) => g.governorId == campaign.character.id);
    return (governs ? 1 : 0, 1);
  }
}

/// Defesa mínima no terreno.
class ReachPlotDefense extends QuestObjective {
  const ReachPlotDefense(this.value);
  final int value;

  @override
  String get label => 'Levar a defesa do terreno a $value';

  @override
  (int, int) progress(Campaign campaign) =>
      (campaign.plot.defense.clamp(0, value), value);
}

/// Recompensa de uma quest.
class QuestReward {
  const QuestReward({
    this.credits = 0,
    this.items = const {},
    this.statusBonus = 0,
  });

  final int credits;
  final Map<ItemId, int> items;
  final int statusBonus;

  bool get isEmpty => credits == 0 && items.isEmpty && statusBonus == 0;

  String get summary {
    final parts = <String>[
      if (credits > 0) '$credits¢',
      for (final entry in items.entries)
        '${entry.value}x ${ItemCatalog.of(entry.key).name}',
      if (statusBonus > 0) '+$statusBonus Status',
    ];
    return parts.isEmpty ? '—' : parts.join(' · ');
  }
}

/// Uma quest da campanha principal.
class Quest {
  const Quest({
    required this.id,
    required this.stage,
    required this.title,
    required this.briefing,
    required this.objectives,
    this.reward = const QuestReward(),
    this.requires = const [],
  });

  final String id;

  /// Estágio do GDD ao qual a quest pertence.
  final CitizenLevel stage;

  final String title;

  /// Texto narrativo. É onde o lore entra sem virar parede de texto.
  final String briefing;

  final List<QuestObjective> objectives;
  final QuestReward reward;

  /// Ids de quests que precisam estar completas antes desta aparecer.
  final List<String> requires;

  bool isComplete(Campaign campaign) =>
      objectives.every((o) => o.isMet(campaign));

  /// Progresso agregado em `[0, 1]`, para a barra da lista.
  double completion(Campaign campaign) {
    if (objectives.isEmpty) return 1;
    var sum = 0.0;
    for (final objective in objectives) {
      final (current, target) = objective.progress(campaign);
      sum += target == 0 ? 1 : (current / target).clamp(0.0, 1.0);
    }
    return sum / objectives.length;
  }
}

/// A campanha principal: quatro atos, seguindo os estágios do GDD.
///
/// A progressão do GDD é econômica, não narrativa — "comprar a primeira
/// fazenda", "abrir indústria", "entrar na política". As quests aqui apenas dão
/// nome e ordem a isso, servindo de tutorial no começo e de lista de metas
/// depois. Nenhuma delas bloqueia o jogador: quem quiser ignorar tudo e virar
/// comerciante pode.
abstract final class QuestBook {
  static const List<Quest> all = [
    // ================= NÍVEL 0 — Sobreviver =================
    Quest(
      id: 'q0_agua',
      stage: CitizenLevel.survivor,
      title: 'Primeiro Gole',
      briefing:
          'Você acordou num cortiço sem nome e sem contrato. A CLT faliu há '
          'décadas; ninguém vem te salvar. A conta que mata mais rápido é a '
          'sede — resolva ela antes de qualquer outra coisa.',
      objectives: [HaveItem(ItemId.water, 5)],
      reward: QuestReward(credits: 150),
    ),
    Quest(
      id: 'q0_comida',
      stage: CitizenLevel.survivor,
      title: 'Barriga Cheia',
      briefing:
          'Comida de rua é barata e não dá bônus nenhum — mas mantém você de pé '
          'até conseguir algo melhor. Estoque o suficiente para não depender do '
          'dia seguinte.',
      objectives: [HaveItem(ItemId.streetFood, 5)],
      reward: QuestReward(credits: 150),
      requires: ['q0_agua'],
    ),
    Quest(
      id: 'q0_trabalho',
      stage: CitizenLevel.survivor,
      title: 'Mão de Obra',
      briefing:
          'O lixão da capital sempre precisa de gente. É o trabalho mais pesado '
          'que existe e paga o mínimo, mas é assim que todo mundo começa: '
          'juntando sucata do que a cidade jogou fora.',
      objectives: [HaveItem(ItemId.scrap, 20)],
      reward: QuestReward(credits: 300),
      requires: ['q0_agua'],
    ),
    Quest(
      id: 'q0_abrigo',
      stage: CitizenLevel.survivor,
      title: 'Um Teto',
      briefing:
          'Você conseguiu um lote dentro da metrópole. Não é muito — mas é seu, '
          'e é o único lugar do mundo onde você pode construir. Levante um '
          'barraco e pare de dormir na rua.',
      objectives: [HaveBuilding(BuildingId.shack)],
      reward: QuestReward(credits: 400, items: {ItemId.water: 5}),
      requires: ['q0_trabalho'],
    ),
    Quest(
      id: 'q0_sobreviver',
      stage: CitizenLevel.survivor,
      title: 'Uma Semana Inteira',
      briefing:
          'Sete resets sem morrer de fome ou de sede. Parece pouco. Metade dos '
          'que chegam nesta cidade não consegue.',
      objectives: [SurviveUntilDay(8)],
      reward: QuestReward(credits: 500, statusBonus: 1),
      requires: ['q0_abrigo'],
    ),

    // ================= NÍVEL 1 — Entrar na economia =================
    Quest(
      id: 'q1_capital',
      stage: CitizenLevel.farmer,
      title: 'Capital Inicial',
      briefing:
          'Trabalhar para os outros nunca vai te tirar do cortiço. Junte o '
          'suficiente para comprar a sua primeira estrutura produtiva.',
      objectives: [HaveCredits(1500), ReachLevel(CitizenLevel.farmer)],
      reward: QuestReward(credits: 600),
      requires: ['q0_sobreviver'],
    ),
    Quest(
      id: 'q1_fazenda',
      stage: CitizenLevel.farmer,
      title: 'A Primeira Fazenda',
      briefing:
          'Ninguém abastece o mercado além dos próprios jogadores. Toda comida '
          'que existe no servidor saiu de uma estufa como a que você vai '
          'levantar agora.',
      objectives: [
        HaveBuildingCategory(BuildingCategory.extraction, 1),
        HaveItem(ItemId.biomass, 20),
      ],
      reward: QuestReward(credits: 800, items: {ItemId.polymer: 6}),
      requires: ['q1_capital'],
    ),
    Quest(
      id: 'q1_estrada',
      stage: CitizenLevel.farmer,
      title: 'Fora dos Muros',
      briefing:
          'Cada capital produz o que a outra não tem. A diferença de preço entre '
          'elas é o lucro — e a estrada entre elas é onde os assaltantes '
          'esperam. Não existe teletransporte: quem quer comprar barato viaja.',
      objectives: [VisitSettlements(3)],
      reward: QuestReward(credits: 900, statusBonus: 1),
      requires: ['q1_capital'],
    ),
    Quest(
      id: 'q1_refino',
      stage: CitizenLevel.farmer,
      title: 'Camada Dois',
      briefing:
          'Matéria-prima bruta vale pouco. O dinheiro está em transformar: '
          'petróleo vira polímero, biomassa vira tecido, sucata vira placa. '
          'Monte a sua primeira oficina.',
      objectives: [
        HaveBuildingCategory(BuildingCategory.refining, 1),
        HaveItem(ItemId.polymer, 10),
      ],
      reward: QuestReward(credits: 1200),
      requires: ['q1_fazenda'],
    ),

    // ================= NÍVEL 2 — Indústria =================
    Quest(
      id: 'q2_industria',
      stage: CitizenLevel.industrialist,
      title: 'Dono do Negócio',
      briefing:
          'Deixar de trabalhar e passar a empregar. É a virada que separa o '
          'operário do industrial nesta cidade.',
      objectives: [
        ReachLevel(CitizenLevel.industrialist),
        EmployWorkers(6),
      ],
      reward: QuestReward(credits: 2500, statusBonus: 2),
      requires: ['q1_refino'],
    ),
    Quest(
      id: 'q2_chip',
      stage: CitizenLevel.industrialist,
      title: 'O Gargalo',
      briefing:
          'Terras raras são o único recurso que ninguém consegue substituir. '
          'Sem elas não há chip; sem chip não há drone, implante nem nada que '
          'valha a pena. Quem controla a mina, controla o servidor.',
      objectives: [HaveItem(ItemId.chip, 5)],
      reward: QuestReward(credits: 3000, items: {ItemId.rareEarth: 10}),
      requires: ['q2_industria'],
    ),
    Quest(
      id: 'q2_expansao',
      stage: CitizenLevel.industrialist,
      title: 'Escala',
      briefing:
          'Uma oficina não é uma indústria. Evolua o que você já tem — nível II '
          'produz 60% mais, e abre espaço para um segundo módulo.',
      objectives: [
        HaveBuildingCategory(BuildingCategory.manufacturing, 1),
        HaveCredits(20000),
      ],
      reward: QuestReward(credits: 4000),
      requires: ['q2_industria'],
    ),
    Quest(
      id: 'q2_defesa',
      stage: CitizenLevel.industrialist,
      title: 'Cerca Alta',
      briefing:
          'Terreno rico e indefeso é convite. Muro, torre e portão custam menos '
          'que perder um armazém cheio.',
      objectives: [ReachPlotDefense(60)],
      reward: QuestReward(credits: 2000, items: {ItemId.pistol: 1}),
      requires: ['q2_industria'],
    ),

    // ================= NÍVEL 3 — Elite =================
    Quest(
      id: 'q3_elite',
      stage: CitizenLevel.elite,
      title: 'Nome na Cidade',
      briefing:
          'Dinheiro sozinho não elege ninguém. Status é reputação — vem do que '
          'você construiu, de como o seu vilarejo aparenta, e de quem depende '
          'de você para comer.',
      objectives: [
        ReachLevel(CitizenLevel.elite),
        ReachStatus(12),
      ],
      reward: QuestReward(credits: 8000, statusBonus: 3),
      requires: ['q2_expansao'],
    ),
    Quest(
      id: 'q3_governo',
      stage: CitizenLevel.elite,
      title: 'O Palácio',
      briefing:
          'Qualquer cidadão pode se candidatar, independente do nível. Mas '
          'ganhar exige plataforma: imposto baixo agrada o comércio, salário '
          'alto agrada o operário, e os dois juntos quebram o tesouro.',
      objectives: [BecomeGovernor()],
      reward: QuestReward(credits: 15000, statusBonus: 5),
      requires: ['q3_elite'],
    ),
    Quest(
      id: 'q3_implante',
      stage: CitizenLevel.elite,
      title: 'Carne Obsoleta',
      briefing:
          'Não existe treinamento de atributos neste mundo. A única evolução '
          'real do corpo vem da clínica: um implante metabólico corta 30% de '
          'tudo que você consome, para sempre.',
      objectives: [HaveItem(ItemId.metabolicImplant, 1)],
      reward: QuestReward(credits: 10000, statusBonus: 3),
      requires: ['q3_elite'],
    ),
    Quest(
      id: 'q3_imperio',
      stage: CitizenLevel.elite,
      title: 'Império',
      briefing:
          'O endgame do CyberKingdoms não é um chefe final. É um monopólio: '
          'produção própria, milícia própria, e caixa suficiente para sustentar '
          'os dois enquanto os outros dependem de você.',
      objectives: [
        HaveCredits(150000),
        HaveBuilding(BuildingId.militiaHall),
        EmployWorkers(30),
      ],
      reward: QuestReward(credits: 50000, statusBonus: 10),
      requires: ['q3_governo'],
    ),
  ];

  static Quest? byId(String id) {
    for (final quest in all) {
      if (quest.id == id) return quest;
    }
    return null;
  }

  static List<Quest> byStage(CitizenLevel stage) =>
      all.where((q) => q.stage == stage).toList(growable: false);
}

/// Avalia o estado das quests contra a campanha.
class QuestLog {
  const QuestLog(this.campaign);

  final Campaign campaign;

  /// Uma quest é considerada concluída se está no registro **ou** se as
  /// condições já valem. A segunda parte importa: sem ela, um jogador que
  /// cumpriu a condição antes de a quest destravar ficaria travado para sempre.
  bool isComplete(Quest quest) =>
      campaign.completedQuests.contains(quest.id) || quest.isComplete(campaign);

  /// Uma quest está disponível quando todos os pré-requisitos caíram.
  bool isUnlocked(Quest quest) {
    for (final requirement in quest.requires) {
      final required = QuestBook.byId(requirement);
      if (required == null) continue;
      if (!isComplete(required)) return false;
    }
    return true;
  }

  List<Quest> get active => QuestBook.all
      .where((q) => isUnlocked(q) && !isComplete(q))
      .toList(growable: false);

  List<Quest> get completed =>
      QuestBook.all.where(isComplete).toList(growable: false);

  List<Quest> get locked => QuestBook.all
      .where((q) => !isUnlocked(q) && !isComplete(q))
      .toList(growable: false);

  /// A próxima quest a perseguir — a mais avançada disponível.
  Quest? get current {
    final list = active;
    return list.isEmpty ? null : list.first;
  }

  double get overallProgress =>
      QuestBook.all.isEmpty ? 0 : completed.length / QuestBook.all.length;

  /// Entrega as recompensas das quests recém-concluídas e devolve quais foram.
  ///
  /// Roda no reset diário. Idempotente: uma quest só paga uma vez, porque o id
  /// vai para [Campaign.completedQuests] antes de a recompensa ser aplicada.
  List<Quest> claimNewlyCompleted() {
    final claimed = <Quest>[];

    for (final quest in QuestBook.all) {
      if (campaign.completedQuests.contains(quest.id)) continue;
      if (!isUnlocked(quest)) continue;
      if (!quest.isComplete(campaign)) continue;

      campaign.completedQuests.add(quest.id);

      final reward = quest.reward;
      campaign.character.credits += reward.credits;
      campaign.character.statusOffset += reward.statusBonus;
      for (final entry in reward.items.entries) {
        campaign.character.inventory.add(entry.key, entry.value);
      }
      claimed.add(quest);
    }

    return claimed;
  }
}
