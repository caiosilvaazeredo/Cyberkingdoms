import 'dart:convert';
import 'dart:io';

import 'package:cyberkingdoms/core/seed/deterministic_random.dart';
import 'package:cyberkingdoms/core/seed/noise.dart';
import 'package:cyberkingdoms/domain/world/world_gen.dart';
import 'package:flutter_test/flutter_test.dart';

/// Exporta a saída do gerador para `web3d/test/worldgen-fixture.json`.
///
/// A porta TypeScript do gerador só vale alguma coisa se produzir **o mesmo
/// mundo** que a versão Dart: mesma seed, mesmo bioma, mesma altura, no mesmo
/// tile. "Parecido" não serve — o objetivo desde o começo é que dois clientes
/// com a mesma seed enxerguem o mesmo mapa, e agora eles são dois motores
/// diferentes.
///
/// Este teste é o lado Dart do contrato: grava a referência. O lado TypeScript
/// (`web3d/test/determinism.test.ts`) lê o mesmo arquivo e compara.
///
/// ```sh
/// flutter test test/fixture_export_test.dart
/// ```
/// O arquivo é versionado, então o `vitest` roda sem precisar do Flutter.
void main() {
  test('exporta a referência de geração para a porta TypeScript', () {
    const seedLabel = 'contrato-dart-ts';
    final seed = DeterministicRandom.hashLabel(seedLabel);
    final generator = WorldGenerator(seed: seed);
    final noise = GradientNoise(DeterministicRandom.mix(seed, 0x31));

    // Amostra esparsa e ampla: passo primo para não cair sempre na mesma fase
    // do ruído, e alcance grande o bastante para atravessar vários biomas.
    final tiles = <Map<String, Object>>[];
    for (var i = 0; i < 400; i++) {
      final x = (i * 137) % 2003 - 1000;
      final y = (i * 89) % 1999 - 1000;
      tiles.add({
        'x': x,
        'y': y,
        'biome': generator.biomeAt(x, y).name,
        'elevation': generator.elevationAt(x, y),
      });
    }

    // Os primitivos entram separados porque, quando o contrato quebra, saber
    // *qual camada* divergiu é a diferença entre um minuto e uma tarde: se o
    // RNG bate mas o ruído não, o problema está na tabela de permutação.
    final rng = DeterministicRandom(seed);
    final fixture = {
      'seedLabel': seedLabel,
      'seed': seed,
      'hashLabel': {
        for (final label in ['', 'a', 'neon-tokyo', 'contrato-dart-ts', 'ãé漢'])
          label: DeterministicRandom.hashLabel(label),
      },
      'mix': [
        for (final pair in [
          [0, 0],
          [1, 2],
          [seed, 0x31],
          [0xFFFFFFFF, 0x9E3779B1],
        ])
          {'a': pair[0], 'b': pair[1], 'out': DeterministicRandom.mix(pair[0], pair[1])},
      ],
      'nextInt32': [for (var i = 0; i < 16; i++) rng.nextInt32()],
      'whiteNoise2D': [
        for (final p in [
          [0, 0],
          [1, 1],
          [-13, 47],
          [1000, -1000],
        ])
          {
            'x': p[0],
            'y': p[1],
            'out': DeterministicRandom.whiteNoise2D(seed, p[0], p[1]),
          },
      ],
      'noiseSample': [
        for (var i = 0; i < 24; i++)
          {
            'x': i * 0.37 - 4,
            'y': i * -0.19 + 2,
            'sample': noise.sample(i * 0.37 - 4, i * -0.19 + 2),
            'fbmUniform': noise.fbmUniform(i * 0.37 - 4, i * -0.19 + 2, octaves: 3),
            'cellular': noise.cellular(i * 0.37 - 4, i * -0.19 + 2, frequency: 0.009),
          },
      ],
      'tiles': tiles,
    };

    final file = File('web3d/test/worldgen-fixture.json');
    file.parent.createSync(recursive: true);
    file.writeAsStringSync(
      '${const JsonEncoder.withIndent('  ').convert(fixture)}\n',
    );

    expect(tiles, hasLength(400));
    expect(file.existsSync(), isTrue);
  });
}
