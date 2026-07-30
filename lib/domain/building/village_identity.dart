/// Brasões disponíveis para o vilarejo.
///
/// Cada um aponta para um sprite já renderizado dos kits da Kenney. A escolha
/// é puramente cosmética, mas é o que transforma "o terreno" em "o **meu**
/// terreno" — e, quando o multiplayer existir, é como os outros jogadores vão
/// reconhecer você no mapa e no livro de ofertas.
enum VillageEmblem {
  banner('Estandarte', 'minidungeon/banner'),
  flagTall('Bandeira Alta', 'castlekit/flag'),
  flagWide('Bandeira Larga', 'castlekit/flag-wide'),
  pennant('Flâmula', 'castlekit/flag-pennant'),
  bannerLong('Faixa Longa', 'castlekit/flag-banner-long'),
  bannerShort('Faixa Curta', 'castlekit/flag-banner-short'),
  forestFlag('Bandeira de Mata', 'miniforest/flag'),
  tower('Torre', 'castlekit/tower-square-top'),
  gate('Portão', 'castlekit/gate'),
  chest('Baú', 'minidungeon/chest'),
  shield('Escudo', 'minidungeon/shield-round'),
  drone('Drone', 'castlekit/siege-ballista');

  const VillageEmblem(this.label, this.spriteId);

  final String label;

  /// Id no manifesto de sprites (`kit/nome`).
  final String spriteId;

  /// Caminho do asset correspondente.
  String get assetPath =>
      'assets/sprites/${spriteId.replaceFirst('/', '__')}.png';

  static VillageEmblem parse(String name) {
    for (final emblem in VillageEmblem.values) {
      if (emblem.name == name) return emblem;
    }
    return VillageEmblem.banner;
  }
}

/// Identidade visual e social do vilarejo do jogador.
class VillageIdentity {
  const VillageIdentity({
    this.name = 'Meu Terreno',
    this.motto = '',
    this.emblem = VillageEmblem.banner,
    this.primaryColor = 0xFF00E5FF,
    this.secondaryColor = 0xFFFF2D95,
  });

  final String name;

  /// Lema exibido junto ao brasão. Livre, e opcional.
  final String motto;

  final VillageEmblem emblem;

  /// Cores em ARGB. Tingem o brasão e as construções sem cor própria.
  final int primaryColor;
  final int secondaryColor;

  /// Um vilarejo com identidade completa (nome próprio, lema e brasão) rende
  /// reputação: no CyberKingdoms, aparência é capital político.
  int get statusBonus {
    var bonus = 0;
    if (name.trim().isNotEmpty && name != 'Meu Terreno') bonus += 1;
    if (motto.trim().isNotEmpty) bonus += 1;
    return bonus;
  }

  VillageIdentity copyWith({
    String? name,
    String? motto,
    VillageEmblem? emblem,
    int? primaryColor,
    int? secondaryColor,
  }) =>
      VillageIdentity(
        name: name ?? this.name,
        motto: motto ?? this.motto,
        emblem: emblem ?? this.emblem,
        primaryColor: primaryColor ?? this.primaryColor,
        secondaryColor: secondaryColor ?? this.secondaryColor,
      );

  Map<String, dynamic> toJson() => {
        'name': name,
        'motto': motto,
        'emblem': emblem.name,
        'primaryColor': primaryColor,
        'secondaryColor': secondaryColor,
      };

  factory VillageIdentity.fromJson(Map<String, dynamic> json) =>
      VillageIdentity(
        name: json['name'] as String? ?? 'Meu Terreno',
        motto: json['motto'] as String? ?? '',
        emblem: VillageEmblem.parse(json['emblem'] as String? ?? 'banner'),
        primaryColor: (json['primaryColor'] as num?)?.toInt() ?? 0xFF00E5FF,
        secondaryColor: (json['secondaryColor'] as num?)?.toInt() ?? 0xFFFF2D95,
      );
}

/// Paleta oferecida ao jogador para pintar construções e o brasão.
///
/// É uma lista curta e curada de propósito: um seletor de cor livre produz
/// terrenos feios e ilegíveis no mapa. Todas as cores aqui têm contraste
/// suficiente sobre o fundo escuro do jogo.
abstract final class VillagePalette {
  static const List<(String, int)> swatches = [
    ('Ciano', 0xFF00E5FF),
    ('Rosa Shocking', 0xFFFF2D95),
    ('Âmbar', 0xFFFFB300),
    ('Verde Ácido', 0xFF00E676),
    ('Violeta', 0xFFB388FF),
    ('Laranja Tóxico', 0xFFFF6D00),
    ('Azul Elétrico', 0xFF2979FF),
    ('Vermelho Sangue', 0xFFFF5252),
    ('Turquesa', 0xFF00BFA5),
    ('Amarelo Sinal', 0xFFFFF176),
    ('Magenta Frio', 0xFFE040FB),
    ('Cinza Aço', 0xFF90A4AE),
  ];

  static String labelFor(int argb) {
    for (final (label, value) in swatches) {
      if (value == argb) return label;
    }
    return 'Personalizada';
  }
}
