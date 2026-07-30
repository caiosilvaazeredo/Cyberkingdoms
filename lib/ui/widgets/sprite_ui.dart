import 'package:flutter/material.dart';

import '../../core/theme.dart';

/// Widgets construídos sobre os sprites de UI da Kenney.
///
/// A UI do jogo é pixel art esticada, então três regras valem em todo este
/// arquivo:
///
/// 1. `filterQuality: none` — interpolação borra pixel art. Sem isso os
///    sprites viram um borrão em telas de alta densidade.
/// 2. 9-slice / 3-slice via `centerSlice` — permite esticar um painel de 64px
///    para qualquer tamanho sem deformar as bordas.
/// 3. Tint por `ColorFilter` — os packs vêm em azul/verde/vermelho/cinza; o
///    tint adapta ao neon ciano/rosa do CyberKingdoms sem re-exportar arte.

/// Painel 9-slice. Substitui `Card` onde a moldura de sprite agrega.
class SpritePanel extends StatelessWidget {
  const SpritePanel({
    super.key,
    required this.child,
    this.asset = 'assets/ui/panels/grey_panel.png',
    this.tint,
    this.padding = const EdgeInsets.all(14),
    this.margin,
  });

  /// Variante azul, para destaque.
  const SpritePanel.blue({
    super.key,
    required this.child,
    this.tint,
    this.padding = const EdgeInsets.all(14),
    this.margin,
  }) : asset = 'assets/ui/panels/blue_panel.png';

  final Widget child;
  final String asset;
  final Color? tint;
  final EdgeInsets padding;
  final EdgeInsets? margin;

  /// Os painéis da Kenney têm 64x64 com borda de ~20px. O centerSlice precisa
  /// cair dentro dessa borda, senão o canto estica junto.
  static const Rect _slice = Rect.fromLTRB(22, 22, 42, 42);

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: margin,
      padding: padding,
      decoration: BoxDecoration(
        image: DecorationImage(
          image: AssetImage(asset),
          centerSlice: _slice,
          fit: BoxFit.fill,
          filterQuality: FilterQuality.none,
          colorFilter: tint == null
              ? null
              : ColorFilter.mode(tint!, BlendMode.modulate),
        ),
      ),
      child: child,
    );
  }
}

/// Barra 3-slice montada com as peças `_l`, `_m` e `_r` do pacote espacial.
///
/// É desenhada em `CustomPaint` em vez de widgets empilhados porque a barra
/// aparece várias vezes no HUD e precisa repintar a cada reset sem reconstruir
/// árvore.
class SpriteBar extends StatelessWidget {
  const SpriteBar({
    super.key,
    required this.value,
    required this.color,
    this.height = 16,
  });

  final double value;
  final SpriteBarColor color;
  final double height;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: height,
      width: double.infinity,
      child: _SpriteBarImages(value: value.clamp(0.0, 1.0), color: color),
    );
  }
}

enum SpriteBarColor {
  green('green'),
  red('red'),
  blue('blue'),
  grey('grey');

  const SpriteBarColor(this.folder);
  final String folder;

  String get left => 'assets/ui/bars/${folder}_l.png';
  String get middle => 'assets/ui/bars/${folder}_m.png';
  String get right => 'assets/ui/bars/${folder}_r.png';

  /// Cor da barra segundo o quanto resta — verde, âmbar, vermelho.
  static SpriteBarColor forRatio(double ratio) {
    if (ratio > 0.6) return SpriteBarColor.green;
    if (ratio > 0.3) return SpriteBarColor.blue;
    return SpriteBarColor.red;
  }
}

class _SpriteBarImages extends StatelessWidget {
  const _SpriteBarImages({required this.value, required this.color});

  final double value;
  final SpriteBarColor color;

  /// As peças `_l`/`_r` têm 8px de largura no asset original.
  static const double _capWidth = 8;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final width = constraints.maxWidth;
        final height = constraints.maxHeight;
        final fillWidth = width * value;

        return Stack(
          fit: StackFit.expand,
          children: [
            // Trilho.
            _threeSlice(
              'assets/ui/bars/track_l.png',
              'assets/ui/bars/track_m.png',
              'assets/ui/bars/track_r.png',
              width,
              height,
            ),
            // Preenchimento, cortado à esquerda para não deformar a ponta.
            ClipRect(
              clipper: _LeftClipper(fillWidth),
              child: _threeSlice(
                color.left,
                color.middle,
                color.right,
                width,
                height,
              ),
            ),
          ],
        );
      },
    );
  }

  Widget _threeSlice(
    String left,
    String middle,
    String right,
    double width,
    double height,
  ) {
    final capWidth = _capWidth.clamp(0.0, width / 2);
    return Row(
      children: [
        Image.asset(left,
            width: capWidth,
            height: height,
            fit: BoxFit.fill,
            filterQuality: FilterQuality.none),
        Expanded(
          child: Image.asset(middle,
              height: height,
              fit: BoxFit.fill,
              filterQuality: FilterQuality.none),
        ),
        Image.asset(right,
            width: capWidth,
            height: height,
            fit: BoxFit.fill,
            filterQuality: FilterQuality.none),
      ],
    );
  }
}

class _LeftClipper extends CustomClipper<Rect> {
  const _LeftClipper(this.width);

  final double width;

  @override
  Rect getClip(Size size) => Rect.fromLTWH(0, 0, width, size.height);

  @override
  bool shouldReclip(_LeftClipper oldClipper) => oldClipper.width != width;
}

/// Botão com moldura de sprite. Usado nas ações de peso (RESET, CONSTRUIR).
class SpriteButton extends StatelessWidget {
  const SpriteButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.icon,
    this.tint,
    this.compact = false,
  });

  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;
  final Color? tint;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final enabled = onPressed != null;
    final content = Row(
      mainAxisSize: MainAxisSize.min,
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        if (icon != null) ...[
          Icon(icon, size: compact ? 13 : 16),
          const SizedBox(width: 8),
        ],
        Flexible(
          child: Text(
            label,
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: compact ? 11 : 13,
              fontWeight: FontWeight.w800,
              letterSpacing: 0.6,
            ),
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );

    return Opacity(
      opacity: enabled ? 1 : 0.45,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onPressed,
          borderRadius: BorderRadius.circular(8),
          child: SpritePanel(
            asset: 'assets/ui/panels/blue_notch.png',
            tint: tint,
            padding: EdgeInsets.symmetric(
              horizontal: compact ? 12 : 18,
              vertical: compact ? 8 : 13,
            ),
            child: DefaultTextStyle.merge(
              style: const TextStyle(color: Colors.white),
              child: IconTheme(
                data: const IconThemeData(color: Colors.white),
                child: content,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Moldura decorativa fina, para separar seções sem peso visual.
class SpriteFrame extends StatelessWidget {
  const SpriteFrame({
    super.key,
    required this.child,
    this.tint = CyberColors.cyan,
    this.padding = const EdgeInsets.all(12),
  });

  final Widget child;
  final Color tint;
  final EdgeInsets padding;

  static const Rect _slice = Rect.fromLTRB(16, 16, 32, 32);

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: padding,
      decoration: BoxDecoration(
        image: DecorationImage(
          image: const AssetImage('assets/ui/panels/frame_border.png'),
          centerSlice: _slice,
          fit: BoxFit.fill,
          filterQuality: FilterQuality.none,
          colorFilter: ColorFilter.mode(tint, BlendMode.modulate),
        ),
      ),
      child: child,
    );
  }
}
