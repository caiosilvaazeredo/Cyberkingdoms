import 'package:flame_audio/flame_audio.dart';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Efeitos curtos de interface e de mundo.
///
/// Cada valor aponta para um arquivo dos packs da Kenney. A separação em
/// enum (em vez de espalhar strings pelo código) garante que renomear um
/// arquivo quebre a compilação, não o jogo em runtime.
enum Sfx {
  /// Toque genérico em botão.
  tap('ui/click1.ogg'),

  /// Troca de aba ou de tela.
  navigate('ui/click3.ogg'),

  /// Liga/desliga: escolher trabalho, selecionar construção no catálogo.
  toggle('ui/switch2.ogg'),

  /// Seleção secundária, mais discreta.
  select('ui/switch11.ogg'),

  /// Abrir folha modal.
  openSheet('game/bookOpen.ogg'),

  /// Fechar folha modal.
  closeSheet('game/bookClose.ogg'),

  /// Rolar lista longa / trocar de página.
  flip('game/bookFlip1.ogg'),

  /// Qualquer transação com dinheiro.
  coins('game/handleCoins.ogg'),

  /// Recebimento de salário ou recompensa em créditos.
  coinsBig('game/handleCoins2.ogg'),

  /// Iniciar uma obra.
  build('game/metalClick.ogg'),

  /// Instalar módulo ou evoluir construção.
  moduleInstall('game/metalLatch.ogg'),

  /// Demolir.
  demolish('game/creak1.ogg'),

  /// Equipar item.
  equip('game/cloth1.ogg'),

  /// Descartar / remover módulo.
  drop('game/dropLeather.ogg'),

  /// Partir em viagem.
  travelStart('game/doorOpen_1.ogg'),

  /// Chegar ao destino.
  travelEnd('game/doorClose_1.ogg'),

  /// Mover o personagem no mundo.
  step('game/footstep00.ogg'),

  /// Passo alternativo, para não repetir o mesmo som.
  stepAlt('game/footstep03.ogg'),

  /// Golpe pesado no relatório de combate.
  hit('game/chop.ogg'),

  /// Golpe cortante.
  slash('game/knifeSlice.ogg');

  const Sfx(this.asset);
  final String asset;
}

/// Trechos musicais curtos que marcam conquistas.
enum Jingle {
  /// Quest da campanha concluída.
  questComplete('jingles/jingles_NES03.ogg'),

  /// Promoção de nível de cidadania.
  levelUp('jingles/jingles_NES07.ogg'),

  /// Obra terminada no terreno.
  buildComplete('jingles/jingles_NES00.ogg'),

  /// Fechamento do dia sem incidentes.
  dayEnd('jingles/jingles_NES10.ogg'),

  /// Morte permanente.
  defeat('jingles/jingles_STEEL05.ogg'),

  /// Vitória importante (golpe de estado, eleição).
  triumph('jingles/jingles_NES13.ogg');

  const Jingle(this.asset);
  final String asset;
}

/// Locuções, usadas só no combate. Vêm do Voice-over Pack: Fighter, que tem
/// entonação de jogo de luta — combina com o PvP de estrada, que é o momento
/// mais tenso do ciclo diário.
enum Voice {
  ambush('voice/prepare_yourself.ogg'),
  fight('voice/fight.ogg'),
  round('voice/round_1.ogg'),
  win('voice/you_win.ogg'),
  lose('voice/you_lose.ogg'),
  flawless('voice/flawless_victory.ogg'),
  gameOver('voice/game_over.ogg');

  const Voice(this.asset);
  final String asset;
}

/// Toca o áudio do jogo.
///
/// Três canais independentes — efeitos, jingles e voz — porque são incômodos
/// muito diferentes: quem se irrita com a locução de combate não
/// necessariamente quer perder o feedback tátil dos cliques.
///
/// **Nunca lança.** Áudio é acessório: se um arquivo faltar, se a plataforma
/// bloquear a reprodução antes do primeiro gesto do usuário (regra dos
/// navegadores) ou se o dispositivo não tiver saída, o jogo segue em silêncio.
class AudioService {
  AudioService._();

  static final AudioService instance = AudioService._();

  static const _keySfx = 'audio.sfx';
  static const _keyMusic = 'audio.music';
  static const _keyVoice = 'audio.voice';
  static const _keyVolume = 'audio.volume';

  bool _sfxEnabled = true;
  bool _musicEnabled = true;
  bool _voiceEnabled = true;
  double _masterVolume = 0.7;

  bool _ready = false;

  bool get sfxEnabled => _sfxEnabled;
  bool get musicEnabled => _musicEnabled;
  bool get voiceEnabled => _voiceEnabled;
  double get masterVolume => _masterVolume;

  /// `true` quando os arquivos já foram carregados em cache.
  bool get isReady => _ready;

  /// Carrega as preferências e pré-carrega os arquivos.
  ///
  /// Deve ser chamado no boot, mas o jogo funciona sem: sem pré-carga, o
  /// primeiro toque de cada som tem uma latência pequena.
  Future<void> initialize() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      _sfxEnabled = prefs.getBool(_keySfx) ?? true;
      _musicEnabled = prefs.getBool(_keyMusic) ?? true;
      _voiceEnabled = prefs.getBool(_keyVoice) ?? true;
      _masterVolume = prefs.getDouble(_keyVolume) ?? 0.7;
    } catch (error) {
      debugPrint('Preferências de áudio indisponíveis: $error');
    }

    try {
      await FlameAudio.audioCache.loadAll([
        for (final sfx in Sfx.values) sfx.asset,
        for (final jingle in Jingle.values) jingle.asset,
        for (final voice in Voice.values) voice.asset,
      ]);
      _ready = true;
    } catch (error) {
      // Pré-carga falha em alguns navegadores até haver interação do usuário.
      // Não é fatal: `play` tenta de novo sob demanda.
      debugPrint('Pré-carga de áudio falhou: $error');
    }
  }

  Future<void> setSfxEnabled(bool value) async {
    _sfxEnabled = value;
    await _persist(_keySfx, value);
  }

  Future<void> setMusicEnabled(bool value) async {
    _musicEnabled = value;
    await _persist(_keyMusic, value);
  }

  Future<void> setVoiceEnabled(bool value) async {
    _voiceEnabled = value;
    await _persist(_keyVoice, value);
  }

  Future<void> setMasterVolume(double value) async {
    _masterVolume = value.clamp(0.0, 1.0);
    await _persist(_keyVolume, _masterVolume);
  }

  /// Silencia tudo de uma vez.
  Future<void> muteAll() async {
    await setSfxEnabled(false);
    await setMusicEnabled(false);
    await setVoiceEnabled(false);
  }

  void play(Sfx sfx, {double volume = 1.0}) {
    if (!_sfxEnabled) return;
    _fire(sfx.asset, volume);
  }

  void playJingle(Jingle jingle, {double volume = 1.0}) {
    if (!_musicEnabled) return;
    // Jingles são mais altos que os efeitos na masterização original da
    // Kenney; abaixamos para não estourar sobre o resto.
    _fire(jingle.asset, volume * 0.55);
  }

  void playVoice(Voice voice, {double volume = 1.0}) {
    if (!_voiceEnabled) return;
    _fire(voice.asset, volume * 0.85);
  }

  /// Alterna entre dois passos, para caminhar não soar mecânico.
  bool _leftFoot = true;
  void playStep() {
    play(_leftFoot ? Sfx.step : Sfx.stepAlt, volume: 0.6);
    _leftFoot = !_leftFoot;
  }

  void _fire(String asset, double volume) {
    final effective = (volume * _masterVolume).clamp(0.0, 1.0);
    if (effective <= 0) return;
    // Sem `await`: som nunca deve segurar a UI. Erros são engolidos porque
    // áudio ausente não pode virar exceção de gameplay.
    unawaited(FlameAudio.play(asset, volume: effective));
  }

  Future<void> _persist(String key, Object value) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      if (value is bool) await prefs.setBool(key, value);
      if (value is double) await prefs.setDouble(key, value);
    } catch (error) {
      debugPrint('Não foi possível salvar preferência de áudio: $error');
    }
  }
}

/// Dispara um future sem esperar e sem deixar o erro escapar.
void unawaited(Future<void> future) {
  future.catchError((Object error) {
    debugPrint('Áudio falhou: $error');
  });
}
