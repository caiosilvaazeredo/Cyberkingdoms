import '../../core/seed/deterministic_random.dart';

/// Cargos do sistema político do GDD (seção 8).
enum PoliticalOffice {
  governor('Governador', 'Controla impostos, salários públicos e segurança.'),
  districtAdmin('Administrador de Distrito', 'Gere um distrito da capital.'),
  interimGovernor('Governador Provisório', 'Assume após um golpe, até a próxima eleição.'),
  militia('Milícia', 'Braço armado do governo. Reprime rebeliões.');

  const PoliticalOffice(this.label, this.description);
  final String label;
  final String description;
}

/// Governo de uma cidade.
class Government {
  Government({
    required this.settlementId,
    this.governorId,
    this.governorName,
    this.taxRate = 0.08,
    this.publicWage = 40,
    this.treasury = 0,
    this.securityBudget = 0,
    Set<String>? militiaIds,
    Set<String>? wantedIds,
    this.interim = false,
  })  : _militiaIds = {...?militiaIds},
        _wantedIds = {...?wantedIds};

  final String settlementId;

  String? governorId;
  String? governorName;

  /// Imposto sobre transações no Mercado Central. O governador escolhe.
  double taxRate;

  /// Salário diário pago a quem trabalha em Serviços Públicos.
  int publicWage;

  /// Caixa da cidade. É isto que os rebeldes saqueiam num golpe.
  int treasury;

  /// Parcela do tesouro gasta em segurança — soma à força do governo contra
  /// rebeliões e reduz o sucesso de assaltos nas estradas próximas.
  int securityBudget;

  final Set<String> _militiaIds;
  final Set<String> _wantedIds;

  /// `true` quando o cargo veio de um golpe, não de uma eleição.
  bool interim;

  Set<String> get militiaIds => Set.unmodifiable(_militiaIds);
  Set<String> get wantedIds => Set.unmodifiable(_wantedIds);

  bool get hasGovernor => governorId != null;

  static const double maxTaxRate = 0.40;
  static const double minTaxRate = 0.0;

  void setTaxRate(double rate) =>
      taxRate = rate.clamp(minTaxRate, maxTaxRate);

  void collectTax(int amount) => treasury += amount;

  /// Paga salários públicos. Devolve quanto foi efetivamente pago — se o caixa
  /// não cobre a folha, o governo paga o que dá e o resto vira insatisfação.
  int payWages(int workerCount) {
    final due = publicWage * workerCount;
    final paid = due <= treasury ? due : treasury;
    treasury -= paid;
    return paid;
  }

  /// Força defensiva do governo numa rebelião: milícia + dinheiro em segurança.
  double get defenseStrength =>
      _militiaIds.length * 10.0 + securityBudget / 100.0;

  void enlistMilitia(String citizenId) => _militiaIds.add(citizenId);
  void dismissMilitia(String citizenId) => _militiaIds.remove(citizenId);

  void markWanted(String citizenId) => _wantedIds.add(citizenId);
  void pardon(String citizenId) => _wantedIds.remove(citizenId);
  bool isWanted(String citizenId) => _wantedIds.contains(citizenId);

  /// Aplica o resultado de um golpe bem-sucedido: o governador cai, o tesouro é
  /// saqueado e o líder rebelde assume como provisório.
  int applyCoup({required String rebelLeaderId, required String rebelLeaderName}) {
    final looted = treasury;
    treasury = 0;
    governorId = rebelLeaderId;
    governorName = rebelLeaderName;
    interim = true;
    _militiaIds.clear();
    _wantedIds.clear();
    return looted;
  }

  Map<String, dynamic> toJson() => {
        'settlementId': settlementId,
        'governorId': governorId,
        'governorName': governorName,
        'taxRate': taxRate,
        'publicWage': publicWage,
        'treasury': treasury,
        'securityBudget': securityBudget,
        'militiaIds': _militiaIds.toList(),
        'wantedIds': _wantedIds.toList(),
        'interim': interim,
      };

  factory Government.fromJson(Map<String, dynamic> json) => Government(
        settlementId: json['settlementId'] as String,
        governorId: json['governorId'] as String?,
        governorName: json['governorName'] as String?,
        taxRate: (json['taxRate'] as num).toDouble(),
        publicWage: (json['publicWage'] as num).toInt(),
        treasury: (json['treasury'] as num).toInt(),
        securityBudget: (json['securityBudget'] as num).toInt(),
        militiaIds: ((json['militiaIds'] as List?) ?? const [])
            .map((e) => e as String)
            .toSet(),
        wantedIds: ((json['wantedIds'] as List?) ?? const [])
            .map((e) => e as String)
            .toSet(),
        interim: json['interim'] as bool? ?? false,
      );
}

/// Uma candidatura numa eleição.
class Candidacy {
  Candidacy({
    required this.citizenId,
    required this.citizenName,
    required this.platformTaxRate,
    required this.platformWage,
    this.votes = 0,
  });

  final String citizenId;
  final String citizenName;

  /// A plataforma é o que o eleitor avalia: imposto prometido e salário
  /// público prometido.
  final double platformTaxRate;
  final int platformWage;

  int votes;
}

/// Eleição para governador. **Qualquer jogador pode disputar, independente do
/// nível** — é uma regra explícita do GDD.
class Election {
  Election({
    required this.settlementId,
    required this.scheduledForDay,
    List<Candidacy>? candidates,
    this.resolved = false,
    this.winnerId,
  }) : _candidates = [...?candidates];

  final String settlementId;
  final int scheduledForDay;
  final List<Candidacy> _candidates;
  bool resolved;
  String? winnerId;

  List<Candidacy> get candidates => List.unmodifiable(_candidates);

  /// Intervalo entre eleições, em dias.
  static const int termLengthInDays = 30;

  bool register(Candidacy candidacy) {
    if (resolved) return false;
    if (_candidates.any((c) => c.citizenId == candidacy.citizenId)) return false;
    _candidates.add(candidacy);
    return true;
  }

  /// Apura. O eleitorado é simulado: cada eleitor pesa imposto baixo e salário
  /// alto, com um ruído determinístico que representa carisma e Status.
  ///
  /// [statusOf] devolve o atributo Status de um candidato — reputação vira
  /// voto, ligando a economia à política.
  Candidacy? resolve({
    required int electorate,
    required DeterministicRandom rng,
    required int Function(String citizenId) statusOf,
  }) {
    if (resolved || _candidates.isEmpty) return null;

    for (final candidate in _candidates) {
      // Imposto baixo agrada; salário alto agrada; Status amplifica.
      final taxAppeal = (Government.maxTaxRate - candidate.platformTaxRate) /
          Government.maxTaxRate;
      final wageAppeal = (candidate.platformWage / 120).clamp(0.0, 1.5);
      final statusAppeal = statusOf(candidate.citizenId) / 12.0;

      final score = taxAppeal * 0.45 + wageAppeal * 0.35 + statusAppeal * 0.20;
      final noise = rng.rangeDouble(0.85, 1.15);
      candidate.votes = (electorate * score * noise / _candidates.length)
          .round()
          .clamp(0, electorate);
    }

    _candidates.sort((a, b) => b.votes.compareTo(a.votes));
    resolved = true;
    winnerId = _candidates.first.citizenId;
    return _candidates.first;
  }
}

/// Comitê Revolucionário. Se a força rebelde superar a do governo, é golpe de
/// estado; caso contrário, os rebeldes viram procurados no servidor.
class RevolutionaryCommittee {
  RevolutionaryCommittee({
    required this.settlementId,
    required this.leaderId,
    required this.leaderName,
    Map<String, double>? members,
  }) : _members = {...?members};

  final String settlementId;
  final String leaderId;
  final String leaderName;

  /// Id do membro → força de combate que ele traz.
  final Map<String, double> _members;

  Map<String, double> get members => Map.unmodifiable(_members);

  void join(String citizenId, double strength) => _members[citizenId] = strength;
  void leave(String citizenId) => _members.remove(citizenId);

  double get strength => _members.values.fold(0.0, (a, b) => a + b);

  /// Tenta o golpe contra [government].
  CoupResult attemptCoup(Government government) {
    final rebel = strength;
    final loyal = government.defenseStrength;

    if (rebel > loyal) {
      final looted = government.applyCoup(
        rebelLeaderId: leaderId,
        rebelLeaderName: leaderName,
      );
      return CoupResult(
        succeeded: true,
        rebelStrength: rebel,
        governmentStrength: loyal,
        lootedTreasury: looted,
        wantedIds: const [],
      );
    }

    // Fracassou: todo mundo do comitê vira procurado.
    for (final id in _members.keys) {
      government.markWanted(id);
    }
    government.markWanted(leaderId);

    return CoupResult(
      succeeded: false,
      rebelStrength: rebel,
      governmentStrength: loyal,
      lootedTreasury: 0,
      wantedIds: [..._members.keys, leaderId],
    );
  }
}

class CoupResult {
  const CoupResult({
    required this.succeeded,
    required this.rebelStrength,
    required this.governmentStrength,
    required this.lootedTreasury,
    required this.wantedIds,
  });

  final bool succeeded;
  final double rebelStrength;
  final double governmentStrength;
  final int lootedTreasury;
  final List<String> wantedIds;
}
