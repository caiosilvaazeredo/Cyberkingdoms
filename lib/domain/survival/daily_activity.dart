import '../economy/item.dart';
import 'survival_tables.dart';

/// O que o jogador fez durante um dia. É o input do reset da meia-noite.
///
/// O GDD é explícito: a perda de Fome e Sede é baseada em **atividade**, não só
/// em tempo. Este objeto acumula tudo que aconteceu no dia e o
/// [SurvivalResolver] transforma numa única conta.
class DailyActivity {
  const DailyActivity({
    this.publicWork,
    this.farmWork,
    this.workshopWork,
    this.roadsTravelled = 0,
    this.sleptOnRoad = false,
    this.combats = const [],
    this.consumed = const [],
    this.weather = Weather.clear,
  });

  final PublicWork? publicWork;
  final PlayerFarmWork? farmWork;
  final WorkshopWork? workshopWork;

  /// Quantas estradas foram atravessadas no dia.
  final int roadsTravelled;

  final bool sleptOnRoad;

  final List<CombatOutcome> combats;

  /// Estimulantes e bebidas consumidos — cobram Fome/Sede na hora.
  final List<ItemId> consumed;

  final Weather weather;

  DailyActivity copyWith({
    PublicWork? publicWork,
    PlayerFarmWork? farmWork,
    WorkshopWork? workshopWork,
    int? roadsTravelled,
    bool? sleptOnRoad,
    List<CombatOutcome>? combats,
    List<ItemId>? consumed,
    Weather? weather,
    bool clearWork = false,
  }) =>
      DailyActivity(
        publicWork: clearWork ? null : (publicWork ?? this.publicWork),
        farmWork: clearWork ? null : (farmWork ?? this.farmWork),
        workshopWork: clearWork ? null : (workshopWork ?? this.workshopWork),
        roadsTravelled: roadsTravelled ?? this.roadsTravelled,
        sleptOnRoad: sleptOnRoad ?? this.sleptOnRoad,
        combats: combats ?? this.combats,
        consumed: consumed ?? this.consumed,
        weather: weather ?? this.weather,
      );

  bool get worked =>
      publicWork != null || farmWork != null || workshopWork != null;

  String get workLabel =>
      publicWork?.label ?? farmWork?.label ?? workshopWork?.label ?? 'Ocioso';
}

/// Resultado de um combate para efeito de consumo.
class CombatOutcome {
  const CombatOutcome({required this.won, required this.rounds});

  final bool won;
  final int rounds;

  bool get wasLong => rounds > SurvivalTables.longCombatRounds;
}

/// Uma linha da conta do dia. Existe para que o jogador veja *por que* perdeu
/// 57 de sede, em vez de só ver a barra cair — o GDD trata a alimentação como
/// decisão econômica, e decisão exige informação.
class UpkeepLine {
  const UpkeepLine(this.label, this.upkeep);

  final String label;
  final Upkeep upkeep;
}

/// A conta fechada do dia.
class UpkeepBreakdown {
  const UpkeepBreakdown({required this.lines, required this.total});

  final List<UpkeepLine> lines;
  final Upkeep total;
}

abstract final class SurvivalResolver {
  /// Fórmula final do GDD:
  /// `Consumo Final = Base + Trabalho + Viagem + Combate + Clima + Modificadores`
  ///
  /// [upkeepModifiers] é a soma dos modificadores de equipamento (ex.: -0.30 do
  /// Implante Metabólico). É aplicada ao subtotal, depois do clima.
  static UpkeepBreakdown resolve(
    DailyActivity activity, {
    double hungerModifier = 0,
    double thirstModifier = 0,
  }) {
    final lines = <UpkeepLine>[];

    lines.add(const UpkeepLine('Base (existir)', SurvivalTables.idleBase));
    var subtotal = SurvivalTables.idleBase;

    if (activity.publicWork != null) {
      final w = activity.publicWork!;
      lines.add(UpkeepLine('Trabalho: ${w.label}', w.upkeep));
      subtotal += w.upkeep;
    }
    if (activity.farmWork != null) {
      final w = activity.farmWork!;
      lines.add(UpkeepLine('Fazenda: ${w.label}', w.upkeep));
      subtotal += w.upkeep;
    }
    if (activity.workshopWork != null) {
      final w = activity.workshopWork!;
      lines.add(UpkeepLine('Oficina: ${w.label}', w.upkeep));
      subtotal += w.upkeep;
    }

    if (activity.roadsTravelled > 0) {
      final travel = Upkeep(
        SurvivalTables.travelRoad.hunger * activity.roadsTravelled,
        SurvivalTables.travelRoad.thirst * activity.roadsTravelled,
      );
      lines.add(UpkeepLine('Viagem (${activity.roadsTravelled}x)', travel));
      subtotal += travel;
    }

    if (activity.sleptOnRoad) {
      lines.add(const UpkeepLine('Dormir na estrada', SurvivalTables.sleepOnRoad));
      subtotal += SurvivalTables.sleepOnRoad;
    }

    for (final combat in activity.combats) {
      var cost = combat.won
          ? SurvivalTables.combatVictory
          : SurvivalTables.combatDefeat;
      if (combat.wasLong) {
        cost = cost.scaled(SurvivalTables.longCombatMultiplier);
      }
      lines.add(UpkeepLine(
        'Combate: ${combat.won ? 'vitória' : 'derrota'}'
        '${combat.wasLong ? ' (longo)' : ''}',
        cost,
      ));
      subtotal += cost;
    }

    for (final itemId in activity.consumed) {
      final def = ItemCatalog.of(itemId);
      if (def.hungerCost == 0 && def.thirstCost == 0) continue;
      final cost = Upkeep(def.hungerCost, def.thirstCost);
      lines.add(UpkeepLine(def.name, cost));
      subtotal += cost;
    }

    // Clima multiplica o subtotal acumulado até aqui.
    final weather = activity.weather;
    if (weather != Weather.clear) {
      final withWeather = Upkeep(
        (subtotal.hunger * weather.hungerMultiplier).round(),
        (subtotal.thirst * weather.thirstMultiplier).round(),
      );
      final delta = Upkeep(
        withWeather.hunger - subtotal.hunger,
        withWeather.thirst - subtotal.thirst,
      );
      if (delta.hunger != 0 || delta.thirst != 0) {
        lines.add(UpkeepLine('Clima: ${weather.label}', delta));
      }
      subtotal = withWeather;
    }

    // Equipamentos reduzem por último, sobre o total já formado.
    if (hungerModifier != 0 || thirstModifier != 0) {
      final reduced = Upkeep(
        (subtotal.hunger * (1 + hungerModifier)).round(),
        (subtotal.thirst * (1 + thirstModifier)).round(),
      );
      final delta = Upkeep(
        reduced.hunger - subtotal.hunger,
        reduced.thirst - subtotal.thirst,
      );
      if (delta.hunger != 0 || delta.thirst != 0) {
        lines.add(UpkeepLine('Equipamentos', delta));
      }
      subtotal = reduced;
    }

    // Consumo nunca é negativo, mesmo com modificadores extremos.
    final total = Upkeep(
      subtotal.hunger < 0 ? 0 : subtotal.hunger,
      subtotal.thirst < 0 ? 0 : subtotal.thirst,
    );

    return UpkeepBreakdown(lines: lines, total: total);
  }
}
