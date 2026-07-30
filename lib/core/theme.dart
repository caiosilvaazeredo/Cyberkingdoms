import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Paleta do canvas de design: fundo grafite/preto petróleo com neon ciano e
/// rosa shocking. Minimalista — o visual do jogo é o mundo isométrico, a UI
/// existe para não atrapalhar.
abstract final class CyberColors {
  static const background = Color(0xFF07070C);
  static const surface = Color(0xFF12121B);
  static const surfaceHigh = Color(0xFF1B1B28);
  static const outline = Color(0xFF2C2C3D);

  static const cyan = Color(0xFF00E5FF);
  static const pink = Color(0xFFFF2D95);
  static const amber = Color(0xFFFFB300);
  static const green = Color(0xFF00E676);
  static const violet = Color(0xFFB388FF);
  static const danger = Color(0xFFFF5252);

  static const textPrimary = Color(0xFFE8E8F0);
  static const textSecondary = Color(0xFF9A9AB0);

  /// Cor da barra vital conforme o quanto resta. Verde → âmbar → vermelho é
  /// leitura instantânea, importante numa mecânica que mata por descuido.
  static Color vital(double ratio) {
    if (ratio > 0.6) return green;
    if (ratio > 0.3) return amber;
    return danger;
  }
}

abstract final class CyberTheme {
  static const overlayStyle = SystemUiOverlayStyle(
    statusBarColor: Colors.transparent,
    statusBarIconBrightness: Brightness.light,
    systemNavigationBarColor: CyberColors.background,
    systemNavigationBarIconBrightness: Brightness.light,
  );

  static ThemeData build() {
    const scheme = ColorScheme.dark(
      primary: CyberColors.cyan,
      onPrimary: Color(0xFF00131A),
      secondary: CyberColors.pink,
      onSecondary: Color(0xFF1A0010),
      surface: CyberColors.surface,
      onSurface: CyberColors.textPrimary,
      error: CyberColors.danger,
      outline: CyberColors.outline,
    );

    final base = ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: CyberColors.background,
      fontFamily: 'KenneyInput',
    );

    return base.copyWith(
      textTheme: base.textTheme.apply(
        bodyColor: CyberColors.textPrimary,
        displayColor: CyberColors.textPrimary,
      ),
      appBarTheme: const AppBarTheme(
        backgroundColor: CyberColors.background,
        foregroundColor: CyberColors.textPrimary,
        elevation: 0,
        centerTitle: false,
        systemOverlayStyle: overlayStyle,
      ),
      cardTheme: CardThemeData(
        color: CyberColors.surface,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(14),
          side: const BorderSide(color: CyberColors.outline),
        ),
        margin: EdgeInsets.zero,
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: CyberColors.cyan,
          foregroundColor: const Color(0xFF00131A),
          // Alvos de toque generosos: o jogo é mobile-first.
          minimumSize: const Size(0, 52),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
          textStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: CyberColors.cyan,
          minimumSize: const Size(0, 52),
          side: const BorderSide(color: CyberColors.outline),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: CyberColors.surfaceHigh,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: CyberColors.outline),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: CyberColors.outline),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: CyberColors.cyan, width: 2),
        ),
      ),
      dividerTheme: const DividerThemeData(
        color: CyberColors.outline,
        thickness: 1,
        space: 1,
      ),
      snackBarTheme: SnackBarThemeData(
        backgroundColor: CyberColors.surfaceHigh,
        contentTextStyle: const TextStyle(color: CyberColors.textPrimary),
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
        ),
      ),
      bottomSheetTheme: const BottomSheetThemeData(
        backgroundColor: CyberColors.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
        ),
      ),
    );
  }
}
