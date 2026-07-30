import 'dart:math' as math;

import 'deterministic_random.dart';

/// Ruído de gradiente 2D (estilo simplex) com tabela de permutação derivada da
/// seed da campanha.
///
/// É o que dá ao mundo a continuidade orgânica do Minecraft: valores próximos
/// no espaço produzem alturas próximas, mas sem repetição perceptível.
class GradientNoise {
  GradientNoise(int seed) : _perm = _buildPermutation(seed);

  final List<int> _perm;

  static const int _tableSize = 256;
  static const int _tableMask = 255;

  /// 8 direções unitárias. Gradientes discretos são suficientes para terreno e
  /// evitam `sin`/`cos` no caminho quente.
  static const List<double> _gradX = [1, -1, 1, -1, 1, -1, 0, 0];
  static const List<double> _gradY = [1, 1, -1, -1, 0, 0, 1, -1];

  static List<int> _buildPermutation(int seed) {
    final rng = DeterministicRandom(seed);
    final base = List<int>.generate(_tableSize, (i) => i);
    rng.shuffle(base);
    // Duplicado para evitar `% 256` dentro do laço de amostragem.
    return List<int>.unmodifiable([...base, ...base]);
  }

  static double _fade(double t) => t * t * t * (t * (t * 6 - 15) + 10);

  int _gradIndex(int x, int y) => _perm[(_perm[x & _tableMask] + y) & _tableMask] & 7;

  double _dotGrad(int gx, int gy, double dx, double dy) {
    final g = _gradIndex(gx, gy);
    return _gradX[g] * dx + _gradY[g] * dy;
  }

  /// Amostra em `[-1, 1]`.
  double sample(double x, double y) {
    final x0 = x.floor();
    final y0 = y.floor();
    final dx = x - x0;
    final dy = y - y0;

    final u = _fade(dx);
    final v = _fade(dy);

    final n00 = _dotGrad(x0, y0, dx, dy);
    final n10 = _dotGrad(x0 + 1, y0, dx - 1, dy);
    final n01 = _dotGrad(x0, y0 + 1, dx, dy - 1);
    final n11 = _dotGrad(x0 + 1, y0 + 1, dx - 1, dy - 1);

    final nx0 = n00 + u * (n10 - n00);
    final nx1 = n01 + u * (n11 - n01);
    return nx0 + v * (nx1 - nx0);
  }

  /// Amostra normalizada em `[0, 1]`.
  double sampleUnit(double x, double y) => (sample(x, y) + 1) * 0.5;

  /// Soma de oitavas (fractal Brownian motion). Mais oitavas = mais detalhe
  /// fino; [persistence] controla quanto cada oitava contribui.
  double fbm(
    double x,
    double y, {
    int octaves = 4,
    double frequency = 1,
    double persistence = 0.5,
    double lacunarity = 2,
  }) {
    var amplitude = 1.0;
    var total = 0.0;
    var normalization = 0.0;
    var freq = frequency;

    for (var i = 0; i < octaves; i++) {
      total += sample(x * freq, y * freq) * amplitude;
      normalization += amplitude;
      amplitude *= persistence;
      freq *= lacunarity;
    }
    return normalization == 0 ? 0 : total / normalization;
  }

  double fbmUnit(
    double x,
    double y, {
    int octaves = 4,
    double frequency = 1,
    double persistence = 0.5,
    double lacunarity = 2,
  }) =>
      (fbm(
                x,
                y,
                octaves: octaves,
                frequency: frequency,
                persistence: persistence,
                lacunarity: lacunarity,
              ) +
              1) *
          0.5;

  /// Desvio-padrão empírico de [fbmUnit] por número de oitavas.
  ///
  /// A soma de oitavas converge para uma distribuição quase normal centrada em
  /// 0.5 e **estreita** (σ ≈ 0.08), não uniforme. Sem corrigir isso, um limiar
  /// como `> 0.72` fica a ~2.7σ da média e praticamente nunca dispara — foi o
  /// que fez a primeira versão do gerador cobrir 80% do mapa com um único
  /// bioma. Medido sobre 32k amostras.
  static const Map<int, double> _fbmStdDev = {
    1: 0.1400,
    2: 0.0929,
    3: 0.0819,
    4: 0.0775,
    5: 0.0746,
  };

  /// Amostra do fBm remapeada para uma distribuição **uniforme** em `[0, 1]`.
  ///
  /// Com isso um limiar passa a significar exatamente o que parece: `> 0.85`
  /// seleciona os 15% mais altos do campo, em qualquer seed. É o que torna a
  /// mistura de biomas projetável em vez de acidental.
  double fbmUniform(
    double x,
    double y, {
    int octaves = 3,
    double frequency = 1,
    double persistence = 0.5,
    double lacunarity = 2,
  }) {
    final raw = fbmUnit(
      x,
      y,
      octaves: octaves,
      frequency: frequency,
      persistence: persistence,
      lacunarity: lacunarity,
    );
    final sd = _fbmStdDev[octaves] ?? 0.08;
    // Aproximação logística da CDF normal: Φ(z) ≈ 1 / (1 + e^(-1.702 z)).
    // Erro máximo ~1%, sem precisar de erf.
    final z = (raw - 0.5) / sd;
    return 1 / (1 + math.exp(-1.702 * z));
  }

  /// Ruído celular (Worley). Devolve a distância normalizada até o ponto de
  /// atração mais próximo — usado para as manchas de contaminação e para dar
  /// textura de "placa tectônica" aos distritos.
  double cellular(double x, double y, {double frequency = 1}) {
    final px = x * frequency;
    final py = y * frequency;
    final cx = px.floor();
    final cy = py.floor();

    var best = double.infinity;
    for (var oy = -1; oy <= 1; oy++) {
      for (var ox = -1; ox <= 1; ox++) {
        final gx = cx + ox;
        final gy = cy + oy;
        final jitterX = _perm[(gx & _tableMask)] / _tableSize;
        final jitterY = _perm[(_perm[gx & _tableMask] + gy) & _tableMask] / _tableSize;
        final featureX = gx + jitterX;
        final featureY = gy + jitterY;
        final d = (featureX - px) * (featureX - px) + (featureY - py) * (featureY - py);
        if (d < best) best = d;
      }
    }
    return math.sqrt(best).clamp(0.0, 1.0);
  }
}
