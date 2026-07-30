import '../economy/item.dart';
import 'coords.dart';

/// Vocação econômica de uma capital. O GDD pede 5 capitais "cada uma com
/// vocações econômicas diferentes" — a vocação decide quais indústrias existem
/// ali, o que a cidade produz barato e o que ela precisa importar.
///
/// A escassez é intencional: nenhuma capital consegue fechar a cadeia sozinha,
/// então o comércio entre regiões deixa de ser opcional.
enum CityVocation {
  petrochemical(
    label: 'Petroquímica',
    produces: [ItemId.oil, ItemId.polymer, ItemId.catalyst],
    demands: [ItemId.culturedMeat, ItemId.chip, ItemId.water],
  ),
  foundry(
    label: 'Metalúrgica',
    produces: [ItemId.scrap, ItemId.circuitBoard],
    demands: [ItemId.biomass, ItemId.rareEarth, ItemId.rationPack],
  ),
  agroBio(
    label: 'Agro-Bio',
    produces: [ItemId.biomass, ItemId.culturedMeat, ItemId.rationPack, ItemId.water],
    demands: [ItemId.polymer, ItemId.chip, ItemId.scrap],
  ),
  techHub(
    label: 'Tecnópole',
    produces: [ItemId.chip, ItemId.drone, ItemId.metabolicImplant],
    demands: [ItemId.rareEarth, ItemId.oil, ItemId.culturedMeat],
  ),
  freePort(
    label: 'Porto Franco',
    produces: [ItemId.fabric, ItemId.clothing, ItemId.stolenGoods],
    demands: [ItemId.rareEarth, ItemId.chip, ItemId.rifle],
  );

  const CityVocation({
    required this.label,
    required this.produces,
    required this.demands,
  });

  final String label;

  /// Itens com oferta abundante — preço de mercado tende a ficar abaixo do base.
  final List<ItemId> produces;

  /// Itens escassos — preço tende a subir. É aqui que o comerciante ganha.
  final List<ItemId> demands;
}

enum SettlementKind {
  capital('Capital'),
  satellite('Satélite');

  const SettlementKind(this.label);
  final String label;
}

/// Uma cidade no mundo gerado.
class Settlement {
  const Settlement({
    required this.id,
    required this.name,
    required this.kind,
    required this.center,
    required this.vocation,
    required this.radius,
    required this.population,
    this.capitalId,
  });

  final String id;
  final String name;
  final SettlementKind kind;

  /// Tile central. Toda a malha urbana é gerada em volta dele.
  final TileCoord center;

  final CityVocation vocation;

  /// Raio urbano em tiles. Capitais são maiores que satélites.
  final int radius;

  final int population;

  /// Para satélites: a capital da qual ela orbita. `null` em capitais.
  final String? capitalId;

  bool get isCapital => kind == SettlementKind.capital;

  /// Quantidade de vagas em Serviços Públicos. O GDD limita as vagas públicas
  /// (o canvas fala em teto de 20 slots por jazida) — é o que força parte dos
  /// jogadores para as fazendas privadas.
  int get publicJobSlots => isCapital ? 20 : 8;

  bool contains(TileCoord tile) => tile.euclideanTo(center) <= radius;

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'kind': kind.name,
        'center': center.toJson(),
        'vocation': vocation.name,
        'radius': radius,
        'population': population,
        'capitalId': capitalId,
      };

  factory Settlement.fromJson(Map<String, dynamic> json) => Settlement(
        id: json['id'] as String,
        name: json['name'] as String,
        kind: SettlementKind.values.byName(json['kind'] as String),
        center: TileCoord.fromJson(json['center'] as Map<String, dynamic>),
        vocation: CityVocation.values.byName(json['vocation'] as String),
        radius: json['radius'] as int,
        population: json['population'] as int,
        capitalId: json['capitalId'] as String?,
      );
}

/// Trecho de estrada ligando dois assentamentos. **Toda estrada é zona PvP** —
/// é a única parte do mapa onde assalto, emboscada e contrabando acontecem.
class Road {
  const Road({
    required this.fromId,
    required this.toId,
    required this.path,
    required this.travelDays,
    required this.danger,
  });

  final String fromId;
  final String toId;

  /// Tiles atravessados, do início ao fim.
  final List<TileCoord> path;

  /// Quantos resets diários a travessia consome. O GDD trava o deslocamento no
  /// reset, então viagens longas deixam o jogador exposto por vários dias.
  final int travelDays;

  /// 0..1 — chance base de encontro hostil por dia de viagem.
  final double danger;

  int get lengthInTiles => path.length;

  String get key => Road.makeKey(fromId, toId);

  /// Chave simétrica: a estrada A→B e a B→A são a mesma.
  static String makeKey(String a, String b) {
    final sorted = [a, b]..sort();
    return '${sorted[0]}::${sorted[1]}';
  }

  Map<String, dynamic> toJson() => {
        'fromId': fromId,
        'toId': toId,
        'travelDays': travelDays,
        'danger': danger,
        'path': path.map((t) => t.toJson()).toList(),
      };

  factory Road.fromJson(Map<String, dynamic> json) => Road(
        fromId: json['fromId'] as String,
        toId: json['toId'] as String,
        travelDays: json['travelDays'] as int,
        danger: (json['danger'] as num).toDouble(),
        path: (json['path'] as List)
            .map((e) => TileCoord.fromJson(e as Map<String, dynamic>))
            .toList(growable: false),
      );
}
