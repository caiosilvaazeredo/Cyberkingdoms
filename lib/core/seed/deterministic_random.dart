/// Gerador determinístico usado por toda a geração procedural.
///
/// ## Por que não `dart:math`
///
/// [Random] não garante a mesma sequência entre versões da linguagem nem entre
/// plataformas, e o mundo do CyberKingdoms precisa ser reproduzível: a mesma
/// seed tem que gerar exatamente o mesmo mundo no Android, no iOS, na web e no
/// worker que validar o tick diário quando o backend existir.
///
/// ## Por que 32 bits, e não 64
///
/// Na web o Dart compila `int` para `double` IEEE-754: inteiros acima de 2^53
/// perdem precisão e literais de 64 bits **nem compilam** no dart2js. Um
/// gerador baseado em SplitMix64 roda perfeitamente no Android e produz um
/// mundo diferente — ou nem compila — na web.
///
/// Por isso tudo aqui é aritmética de 32 bits, e toda multiplicação passa por
/// [_mul32], que decompõe os operandos em metades de 16 bits para que nenhum
/// produto intermediário ultrapasse 2^53. O resultado é bit-a-bit idêntico em
/// todas as plataformas.
///
/// O algoritmo é o Mulberry32: passa no TestU01 SmallCrush, tem período de
/// 2^32 e custa três multiplicações por número — mais que suficiente para
/// terreno, e barato o bastante para o caminho quente da geração de chunks.
class DeterministicRandom {
  DeterministicRandom(int seed) : _state = seed & _mask32;

  static const int _mask32 = 0xFFFFFFFF;

  int _state;

  /// Multiplicação de 32 bits exata em todas as plataformas.
  ///
  /// `a * b` com dois valores de 32 bits chega a 64 bits e estoura o mantissa
  /// de 53 bits do double na web. Quebrar `a` em metades de 16 bits mantém
  /// cada produto parcial abaixo de 2^48, que o double representa exatamente.
  /// É o mesmo truque do `Math.imul` do JavaScript.
  static int _mul32(int a, int b) {
    a &= _mask32;
    b &= _mask32;
    final aLow = a & 0xFFFF;
    final aHigh = a >>> 16;
    return ((((aHigh * b) & 0xFFFF) << 16) + aLow * b) & _mask32;
  }

  /// Deriva um gerador filho a partir de um rótulo, sem consumir a sequência
  /// deste gerador. Dá a cada subsistema (relevo, cidades, estradas, recursos)
  /// um fluxo independente e estável.
  DeterministicRandom fork(String label) =>
      DeterministicRandom(mix(_state, hashLabel(label)));

  /// Próximo inteiro de 32 bits sem sinal.
  int nextInt32() {
    _state = (_state + 0x6D2B79F5) & _mask32;
    var z = _state;
    z = _mul32(z ^ (z >>> 15), z | 1);
    z ^= (z + _mul32(z ^ (z >>> 7), z | 61)) & _mask32;
    return (z ^ (z >>> 14)) & _mask32;
  }

  /// Inteiro em `[0, max)`. [max] deve ser positivo.
  int nextIntBelow(int max) {
    assert(max > 0, 'max deve ser > 0');
    return nextInt32() % max;
  }

  /// Inteiro em `[min, max]`, inclusivo nas duas pontas.
  int range(int min, int max) {
    assert(max >= min, 'max deve ser >= min');
    return min + nextIntBelow(max - min + 1);
  }

  /// Double em `[0, 1)`.
  double nextDouble() => nextInt32() / 4294967296.0;

  /// Double em `[min, max)`.
  double rangeDouble(double min, double max) => min + nextDouble() * (max - min);

  bool chance(double probability) => nextDouble() < probability;

  T pick<T>(List<T> options) {
    assert(options.isNotEmpty, 'lista vazia');
    return options[nextIntBelow(options.length)];
  }

  /// Embaralha in-place (Fisher-Yates) de forma determinística.
  void shuffle<T>(List<T> items) {
    for (var i = items.length - 1; i > 0; i--) {
      final j = nextIntBelow(i + 1);
      final tmp = items[i];
      items[i] = items[j];
      items[j] = tmp;
    }
  }

  /// Hash estável de uma string (FNV-1a de 32 bits).
  ///
  /// Transforma seeds textuais ("neon-tokyo") em seeds numéricas sem depender
  /// de `String.hashCode`, que varia entre execuções e entre plataformas.
  static int hashLabel(String label) {
    var hash = 0x811C9DC5;
    for (final unit in label.codeUnits) {
      hash = (hash ^ unit) & _mask32;
      hash = _mul32(hash, 0x01000193);
    }
    return hash;
  }

  /// Combina duas seeds numa terceira, sem correlação aparente.
  /// Finalizador do MurmurHash3 de 32 bits.
  static int mix(int a, int b) {
    var z = (a ^ _mul32(b, 0x9E3779B1)) & _mask32;
    z ^= z >>> 16;
    z = _mul32(z, 0x85EBCA6B);
    z ^= z >>> 13;
    z = _mul32(z, 0xC2B2AE35);
    z ^= z >>> 16;
    return z & _mask32;
  }

  /// Ruído branco determinístico numa coordenada 2D. É o primitivo que o
  /// gerador usa para decidir "tem uma árvore aqui?" sem precisar de estado.
  static double whiteNoise2D(int seed, int x, int y) {
    final h = mix(seed, mix(_mul32(x, 0x1F123BB5), _mul32(y, 0x7C4A7C15)));
    return (h & _mask32) / 4294967296.0;
  }
}
