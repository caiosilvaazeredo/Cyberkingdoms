import '../../core/seed/deterministic_random.dart';

/// Os 6 atributos do GDD, sorteados na criação do personagem.
///
/// Não existe treinamento: a evolução vem de equipamentos e implantes. Por isso
/// o sorteio importa e por isso o jogador tem exatamente 3 rerrolagens.
enum Attribute {
  strength('Força', 'Dano em combate e capacidade de carga.'),
  perception('Percepção', 'Detecta emboscadas e avalia preços.'),
  luck('Sorte', 'Loot raro, críticos e resultados de eleição apertada.'),
  intelligence('Inteligência', 'Rendimento em refino e manufatura.'),
  endurance('Resistência', 'HP, e quanto tempo aguenta fome e sede.'),
  status('Status', 'Reputação: peso político e acesso a contratos.');

  const Attribute(this.label, this.description);
  final String label;
  final String description;
}

/// Conjunto de atributos rolados.
class AttributeSet {
  const AttributeSet(this._values);

  final Map<Attribute, int> _values;

  static const int minRoll = 3;
  static const int maxRoll = 12;

  /// O GDD permite rerrolar até 3 vezes; depois o valor é permanente.
  static const int maxRerolls = 3;

  int operator [](Attribute attribute) => _values[attribute] ?? minRoll;

  int get total => _values.values.fold(0, (sum, v) => sum + v);

  /// Sorteia um conjunto novo. Usa 2d5+1 em vez de uniforme para que valores
  /// médios sejam comuns e extremos sejam memoráveis.
  factory AttributeSet.roll(DeterministicRandom rng) {
    final values = <Attribute, int>{};
    for (final attribute in Attribute.values) {
      values[attribute] = rng.range(1, 5) + rng.range(1, 5) + 1;
    }
    return AttributeSet(values);
  }

  AttributeSet withBonus(Map<Attribute, int> bonuses) {
    final merged = Map<Attribute, int>.from(_values);
    bonuses.forEach((attribute, bonus) {
      merged[attribute] = (merged[attribute] ?? minRoll) + bonus;
    });
    return AttributeSet(merged);
  }

  Map<String, dynamic> toJson() =>
      {for (final e in _values.entries) e.key.name: e.value};

  factory AttributeSet.fromJson(Map<String, dynamic> json) => AttributeSet({
        for (final attribute in Attribute.values)
          attribute: (json[attribute.name] as num?)?.toInt() ?? minRoll,
      });

  @override
  String toString() => _values.entries
      .map((e) => '${e.key.label} ${e.value}')
      .join(', ');
}

/// Os 4 estágios de progressão do GDD (seção 5).
enum CitizenLevel {
  survivor(0, 'Nível 0', 'Sobreviver e aprender a trabalhar.'),
  farmer(1, 'Nível 1', 'Comprar a primeira fazenda e entrar na economia.'),
  industrialist(2, 'Nível 2', 'Abrir indústria e contratar funcionários.'),
  elite(3, 'Nível 3', 'Política, monopólios, milícias e implantes.');

  const CitizenLevel(this.rank, this.label, this.goal);
  final int rank;
  final String label;
  final String goal;

  CitizenLevel? get next {
    final index = CitizenLevel.values.indexOf(this) + 1;
    return index < CitizenLevel.values.length
        ? CitizenLevel.values[index]
        : null;
  }
}
