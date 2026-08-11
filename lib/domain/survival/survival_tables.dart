// Tabelas de consumo de Fome e Sede — transcrição literal da seção 13 do GDD
// (Rev. 3.0). Qualquer rebalanceamento acontece *aqui* e em nenhum outro lugar,
// para que o Balance Manual (Vol. IV) tenha uma fonte única.

/// Par (fome, sede). Valores positivos representam consumo.
class Upkeep {
  const Upkeep(this.hunger, this.thirst);

  final int hunger;
  final int thirst;

  static const zero = Upkeep(0, 0);

  Upkeep operator +(Upkeep other) =>
      Upkeep(hunger + other.hunger, thirst + other.thirst);

  Upkeep scaled(double factor) =>
      Upkeep((hunger * factor).round(), (thirst * factor).round());

  @override
  String toString() => '(-$hunger fome, -$thirst sede)';
}

/// Trabalhos em Serviços Públicos. Vagas limitadas, controlados pelo governo.
enum PublicWork {
  publicFarming('Lavoura Comunal', Upkeep(4, 5)),
  dump('Pedreira', Upkeep(8, 10)),
  oil('Poço de Breu', Upkeep(9, 12)),
  rareEarth('Veio de Prata', Upkeep(10, 12));

  const PublicWork(this.label, this.upkeep);
  final String label;
  final Upkeep upkeep;
}

/// Fazendas de jogador. Sem limite de vagas, produção privada.
enum PlayerFarmWork {
  hydroponics('Hortas', Upkeep(5, 6)),
  biomass('Cevada', Upkeep(6, 8)),
  bioreactors('Currais', Upkeep(7, 8));

  const PlayerFarmWork(this.label, this.upkeep);
  final String label;
  final Upkeep upkeep;
}

/// Oficinas — a Camada 2/3 da cadeia produtiva.
enum WorkshopWork {
  textiles('Tecidos', Upkeep(4, 4)),
  hardware('Ferragem', Upkeep(5, 5)),
  laboratory('Botica', Upkeep(6, 6)),
  gunsmith('Armeiro', Upkeep(7, 7));

  const WorkshopWork(this.label, this.upkeep);
  final String label;
  final Upkeep upkeep;
}

/// Clima. Marcado no GDD como expansão futura, já modelado porque o motor de
/// tick precisa de um lugar para plugá-lo.
enum Weather {
  clear('Limpo', 1.0, 1.0),
  desert('Deserto', 1.0, 1.5),
  snow('Neve', 1.3, 1.0),
  rain('Chuva', 1.1, 1.1);

  const Weather(this.label, this.hungerMultiplier, this.thirstMultiplier);
  final String label;
  final double hungerMultiplier;
  final double thirstMultiplier;
}

abstract final class SurvivalTables {
  /// "Apenas existir (sem fazer nada)": -8 fome, -10 sede.
  ///
  /// É o mecanismo central contra jogadores inativos — impede que alguém fique
  /// semanas offline sem consequência.
  static const Upkeep idleBase = Upkeep(8, 10);

  /// Viagens.
  static const Upkeep travelRoad = Upkeep(5, 8);
  static const Upkeep sleepOnRoad = Upkeep(10, 12);

  /// Combate.
  static const Upkeep combatVictory = Upkeep(4, 6);
  static const Upkeep combatDefeat = Upkeep(8, 10);

  /// Combates muito longos aplicam multiplicador adicional (GDD, seção 13).
  static const double longCombatMultiplier = 1.5;

  /// Acima de quantas rodadas um combate conta como "muito longo".
  static const int longCombatRounds = 6;

  /// Limites das barras.
  static const int maxVital = 100;
  static const int minVital = 0;

  /// Abaixo deste valor o personagem começa a perder HP no reset.
  static const int starvationThreshold = 0;

  /// Quantos HP são perdidos por reset com Fome ou Sede zeradas.
  static const int starvationDamage = 25;

  /// Quantos resets consecutivos com Fome **e** Sede em zero causam morte
  /// permanente. O GDD reserva a morte permanente ao abandono.
  static const int consecutiveDaysToDeath = 4;
}
