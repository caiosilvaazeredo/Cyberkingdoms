import 'package:cloud_firestore/cloud_firestore.dart';

import '../domain/campaign/campaign.dart';
import 'campaign_repository.dart';

/// Espelha campanhas no Firestore do projeto `cyberkingdoms-f1142`.
///
/// Estrutura de coleções:
/// ```
/// users/{uid}/campaigns/{campaignId}   -> documento da campanha
/// ```
///
/// **Estado atual:** este repositório só entra em uso depois de rodar
/// `flutterfire configure` e substituir o `firebase_options.dart`. Até lá o
/// app usa [LocalCampaignRepository]. A escrita é a mesma em ambos, então
/// trocar não exige mudança em nenhuma tela.
///
/// **Nota de arquitetura para o MMO:** o Firestore aqui guarda o estado do
/// jogador. A economia compartilhada (livro de ofertas, governos, eleições)
/// vai precisar de escrita transacional e de um worker de tick autoritativo —
/// não dá para deixar o cliente fechar o próprio dia num MMO com dinheiro real
/// em jogo. O [DailyTick] já é determinístico justamente para que esse worker
/// possa recalcular e validar.
class FirebaseCampaignRepository implements CampaignRepository {
  FirebaseCampaignRepository({
    required this.userId,
    FirebaseFirestore? firestore,
  }) : _db = firestore ?? FirebaseFirestore.instance;

  final String userId;
  final FirebaseFirestore _db;

  CollectionReference<Map<String, dynamic>> get _collection =>
      _db.collection('users').doc(userId).collection('campaigns');

  @override
  Future<List<CampaignSummary>> listCampaigns() async {
    final snapshot = await _collection.get();
    return snapshot.docs
        .map((doc) => Campaign.fromJson(doc.data()).summary)
        .toList()
      ..sort((a, b) =>
          (b.createdAt ?? DateTime(0)).compareTo(a.createdAt ?? DateTime(0)));
  }

  @override
  Future<Campaign?> loadCampaign(String id) async {
    final doc = await _collection.doc(id).get();
    final data = doc.data();
    if (data == null) return null;
    return Campaign.fromJson(data);
  }

  @override
  Future<void> saveCampaign(Campaign campaign) =>
      _collection.doc(campaign.id).set(campaign.toJson());

  @override
  Future<void> deleteCampaign(String id) => _collection.doc(id).delete();
}
