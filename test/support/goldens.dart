import 'dart:io' show Platform;

import 'package:flutter_test/flutter_test.dart';

/// Captura de tela só vale contra o mesmo motor gráfico que a gerou.
///
/// O Flutter não garante que dois lançamentos rasterizem igual, e não
/// rasterizam mesmo: a mesma tela do menu difere em **7% dos pixels** entre o
/// Flutter 3.32 e o 3.35 — só de antialiasing de fonte, sem uma linha de código
/// mudar. Sete por cento é folga demais para virar tolerância: uma regressão
/// visual de verdade caberia inteira dentro dela.
///
/// Então os goldens têm uma versão de referência, e nas outras a comparação é
/// **pulada, não afrouxada**. Todo o resto da suíte roda em qualquer versão —
/// inclusive as medições de pixel do `world_render_test.dart`, que checam que o
/// mundo desenhou alguma coisa e não dependem de rasterização exata.
///
/// Para regravar depois de mudar a UI, use a versão de referência:
/// ```sh
/// flutter test --update-goldens
/// ```
/// Se o projeto mudar de versão de referência, troque [goldenDartVersion] e
/// regrave tudo de uma vez.
const String goldenDartVersion = '3.8';

/// `true` se o SDK atual é o que gerou as imagens em `test/goldens/`.
///
/// A checagem é pela versão do Dart porque é a única exposta ao teste em tempo
/// de execução, e ela anda casada com a do motor: Dart 3.8 é Flutter 3.32.
bool get goldensRunHere => Platform.version.startsWith('$goldenDartVersion.');

/// Compara com a imagem versionada, ou marca o teste como pulado fora da
/// versão de referência.
///
/// Marcar como pulado, em vez de simplesmente não comparar, é o que evita o
/// pior dos mundos: um teste que passa em silêncio sem ter verificado nada.
Future<void> expectGolden(Object actual, String path) async {
  if (!goldensRunHere) {
    markTestSkipped(
      'captura ignorada: as imagens em test/goldens/ foram geradas no Dart '
      '$goldenDartVersion.x e este SDK é o ${Platform.version.split(' ').first}. '
      'Rode a suíte no Dart $goldenDartVersion.x para conferir a interface.',
    );
    return;
  }
  await expectLater(actual, matchesGoldenFile(path));
}
