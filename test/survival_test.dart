import 'package:cyberkingdoms/domain/economy/item.dart';
import 'package:cyberkingdoms/domain/survival/daily_activity.dart';
import 'package:cyberkingdoms/domain/survival/survival_tables.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('SurvivalResolver — fórmula do GDD seção 13', () {
    test('exemplo textual do GDD fecha em -32 fome e -57 sede', () {
      // O GDD traz este caso resolvido: "jogador que trabalhou em Petróleo,
      // viajou, dormiu na estrada e tomou Red Rush".
      //
      //   Base              -8   -10
      //   Petróleo          -9   -12
      //   Viagem            -5   -8
      //   Dormir na estrada -10  -12
      //   Red Rush           0   -15
      //   TOTAL             -32  -57
      const activity = DailyActivity(
        publicWork: PublicWork.oil,
        roadsTravelled: 1,
        sleptOnRoad: true,
        consumed: [ItemId.redRush],
      );

      final breakdown = SurvivalResolver.resolve(activity);

      expect(breakdown.total.hunger, 32);
      expect(breakdown.total.thirst, 57);
    });

    test('só existir já cobra -8 fome e -10 sede', () {
      final breakdown = SurvivalResolver.resolve(const DailyActivity());
      expect(breakdown.total.hunger, 8);
      expect(breakdown.total.thirst, 10);
    });

    test('cada linha do consumo é discriminada para o jogador auditar', () {
      const activity = DailyActivity(
        publicWork: PublicWork.rareEarth,
        roadsTravelled: 2,
      );
      final breakdown = SurvivalResolver.resolve(activity);

      final labels = breakdown.lines.map((l) => l.label).toList();
      expect(labels, contains('Base (existir)'));
      expect(labels, contains('Trabalho: Terras Raras'));
      expect(labels, contains('Viagem (2x)'));
    });

    test('viagem múltipla multiplica o custo por estrada', () {
      final one = SurvivalResolver.resolve(
        const DailyActivity(roadsTravelled: 1),
      );
      final three = SurvivalResolver.resolve(
        const DailyActivity(roadsTravelled: 3),
      );

      expect(
        three.total.hunger - one.total.hunger,
        SurvivalTables.travelRoad.hunger * 2,
      );
      expect(
        three.total.thirst - one.total.thirst,
        SurvivalTables.travelRoad.thirst * 2,
      );
    });

    test('combate longo aplica o multiplicador adicional', () {
      final short = SurvivalResolver.resolve(
        const DailyActivity(combats: [CombatOutcome(won: true, rounds: 3)]),
      );
      final long = SurvivalResolver.resolve(
        const DailyActivity(combats: [CombatOutcome(won: true, rounds: 12)]),
      );

      expect(long.total.hunger, greaterThan(short.total.hunger));
      expect(
        long.total.hunger - SurvivalTables.idleBase.hunger,
        (SurvivalTables.combatVictory.hunger *
                SurvivalTables.longCombatMultiplier)
            .round(),
      );
    });

    test('derrota custa mais que vitória', () {
      final win = SurvivalResolver.resolve(
        const DailyActivity(combats: [CombatOutcome(won: true, rounds: 2)]),
      );
      final loss = SurvivalResolver.resolve(
        const DailyActivity(combats: [CombatOutcome(won: false, rounds: 2)]),
      );
      expect(loss.total.hunger, greaterThan(win.total.hunger));
      expect(loss.total.thirst, greaterThan(win.total.thirst));
    });

    test('clima deserto aumenta 50% do consumo de sede', () {
      final clear = SurvivalResolver.resolve(const DailyActivity());
      final desert = SurvivalResolver.resolve(
        const DailyActivity(weather: Weather.desert),
      );

      expect(desert.total.thirst, (clear.total.thirst * 1.5).round());
      // Deserto não mexe na fome.
      expect(desert.total.hunger, clear.total.hunger);
    });

    test('implante metabólico reduz 30% dos dois consumos', () {
      const activity = DailyActivity(publicWork: PublicWork.oil);
      final plain = SurvivalResolver.resolve(activity);
      final implanted = SurvivalResolver.resolve(
        activity,
        hungerModifier: -0.30,
        thirstModifier: -0.30,
      );

      expect(implanted.total.hunger, (plain.total.hunger * 0.7).round());
      expect(implanted.total.thirst, (plain.total.thirst * 0.7).round());
    });

    test('modificadores extremos nunca produzem consumo negativo', () {
      final breakdown = SurvivalResolver.resolve(
        const DailyActivity(),
        hungerModifier: -5,
        thirstModifier: -5,
      );
      expect(breakdown.total.hunger, greaterThanOrEqualTo(0));
      expect(breakdown.total.thirst, greaterThanOrEqualTo(0));
    });
  });
}
