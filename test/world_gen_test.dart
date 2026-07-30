import 'package:cyberkingdoms/core/seed/deterministic_random.dart';
import 'package:cyberkingdoms/domain/world/biome.dart';
import 'package:cyberkingdoms/domain/world/coords.dart';
import 'package:cyberkingdoms/domain/world/settlement.dart';
import 'package:cyberkingdoms/domain/world/world.dart';
import 'package:cyberkingdoms/domain/world/world_gen.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('Determinismo', () {
    test('a mesma seed gera exatamente o mesmo terreno', () {
      final a = WorldGenerator(seed: 12345);
      final b = WorldGenerator(seed: 12345);

      for (var i = 0; i < 500; i++) {
        final x = i * 37 - 4000;
        final y = i * -19 + 2500;
        expect(a.biomeAt(x, y), b.biomeAt(x, y), reason: 'bioma em ($x,$y)');
        expect(a.elevationAt(x, y), b.elevationAt(x, y),
            reason: 'elevação em ($x,$y)');
      }
    });

    test('seeds diferentes geram mundos diferentes', () {
      final a = WorldGenerator(seed: 1);
      final b = WorldGenerator(seed: 2);

      var differences = 0;
      var total = 0;
      for (var y = -600; y <= 600; y += 40) {
        for (var x = -600; x <= 600; x += 40) {
          total++;
          if (a.biomeAt(x, y) != b.biomeAt(x, y)) differences++;
        }
      }

      // Coincidências são esperadas: com 10 biomas e distribuição desigual,
      // dois mapas independentes concordam em parte dos tiles por acaso. O que
      // não pode acontecer é a seed ser ignorada, o que apareceria como
      // divergência perto de zero.
      expect(differences / total, greaterThan(0.5));
    });

    test('o layout é reproduzível a partir da seed', () {
      final a = WorldGenerator(seed: 999).generateLayout();
      final b = WorldGenerator(seed: 999).generateLayout();

      expect(a.settlements.length, b.settlements.length);
      for (var i = 0; i < a.settlements.length; i++) {
        expect(a.settlements[i].name, b.settlements[i].name);
        expect(a.settlements[i].center, b.settlements[i].center);
        expect(a.settlements[i].vocation, b.settlements[i].vocation);
      }
    });

    test('DeterministicRandom produz a mesma sequência para a mesma seed', () {
      final a = DeterministicRandom(42);
      final b = DeterministicRandom(42);
      for (var i = 0; i < 200; i++) {
        expect(a.nextInt32(), b.nextInt32());
      }
    });

    test('hashLabel é estável entre execuções', () {
      expect(
        DeterministicRandom.hashLabel('neon-tokyo'),
        DeterministicRandom.hashLabel('neon-tokyo'),
      );
      expect(
        DeterministicRandom.hashLabel('neon-tokyo'),
        isNot(DeterministicRandom.hashLabel('neon-tóquio')),
      );
    });
  });

  group('Macroestrutura do GDD', () {
    late WorldLayout layout;

    setUp(() {
      layout = WorldGenerator(seed: 20260730).generateLayout();
    });

    test('gera exatamente 5 capitais e 15 satélites', () {
      expect(layout.capitals.length, 5);
      expect(layout.satellites.length, 15);
    });

    test('as 5 capitais têm vocações econômicas distintas', () {
      final vocations = layout.capitals.map((c) => c.vocation).toSet();
      expect(vocations.length, 5,
          reason: 'nenhuma capital pode repetir vocação');
    });

    test('capitais não nascem coladas umas nas outras', () {
      for (var i = 0; i < layout.capitals.length; i++) {
        for (var j = i + 1; j < layout.capitals.length; j++) {
          final distance =
              layout.capitals[i].center.euclideanTo(layout.capitals[j].center);
          expect(distance, greaterThan(200),
              reason: 'logística exige capitais distantes');
        }
      }
    });

    test('todo satélite orbita uma capital existente', () {
      final capitalIds = layout.capitals.map((c) => c.id).toSet();
      for (final satellite in layout.satellites) {
        expect(satellite.capitalId, isNotNull);
        expect(capitalIds, contains(satellite.capitalId));
      }
    });

    test('nenhuma cidade nasce em bioma inóspito', () {
      final generator = WorldGenerator(seed: 20260730);
      for (final settlement in layout.settlements) {
        final biome =
            generator.biomeAt(settlement.center.x, settlement.center.y);
        expect(biome.supportsSettlement, isTrue,
            reason: '${settlement.name} caiu em ${biome.label}');
      }
    });

    test('toda cidade tem pelo menos uma estrada', () {
      for (final settlement in layout.settlements) {
        expect(layout.roadsFrom(settlement.id), isNotEmpty,
            reason: '${settlement.name} ficou isolada');
      }
    });

    test('estradas ligam pontas reais e têm caminho traçado', () {
      final ids = layout.settlements.map((s) => s.id).toSet();
      for (final road in layout.roads) {
        expect(ids, contains(road.fromId));
        expect(ids, contains(road.toId));
        expect(road.path, isNotEmpty);
        expect(road.travelDays, greaterThanOrEqualTo(1));
        expect(road.danger, inInclusiveRange(0.0, 1.0));
      }
    });

    test('a chave da estrada é simétrica', () {
      expect(Road.makeKey('a', 'b'), Road.makeKey('b', 'a'));
    });
  });

  group('Distribuição do terreno', () {
    /// Amostra uma grade grande e devolve a fração de cada bioma.
    Map<Biome, double> biomeShares(int seed) {
      final generator = WorldGenerator(seed: seed);
      final counts = <Biome, int>{};
      var total = 0;
      for (var y = -900; y <= 900; y += 10) {
        for (var x = -900; x <= 900; x += 10) {
          total++;
          final biome = generator.biomeAt(x, y);
          counts[biome] = (counts[biome] ?? 0) + 1;
        }
      }
      return {
        for (final entry in counts.entries) entry.key: entry.value / total,
      };
    }

    test('todo bioma natural aparece no mapa, em qualquer seed', () {
      // Regressão: a primeira versão do gerador comparava limiares contra fBm
      // cru (concentrado perto da média), o que cobria 80% do mapa com um único
      // bioma e deixava petróleo e terras raras praticamente inexistentes —
      // inviabilizando a cadeia produtiva do GDD.
      //
      // Núcleo Neon fica de fora: ele não é sorteado pelo relevo, é aplicado
      // sobre os tiles de dentro das cidades.
      final natural =
          Biome.values.where((b) => b != Biome.neonCore).toList();

      for (final seed in [1, 777, 20260730]) {
        final shares = biomeShares(seed);
        for (final biome in natural) {
          expect(
            shares[biome] ?? 0,
            greaterThan(0.005),
            reason: '${biome.label} quase sumiu na seed $seed',
          );
        }
      }
    });

    test('Núcleo Neon existe, mas só dentro das cidades', () {
      final world = World.fromSeed(20260730);
      expect(world.generator.biomeAt(90000, 90000), isNot(Biome.neonCore));

      final capital = world.layout.capitals.first;
      expect(world.tileAt(capital.center.x, capital.center.y).biome,
          Biome.neonCore);
    });

    test('nenhum bioma domina o mapa', () {
      for (final seed in [1, 777, 20260730]) {
        final shares = biomeShares(seed);
        for (final entry in shares.entries) {
          expect(
            entry.value,
            lessThan(0.35),
            reason: '${entry.key.label} domina a seed $seed',
          );
        }
      }
    });

    test('os recursos de Camada 1 têm território jogável', () {
      // Sem petróleo, sucata e terras raras em quantidade, a economia de três
      // camadas não fecha.
      final shares = biomeShares(20260730);
      expect(shares[Biome.oilFields] ?? 0, greaterThan(0.03));
      expect(shares[Biome.scrapyard] ?? 0, greaterThan(0.03));
      expect(shares[Biome.rareEarthMine] ?? 0, greaterThan(0.02));
    });

    test('a elevação usa toda a faixa de degraus', () {
      final generator = WorldGenerator(seed: 20260730);
      final seen = <int>{};
      for (var y = -900; y <= 900; y += 10) {
        for (var x = -900; x <= 900; x += 10) {
          seen.add(generator.elevationAt(x, y));
        }
      }
      for (var step = -4; step <= 4; step++) {
        expect(seen, contains(step), reason: 'degrau $step nunca aparece');
      }
    });

    test('a elevação nunca sai da faixa declarada', () {
      final generator = WorldGenerator(seed: 42);
      for (var i = 0; i < 3000; i++) {
        final e = generator.elevationAt(i * 13 - 2000, i * -7 + 1500);
        expect(e, inInclusiveRange(-4, 4));
      }
    });
  });

  group('Chunks e tiles', () {
    test('a chunk devolve chunkSize^2 tiles', () {
      final world = World.fromSeed(7);
      final chunk = world.chunkAt(const ChunkCoord(0, 0));
      final tiles = chunk.tilesInDepthOrder.toList();
      expect(tiles.length, WorldMetrics.chunkSize * WorldMetrics.chunkSize);
    });

    test('a ordem de iteração é de trás para frente na isométrica', () {
      final world = World.fromSeed(7);
      final chunk = world.chunkAt(const ChunkCoord(0, 0));
      var lastDepth = -1 << 30;
      for (final (coord, _) in chunk.tilesInDepthOrder) {
        final depth = coord.x + coord.y;
        expect(depth, greaterThanOrEqualTo(lastDepth));
        lastDepth = depth;
      }
    });

    test('o cache de chunks respeita o teto de memória', () {
      final world = World.fromSeed(7);
      for (var i = 0; i < 400; i++) {
        world.chunkAt(ChunkCoord(i, i));
      }
      expect(world.cachedChunkCount, lessThanOrEqualTo(256));
    });

    test('tileAt e chunkAt concordam', () {
      final world = World.fromSeed(7);
      const coord = TileCoord(37, -22);
      final direct = world.tileAt(coord.x, coord.y);
      final viaChunk =
          world.chunkAt(coord.chunk).tileAt(coord.localX, coord.localY);
      expect(direct.biome, viaChunk.biome);
      expect(direct.elevation, viaChunk.elevation);
    });

    test('coordenadas negativas caem na chunk correta', () {
      const coord = TileCoord(-1, -1);
      expect(coord.chunk, const ChunkCoord(-1, -1));
      expect(coord.localX, WorldMetrics.chunkSize - 1);
      expect(coord.localY, WorldMetrics.chunkSize - 1);
    });

    test('tiles urbanos ficam marcados com o id da cidade', () {
      final world = World.fromSeed(20260730);
      final capital = world.layout.capitals.first;
      final tile = world.tileAt(capital.center.x, capital.center.y);
      expect(tile.settlementId, capital.id);
      expect(tile.isUrban, isTrue);
    });

    test('água morta é intransponível', () {
      expect(Biome.deadWater.isWalkable, isFalse);
      expect(Biome.deadWater.supportsSettlement, isFalse);
    });
  });

  group('Chão de mato', () {
    // O mundo não tem pavimento em lugar nenhum: nem estrada entre cidades,
    // nem rua dentro delas. Estes testes existem porque a regra é fácil de
    // reintroduzir sem querer — basta um `case` novo no gerador devolvendo uma
    // feature de asfalto, e nada mais no projeto reclamaria.
    test('nenhum tile do mundo é pavimentado', () {
      final world = World.fromSeed(DeterministicRandom.hashLabel('sem-asfalto'));

      // Amostra grossa cobrindo cidade, entorno e mata aberta.
      final paved = <String>[];
      for (final settlement in world.layout.settlements.take(4)) {
        for (var dy = -40; dy <= 40; dy += 2) {
          for (var dx = -40; dx <= 40; dx += 2) {
            final tile = world.tileAt(
              settlement.center.x + dx,
              settlement.center.y + dy,
            );
            if (_pavedNames.contains(tile.feature.name)) {
              paved.add('${settlement.id} ($dx,$dy): ${tile.feature.name}');
            }
          }
        }
      }

      expect(paved, isEmpty, reason: 'pavimento no terreno: ${paved.take(5)}');
    });

    test('as rotas entre cidades continuam existindo fora do terreno', () {
      // Tirar o asfalto do chão não pode ter tirado a viagem do jogo: a rota é
      // uma aresta do grafo de assentamentos, e é ela que a tela de viagem e a
      // emboscada da estrada usam.
      final world = World.fromSeed(DeterministicRandom.hashLabel('rotas'));

      expect(world.layout.roads, isNotEmpty);
      for (final settlement in world.layout.settlements) {
        expect(world.layout.roadsFrom(settlement.id), isNotEmpty,
            reason: '${settlement.name} ficou sem rota');
      }

      // E um tile em cima da rota é mato como qualquer outro.
      final road = world.layout.roads.first;
      final onRoute = road.path[road.path.length ~/ 2];
      final tile = world.tileAt(onRoute.x, onRoute.y);
      expect(_pavedNames, isNot(contains(tile.feature.name)));
    });

    test('a viagem não tem mais desconto de estrada', () {
      // O bônus de 0,5x saiu junto com o asfalto. Se voltar, o custo de um
      // tile qualquer cairia pela metade sem nada na tela justificando.
      final world = World.fromSeed(DeterministicRandom.hashLabel('custo'));
      final road = world.layout.roads.first;
      final onRoute = road.path[road.path.length ~/ 2];

      final tile = world.tileAt(onRoute.x, onRoute.y);
      if (!tile.isWalkable) return;

      // O custo tem de estar na faixa do bioma, não abaixo dela.
      expect(tile.travelCost, greaterThanOrEqualTo(tile.biome.travelCost));
    });

  });

  group('Projeção isométrica', () {
    test('tileToWorld e worldToTile são inversas', () {
      for (final (tx, ty) in [(0.0, 0.0), (5.0, 3.0), (-12.0, 8.0)]) {
        final (wx, wy) = IsoProjection.tileToWorld(tx, ty);
        final (backX, backY) = IsoProjection.worldToTile(wx, wy);
        expect(backX, closeTo(tx, 0.0001));
        expect(backY, closeTo(ty, 0.0001));
      }
    });

    test('elevação desloca o sprite para cima', () {
      final (_, flat) = IsoProjection.tileToWorld(0, 0);
      final (_, raised) = IsoProjection.tileToWorld(0, 0, elevation: 3);
      expect(raised, lessThan(flat));
    });
  });
}

/// Nomes de features de pavimento. Escritos como texto de propósito: se
/// alguém recriar `TileFeature.road`, o teste continua compilando e falha —
/// que é o comportamento útil. Referenciar o enum faria o teste sumir junto
/// com a regra que ele protege.
const _pavedNames = {'road', 'roadJunction', 'pavement', 'highway', 'asphalt'};
