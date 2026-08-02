import 'package:cyberkingdoms/core/theme.dart';
import 'package:cyberkingdoms/data/campaign_repository.dart';
import 'package:cyberkingdoms/domain/campaign/campaign.dart';
import 'package:cyberkingdoms/state/providers.dart';
import 'package:cyberkingdoms/ui/screens/campaign_select_screen.dart';
import 'package:cyberkingdoms/ui/screens/game_shell.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

/// Testes do fluxo de telas.
///
/// Existem porque o app roda com Flame/CanvasKit: na web o texto é desenhado
/// num `<canvas>` e não aparece no DOM, então automação de browser não
/// consegue clicar por rótulo. O widget test enxerga a árvore de widgets de
/// verdade — é a única forma prática de cobrir a navegação.
/// Bombeia alguns quadros sem esperar a árvore estabilizar.
///
/// `pumpAndSettle` não pode ser usado depois que a casca do jogo monta: a aba
/// Mundo cria um `GameWidget` do Flame, e o laço de render do Flame mantém
/// frames agendados indefinidamente — a espera nunca termina.
Future<void> pumpFrames(WidgetTester tester, {int frames = 8}) async {
  for (var i = 0; i < frames; i++) {
    await tester.pump(const Duration(milliseconds: 32));
  }
}

void main() {
  /// Monta a tela inicial com um repositório em memória, para não depender de
  /// `SharedPreferences` (que exige binding de plataforma no teste).
  Widget bootstrap(CampaignRepository repository) => ProviderScope(
        overrides: [
          campaignRepositoryProvider.overrideWithValue(repository),
        ],
        child: MaterialApp(theme: CyberTheme.build(), home: const CampaignSelectScreen()),
      );

  group('Criação de campanha pela UI', () {
    testWidgets('a tela inicial mostra o estado vazio', (tester) async {
      await tester.pumpWidget(bootstrap(InMemoryCampaignRepository()));
      await tester.pumpAndSettle();

      expect(find.text('CYBERKINGDOMS'), findsOneWidget);
      expect(find.textContaining('Nenhum mundo gerado'), findsOneWidget);
      expect(find.text('NOVA CAMPANHA'), findsOneWidget);
    });

    testWidgets('a folha de nova campanha abre com nome e seed preenchidos',
        (tester) async {
      await tester.pumpWidget(bootstrap(InMemoryCampaignRepository()));
      await tester.pumpAndSettle();

      await tester.tap(find.text('NOVA CAMPANHA'));
      await tester.pumpAndSettle();

      expect(find.text('NOVO MUNDO'), findsOneWidget);

      // Os dois campos vêm sugeridos: um campo em branco travaria o botão de
      // criar mundo para quem só quer começar a jogar.
      final fields = tester.widgetList<TextField>(find.byType(TextField));
      expect(fields.length, 2);
      for (final field in fields) {
        expect(field.controller?.text.trim(), isNotEmpty);
      }
    });

    testWidgets('a folha rola até o botão de gerar mundo', (tester) async {
      // Regressão: numa tela de celular a folha transbordava e o botão
      // "GERAR MUNDO" ficava fora de alcance — era impossível criar campanha.
      tester.view.physicalSize = const Size(412, 780);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);

      await tester.pumpWidget(bootstrap(InMemoryCampaignRepository()));
      await tester.pumpAndSettle();

      await tester.tap(find.text('NOVA CAMPANHA'));
      await tester.pumpAndSettle();

      final button = find.text('GERAR MUNDO');
      expect(button, findsOneWidget);

      // `ensureVisible` falha se não houver um Scrollable ancestral.
      await tester.ensureVisible(button);
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    });

    testWidgets('gerar mundo cria a campanha e entra no jogo', (tester) async {
      final repository = InMemoryCampaignRepository();
      await tester.pumpWidget(bootstrap(repository));
      await tester.pumpAndSettle();

      await tester.tap(find.text('NOVA CAMPANHA'));
      await tester.pumpAndSettle();

      await tester.ensureVisible(find.text('GERAR MUNDO'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('GERAR MUNDO'));

      // `pumpAndSettle` nunca retorna daqui em diante: a aba Mundo monta um
      // `GameWidget` do Flame, cujo laço de render mantém frames agendados
      // para sempre. Bombeamos um número fixo de frames.
      await pumpFrames(tester);

      // A campanha foi persistida...
      final saved = await repository.listCampaigns();
      expect(saved, hasLength(1));

      // ...e o app navegou para a casca do jogo.
      expect(find.byType(GameShell), findsOneWidget);
    });

    testWidgets('nome em branco é recusado com aviso', (tester) async {
      await tester.pumpWidget(bootstrap(InMemoryCampaignRepository()));
      await tester.pumpAndSettle();

      await tester.tap(find.text('NOVA CAMPANHA'));
      await tester.pumpAndSettle();

      await tester.enterText(find.byType(TextField).first, '   ');
      await tester.pumpAndSettle();

      await tester.ensureVisible(find.text('GERAR MUNDO'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('GERAR MUNDO'));
      await tester.pump();

      expect(find.text('Preencha nome e seed.'), findsOneWidget);
    });
  });

  group('Casca do jogo', () {
    testWidgets('as seis abas existem e trocam de tela', (tester) async {
      final repository = InMemoryCampaignRepository();
      final container = ProviderContainer(
        overrides: [campaignRepositoryProvider.overrideWithValue(repository)],
      );
      addTearDown(container.dispose);

      await container.read(campaignControllerProvider.notifier).startNew(
            seedLabel: 'ui-teste',
            characterName: 'Kaia',
          );

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: MaterialApp(theme: CyberTheme.build(), home: const GameShell()),
        ),
      );
      await pumpFrames(tester);

      for (final label in [
        'Mundo',
        'Quests',
        'Terreno',
        'Cidade',
        'Mercado',
        'Ficha',
        'Poder',
      ]) {
        expect(find.text(label), findsWidgets, reason: 'aba $label');
      }

      // O HUD mostra as barras vitais e o botão de fechar o dia.
      expect(find.text('FOME'), findsOneWidget);
      expect(find.text('SEDE'), findsOneWidget);
      expect(find.text('RESET'), findsOneWidget);
    });

    testWidgets('a aba de missões lista a campanha principal', (tester) async {
      final container = ProviderContainer(
        overrides: [
          campaignRepositoryProvider
              .overrideWithValue(InMemoryCampaignRepository()),
        ],
      );
      addTearDown(container.dispose);

      await container.read(campaignControllerProvider.notifier).startNew(
            seedLabel: 'ui-quests',
            characterName: 'Kaia',
          );

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: MaterialApp(theme: CyberTheme.build(), home: const GameShell()),
        ),
      );
      await pumpFrames(tester);

      await tester.tap(find.text('Quests'));
      await pumpFrames(tester);

      expect(find.text('CAMPANHA PRINCIPAL'), findsOneWidget);
      expect(find.text('Primeiro Gole'), findsWidgets);
    });

    testWidgets('a aba do terreno mostra o vilarejo e o catálogo',
        (tester) async {
      final container = ProviderContainer(
        overrides: [
          campaignRepositoryProvider
              .overrideWithValue(InMemoryCampaignRepository()),
        ],
      );
      addTearDown(container.dispose);

      await container.read(campaignControllerProvider.notifier).startNew(
            seedLabel: 'ui-terreno',
            characterName: 'Kaia',
          );

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: MaterialApp(theme: CyberTheme.build(), home: const GameShell()),
        ),
      );
      await pumpFrames(tester);

      await tester.tap(find.text('Terreno'));
      await pumpFrames(tester);

      expect(find.text('PLANTA DO TERRENO'), findsOneWidget);

      // O catálogo fica abaixo da dobra; rola até ele.
      await tester.scrollUntilVisible(
        find.textContaining('tipos disponíveis'),
        400,
        scrollable: find.byType(Scrollable).first,
        maxScrolls: 30,
      );
      await pumpFrames(tester);
      expect(find.textContaining('tipos disponíveis'), findsOneWidget);
    });
  });

  group('Repositório em memória', () {
    test('salva, lista, carrega e apaga', () async {
      final repository = InMemoryCampaignRepository();
      final campaign = Campaign.create(
        id: 'c1',
        seedLabel: 'repo',
        characterName: 'Kaia',
      );

      await repository.saveCampaign(campaign);
      expect(await repository.listCampaigns(), hasLength(1));

      final loaded = await repository.loadCampaign('c1');
      expect(loaded?.character.name, 'Kaia');

      await repository.deleteCampaign('c1');
      expect(await repository.listCampaigns(), isEmpty);
    });
  });
}
