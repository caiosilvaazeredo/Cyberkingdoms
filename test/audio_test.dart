import 'dart:io';

import 'package:cyberkingdoms/core/audio/audio_service.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:yaml/yaml.dart';

/// Confere que todo som referenciado no código existe em disco **e** está
/// declarado no `pubspec.yaml`.
///
/// Um caminho de áudio errado não quebra a compilação nem lança em runtime — o
/// [AudioService] engole a falha de propósito, porque som ausente não pode
/// derrubar o jogo. O preço disso é que só um teste pega o erro.
void main() {
  final assetsRoot = Directory('assets/audio');

  group('Assets de áudio', () {
    test('a pasta de áudio existe', () {
      expect(assetsRoot.existsSync(), isTrue);
    });

    test('todo efeito aponta para um arquivo real', () {
      for (final sfx in Sfx.values) {
        final file = File('assets/audio/${sfx.asset}');
        expect(file.existsSync(), isTrue,
            reason: '${sfx.name} -> ${sfx.asset} não existe');
        expect(file.lengthSync(), greaterThan(0), reason: sfx.name);
      }
    });

    test('todo jingle aponta para um arquivo real', () {
      for (final jingle in Jingle.values) {
        final file = File('assets/audio/${jingle.asset}');
        expect(file.existsSync(), isTrue,
            reason: '${jingle.name} -> ${jingle.asset} não existe');
      }
    });

    test('toda locução aponta para um arquivo real', () {
      for (final voice in Voice.values) {
        final file = File('assets/audio/${voice.asset}');
        expect(file.existsSync(), isTrue,
            reason: '${voice.name} -> ${voice.asset} não existe');
      }
    });

    test('as pastas de áudio estão declaradas no pubspec', () {
      // Regressão: a declaração de assets do Flutter não é recursiva. Declarar
      // só `assets/audio/` deixaria `assets/audio/ui/` de fora e nenhum som
      // seria empacotado no app.
      final pubspec = loadYaml(File('pubspec.yaml').readAsStringSync()) as Map;
      final declared = ((pubspec['flutter'] as Map)['assets'] as List)
          .map((e) => e.toString())
          .toSet();

      for (final folder in ['ui', 'game', 'jingles', 'voice']) {
        expect(declared, contains('assets/audio/$folder/'),
            reason: 'assets/audio/$folder/ não declarado no pubspec');
      }
    });

    test('nenhum som é referenciado duas vezes com nomes diferentes', () {
      final paths = [
        for (final sfx in Sfx.values) sfx.asset,
        for (final jingle in Jingle.values) jingle.asset,
        for (final voice in Voice.values) voice.asset,
      ];
      expect(paths.toSet().length, paths.length,
          reason: 'há caminhos de áudio duplicados entre os enums');
    });

    test('todo arquivo empacotado é usado por algum enum', () {
      // Evita que o app carregue peso morto: se um .ogg entrou em assets mas
      // nenhum enum aponta para ele, ou falta o mapeamento ou o arquivo sobra.
      final referenced = {
        for (final sfx in Sfx.values) 'assets/audio/${sfx.asset}',
        for (final jingle in Jingle.values) 'assets/audio/${jingle.asset}',
        for (final voice in Voice.values) 'assets/audio/${voice.asset}',
      };

      final onDisk = assetsRoot
          .listSync(recursive: true)
          .whereType<File>()
          .where((f) => f.path.endsWith('.ogg'))
          .map((f) => f.path)
          .toSet();

      expect(onDisk.difference(referenced), isEmpty,
          reason: 'arquivos de áudio empacotados mas nunca tocados');
    });
  });

  group('AudioService', () {
    test('começa com os três canais ligados', () {
      final audio = AudioService.instance;
      // Sem `initialize()` (que precisa de binding de plataforma), os valores
      // são os padrões declarados.
      expect(audio.sfxEnabled, isTrue);
      expect(audio.musicEnabled, isTrue);
      expect(audio.voiceEnabled, isTrue);
      expect(audio.masterVolume, inInclusiveRange(0.0, 1.0));
    });

    test('tocar com o canal desligado não faz nada e não lança', () {
      final audio = AudioService.instance;
      audio.setSfxEnabled(false);
      expect(() => audio.play(Sfx.tap), returnsNormally);
      audio.setSfxEnabled(true);
    });
  });
}
