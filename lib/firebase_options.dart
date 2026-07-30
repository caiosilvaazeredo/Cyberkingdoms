import 'package:firebase_core/firebase_core.dart' show FirebaseOptions;

/// PLACEHOLDER — este arquivo ainda não foi gerado.
///
/// Para conectar o app ao projeto `cyberkingdoms-f1142`, rode na raiz do
/// projeto Flutter:
///
/// ```sh
/// dart pub global activate flutterfire_cli
/// flutterfire configure --project=cyberkingdoms-f1142
/// ```
///
/// A CLI **sobrescreve este arquivo** com as chaves reais de cada plataforma e
/// registra os apps Android/iOS/Web no console do Firebase. Ela exige login
/// OAuth interativo, por isso não pôde ser executada no ambiente de build.
///
/// Enquanto [isConfigured] for `false`, o app inicia em modo offline e usa o
/// [LocalCampaignRepository]. Nenhuma tela precisa mudar depois da troca.
abstract final class DefaultFirebaseOptions {
  /// A CLI do FlutterFire não gera este campo — ele sobrevive apenas enquanto
  /// o arquivo é o placeholder. Depois de rodar `flutterfire configure`,
  /// ajuste [FirebaseBootstrap] para simplesmente tentar `initializeApp`.
  static const bool isConfigured = false;

  static FirebaseOptions get currentPlatform => throw UnsupportedError(
        'firebase_options.dart ainda é um placeholder. '
        'Rode `flutterfire configure --project=cyberkingdoms-f1142`.',
      );
}
