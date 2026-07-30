import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/theme.dart';
import 'ui/screens/campaign_select_screen.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Mobile-first: o jogo é feito para retrato e para o polegar.
  await SystemChrome.setPreferredOrientations([
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
  ]);
  SystemChrome.setSystemUIOverlayStyle(CyberTheme.overlayStyle);

  runApp(const ProviderScope(child: CyberKingdomsApp()));
}

class CyberKingdomsApp extends StatelessWidget {
  const CyberKingdomsApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'CyberKingdoms',
      debugShowCheckedModeBanner: false,
      theme: CyberTheme.build(),
      home: const CampaignSelectScreen(),
    );
  }
}
