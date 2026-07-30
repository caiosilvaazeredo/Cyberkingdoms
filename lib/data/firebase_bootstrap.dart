import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart';

import '../firebase_options.dart';
import 'campaign_repository.dart';
import 'firebase_campaign_repository.dart';

/// Resultado da tentativa de subir o Firebase.
class BootstrapResult {
  const BootstrapResult({
    required this.repository,
    required this.online,
    this.userId,
    this.message,
  });

  final CampaignRepository repository;

  /// `true` quando o Firestore está de fato conectado.
  final bool online;

  final String? userId;

  /// Explicação para a UI quando o jogo caiu em modo offline.
  final String? message;
}

/// Inicializa o Firebase e escolhe o repositório.
///
/// O app **nunca falha por causa do Firebase**: se as opções ainda são o
/// placeholder, ou se a rede está fora, ele cai no repositório local e segue
/// jogável. Num jogo offline-first isso não é degradação — é o modo normal.
abstract final class FirebaseBootstrap {
  static Future<BootstrapResult> start() async {
    if (!DefaultFirebaseOptions.isConfigured) {
      return BootstrapResult(
        repository: LocalCampaignRepository(),
        online: false,
        message: 'Modo offline: rode `flutterfire configure '
            '--project=cyberkingdoms-f1142` para sincronizar na nuvem.',
      );
    }

    try {
      await Firebase.initializeApp(
        options: DefaultFirebaseOptions.currentPlatform,
      );

      // Anônimo é suficiente para o MVP: o jogador ganha um id estável sem
      // precisar criar conta. Dá para promover para e-mail/Google depois sem
      // perder as campanhas.
      final credential = await FirebaseAuth.instance.signInAnonymously();
      final uid = credential.user?.uid;
      if (uid == null) {
        return BootstrapResult(
          repository: LocalCampaignRepository(),
          online: false,
          message: 'Não foi possível autenticar. Jogando offline.',
        );
      }

      return BootstrapResult(
        repository: FirebaseCampaignRepository(userId: uid),
        online: true,
        userId: uid,
      );
    } catch (error, stack) {
      debugPrint('Firebase indisponível: $error\n$stack');
      return BootstrapResult(
        repository: LocalCampaignRepository(),
        online: false,
        message: 'Firebase indisponível. Jogando offline.',
      );
    }
  }
}
