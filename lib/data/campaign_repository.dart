import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';

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

/// Implementação em arquivo local. Uma campanha = um JSON.
///
/// Cabe em poucos KB porque o terreno não é salvo: só a seed, o layout das
/// cidades, o personagem, os mercados e os governos.
class LocalCampaignRepository implements CampaignRepository {
  LocalCampaignRepository({Directory? root}) : _rootOverride = root;

  final Directory? _rootOverride;
  Directory? _resolved;

  Future<Directory> _root() async {
    if (_resolved != null) return _resolved!;
    final base = _rootOverride ?? await getApplicationDocumentsDirectory();
    final dir = Directory('${base.path}/campaigns');
    if (!await dir.exists()) {
      await dir.create(recursive: true);
    }
    return _resolved = dir;
  }

  File _fileFor(Directory root, String id) => File('${root.path}/$id.json');

  @override
  Future<List<CampaignSummary>> listCampaigns() async {
    final root = await _root();
    final summaries = <CampaignSummary>[];

    await for (final entity in root.list()) {
      if (entity is! File || !entity.path.endsWith('.json')) continue;
      try {
        final json = jsonDecode(await entity.readAsString()) as Map<String, dynamic>;
        summaries.add(Campaign.fromJson(json).summary);
      } catch (error, stack) {
        // Um save corrompido não pode impedir o jogador de abrir os outros.
        debugPrint('Campanha ilegível em ${entity.path}: $error\n$stack');
      }
    }

    summaries.sort((a, b) =>
        (b.createdAt ?? DateTime(0)).compareTo(a.createdAt ?? DateTime(0)));
    return summaries;
  }

  @override
  Future<Campaign?> loadCampaign(String id) async {
    final root = await _root();
    final file = _fileFor(root, id);
    if (!await file.exists()) return null;
    final json = jsonDecode(await file.readAsString()) as Map<String, dynamic>;
    return Campaign.fromJson(json);
  }

  @override
  Future<void> saveCampaign(Campaign campaign) async {
    final root = await _root();
    // Escreve num temporário e renomeia: se o app morrer no meio do save, o
    // arquivo antigo continua íntegro em vez de virar JSON truncado.
    final temp = File('${root.path}/${campaign.id}.json.tmp');
    await temp.writeAsString(jsonEncode(campaign.toJson()), flush: true);
    await temp.rename(_fileFor(root, campaign.id).path);
  }

  @override
  Future<void> deleteCampaign(String id) async {
    final root = await _root();
    final file = _fileFor(root, id);
    if (await file.exists()) await file.delete();
  }
}
