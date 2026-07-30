import 'dart:async';
import 'dart:io';

import 'package:cyberkingdoms/core/audio/audio_service.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

/// Configuração aplicada a **todos** os testes deste diretório.
///
/// O `flutter_test` roda com uma fonte de teste que desenha cada glifo como um
/// retângulo vazio. Isso não atrapalha assertivas de texto, mas torna qualquer
/// captura de tela ilegível. Carregar as fontes reais aqui faz os goldens
/// saírem com o texto de verdade — que é o ponto de gerá-los.
Future<void> testExecutable(FutureOr<void> Function() testMain) async {
  TestWidgetsFlutterBinding.ensureInitialized();

  AudioService.instance.disableForTests();

  await _loadFont('KenneyFuture', 'assets/fonts/KenneyFuture.ttf');
  await _loadFont('KenneyFutureNarrow', 'assets/fonts/KenneyFutureNarrow.ttf');

  // Os ícones do Material vêm do pacote, não do projeto.
  await _loadFont(
    'MaterialIcons',
    'fonts/MaterialIcons-Regular.otf',
    packageRelative: true,
  );

  await testMain();
}

Future<void> _loadFont(
  String family,
  String path, {
  bool packageRelative = false,
}) async {
  try {
    final File file;
    if (packageRelative) {
      // A fonte de ícones vive dentro do SDK do Flutter, não do projeto.
      final flutterRoot = Platform.environment['FLUTTER_ROOT'];
      if (flutterRoot == null) return;
      file = File(
        '$flutterRoot/bin/cache/artifacts/material_fonts/'
        'MaterialIcons-Regular.otf',
      );
    } else {
      file = File(path);
    }
    if (!file.existsSync()) return;

    final loader = FontLoader(family)
      ..addFont(Future.value(file.readAsBytesSync().buffer.asByteData()));
    await loader.load();
  } catch (_) {
    // Sem a fonte real os testes ainda passam; só as capturas ficam sem texto.
  }
}
