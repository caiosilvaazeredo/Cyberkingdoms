import 'dart:io';
import 'dart:ui' as ui;

import 'package:cyberkingdoms/domain/building/building_type.dart';
import 'package:cyberkingdoms/domain/building/plot.dart';
import 'package:cyberkingdoms/domain/campaign/campaign.dart';
import 'package:cyberkingdoms/domain/character/attributes.dart';
import 'package:cyberkingdoms/domain/economy/item.dart';
import 'package:cyberkingdoms/domain/world/coords.dart';
import 'package:cyberkingdoms/domain/world/tile.dart';
import 'package:cyberkingdoms/game/sprite_catalog.dart';
import 'package:cyberkingdoms/game/world_game.dart';
import 'package:flame/game.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/goldens.dart';

/// Captura do mundo isométrico.
///
/// Os goldens da aba Mundo saíam vazios: o `GameWidget` do Flame pinta a partir
/// do próprio laço de render, que nunca roda dentro de um widget test. O
/// resultado é que a parte mais visual do jogo — o mundo — era a única sem
/// nenhuma verificação de que desenha coisa alguma.
///
/// A saída aqui é pular o widget: instanciar o `CyberWorldGame`, dizer o
/// tamanho da tela e chamar `render` num `Canvas` nosso. O código exercitado é
/// exatamente o mesmo que roda no celular — projeção, culling de chunks,
/// ancoragem dos sprites, contorno do terreno e marcador do jogador.
///
/// A primeira captura já pagou o custo do arquivo: mostrou que as construções
/// do jogador eram desenhadas do tamanho de um barril sobre um lote de 8x8, e
/// que a cidade procedural continuava gerando prédios *por cima* do terreno,
/// deixando a base do jogador impossível de achar no mapa.
///
/// Regravar as imagens:
/// ```sh
/// flutter test test/world_render_test.dart --update-goldens
/// ```
void main() {
  group('Render do mundo', () {
    testWidgets('a cidade, o terreno e o marcador do jogador aparecem',
        (tester) async {
      late ui.Image capture;
      late _RenderProbe probe;

      await tester.runAsync(() async {
        final scene = await _Scene.build();
        capture = await scene.shoot(focus: scene.plotCenter, zoom: 0.55);
        probe = await _RenderProbe.of(capture);
      });

      // Estas assertivas são o que separa "gerou um PNG" de "o mundo aparece".
      // Um golden sozinho não reprova uma tela preta — ele só a congela.
      expect(probe.paintedFraction, greaterThan(0.6),
          reason: 'o mundo cobriu apenas '
              '${(probe.paintedFraction * 100).toStringAsFixed(1)}% da tela — '
              'provavelmente o culling descartou as chunks visíveis');
      expect(probe.distinctColors, greaterThan(120),
          reason: 'a imagem tem só ${probe.distinctColors} cores distintas: '
              'os sprites não carregaram e sobrou o losango de fallback');
      expect(probe.hasPlayerPin, isTrue,
          reason: 'o pino magenta do jogador não aparece na captura');
      expect(probe.outlinePixels, greaterThan(200),
          reason: 'só ${probe.outlinePixels} pixels do contorno do lote: o '
              'terreno do jogador sumiu no meio da cidade procedural');

      await expectGolden(capture, 'goldens/11-mundo-isometrico.png');
      capture.dispose();
    });

    testWidgets('o terreno do jogador se destaca da cidade ao redor',
        (tester) async {
      late ui.Image capture;

      await tester.runAsync(() async {
        final scene = await _Scene.build();
        capture = await scene.shoot(focus: scene.plotCenter, zoom: 0.42);
      });

      await expectGolden(capture, 'goldens/12-terreno-no-mundo.png');
      capture.dispose();
    });

    testWidgets('nenhum zoom trava tentando desenhar o mundo inteiro',
        (tester) async {
      // Teto de segurança do `_renderVisibleChunks`: afastar tudo não pode
      // virar uma varredura de dezenas de milhares de tiles.
      await tester.runAsync(() async {
        final scene = await _Scene.build();

        for (final zoom in [0.05, 0.22, 0.55, 1.0, 4.0]) {
          final stopwatch = Stopwatch()..start();
          final image = await scene.shoot(focus: scene.plotCenter, zoom: zoom);
          stopwatch.stop();
          image.dispose();

          expect(stopwatch.elapsedMilliseconds, lessThan(3000),
              reason: 'render a zoom $zoom levou '
                  '${stopwatch.elapsedMilliseconds}ms');
        }
      });
    });
  });

  group('Arte das construções', () {
    // Duas regressões que só a folha de contato revelou, e que nenhuma
    // assertiva de regra de jogo pegaria.
    test('nenhuma construção compartilha sprite com outra', () {
      final bySprite = <String, List<String>>{};
      for (final def in BuildingCatalog.all) {
        bySprite.putIfAbsent(def.spriteId, () => []).add(def.name);
      }

      final shared = bySprite.entries.where((e) => e.value.length > 1).toList();
      expect(shared, isEmpty,
          reason: 'duas construções desenhadas iguais no terreno são '
              'indistinguíveis:\n'
              '${shared.map((e) => '${e.key}: ${e.value.join(', ')}').join('\n')}');
    });

    testWidgets('toda feature que o mundo gera tem arte carregada',
        (tester) async {
      // Uma feature sem candidato de sprite não desenha nada: o tile fica só
      // com o chão, e o bioma perde exatamente o detalhe que o define. Nada
      // mais no projeto liga as duas pontas — dá para acrescentar um
      // `TileFeature` ao gerador e nunca desenhá-lo.
      await tester.runAsync(() async {
        final catalog = await SpriteCatalog.load();
        await catalog.preloadUsedSprites();

        final campaign = Campaign.create(
          id: 'arte',
          seedLabel: 'cobertura-de-arte',
          characterName: 'Kaia Vex',
        );

        final generated = <TileFeature>{};
        for (var y = -900; y <= 900; y += 17) {
          for (var x = -900; x <= 900; x += 17) {
            generated.add(campaign.world.tileAt(x, y).feature);
          }
        }
        generated.remove(TileFeature.none);

        // Amostra ampla o bastante para valer como cobertura.
        expect(generated.length, greaterThan(15),
            reason: 'a varredura pegou poucas features: $generated');

        final semArte = <String>[];
        for (final feature in generated) {
          final meta = catalog.featureFor(feature, 0, 0);
          if (meta == null) {
            semArte.add('${feature.name}: sem candidato');
          } else if (!catalog.isLoaded(meta)) {
            semArte.add('${feature.name}: ${meta.id} fora do preload');
          }
        }

        expect(semArte, isEmpty,
            reason: 'feature gerada e invisível:\n${semArte.join('\n')}');
      });
    });

    test('toda construção aponta para um sprite que existe', () async {
      final catalog = await SpriteCatalog.load();
      final missing = BuildingCatalog.all
          .where((def) => catalog.byId(def.spriteId) == null)
          .map((def) => '${def.name} -> ${def.spriteId}')
          .toList();

      expect(missing, isEmpty,
          reason: 'sprite inexistente: a construção não desenha nada e o '
              'terreno fica com um buraco:\n${missing.join('\n')}');
    });
  });
}

/// Uma campanha com o terreno povoado, pronta para render.
class _Scene {
  _Scene(this.campaign, this.catalog);

  final Campaign campaign;
  final SpriteCatalog catalog;

  /// Lote de 8x8 ocupado com uma construção de cada categoria — moradia,
  /// extração, refino, comércio, infraestrutura, defesa e civismo. Uma captura
  /// com um prédio só não mostraria que footprints diferentes se ancoram no
  /// lugar certo.
  static const _layout = <(BuildingId, int, int)>[
    (BuildingId.shack, 0, 0),
    (BuildingId.warehouse, 2, 0),
    (BuildingId.watchtower, 6, 0),
    (BuildingId.scrapYard, 0, 2),
    (BuildingId.bioreactor, 2, 2),
    (BuildingId.waterTower, 5, 2),
    (BuildingId.generator, 6, 2),
    (BuildingId.shopFront, 7, 2),
    (BuildingId.hydroponicBay, 0, 4),
    (BuildingId.implantClinic, 2, 4),
    (BuildingId.bar, 4, 4),
    (BuildingId.perimeterWall, 5, 4),
    (BuildingId.plaza, 0, 6),
    (BuildingId.armoredGate, 2, 6),
  ];

  static Future<_Scene> build() async {
    final catalog = await SpriteCatalog.load();
    await catalog.preloadUsedSprites();

    final campaign = Campaign.create(
      id: 'render',
      seedLabel: 'captura-do-mundo',
      characterName: 'Kaia Vex',
    );

    campaign.character.credits = 500000;
    for (final id in ItemId.values) {
      campaign.character.inventory.add(id, 400);
    }

    for (final (type, x, y) in _layout) {
      final result = campaign.plot.build(
        type: type,
        // O terreno inicial é de sobrevivente; a captura precisa de nível
        // máximo para exibir também as construções travadas por progressão.
        level: CitizenLevel.elite,
        x: x,
        y: y,
        inventory: campaign.character.inventory,
        credits: campaign.character.credits,
        day: 1,
      );
      // Sem esta checagem, uma construção recusada (não cabe, nível
      // insuficiente, sobreposição) sumiria em silêncio e o golden gravaria um
      // lote vazio como se fosse o certo.
      if (result is BuildRejected) {
        throw StateError('${type.name} recusada em ($x,$y): ${result.reason}');
      }
    }
    // Uma obra fica em andamento de propósito: a silhueta âmbar translúcida é
    // um estado que o jogador vê todo dia e que precisa aparecer no golden.
    for (final building in campaign.plot.buildings.skip(1)) {
      building.daysRemaining = 0;
    }

    return _Scene(campaign, catalog);
  }

  TileCoord get plotCenter => TileCoord(
        campaign.plot.origin.x + campaign.plot.width ~/ 2,
        campaign.plot.origin.y + campaign.plot.height ~/ 2,
      );

  static const Size size = Size(412, 720);

  Future<ui.Image> shoot({required TileCoord focus, required double zoom}) async {
    final game = CyberWorldGame(
      gameWorld: campaign.world,
      catalog: catalog,
      playerPosition: campaign.character.position,
      plot: campaign.plot,
    );

    // O que o `GameWidget` faria antes do primeiro frame.
    game.onGameResize(Vector2(size.width, size.height));
    await game.onLoad();
    game.focusOn(focus);
    game.zoom = zoom;

    final recorder = ui.PictureRecorder();
    final canvas = Canvas(
      recorder,
      Rect.fromLTWH(0, 0, size.width, size.height),
    );
    canvas.drawRect(
      Rect.fromLTWH(0, 0, size.width, size.height),
      Paint()..color = game.backgroundColor(),
    );
    game.render(canvas);

    return recorder
        .endRecording()
        .toImage(size.width.round(), size.height.round());
  }
}

/// Estatísticas dos pixels de uma captura.
///
/// Existe porque `matchesGoldenFile` aceita qualquer imagem, inclusive uma tela
/// preta: ele compara com o que foi gravado antes, não com o que deveria estar
/// lá. Estas medidas dizem que *algo* foi efetivamente desenhado.
class _RenderProbe {
  _RenderProbe({
    required this.paintedFraction,
    required this.distinctColors,
    required this.hasPlayerPin,
    required this.outlinePixels,
  });

  /// Fração de pixels diferentes da cor de fundo do jogo.
  final double paintedFraction;

  /// Cores distintas, quantizadas em 5 bits por canal. Sprites reais produzem
  /// centenas; losangos de fallback, uma dúzia.
  final int distinctColors;

  /// Se o magenta do pino do jogador (`0xFFFF2D95`) aparece.
  final bool hasPlayerPin;

  /// Pixels do contorno ciano do lote. É o que prova que o terreno do jogador
  /// continua achável dentro da metrópole.
  final int outlinePixels;

  static const int _background = 0xFF07070C;

  static Future<_RenderProbe> of(ui.Image image) async {
    final data = await image.toByteData(format: ui.ImageByteFormat.rawRgba);
    final bytes = data!.buffer.asUint8List();

    var painted = 0;
    var pin = false;
    var outline = 0;
    final colors = <int>{};

    for (var i = 0; i < bytes.length; i += 4) {
      final r = bytes[i];
      final g = bytes[i + 1];
      final b = bytes[i + 2];

      final argb = 0xFF000000 | (r << 16) | (g << 8) | b;
      if (argb != _background) painted++;

      colors.add(((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3));

      // Tolerância larga: o pino é desenhado com antialias e pode receber
      // blend do halo por trás.
      if (r > 200 && g < 90 && b > 110 && b < 190) pin = true;

      // Ciano do contorno (`0xFF00E5FF`), com folga para o antialias.
      if (r < 140 && g > 170 && b > 200) outline++;
    }

    final total = bytes.length ~/ 4;
    return _RenderProbe(
      paintedFraction: painted / total,
      distinctColors: colors.length,
      hasPlayerPin: pin,
      outlinePixels: outline,
    );
  }
}

/// Escreve uma captura em disco para inspeção manual, fora do fluxo de golden.
///
/// Não é chamado pelos testes; fica aqui porque depurar um render errado sem
/// olhar a imagem é adivinhação.
Future<void> debugDump(ui.Image image, String path) async {
  final data = await image.toByteData(format: ui.ImageByteFormat.png);
  File(path).writeAsBytesSync(data!.buffer.asUint8List());
}
