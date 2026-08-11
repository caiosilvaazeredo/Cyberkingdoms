import 'dart:math' as math;

import '../../core/seed/deterministic_random.dart';
import '../../core/seed/noise.dart';
import '../economy/item.dart';
import 'biome.dart';
import 'coords.dart';
import 'settlement.dart';
import 'tile.dart';

/// Gera o mundo de uma campanha a partir de uma única seed.
///
/// O modelo é o do Minecraft: o terreno **não é armazenado**, ele é uma função
/// pura `(seed, x, y) -> WorldTile`. Isso significa que um mundo infinito custa
/// zero bytes em disco e que dois dispositivos com a mesma seed enxergam
/// exatamente o mesmo mapa — condição necessária para o MMO validar no servidor
/// o que o cliente afirma ter feito.
///
/// A macroestrutura (5 capitais, 15 satélites, estradas) é a exceção: ela é
/// calculada uma vez no início da campanha porque depende de uma visão global
/// do mapa, e cabe em poucos kilobytes.
class WorldGenerator {
  WorldGenerator({required this.seed})
      : _elevationNoise = GradientNoise(DeterministicRandom.mix(seed, 0x31)),
        _moistureNoise = GradientNoise(DeterministicRandom.mix(seed, 0x37)),
        _industryNoise = GradientNoise(DeterministicRandom.mix(seed, 0x3D)),
        _contaminationNoise = GradientNoise(DeterministicRandom.mix(seed, 0x43)),
        _detailNoise = GradientNoise(DeterministicRandom.mix(seed, 0x49));

  final int seed;

  final GradientNoise _elevationNoise;
  final GradientNoise _moistureNoise;
  final GradientNoise _industryNoise;
  final GradientNoise _contaminationNoise;
  final GradientNoise _detailNoise;

  // Escalas de amostragem. Números menores = manchas maiores no mapa.
  static const double _elevationScale = 0.0075;
  static const double _moistureScale = 0.0052;
  static const double _industryScale = 0.0036;
  static const double _contaminationScale = 0.0090;
  static const double _detailScale = 0.0700;

  // ===========================================================================
  // Terreno
  // ===========================================================================

  /// Altura contínua em `[-1, 1]`, distribuída de forma previsível.
  ///
  /// Usa [GradientNoise.fbmUniform] pelo mesmo motivo dos biomas: o fBm cru
  /// concentra tudo perto da média, e a primeira versão deste método (que
  /// misturava fBm cru com um termo de cume) produzia 78% do mapa num único
  /// degrau de altura e nenhuma água. Com o campo uniformizado, os limiares
  /// abaixo são percentis de verdade.
  double _rawElevation(int x, int y) {
    final fx = x * _elevationScale;
    final fy = y * _elevationScale;

    // Domain warping: perturbar as coordenadas antes de amostrar quebra o
    // aspecto de "grade" do ruído e produz costas de terreno mais naturais.
    final warpX = _detailNoise.sample(fx * 0.5, fy * 0.5) * 1.8;
    final warpY = _detailNoise.sample(fx * 0.5 + 41.7, fy * 0.5 + 19.3) * 1.8;

    // Uniforme em [0,1] -> centrado em [-1,1].
    final continental = _elevationNoise.fbmUniform(
          fx + warpX,
          fy + warpY,
          octaves: 5,
          persistence: 0.52,
          lacunarity: 2.05,
        ) *
        2 -
        1;

    // Expoente > 1 puxa o relevo para o meio, deixando planícies dominantes e
    // reservando picos e bacias para os extremos — sem matar as pontas, que é
    // onde ficam montanha e água.
    final shaped =
        continental.sign * math.pow(continental.abs(), 1.35).toDouble();
    return shaped.clamp(-1.0, 1.0);
  }

  /// Fração do mapa coberta por água morta. Água é intransponível, então ela é
  /// um obstáculo logístico de verdade: pouca demais não afeta nada, muita
  /// fragmenta o mapa e isola cidades.
  static const double _waterLevel = -0.72;

  int elevationAt(int x, int y) {
    final raw = _rawElevation(x, y);
    // 9 degraus de altura. Poucos degraus mantêm a leitura isométrica limpa no
    // celular; muitos viram serrilhado visual.
    return (raw * 4).round().clamp(-4, 4);
  }

  /// Classifica o bioma de um tile.
  ///
  /// Os campos de controle (umidade, industrialização) passam por
  /// [GradientNoise.fbmUniform], então cada limiar abaixo é um **percentil**: o
  /// mapa tem, por construção, aproximadamente a participação anotada em cada
  /// bioma — em qualquer seed. Isso importa porque a economia do GDD depende de
  /// petróleo, sucata e terras raras existirem em quantidade jogável e mal
  /// distribuída; deixar a mistura ao acaso do ruído já produziu um mapa com
  /// 80% de um único bioma e petróleo praticamente inexistente.
  Biome biomeAt(int x, int y) {
    final elevation = _rawElevation(x, y);
    if (elevation < _waterLevel) return Biome.deadWater;

    final fx = x.toDouble();
    final fy = y.toDouble();

    final moisture = _moistureNoise.fbmUniform(
      fx * _moistureScale,
      fy * _moistureScale,
      octaves: 3,
    );
    final industry = _industryNoise.fbmUniform(
      fx * _industryScale,
      fy * _industryScale,
      octaves: 3,
    );
    final contamination = _contaminationNoise.cellular(
      fx,
      fy,
      frequency: _contaminationScale,
    );

    // Ruínas (~4%): núcleos das células de contaminação, só onde já houve
    // ocupação industrial.
    if (contamination < 0.11 && industry > 0.40) return Biome.ruins;

    // Cinturão industrial: os 22% mais industrializados do mapa. Aqui ficam os
    // três recursos de Camada 1 que movem a economia.
    if (industry > 0.78) {
      if (moisture < 0.40) return Biome.oilFields; // ~7%
      if (elevation > 0.20) return Biome.rareEarthMine; // ~5%
      return Biome.scrapyard; // ~10%
    }

    // Cinturão verde: os 30% mais úmidos.
    if (moisture > 0.70) {
      // Pântano ocupa as terras baixas úmidas, logo acima da linha d'água.
      if (elevation < -0.18) return Biome.toxicMarsh; // ~5%
      if (industry < 0.40) return Biome.reclaimedForest; // ~12%
      return Biome.bioFarm; // ~8%
    }

    // Faixa agrícola intermediária.
    if (moisture > 0.52 && industry < 0.55) return Biome.bioFarm;

    // Os 25% mais secos viram deserto de concreto.
    if (moisture < 0.25) return Biome.wasteland;

    return Biome.sprawl;
  }

  // ===========================================================================
  // Macroestrutura: capitais, satélites, estradas
  // ===========================================================================

  /// Planta as 5 capitais e os 15 satélites do GDD e liga tudo por estradas.
  ///
  /// As capitais são distribuídas em anel com jitter para que nenhuma campanha
  /// tenha duas capitais coladas — o que arruinaria a logística que o jogo
  /// depende. Cada capital recebe uma vocação distinta.
  WorldLayout generateLayout() {
    final rng = DeterministicRandom(seed).fork('layout');

    final vocations = List<CityVocation>.from(CityVocation.values);
    rng.shuffle(vocations);

    final capitals = <Settlement>[];
    const capitalCount = 5;
    final ringRadius = WorldMetrics.settledRadius * 0.62;

    for (var i = 0; i < capitalCount; i++) {
      final baseAngle = (i / capitalCount) * 2 * math.pi;
      // Jitter limitado a +-25% do setor evita colisão entre vizinhas.
      final angle = baseAngle + rng.rangeDouble(-0.25, 0.25) * (2 * math.pi / capitalCount);
      final distance = ringRadius * rng.rangeDouble(0.78, 1.18);

      final center = _findHospitableTile(
        TileCoord(
          (math.cos(angle) * distance).round(),
          (math.sin(angle) * distance).round(),
        ),
        rng,
      );

      capitals.add(Settlement(
        id: 'cap_$i',
        name: _cityName(rng, isCapital: true),
        kind: SettlementKind.capital,
        center: center,
        vocation: vocations[i % vocations.length],
        radius: rng.range(26, 34),
        population: rng.range(180000, 640000),
      ));
    }

    // 15 satélites: 3 por capital, orbitando a uma distância que exige viagem
    // mas não inviabiliza a rota diária.
    final satellites = <Settlement>[];
    var satelliteIndex = 0;
    for (final capital in capitals) {
      for (var s = 0; s < 3; s++) {
        final angle = rng.rangeDouble(0, 2 * math.pi);
        final distance = rng.rangeDouble(120, 260);
        final center = _findHospitableTile(
          TileCoord(
            capital.center.x + (math.cos(angle) * distance).round(),
            capital.center.y + (math.sin(angle) * distance).round(),
          ),
          rng,
        );

        satellites.add(Settlement(
          id: 'sat_$satelliteIndex',
          name: _cityName(rng, isCapital: false),
          kind: SettlementKind.satellite,
          center: center,
          // Satélites herdam a vocação da capital, com desvio ocasional que
          // cria oportunidades de arbitragem local.
          vocation: rng.chance(0.30) ? rng.pick(CityVocation.values) : capital.vocation,
          radius: rng.range(10, 16),
          population: rng.range(8000, 45000),
          capitalId: capital.id,
        ));
        satelliteIndex++;
      }
    }

    final all = [...capitals, ...satellites];
    final roads = _generateRoads(capitals, satellites, rng);

    return WorldLayout(
      seed: seed,
      settlements: all,
      roads: roads,
    );
  }

  /// Empurra um ponto candidato até cair num bioma que aceita cidade. Sem isso,
  /// uma capital poderia nascer no meio da água morta.
  TileCoord _findHospitableTile(TileCoord candidate, DeterministicRandom rng) {
    var current = candidate;
    for (var attempt = 0; attempt < 64; attempt++) {
      if (biomeAt(current.x, current.y).supportsSettlement) return current;
      // Espiral crescente em vez de salto aleatório: mantém a cidade perto do
      // ponto pretendido, preservando a distribuição em anel.
      final step = 8 + attempt * 3;
      final angle = rng.rangeDouble(0, 2 * math.pi);
      current = TileCoord(
        candidate.x + (math.cos(angle) * step).round(),
        candidate.y + (math.sin(angle) * step).round(),
      );
    }
    return current;
  }

  /// Malha viária: cada satélite liga à sua capital, e as capitais formam um
  /// anel entre si. Toda estrada é zona PvP.
  List<Road> _generateRoads(
    List<Settlement> capitals,
    List<Settlement> satellites,
    DeterministicRandom rng,
  ) {
    final roads = <String, Road>{};

    void connect(Settlement a, Settlement b, double dangerBase) {
      final key = Road.makeKey(a.id, b.id);
      if (roads.containsKey(key)) return;
      final path = _tracePath(a.center, b.center);
      final tiles = path.length;
      // ~90 tiles por dia de viagem: torna as rotas capital-capital caras o
      // suficiente para justificar escolta e contrabando.
      final days = math.max(1, (tiles / 90).round());
      roads[key] = Road(
        fromId: a.id,
        toId: b.id,
        path: path,
        travelDays: days,
        danger: (dangerBase + rng.rangeDouble(-0.05, 0.10)).clamp(0.05, 0.85),
      );
    }

    // Anel entre capitais, ordenado por ângulo para não cruzar o mapa inteiro.
    final ordered = List<Settlement>.from(capitals)
      ..sort((a, b) => math.atan2(a.center.y.toDouble(), a.center.x.toDouble())
          .compareTo(math.atan2(b.center.y.toDouble(), b.center.x.toDouble())));
    for (var i = 0; i < ordered.length; i++) {
      connect(ordered[i], ordered[(i + 1) % ordered.length], 0.35);
    }

    // Uma diagonal atravessando o anel dá uma rota curta e perigosa —
    // exatamente o tipo de decisão de risco que o GDD quer.
    if (ordered.length >= 4) {
      connect(ordered[0], ordered[2], 0.55);
    }

    for (final satellite in satellites) {
      final capital = capitals.firstWhere((c) => c.id == satellite.capitalId);
      connect(satellite, capital, 0.18);
    }

    return roads.values.toList(growable: false);
  }

  /// Traça o caminho de uma estrada, desviando de água quando dá. Não é A* —
  /// estradas devem parecer construídas, não otimizadas ao milímetro.
  ///
  /// ## Por que o passo é recalculado a cada tile
  ///
  /// A versão anterior era um Bresenham clássico com um desvio grudado por
  /// cima: quando o próximo tile era água, ela empurrava a posição para o lado
  /// **sem** corrigir o termo de erro. A partir daí o erro descrevia uma reta
  /// que não passava mais pela posição real, e a linha nunca reencontrava o
  /// destino — ela vagava até bater no teto de 20 mil passos.
  ///
  /// Isso não era um detalhe de traçado. `travelDays` sai do comprimento do
  /// caminho, então toda estrada que cruzava um lago virava uma viagem de 222
  /// dias — mais do que um personagem sobrevive sem comer. Metade do mapa era
  /// inalcançável por um defeito de geometria.
  ///
  /// Recalcular o passo a partir da posição atual elimina o estado que podia
  /// dessincronizar: cada passo aceito reduz a distância restante em pelo menos
  /// um, então o caminho **sempre** termina, com ou sem desvio.
  List<TileCoord> _tracePath(TileCoord from, TileCoord to) {
    final path = <TileCoord>[];
    var x = from.x;
    var y = from.y;

    // Teto: o caminho é monotônico, então a soma das distâncias é o pior caso.
    // Continua existindo como rede de segurança, mas não é mais alcançável.
    final maxSteps = (to.x - x).abs() + (to.y - y).abs() + 4;

    for (var guard = 0; guard <= maxSteps; guard++) {
      path.add(TileCoord(x, y));
      if (x == to.x && y == to.y) break;

      final dxr = to.x - x;
      final dyr = to.y - y;
      final stepX = dxr.sign;
      final stepY = dyr.sign;

      // Enquanto um eixo domina o outro em mais que o dobro, anda reto nele; no
      // meio-termo, anda na diagonal. É o que dá o canto chanfrado de estrada
      // de verdade em vez do degrau de escada.
      final candidatos = <List<int>>[];
      if (dxr.abs() > dyr.abs() * 2) {
        candidatos.add([stepX, 0]);
        candidatos.add([stepX, stepY]);
        candidatos.add([0, stepY]);
      } else if (dyr.abs() > dxr.abs() * 2) {
        candidatos.add([0, stepY]);
        candidatos.add([stepX, stepY]);
        candidatos.add([stepX, 0]);
      } else {
        candidatos.add([stepX, stepY]);
        candidatos.add([stepX, 0]);
        candidatos.add([0, stepY]);
      }

      var escolhido = candidatos.first;
      for (final c in candidatos) {
        if (c[0] == 0 && c[1] == 0) continue;
        if (biomeAt(x + c[0], y + c[1]).isWalkable) {
          escolhido = c;
          break;
        }
      }

      x += escolhido[0];
      y += escolhido[1];
    }
    return path;
  }

  // ===========================================================================
  // Nomes
  // ===========================================================================

  static const _cityPrefix = [
    'Alto', 'Novo', 'Porto', 'Vale', 'Vila', 'Burgo', 'Forte',
    'Cidade', 'Colina', 'Ponte',
  ];
  static const _cityRoot = [
    'Corvo', 'Ferrolho', 'Âmbar', 'Serpente', 'Cinza', 'Sabiá', 'Ipê',
    'Aurora', 'Pantanal', 'Falcão', 'Espinho', 'Carvalho', 'Pedra', 'Ravena',
    'Junco', 'Lobo', 'Bruma', 'Sino', 'Torga', 'Veiga',
  ];
  static const _citySuffix = [
    '', '', '', ' Maior', ' Norte', ' Sul', ' de Cima', ' do Vau', ' Baixa', ' Velha',
  ];

  String _cityName(DeterministicRandom rng, {required bool isCapital}) {
    final root = rng.pick(_cityRoot);
    if (isCapital) {
      return '${rng.pick(_cityPrefix)} $root${rng.pick(_citySuffix)}';
    }
    return rng.chance(0.5)
        ? '$root${rng.pick(_citySuffix)}'
        : '${rng.pick(_cityPrefix)} $root';
  }

  // ===========================================================================
  // Resolução de tile
  // ===========================================================================

  /// Resolve um tile completo. Este é o caminho quente: chamado uma vez por
  /// tile visível, por chunk gerada.
  WorldTile tileAt(int x, int y, WorldLayout layout) {
    final biome = biomeAt(x, y);
    final elevation = elevationAt(x, y);

    if (biome == Biome.deadWater) {
      // Água parada: só vitória-régia mutante, e mesmo assim rala.
      final roll = DeterministicRandom.whiteNoise2D(
        DeterministicRandom.mix(seed, 0x63),
        x,
        y,
      );
      return WorldTile(
        biome: biome,
        elevation: elevation,
        feature: roll < 0.16 ? TileFeature.lily : TileFeature.none,
      );
    }

    final settlement = layout.settlementAt(TileCoord(x, y));
    if (settlement != null) {
      return _urbanTile(x, y, biome, elevation, settlement);
    }

    return _wildTile(x, y, biome, elevation);
  }

  /// Tile dentro de uma cidade: quarteirões separados por vielas de mato.
  ///
  /// A cidade não é pavimentada. A grade a cada 4 tiles continua existindo,
  /// porque é ela que dá leitura de "cidade" em vez de "amontoado", mas as
  /// faixas entre os quarteirões são chão limpo com mato nascendo — não
  /// asfalto. Numa distopia onde a manutenção pública é a primeira coisa a
  /// falir, rua conservada seria a mentira mais cara da tela.
  WorldTile _urbanTile(
    int x,
    int y,
    Biome biome,
    int elevation,
    Settlement settlement,
  ) {
    final lx = x - settlement.center.x;
    final ly = y - settlement.center.y;

    final roll = DeterministicRandom.whiteNoise2D(
      DeterministicRandom.mix(seed, 0x51),
      x,
      y,
    );

    const block = 4;
    final onLaneX = lx % block == 0;
    final onLaneY = ly % block == 0;

    if (onLaneX || onLaneY) {
      // Cruzamento das vielas: onde a feira se instala.
      final atCrossing = onLaneX && onLaneY;
      final feature = switch (roll) {
        _ when atCrossing && roll < 0.16 => TileFeature.marketStall,
        _ when roll < 0.14 => TileFeature.grassTuft,
        _ when roll < 0.18 => TileFeature.crate,
        _ when roll < 0.20 => TileFeature.wreck,
        _ => TileFeature.none,
      };
      return WorldTile(
        biome: Biome.neonCore,
        elevation: elevation,
        feature: feature,
        settlementId: settlement.id,
      );
    }

    // A praça central fica aberta: é onde a tela de cidade situa mercado e
    // governo, e um prédio em cima do centro esconde o marcador do jogador.
    if (lx.abs() <= 1 && ly.abs() <= 1) {
      return WorldTile(
        biome: Biome.neonCore,
        elevation: elevation,
        feature: roll < 0.34 ? TileFeature.grassTuft : TileFeature.none,
        settlementId: settlement.id,
      );
    }

    // Densidade cai do centro para a periferia. Os números caíram junto com a
    // troca do asfalto por mato: com 86% de ocupação no centro de uma capital
    // não sobrava um palmo de chão visível, e o mundo inteiro virou mato
    // justamente para o chão aparecer.
    final distanceRatio =
        (math.sqrt((lx * lx + ly * ly).toDouble()) / settlement.radius).clamp(0.0, 1.0);
    final buildChance = settlement.isCapital
        ? 0.66 - distanceRatio * 0.38
        : 0.52 - distanceRatio * 0.32;

    TileFeature feature;
    if (roll < buildChance * 0.12) {
      feature = TileFeature.tower;
    } else if (roll < buildChance) {
      feature = TileFeature.building;
    } else if (roll < buildChance + 0.05) {
      feature = TileFeature.camp;
    } else if (roll < buildChance + 0.09) {
      feature = TileFeature.crate;
    } else if (roll < buildChance + 0.13) {
      // A periferia é onde o mato volta primeiro.
      feature = distanceRatio > 0.6 ? TileFeature.bush : TileFeature.grassTuft;
    } else {
      feature = TileFeature.none;
    }

    return WorldTile(
      biome: Biome.neonCore,
      elevation: elevation,
      feature: feature,
      settlementId: settlement.id,
    );
  }

  /// Tile selvagem: vegetação, rochas e jazidas espalhadas pelo bioma.
  WorldTile _wildTile(int x, int y, Biome biome, int elevation) {
    final scatter = DeterministicRandom.whiteNoise2D(
      DeterministicRandom.mix(seed, 0x57),
      x,
      y,
    );
    final detail = _detailNoise.fbmUnit(x * _detailScale, y * _detailScale, octaves: 2);

    final feature = _scatterFeature(biome, scatter, detail);

    // Jazidas: agrupadas (o ruído de detalhe cria bolsões) em vez de
    // pulverizadas, para que valha a pena viajar até elas.
    ItemId? resource;
    var richness = 0.0;
    if (biome.resources.isNotEmpty && detail > 0.58) {
      final pickRoll = DeterministicRandom.whiteNoise2D(
        DeterministicRandom.mix(seed, 0x5D),
        x,
        y,
      );
      resource = biome.resources[(pickRoll * biome.resources.length)
          .floor()
          .clamp(0, biome.resources.length - 1)];
      richness = ((detail - 0.58) / 0.42).clamp(0.0, 1.0);
    }

    return WorldTile(
      biome: biome,
      elevation: elevation,
      feature: feature,
      resource: resource,
      resourceRichness: richness,
    );
  }

  /// Escolhe o que nasce num tile selvagem.
  ///
  /// Duas entradas, com papéis diferentes. `roll` é ruído branco — decide a
  /// espécie e é o que quebra a repetição tile a tile. `detail` é ruído
  /// coerente — decide a *densidade*, e é o que faz a mata fechar em bosques
  /// e abrir em clareiras em vez de virar um chuvisco uniforme. Antes daqui só
  /// o ruído branco decidia, e cada bioma parecia o mesmo confete espalhado.
  ///
  /// Somando os dois, a leitura é: onde `detail` é alto o bioma mostra a
  /// vegetação alta que o define; onde é baixo, sobra rasteira e chão.
  TileFeature _scatterFeature(Biome biome, double roll, double detail) {
    /// Compacta a escala: `detail` fica quase todo entre 0,3 e 0,7, então
    /// usá-lo cru como probabilidade quase nunca chega nos extremos.
    final density = ((detail - 0.35) / 0.30).clamp(0.0, 1.0);

    switch (biome) {
      // Mata mutante que retomou o subúrbio. É o bioma mais fechado do mapa.
      case Biome.reclaimedForest:
        if (roll < 0.30 * density + 0.06) return TileFeature.denseTree;
        if (roll < 0.58 * density + 0.14) return TileFeature.tree;
        if (roll < 0.68) return TileFeature.bush;
        if (roll < 0.74) return TileFeature.mushroom;
        if (roll < 0.79) return TileFeature.fallenLog;
        if (roll < 0.83) return TileFeature.stump;
        if (roll < 0.88) return TileFeature.grassTuft;
        if (roll < 0.90) return TileFeature.boulder;
        return TileFeature.none;

      // Lavoura. Fileiras de plantio, cercas e o pasto entre elas.
      case Biome.bioFarm:
        if (roll < 0.34 * density + 0.10) return TileFeature.crops;
        if (roll < 0.52) return TileFeature.grassTuft;
        if (roll < 0.58) return TileFeature.fence;
        if (roll < 0.63) return TileFeature.flowers;
        if (roll < 0.67) return TileFeature.tree;
        if (roll < 0.70) return TileFeature.crate;
        return TileFeature.none;

      // Lixão: sucata sobre mato pisado, com acampamentos de catadores.
      case Biome.scrapyard:
        if (roll < 0.28 * density + 0.10) return TileFeature.scrapPile;
        if (roll < 0.46) return TileFeature.wreck;
        if (roll < 0.53) return TileFeature.rubble;
        if (roll < 0.59) return TileFeature.crate;
        if (roll < 0.63) return TileFeature.camp;
        if (roll < 0.70) return TileFeature.grassTuft;
        return TileFeature.none;

      // Campo de petróleo: mato queimado, bombas e árvores mortas.
      case Biome.oilFields:
        if (roll < 0.10 * density + 0.03) return TileFeature.oilPump;
        if (roll < 0.20) return TileFeature.deadTree;
        if (roll < 0.27) return TileFeature.rock;
        if (roll < 0.32) return TileFeature.crate;
        if (roll < 0.36) return TileFeature.wreck;
        if (roll < 0.44) return TileFeature.grassTuft;
        return TileFeature.none;

      // Mina: pedra exposta, torres de extração e pouca vegetação.
      case Biome.rareEarthMine:
        if (roll < 0.18 * density + 0.08) return TileFeature.boulder;
        if (roll < 0.34) return TileFeature.rock;
        if (roll < 0.41) return TileFeature.extractionRig;
        if (roll < 0.47) return TileFeature.cliff;
        if (roll < 0.52) return TileFeature.rubble;
        if (roll < 0.58) return TileFeature.grassTuft;
        return TileFeature.none;

      // Ruínas: o que sobrou de uma cidade, sendo comido pelo mato.
      case Biome.ruins:
        if (roll < 0.20 * density + 0.06) return TileFeature.rubble;
        if (roll < 0.36) return TileFeature.wall;
        if (roll < 0.44) return TileFeature.tower;
        if (roll < 0.50) return TileFeature.wreck;
        if (roll < 0.58) return TileFeature.bush;
        if (roll < 0.66) return TileFeature.grassTuft;
        if (roll < 0.70) return TileFeature.tree;
        return TileFeature.none;

      // Cortiço: construção improvisada, cerca e horta de fundo de quintal.
      case Biome.sprawl:
        if (roll < 0.20 * density + 0.08) return TileFeature.building;
        if (roll < 0.36) return TileFeature.camp;
        if (roll < 0.44) return TileFeature.fence;
        if (roll < 0.50) return TileFeature.crate;
        if (roll < 0.55) return TileFeature.crops;
        if (roll < 0.63) return TileFeature.grassTuft;
        return TileFeature.none;

      // Charco tóxico: cogumelos, árvores mortas e água parada.
      case Biome.toxicMarsh:
        if (roll < 0.20 * density + 0.06) return TileFeature.mushroom;
        if (roll < 0.34) return TileFeature.deadTree;
        if (roll < 0.42) return TileFeature.lily;
        if (roll < 0.50) return TileFeature.bush;
        if (roll < 0.56) return TileFeature.rubble;
        if (roll < 0.64) return TileFeature.grassTuft;
        return TileFeature.none;

      // Descampado: mato ralo, cacto e pedra. É o vazio entre as cidades.
      case Biome.wasteland:
        if (roll < 0.10 * density + 0.02) return TileFeature.cactus;
        if (roll < 0.18) return TileFeature.rock;
        if (roll < 0.23) return TileFeature.deadTree;
        if (roll < 0.27) return TileFeature.stump;
        if (roll < 0.31) return TileFeature.rubble;
        if (roll < 0.42) return TileFeature.grassTuft;
        return TileFeature.none;

      // Fora do raio de um assentamento, o núcleo é prédio esparso no mato.
      case Biome.neonCore:
        if (roll < 0.30 * density + 0.12) return TileFeature.building;
        if (roll < 0.50) return TileFeature.tower;
        if (roll < 0.58) return TileFeature.crate;
        if (roll < 0.66) return TileFeature.grassTuft;
        return TileFeature.none;

      case Biome.deadWater:
        return TileFeature.none;
    }
  }
}

/// A macroestrutura do mundo — a única parte que a campanha persiste.
class WorldLayout {
  WorldLayout({
    required this.seed,
    required this.settlements,
    required this.roads,
  })  : _byId = {for (final s in settlements) s.id: s},
        _roadTiles = _indexRoadTiles(roads);

  final int seed;
  final List<Settlement> settlements;
  final List<Road> roads;

  final Map<String, Settlement> _byId;

  /// Conjunto de tiles ocupados por estrada, para teste O(1) durante a geração.
  final Set<int> _roadTiles;

  List<Settlement> get capitals =>
      settlements.where((s) => s.isCapital).toList(growable: false);

  List<Settlement> get satellites =>
      settlements.where((s) => !s.isCapital).toList(growable: false);

  Settlement? byId(String id) => _byId[id];

  /// Assentamento que cobre este tile, se algum.
  Settlement? settlementAt(TileCoord tile) {
    for (final s in settlements) {
      if (s.contains(tile)) return s;
    }
    return null;
  }

  bool isRoadTile(int x, int y) => _roadTiles.contains(_packTile(x, y));

  /// Estradas que partem de um assentamento.
  List<Road> roadsFrom(String settlementId) => roads
      .where((r) => r.fromId == settlementId || r.toId == settlementId)
      .toList(growable: false);

  /// A ponta oposta de uma estrada.
  String otherEnd(Road road, String fromId) =>
      road.fromId == fromId ? road.toId : road.fromId;

  static Set<int> _indexRoadTiles(List<Road> roads) {
    final set = <int>{};
    for (final road in roads) {
      for (final tile in road.path) {
        // Espessura 3 para a estrada ficar visível no zoom isométrico.
        for (var dx = -1; dx <= 1; dx++) {
          for (var dy = -1; dy <= 1; dy++) {
            set.add(_packTile(tile.x + dx, tile.y + dy));
          }
        }
      }
    }
    return set;
  }

  /// Empacota (x, y) num único int. Offset de 2^20 cobre o mundo assentado com
  /// folga e mantém o valor dentro do inteiro seguro do JS.
  static int _packTile(int x, int y) => (x + 0x100000) * 0x400000 + (y + 0x100000);

  Map<String, dynamic> toJson() => {
        'seed': seed,
        'settlements': settlements.map((s) => s.toJson()).toList(),
        'roads': roads.map((r) => r.toJson()).toList(),
      };

  factory WorldLayout.fromJson(Map<String, dynamic> json) => WorldLayout(
        seed: json['seed'] as int,
        settlements: (json['settlements'] as List)
            .map((e) => Settlement.fromJson(e as Map<String, dynamic>))
            .toList(),
        roads: (json['roads'] as List)
            .map((e) => Road.fromJson(e as Map<String, dynamic>))
            .toList(),
      );
}
