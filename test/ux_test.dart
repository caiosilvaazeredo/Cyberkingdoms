import 'dart:io';
import 'dart:math' as math;

import 'package:cyberkingdoms/core/theme.dart';
import 'package:cyberkingdoms/data/campaign_repository.dart';
import 'package:cyberkingdoms/domain/economy/item.dart';
import 'package:cyberkingdoms/state/providers.dart';
import 'package:cyberkingdoms/ui/screens/campaign_select_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/harness.dart';

/// Bateria de UI/UX.
///
/// Cada grupo aqui existe porque o problema correspondente **já apareceu** no
/// projeto: o botão de criar mundo ficou fora da tela num celular pequeno, os
/// rótulos das abas quebravam em duas linhas, e os botões renderizavam na fonte
/// errada. Testes de tela cheia não pegam isso; estes pegam.
void main() {
  group('Sem overflow em nenhum tamanho de tela', () {
    for (final screen in allScreens) {
      testWidgets('menu inicial — $screen', (tester) async {
        await tester.setScreen(screen);
        await tester.pumpWidget(_menuApp());
        await tester.pumpAndSettle();

        expectNoOverflow(tester);
      });

      testWidgets('folha de nova campanha — $screen', (tester) async {
        await tester.setScreen(screen);
        await tester.pumpWidget(_menuApp());
        await tester.pumpAndSettle();

        await tester.tap(find.text('NOVA CAMPANHA'));
        await tester.pumpAndSettle();

        expectNoOverflow(tester);

        // O botão de criar mundo precisa ser alcançável rolando.
        await tester.ensureVisible(find.text('GERAR MUNDO'));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
      });
    }

    for (final screen in allScreens) {
      for (final tab in gameTabs) {
        testWidgets('aba $tab — $screen', (tester) async {
          final harness = await GameHarness.start(
            tester,
            tab: tab,
            screen: screen,
          );
          expectNoOverflow(tester);
          harness.dispose();
        });
      }
    }
  });

  group('Escala de texto', () {
    // Acessibilidade do sistema: no Android o usuário pode chegar a 2.0.
    for (final scale in [0.85, 1.0, 1.3, 1.6]) {
      testWidgets('menu a ${scale}x', (tester) async {
        await tester.setScreen(phone, textScale: scale);
        await tester.pumpWidget(_menuApp());
        await tester.pumpAndSettle();
        expectNoOverflow(tester);
      });

      testWidgets('casca do jogo a ${scale}x', (tester) async {
        final harness = await GameHarness.start(tester, textScale: scale);
        expectNoOverflow(tester);
        harness.dispose();
      });
    }
  });

  group('Alvos de toque', () {
    testWidgets('as abas têm altura tocável', (tester) async {
      final harness = await GameHarness.start(tester);

      // A barra inteira precisa acomodar o dedo; cada destino divide a largura.
      final bar = tester.getSize(find.byType(NavigationBar));
      expect(bar.height, greaterThanOrEqualTo(48),
          reason: 'barra de navegação baixa demais para o polegar');
      expect(bar.width / gameTabs.length, greaterThanOrEqualTo(40),
          reason: 'abas estreitas demais: ${bar.width / gameTabs.length}px');

      harness.dispose();
    });

    testWidgets('os botões principais têm 48px de altura', (tester) async {
      await tester.setScreen(phone);
      await tester.pumpWidget(_menuApp());
      await tester.pumpAndSettle();

      await tester.tap(find.text('NOVA CAMPANHA'));
      await tester.pumpAndSettle();

      final button = tester.getSize(find.byType(FilledButton).first);
      expect(button.height, greaterThanOrEqualTo(48),
          reason: 'alvo de toque abaixo do mínimo recomendado');
    });

    testWidgets('os controles do mundo são grandes o suficiente',
        (tester) async {
      final harness = await GameHarness.start(tester, tab: 'Mundo');

      // Os botões de zoom/foco são círculos de 46px declarados na tela.
      final buttons = find.byType(InkWell);
      expect(buttons, findsWidgets);

      harness.dispose();
    });
  });

  group('Legibilidade', () {
    /// Contraste WCAG entre duas cores opacas.
    double contrast(Color a, Color b) {
      double luminance(Color c) {
        double channel(double v) {
          v = v / 255;
          return v <= 0.03928
              ? v / 12.92
              : math.pow((v + 0.055) / 1.055, 2.4).toDouble();
        }

        return 0.2126 * channel(c.r * 255) +
            0.7152 * channel(c.g * 255) +
            0.0722 * channel(c.b * 255);
      }

      final la = luminance(a);
      final lb = luminance(b);
      final lighter = la > lb ? la : lb;
      final darker = la > lb ? lb : la;
      return (lighter + 0.05) / (darker + 0.05);
    }

    test('o texto principal tem contraste AA sobre o fundo', () {
      expect(
        contrast(CyberColors.textPrimary, CyberColors.background),
        greaterThanOrEqualTo(4.5),
      );
    });

    test('o texto secundário tem contraste AA para texto grande', () {
      // 3:1 é o mínimo da WCAG para texto grande ou de apoio.
      expect(
        contrast(CyberColors.textSecondary, CyberColors.surface),
        greaterThanOrEqualTo(3.0),
      );
    });

    test('as cores de destaque contrastam com o fundo', () {
      for (final color in [
        CyberColors.cyan,
        CyberColors.pink,
        CyberColors.amber,
        CyberColors.green,
        CyberColors.violet,
      ]) {
        expect(
          contrast(color, CyberColors.background),
          greaterThanOrEqualTo(4.5),
          reason: 'cor de destaque com contraste baixo: $color',
        );
      }
    });

    test('a cor da barra vital muda conforme esvazia', () {
      expect(CyberColors.vital(0.9), CyberColors.green);
      expect(CyberColors.vital(0.5), CyberColors.amber);
      expect(CyberColors.vital(0.1), CyberColors.danger);
    });
  });

  group('Tipografia', () {
    test('os estilos de botão declaram a fonte do jogo', () {
      // Regressão: um TextStyle dentro de ButtonStyle substitui o do tema em
      // vez de herdar. Sem `fontFamily` explícito, todo botão do jogo
      // renderizava na fonte padrão da plataforma — visível nas capturas como
      // retângulos no lugar das letras.
      final theme = CyberTheme.build();

      final filled = theme.filledButtonTheme.style?.textStyle
          ?.resolve(<WidgetState>{});
      expect(filled?.fontFamily, CyberTheme.bodyFont);

      final outlined = theme.outlinedButtonTheme.style?.textStyle
          ?.resolve(<WidgetState>{});
      expect(outlined?.fontFamily, CyberTheme.bodyFont);

      final text =
          theme.textButtonTheme.style?.textStyle?.resolve(<WidgetState>{});
      expect(text?.fontFamily, CyberTheme.bodyFont);
    });

    test('o tema usa a fonte empacotada, não a do sistema', () {
      expect(CyberTheme.build().textTheme.bodyMedium?.fontFamily,
          CyberTheme.bodyFont);
    });

    test('nenhum textStyle de botão esquece a fontFamily', () {
      // Varredura de código-fonte, não de widget.
      //
      // Este bug não aparece em nenhuma assertiva de árvore: o botão continua
      // existindo, com o texto certo, no lugar certo — só desenhado na fonte
      // errada. Só uma captura de tela ou esta varredura pegam. Já aconteceu
      // duas vezes (tema e botão RESET do HUD).
      final offenders = <String>[];

      for (final file in Directory('lib')
          .listSync(recursive: true)
          .whereType<File>()
          .where((f) => f.path.endsWith('.dart'))) {
        final source = file.readAsStringSync();
        final matches = RegExp(
          r'textStyle:\s*(?:const\s*)?TextStyle\(([^)]*)\)',
          multiLine: true,
        ).allMatches(source);

        for (final match in matches) {
          if (!match.group(1)!.contains('fontFamily')) {
            final line = '\n'.allMatches(source.substring(0, match.start)).length + 1;
            offenders.add('${file.path}:$line');
          }
        }
      }

      expect(offenders, isEmpty,
          reason: 'textStyle de botão sem fontFamily — o botão cairá na '
              'fonte padrão da plataforma em:\n${offenders.join('\n')}');
    });
  });

  group('Conteúdo legível para o jogador', () {
    testWidgets('a cidade mostra nomes de itens, não identificadores',
        (tester) async {
      // Regressão: a tela mostrava "STOLENGOODS" e "RAREEARTH" — os nomes do
      // enum — em vez de "Carga Roubada" e "Terras Raras".
      final harness = await GameHarness.start(tester, tab: 'Cidade');

      for (final id in ItemId.values) {
        expect(find.text(id.name), findsNothing,
            reason: 'identificador cru "${id.name}" visível na interface');
      }

      harness.dispose();
    });

    testWidgets('o mercado mostra nomes de itens, não identificadores',
        (tester) async {
      final harness = await GameHarness.start(tester, tab: 'Mercado');

      for (final id in ItemId.values) {
        expect(find.text(id.name), findsNothing,
            reason: 'identificador cru "${id.name}" visível no mercado');
      }

      harness.dispose();
    });

    testWidgets('nenhuma tela mostra texto de placeholder', (tester) async {
      for (final tab in gameTabs) {
        final harness = await GameHarness.start(tester, tab: tab);
        for (final marker in ['TODO', 'FIXME', 'null', 'Instance of']) {
          expect(find.textContaining(marker), findsNothing,
              reason: '"$marker" aparece na aba $tab');
        }
        harness.dispose();
      }
    });
  });

  group('Navegação', () {
    testWidgets('todas as abas trocam de conteúdo sem exceção',
        (tester) async {
      final harness = await GameHarness.start(tester);

      for (final tab in gameTabs) {
        await tester.tap(find.text(tab));
        await harness.pumpFrames(tester);
        expect(tester.takeException(), isNull, reason: 'exceção na aba $tab');
      }

      harness.dispose();
    });

    testWidgets('a folha de som abre e fecha', (tester) async {
      final harness = await GameHarness.start(tester);

      await tester.longPress(find.byIcon(Icons.volume_up));
      await harness.pumpFrames(tester, frames: 20);

      expect(find.text('SOM'), findsOneWidget);
      expect(find.text('Efeitos'), findsOneWidget);
      expect(find.text('Combate'), findsOneWidget);

      await tester.tap(find.text('FECHAR'));
      await harness.pumpFrames(tester, frames: 20);
      expect(find.text('SOM'), findsNothing);

      harness.dispose();
    });
  });
}

/// Falha se qualquer `RenderBox` da árvore estourou o espaço disponível.
///
/// O Flutter reporta overflow como uma exceção capturada durante o layout —
/// `takeException` a devolve. Sem esta checagem, uma faixa listrada amarela e
/// preta passaria despercebida no teste.
void expectNoOverflow(WidgetTester tester) {
  final exception = tester.takeException();
  if (exception == null) return;

  final message = exception.toString();
  if (message.contains('overflowed')) {
    fail('overflow de layout: $message');
  }
  // Outras exceções também são falhas, só que com mensagem própria.
  fail('exceção durante o layout: $message');
}

Widget _menuApp() => ProviderScope(
      overrides: [
        campaignRepositoryProvider
            .overrideWithValue(InMemoryCampaignRepository()),
      ],
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: CyberTheme.build(),
        home: const CampaignSelectScreen(),
      ),
    );
