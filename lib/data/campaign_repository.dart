import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../domain/campaign/campaign.dart';

/// Onde as campanhas ficam guardadas.
///
/// A interface existe para que o backend Firebase entre sem tocar em nenhuma
/// tela: hoje o jogo roda 100% offline, e quando o Firestore estiver
/// configurado basta trocar a implementação injetada.
abstract interface class CampaignRepository {
  Future<List<CampaignSummary>> listCampaigns();
  Future<Campaign?> loadCampaign(String id);
  Future<void> saveCampaign(Campaign campaign);
  Future<void> deleteCampaign(String id);
}

/// Implementação local sobre `shared_preferences`.
///
/// Escolhida em vez de arquivos porque `path_provider` **não tem implementação
/// para web** e lança `MissingPluginException` no navegador — o que quebrava a
/// listagem de campanhas por completo. `shared_preferences` usa `localStorage`
/// na web, `NSUserDefaults` no iOS e `SharedPreferences` no Android, com a
/// mesma API.
///
/// Uma campanha ocupa poucos KB porque o terreno não é salvo: só a seed, o
/// layout das cidades, o personagem, o vilarejo, os mercados e os governos.
class LocalCampaignRepository implements CampaignRepository {
  LocalCampaignRepository({SharedPreferences? preferences})
      : _injected = preferences;

  final SharedPreferences? _injected;
  SharedPreferences? _resolved;

  /// Prefixo das chaves. Uma campanha por chave permite salvar uma sem
  /// reescrever as outras.
  static const String _keyPrefix = 'campaign:';

  Future<SharedPreferences> _prefs() async =>
      _resolved ??= _injected ?? await SharedPreferences.getInstance();

  String _keyFor(String id) => '$_keyPrefix$id';

  @override
  Future<List<CampaignSummary>> listCampaigns() async {
    final prefs = await _prefs();
    final summaries = <CampaignSummary>[];

    for (final key in prefs.getKeys()) {
      if (!key.startsWith(_keyPrefix)) continue;
      final raw = prefs.getString(key);
      if (raw == null) continue;
      try {
        final json = jsonDecode(raw) as Map<String, dynamic>;
        summaries.add(Campaign.fromJson(json).summary);
      } catch (error, stack) {
        // Um save corrompido não pode impedir o jogador de abrir os outros.
        debugPrint('Campanha ilegível em $key: $error\n$stack');
      }
    }

    summaries.sort((a, b) =>
        (b.createdAt ?? DateTime(0)).compareTo(a.createdAt ?? DateTime(0)));
    return summaries;
  }

  @override
  Future<Campaign?> loadCampaign(String id) async {
    final prefs = await _prefs();
    final raw = prefs.getString(_keyFor(id));
    if (raw == null) return null;
    return Campaign.fromJson(jsonDecode(raw) as Map<String, dynamic>);
  }

  @override
  Future<void> saveCampaign(Campaign campaign) async {
    final prefs = await _prefs();
    await prefs.setString(_keyFor(campaign.id), jsonEncode(campaign.toJson()));
  }

  @override
  Future<void> deleteCampaign(String id) async {
    final prefs = await _prefs();
    await prefs.remove(_keyFor(id));
  }
}

/// Repositório em memória, para testes e para o caso de o armazenamento do
/// dispositivo falhar. Nunca persiste — mas mantém o jogo jogável na sessão.
class InMemoryCampaignRepository implements CampaignRepository {
  final Map<String, String> _store = {};

  @override
  Future<List<CampaignSummary>> listCampaigns() async {
    final summaries = _store.values
        .map((raw) =>
            Campaign.fromJson(jsonDecode(raw) as Map<String, dynamic>).summary)
        .toList();
    summaries.sort((a, b) =>
        (b.createdAt ?? DateTime(0)).compareTo(a.createdAt ?? DateTime(0)));
    return summaries;
  }

  @override
  Future<Campaign?> loadCampaign(String id) async {
    final raw = _store[id];
    if (raw == null) return null;
    return Campaign.fromJson(jsonDecode(raw) as Map<String, dynamic>);
  }

  @override
  Future<void> saveCampaign(Campaign campaign) async {
    _store[campaign.id] = jsonEncode(campaign.toJson());
  }

  @override
  Future<void> deleteCampaign(String id) async {
    _store.remove(id);
  }
}
