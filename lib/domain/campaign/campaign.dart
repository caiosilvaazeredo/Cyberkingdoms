import '../../core/seed/deterministic_random.dart';
import '../building/plot.dart';
import '../character/attributes.dart';
import '../character/character.dart';
import '../economy/market.dart';
import '../politics/government.dart';
import '../world/coords.dart';
import '../world/settlement.dart';
import '../world/world.dart';
import '../world/world_gen.dart';

/// Uma campanha: um mundo gerado, um personagem e o estado do servidor.
///
/// "Cada nova campanha gera um mundo novo" — a seed é o único input. Tudo que
/// não é derivável da seed (personagem, mercados, governos, dia atual) vive
/// aqui e é persistido.
class Campaign {
  Campaign({
    required this.id,
    required this.seedLabel,
    required this.seed,
    required this.world,
    required this.character,
    required this.plot,
    required Map<String, Government> governments,
    required Map<String, Market> markets,
    this.day = 1,
    this.createdAt,
    List<String>? journal,
  })  : _governments = governments,
        _markets = markets,
        _journal = [...?journal];

  /// Cria uma campanha nova a partir de um rótulo de seed digitado pelo
  /// jogador (ou sorteado).
  factory Campaign.create({
    required String id,
    required String seedLabel,
    required String characterName,
  }) {
    final seed = DeterministicRandom.hashLabel(seedLabel);
    final world = World.fromSeed(seed);
    final rng = DeterministicRandom(seed).fork('campaign');

    // O jogador começa numa capital sorteada.
    final startCapital = rng.pick(world.layout.capitals);

    final character = Character(
      id: 'player',
      name: characterName,
      attributes: AttributeSet.roll(rng.fork('attributes')),
      position: startCapital.center,
      homeSettlementId: startCapital.id,
    );

    final governments = <String, Government>{};
    final markets = <String, Market>{};

    for (final settlement in world.layout.settlements) {
      governments[settlement.id] = Government(
        settlementId: settlement.id,
        // Capitais começam sem governador eleito — a primeira eleição é um
        // gancho de conteúdo logo no início da campanha.
        taxRate: rng.rangeDouble(0.04, 0.14),
        publicWage: rng.range(28, 62),
        treasury: settlement.isCapital ? rng.range(40000, 180000) : rng.range(4000, 22000),
      );

      final marketRng = rng.fork('market_${settlement.id}');
      final central = Market(
        settlementId: settlement.id,
        kind: MarketKind.central,
      )..seed(settlement: settlement, rng: marketRng);
      markets[_marketKey(settlement.id, MarketKind.central)] = central;

      // Só capitais e satélites grandes têm mercado clandestino organizado.
      if (settlement.isCapital || marketRng.chance(0.45)) {
        final black = Market(
          settlementId: settlement.id,
          kind: MarketKind.clandestine,
        )..seed(settlement: settlement, rng: marketRng.fork('black'));
        markets[_marketKey(settlement.id, MarketKind.clandestine)] = black;
      }
    }

    return Campaign(
      id: id,
      seedLabel: seedLabel,
      seed: seed,
      world: world,
      character: character,
      plot: buildStartingPlot(startCapital, CitizenLevel.survivor),
      governments: governments,
      markets: markets,
      createdAt: DateTime.now(),
    );
  }

  /// Reserva o terreno inicial do jogador **dentro** da metrópole.
  ///
  /// O terreno nunca fica em campo aberto: o mundo selvagem é para explorar,
  /// extrair e viajar, e toda construção acontece na base urbana. O offset
  /// tira o terreno de cima do centro da cidade (onde ficam mercado e governo)
  /// sem sair do raio urbano.
  static Plot buildStartingPlot(Settlement settlement, CitizenLevel level) {
    final (width, height) = Plot.sizeForLevel(level);
    return Plot(
      id: 'plot_${settlement.id}',
      settlementId: settlement.id,
      origin: TileCoord(
        settlement.center.x + 5,
        settlement.center.y + 5,
      ),
      width: width,
      height: height,
      name: 'Terreno em ${settlement.name}',
    );
  }

  final String id;

  /// O texto que o jogador digitou. Mostrar isso permite recriar o mesmo mundo
  /// e compartilhar seeds — parte da graça de um mundo procedural.
  final String seedLabel;

  final int seed;
  final World world;
  final Character character;

  /// O terreno (vilarejo) do jogador, sempre dentro de uma metrópole.
  final Plot plot;

  final Map<String, Government> _governments;
  final Map<String, Market> _markets;

  /// Dia do servidor. Avança um por reset da meia-noite.
  int day;

  final DateTime? createdAt;

  final List<String> _journal;

  List<String> get journal => List.unmodifiable(_journal);

  Map<String, Government> get governments => Map.unmodifiable(_governments);

  Government governmentOf(String settlementId) =>
      _governments[settlementId] ??
      (_governments[settlementId] = Government(settlementId: settlementId));

  Market? marketOf(String settlementId, MarketKind kind) =>
      _markets[_marketKey(settlementId, kind)];

  List<Market> marketsAt(String settlementId) => MarketKind.values
      .map((k) => marketOf(settlementId, k))
      .whereType<Market>()
      .toList(growable: false);

  /// A cidade onde o personagem está agora, se estiver em alguma.
  String? get currentSettlementId =>
      world.settlementAt(character.position)?.id;

  void log(String entry) {
    _journal.add('Dia $day · $entry');
    // O diário é UI, não histórico oficial: manter os últimos 200 evita que o
    // save cresça sem limite numa campanha longa.
    if (_journal.length > 200) _journal.removeAt(0);
  }

  static String _marketKey(String settlementId, MarketKind kind) =>
      '$settlementId::${kind.name}';

  Map<String, dynamic> toJson() => {
        'id': id,
        'seedLabel': seedLabel,
        'seed': seed,
        'day': day,
        'createdAt': createdAt?.toIso8601String(),
        // O terreno não vai para o save: é regenerado da seed. Só o layout,
        // que depende de uma visão global do mapa, é persistido.
        'layout': world.layout.toJson(),
        'character': character.toJson(),
        'plot': plot.toJson(),
        'governments': {
          for (final e in _governments.entries) e.key: e.value.toJson(),
        },
        'markets': {
          for (final e in _markets.entries) e.key: e.value.toJson(),
        },
        'journal': _journal,
      };

  factory Campaign.fromJson(Map<String, dynamic> json) {
    final seed = (json['seed'] as num).toInt();
    final layout = WorldLayout.fromJson(json['layout'] as Map<String, dynamic>);
    final character =
        Character.fromJson(json['character'] as Map<String, dynamic>);

    // Saves anteriores ao sistema de terrenos não têm a chave; recriamos o
    // terreno vazio na cidade natal em vez de recusar o save.
    final rawPlot = json['plot'] as Map<String, dynamic>?;
    final plot = rawPlot != null
        ? Plot.fromJson(rawPlot)
        : buildStartingPlot(
            layout.byId(character.homeSettlementId) ?? layout.capitals.first,
            character.level,
          );

    return Campaign(
      id: json['id'] as String,
      seedLabel: json['seedLabel'] as String,
      seed: seed,
      world: World.restore(seed: seed, layout: layout),
      character: character,
      plot: plot,
      day: (json['day'] as num).toInt(),
      createdAt: json['createdAt'] == null
          ? null
          : DateTime.tryParse(json['createdAt'] as String),
      governments: {
        for (final e in (json['governments'] as Map).entries)
          e.key as String:
              Government.fromJson(e.value as Map<String, dynamic>),
      },
      markets: {
        for (final e in (json['markets'] as Map).entries)
          e.key as String: Market.fromJson(e.value as Map<String, dynamic>),
      },
      journal: ((json['journal'] as List?) ?? const [])
          .map((e) => e as String)
          .toList(),
    );
  }

  /// Resumo curto para a tela de seleção de campanhas.
  CampaignSummary get summary => CampaignSummary(
        id: id,
        seedLabel: seedLabel,
        characterName: character.name,
        day: day,
        level: character.level,
        credits: character.credits,
        dead: character.dead,
        createdAt: createdAt,
      );
}

class CampaignSummary {
  const CampaignSummary({
    required this.id,
    required this.seedLabel,
    required this.characterName,
    required this.day,
    required this.level,
    required this.credits,
    required this.dead,
    this.createdAt,
  });

  final String id;
  final String seedLabel;
  final String characterName;
  final int day;
  final CitizenLevel level;
  final int credits;
  final bool dead;
  final DateTime? createdAt;
}

/// Coordenada de spawn conveniente para testes e para a câmera inicial.
extension CampaignSpawn on Campaign {
  TileCoord get spawnPoint =>
      world.layout.byId(character.homeSettlementId)?.center ??
      character.position;
}
