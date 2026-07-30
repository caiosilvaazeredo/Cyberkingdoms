import 'package:cyberkingdoms/core/theme.dart';
import 'package:cyberkingdoms/data/campaign_repository.dart';
import 'package:cyberkingdoms/domain/campaign/campaign.dart';
import 'package:cyberkingdoms/state/providers.dart';
import 'package:cyberkingdoms/ui/screens/game_shell.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

/// Tamanhos de tela usados nos testes de UI.
///
/// A lista existe porque quase todo problema de layout deste jogo aparece nas
/// pontas: telas estreitas cortam os `StatChip` do HUD, telas baixas escondem
/// botões no fim de folhas modais.
class ScreenSize {
  const ScreenSize(this.label, this.width, this.height);

  final String label;
  final double width;
  final double height;

  Size get size => Size(width, height);

  @override
  String toString() => '$label (${width.round()}x${height.round()})';
}

/// Um dos aparelhos mais estreitos ainda em uso (iPhone SE 1ª geração).
const tinyPhone = ScreenSize('celular pequeno', 320, 568);

/// Android mediano.
const phone = ScreenSize('celular', 412, 915);

/// iPhone recente.
const bigPhone = ScreenSize('celular grande', 430, 932);

/// Tablet em retrato.
const tablet = ScreenSize('tablet', 768, 1024);

/// Celular deitado — o app trava em retrato, mas o layout não pode explodir se
/// o sistema forçar a rotação (multi-janela, desktop, Chrome OS).
const landscape = ScreenSize('paisagem', 915, 412);

const allScreens = [tinyPhone, phone, bigPhone, tablet, landscape];

extension ScreenTester on WidgetTester {
  /// Ajusta a viewport do teste e desfaz no fim.
  Future<void> setScreen(ScreenSize screen, {double textScale = 1.0}) async {
    view.physicalSize = screen.size;
    view.devicePixelRatio = 1.0;
    platformDispatcher.textScaleFactorTestValue = textScale;
    addTearDown(() {
      view.reset();
      platformDispatcher.clearTextScaleFactorTestValue();
    });
  }
}

/// Monta a casca do jogo com uma campanha pronta.
///
/// Existe porque montar o jogo à mão em cada teste dava dez linhas repetidas —
/// e porque `pumpAndSettle` não pode ser usado depois que a aba Mundo monta o
/// `GameWidget` do Flame, cujo laço de render nunca deixa a árvore estabilizar.
class GameHarness {
  GameHarness._(this.container, this.campaign);

  final ProviderContainer container;
  final Campaign campaign;

  static Future<GameHarness> start(
    WidgetTester tester, {
    String? tab,
    ScreenSize screen = phone,
    double textScale = 1.0,
    String seed = 'harness',
    void Function(Campaign campaign)? setup,
  }) async {
    await tester.setScreen(screen, textScale: textScale);

    final container = ProviderContainer(
      overrides: [
        campaignRepositoryProvider
            .overrideWithValue(InMemoryCampaignRepository()),
      ],
    );

    await container.read(campaignControllerProvider.notifier).startNew(
          seedLabel: seed,
          characterName: 'Kaia Vex',
        );

    final campaign = container.read(campaignControllerProvider)!;
    setup?.call(campaign);

    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp(
          debugShowCheckedModeBanner: false,
          theme: CyberTheme.build(),
          home: const GameShell(),
        ),
      ),
    );

    final harness = GameHarness._(container, campaign);
    await harness.pumpFrames(tester);

    if (tab != null) {
      await tester.tap(find.text(tab));
      await harness.pumpFrames(tester);
    }

    return harness;
  }

  /// Bombeia quadros sem esperar a árvore estabilizar.
  Future<void> pumpFrames(WidgetTester tester, {int frames = 10}) async {
    for (var i = 0; i < frames; i++) {
      await tester.pump(const Duration(milliseconds: 32));
    }
  }

  void dispose() => container.dispose();
}

/// Nomes das abas, na ordem em que aparecem na barra inferior.
const gameTabs = [
  'Mundo',
  'Quests',
  'Terreno',
  'Cidade',
  'Mercado',
  'Ficha',
  'Poder',
];
