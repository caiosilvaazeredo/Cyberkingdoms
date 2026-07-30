import 'package:flutter/material.dart';

import '../../core/audio/audio_service.dart';
import '../../core/theme.dart';
import 'vital_bar.dart';

/// Botão de som no HUD.
///
/// Um toque silencia tudo; um toque longo abre os controles detalhados. Estar
/// no HUD, e não enterrado num menu de opções, é deliberado: som num jogo de
/// celular precisa ser desligável na hora em que incomoda.
class AudioToggleButton extends StatefulWidget {
  const AudioToggleButton({super.key});

  @override
  State<AudioToggleButton> createState() => _AudioToggleButtonState();
}

class _AudioToggleButtonState extends State<AudioToggleButton> {
  @override
  Widget build(BuildContext context) {
    final audio = AudioService.instance;
    final anyOn = audio.sfxEnabled || audio.musicEnabled || audio.voiceEnabled;

    return Tooltip(
      message: anyOn ? 'Silenciar (segure para ajustar)' : 'Ativar som',
      child: InkWell(
        borderRadius: BorderRadius.circular(8),
        onTap: () async {
          if (anyOn) {
            await audio.muteAll();
          } else {
            await audio.setSfxEnabled(true);
            await audio.setMusicEnabled(true);
            await audio.setVoiceEnabled(true);
            audio.play(Sfx.tap);
          }
          if (mounted) setState(() {});
        },
        onLongPress: () async {
          await showAudioSettings(context);
          if (mounted) setState(() {});
        },
        child: Padding(
          padding: const EdgeInsets.all(6),
          child: Icon(
            anyOn ? Icons.volume_up : Icons.volume_off,
            size: 18,
            color: anyOn ? CyberColors.cyan : CyberColors.outline,
          ),
        ),
      ),
    );
  }
}

/// Folha com os três canais de áudio e o volume geral.
Future<void> showAudioSettings(BuildContext context) async {
  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (sheetContext) => const _AudioSettingsSheet(),
  );
}

class _AudioSettingsSheet extends StatefulWidget {
  const _AudioSettingsSheet();

  @override
  State<_AudioSettingsSheet> createState() => _AudioSettingsSheetState();
}

class _AudioSettingsSheetState extends State<_AudioSettingsSheet> {
  @override
  Widget build(BuildContext context) {
    final audio = AudioService.instance;

    return SingleChildScrollView(
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 20,
        bottom: MediaQuery.of(context).viewInsets.bottom + 32,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text(
            'SOM',
            style: TextStyle(
              fontWeight: FontWeight.w900,
              letterSpacing: 1.4,
              fontSize: 15,
            ),
          ),
          const SizedBox(height: 4),
          const Text(
            'Os três canais são independentes: dá para manter o retorno dos '
            'cliques e desligar só a locução de combate.',
            style: TextStyle(fontSize: 11, color: CyberColors.textSecondary),
          ),

          const SectionHeader('Volume geral'),
          Row(
            children: [
              const Icon(Icons.volume_mute,
                  size: 16, color: CyberColors.textSecondary),
              Expanded(
                child: Slider(
                  value: audio.masterVolume,
                  divisions: 20,
                  label: '${(audio.masterVolume * 100).round()}%',
                  onChanged: (v) => setState(() => audio.setMasterVolume(v)),
                  onChangeEnd: (_) => audio.play(Sfx.tap),
                ),
              ),
              const Icon(Icons.volume_up, size: 16, color: CyberColors.cyan),
              SizedBox(
                width: 44,
                child: Text(
                  '${(audio.masterVolume * 100).round()}%',
                  textAlign: TextAlign.right,
                  style: const TextStyle(fontSize: 12),
                ),
              ),
            ],
          ),

          const SectionHeader('Canais'),
          _Channel(
            icon: Icons.touch_app,
            label: 'Efeitos',
            description: 'Cliques, moedas, construção, passos.',
            value: audio.sfxEnabled,
            onChanged: (v) async {
              await audio.setSfxEnabled(v);
              if (v) audio.play(Sfx.tap);
              if (mounted) setState(() {});
            },
          ),
          _Channel(
            icon: Icons.music_note,
            label: 'Jingles',
            description: 'Quest concluída, promoção, fim de dia.',
            value: audio.musicEnabled,
            onChanged: (v) async {
              await audio.setMusicEnabled(v);
              if (v) audio.playJingle(Jingle.questComplete);
              if (mounted) setState(() {});
            },
          ),
          _Channel(
            icon: Icons.record_voice_over,
            label: 'Locução',
            description: 'Narração dos combates de estrada.',
            value: audio.voiceEnabled,
            onChanged: (v) async {
              await audio.setVoiceEnabled(v);
              if (v) audio.playVoice(Voice.fight);
              if (mounted) setState(() {});
            },
          ),

          if (!audio.isReady)
            Padding(
              padding: const EdgeInsets.only(top: 16),
              child: Text(
                'Os sons ainda não terminaram de carregar. No navegador, isso '
                'só acontece depois da primeira interação com a página.',
                style: TextStyle(
                  fontSize: 10,
                  color: CyberColors.amber.withValues(alpha: 0.9),
                ),
              ),
            ),

          const SizedBox(height: 24),
          FilledButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('FECHAR'),
          ),
        ],
      ),
    );
  }
}

class _Channel extends StatelessWidget {
  const _Channel({
    required this.icon,
    required this.label,
    required this.description,
    required this.value,
    required this.onChanged,
  });

  final IconData icon;
  final String label;
  final String description;
  final bool value;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: SwitchListTile.adaptive(
        value: value,
        onChanged: onChanged,
        contentPadding: EdgeInsets.zero,
        secondary: Icon(
          icon,
          color: value ? CyberColors.cyan : CyberColors.outline,
        ),
        title: Text(label, style: const TextStyle(fontSize: 13)),
        subtitle: Text(
          description,
          style: const TextStyle(fontSize: 10, color: CyberColors.outline),
        ),
      ),
    );
  }
}
