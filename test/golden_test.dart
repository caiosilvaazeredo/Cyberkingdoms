import 'package:cyberkingdoms/core/theme.dart';
import 'package:cyberkingdoms/data/campaign_repository.dart';
import 'package:cyberkingdoms/domain/building/building_type.dart';
import 'package:cyberkingdoms/domain/economy/item.dart';
import 'package:cyberkingdoms/state/providers.dart';
import 'package:cyberkingdoms/ui/screens/campaign_select_screen.dart';
import 'package:cyberkingdoms/ui/screens/game_shell.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/harness.dart';

/// Capturas de tela das telas do jogo.
///
/// Substituem a automação de navegador, que não funciona aqui: o Flutter web
/// com CanvasKit desenha tudo num `<canvas>`, então nenhum elemento existe no
/// DOM para clicar ou fotografar. O widget test renderiza a mesma árvore num
/// Skia real e grava PNG — sem browser, sem coordenada chutada, e roda no CI.
///
/// Gerar/atualizar as imagens:
/// ```sh
/// flutter test test/golden_test.dart --update-goldens
/// ```
/// As imagens ficam em `test/goldens/` e entram no controle de versão: assim
/// uma mudança visual aparece no diff do PR em vez de passar despercebida.
void main() {
  group('Capturas', () {
    testWidgets('menu inicial', (tester) async {
      await tester.setScreen(phone);
      await tester.pumpWidget(menuApp(InMemoryCampaignRepository()));
      await tester.pumpAndSettle();

      await expectLater(
        find.byType(MaterialApp),
        matchesGoldenFile('goldens/01-menu.png'),
      );
    });

    testWidgets('folha de nova campanha', (tester) async {
      await tester.setScreen(phone);
      await tester.pumpWidget(menuApp(InMemoryCampaignRepository()));
      await tester.pumpAndSettle();

      await tester.tap(find.text('NOVA CAMPANHA'));
      await tester.pumpAndSettle();

      // Nome e seed vêm sorteados a cada abertura. Fixar os dois é o que torna
      // esta captura comparável entre execuções — sem isso o golden acusa
      // diferença de pixels toda vez, por texto que mudou legitimamente.
      final fields = find.byType(TextField);
      await tester.enterText(fields.at(0), 'Kaia Vex');
      await tester.enterText(fields.at(1), 'aurora-krom-191');

      // Tirar o foco antes de fotografar. O cursor do campo pisca: com ele
      // ativo a captura sai com ou sem o traço conforme o instante em que o
      // teste roda, e o golden falha de forma intermitente — foi assim que
      // este teste reprovou uma vez na suíte cheia e passou sozinho.
      FocusManager.instance.primaryFocus?.unfocus();
      await tester.pumpAndSettle();

      await expectLater(
        find.byType(MaterialApp),
        matchesGoldenFile('goldens/02-nova-campanha.png'),
      );
    });

    testWidgets('campanha — missões', (tester) async {
      final harness = await GameHarness.start(tester, tab: 'Quests');
      await expectLater(
        find.byType(MaterialApp),
        matchesGoldenFile('goldens/03-missoes.png'),
      );
      harness.dispose();
    });

    testWidgets('terreno', (tester) async {
      final harness = await GameHarness.start(tester, tab: 'Terreno');
      await expectLater(
        find.byType(MaterialApp),
        matchesGoldenFile('goldens/04-terreno.png'),
      );
      harness.dispose();
    });

    testWidgets('terreno com construções', (tester) async {
      final harness = await GameHarness.start(
        tester,
        tab: 'Terreno',
        setup: (campaign) {
          campaign.character.credits = 500000;
          for (final id in ItemId.values) {
            campaign.character.inventory.add(id, 400);
          }
          final placements = <(BuildingId, int, int)>[
            (BuildingId.shack, 0, 0),
            (BuildingId.scrapYard, 2, 0),
            (BuildingId.hydroponicBay, 5, 0),
            (BuildingId.warehouse, 0, 2),
            (BuildingId.watchtower, 4, 2),
            (BuildingId.perimeterWall, 5, 2),
            (BuildingId.shopFront, 6, 2),
            (BuildingId.plaza, 0, 4),
          ];
          for (final (type, x, y) in placements) {
            campaign.plot.build(
              type: type,
              x: x,
              y: y,
              inventory: campaign.character.inventory,
              credits: campaign.character.credits,
              level: campaign.character.level,
              day: 1,
            );
          }
          // Conclui as obras para o terreno aparecer povoado.
          for (final building in campaign.plot.buildings) {
            building.daysRemaining = 0;
          }
        },
      );
      await expectLater(
        find.byType(MaterialApp),
        matchesGoldenFile('goldens/05-terreno-construido.png'),
      );
      harness.dispose();
    });

    testWidgets('cidade', (tester) async {
      final harness = await GameHarness.start(tester, tab: 'Cidade');
      await expectLater(
        find.byType(MaterialApp),
        matchesGoldenFile('goldens/06-cidade.png'),
      );
      harness.dispose();
    });

    testWidgets('mercado', (tester) async {
      final harness = await GameHarness.start(tester, tab: 'Mercado');
      await expectLater(
        find.byType(MaterialApp),
        matchesGoldenFile('goldens/07-mercado.png'),
      );
      harness.dispose();
    });

    testWidgets('ficha do personagem', (tester) async {
      final harness = await GameHarness.start(
        tester,
        tab: 'Ficha',
        setup: (campaign) {
          campaign.character.inventory.add(ItemId.water, 12);
          campaign.character.inventory.add(ItemId.scrap, 40);
          campaign.character.inventory.add(ItemId.rifle, 1);
          campaign.character.inventory.add(ItemId.hydrationPack, 1);
          campaign.character.inventory.equip(ItemId.rifle);
          campaign.character.inventory.equip(ItemId.hydrationPack);
        },
      );
      await expectLater(
        find.byType(MaterialApp),
        matchesGoldenFile('goldens/08-ficha.png'),
      );
      harness.dispose();
    });

    testWidgets('política', (tester) async {
      final harness = await GameHarness.start(tester, tab: 'Poder');
      await expectLater(
        find.byType(MaterialApp),
        matchesGoldenFile('goldens/09-politica.png'),
      );
      harness.dispose();
    });

    testWidgets('relatório do reset diário', (tester) async {
      final harness = await GameHarness.start(tester);
      await tester.tap(find.text('RESET'));
      await harness.pumpFrames(tester, frames: 20);

      await expectLater(
        find.byType(MaterialApp),
        matchesGoldenFile('goldens/10-reset.png'),
      );
      harness.dispose();
    });
  });
}

/// App só com a tela de menu, para as capturas que não precisam do jogo.
Widget menuApp(CampaignRepository repository) => ProviderScope(
      overrides: [campaignRepositoryProvider.overrideWithValue(repository)],
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        // Sem o tema, o texto cai na fonte padrão do ambiente de teste e a
        // captura sai com retângulos no lugar das letras.
        theme: CyberTheme.build(),
        home: const CampaignSelectScreen(),
      ),
    );

/// Reexportado para os testes que só precisam da casca.
typedef Shell = GameShell;
