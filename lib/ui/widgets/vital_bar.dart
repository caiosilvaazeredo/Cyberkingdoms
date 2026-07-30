import 'package:flutter/material.dart';

import '../../core/theme.dart';
import 'sprite_ui.dart';

/// Barra vital com rótulo e valor. O canvas pede "barras vitais visuais" como
/// feedback primário — é a leitura mais rápida de que o jogador está prestes a
/// morrer de fome.
class VitalBar extends StatelessWidget {
  const VitalBar({
    super.key,
    required this.label,
    required this.value,
    required this.max,
    this.color,
    this.spriteColor,
    this.compact = false,
  });

  final String label;
  final int value;
  final int max;

  /// Cor do número à direita. A barra em si usa [spriteColor].
  final Color? color;

  /// Força uma cor de sprite. Sem isso, a barra muda de cor conforme esvazia.
  final SpriteBarColor? spriteColor;

  final bool compact;

  @override
  Widget build(BuildContext context) {
    final ratio = max == 0 ? 0.0 : (value / max).clamp(0.0, 1.0);
    final barColor = color ?? CyberColors.vital(ratio);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              label,
              style: TextStyle(
                fontSize: compact ? 10 : 12,
                color: CyberColors.textSecondary,
                letterSpacing: 0.5,
              ),
            ),
            Text(
              '$value',
              style: TextStyle(
                fontSize: compact ? 10 : 12,
                color: barColor,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
        SizedBox(height: compact ? 2 : 4),
        // Barra de sprite da Kenney: dá peso de HUD de jogo ao que antes era um
        // `LinearProgressIndicator` genérico de Material.
        SpriteBar(
          value: ratio,
          color: spriteColor ?? SpriteBarColor.forRatio(ratio),
          height: compact ? 10 : 16,
        ),
      ],
    );
  }
}

/// Cartão de estatística compacto — usado no HUD e nas telas de cidade.
class StatChip extends StatelessWidget {
  const StatChip({
    super.key,
    required this.label,
    required this.value,
    this.color = CyberColors.cyan,
    this.icon,
  });

  final String label;
  final String value;
  final Color color;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
      decoration: BoxDecoration(
        color: CyberColors.surfaceHigh,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: color.withValues(alpha: 0.35)),
      ),
      // `Flexible` + elipse nos dois textos: sem isso, um chip dentro de um
      // `Expanded` estoura quando o valor cresce (um tesouro de 6 dígitos
      // derrubava a tela de política num celular de 320px).
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 14, color: color),
            const SizedBox(width: 6),
          ],
          Flexible(
            child: Text(
              value,
              overflow: TextOverflow.ellipsis,
              softWrap: false,
              style: TextStyle(
                color: color,
                fontWeight: FontWeight.w700,
                fontSize: 13,
              ),
            ),
          ),
          const SizedBox(width: 5),
          Flexible(
            child: Text(
              label,
              overflow: TextOverflow.ellipsis,
              softWrap: false,
              style: const TextStyle(
                color: CyberColors.textSecondary,
                fontSize: 11,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Cabeçalho de seção, para dar ritmo às listas longas.
class SectionHeader extends StatelessWidget {
  const SectionHeader(this.title, {super.key, this.trailing});

  final String title;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 20, 4, 10),
      child: Row(
        children: [
          Container(width: 3, height: 16, color: CyberColors.pink),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              title.toUpperCase(),
              style: const TextStyle(
                fontSize: 12,
                letterSpacing: 1.4,
                fontWeight: FontWeight.w700,
                color: CyberColors.textSecondary,
              ),
            ),
          ),
          if (trailing != null) trailing!,
        ],
      ),
    );
  }
}
