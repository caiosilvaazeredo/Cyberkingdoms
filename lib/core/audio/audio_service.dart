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

/// Efeitos de combate — sintetizados, não gravados.
///
/// A primeira versão usava o Voice-over Pack: Fighter, com locução de jogo de
/// luta de fliperama ("FIGHT!", "YOU WIN!"). Destoava do tom do jogo: o GDD
/// descreve economia fria, sobrevivência e política, não um torneio. Estes
/// sons são gerados por `tools/audio-synth/synth.py` — serra desafinada,
/// sub-bass e ruído filtrado.
enum CombatSfx {
  /// Emboscada detectada na estrada.
  alert('combat/alert.ogg'),

  /// Golpe comum.
  impact('combat/impact.ogg'),

  /// Golpe crítico.
  critical('combat/critical.ogg'),

  /// Você venceu o encontro.
  victory('combat/victory.ogg'),

  /// Você perdeu o encontro.
  defeat('combat/defeat.ogg'),

  /// Morte permanente por abandono.
  death('combat/death.ogg'),

  /// Bipe neutro de terminal, para confirmações.
  scan('combat/scan.ogg');

  const CombatSfx(this.asset);
  final String asset;
}

/// Trilhas de fundo em loop.
///
/// A troca é por contexto, não por tela: alternar a música a cada aba deixaria
/// o jogo agitado e chamaria atenção para a navegação em vez do mundo.
enum MusicTrack {
  /// Menu, cidade, mercado e política. Lenta e sombria.
  city('music/city.ogg'),

  /// Exploração do mundo aberto e do terreno. Pulso constante.
  world('music/world.ogg'),

  /// Estrada e combate. Mais rápida, baixo insistente.
  tension('music/tension.ogg');

  const MusicTrack(this.asset);
  final String asset;
}

/// Toca o áudio do jogo.
///
/// Três canais independentes — efeitos de interface, trilha/jingles e combate
/// — porque incomodam de formas diferentes: quem se cansa da música de fundo
/// não necessariamente quer perder o retorno tátil dos cliques.
///
/// **Nunca lança.** Áudio é acessório: se um arquivo faltar, se a plataforma
/// bloquear a reprodução antes do primeiro gesto do usuário (regra dos
/// navegadores) ou se o dispositivo não tiver saída, o jogo segue em silêncio.
class AudioService {
  AudioService._();

  static final AudioService instance = AudioService._();

  static const _keySfx = 'audio.sfx';
  static const _keyMusic = 'audio.music';
  static const _keyCombat = 'audio.combat';
  static const _keyMusicVolume = 'audio.musicVolume';
  static const _keyVolume = 'audio.volume';

  bool _sfxEnabled = true;
  bool _musicEnabled = true;
  bool _combatEnabled = true;
  double _masterVolume = 0.7;

  /// A trilha fica bem abaixo dos efeitos: é fundo, não evento.
  double _musicVolume = 0.35;

  bool _ready = false;

  /// Interruptor geral. Quando `false`, todo método vira no-op.
  ///
  /// Existe para os testes: o `audioplayers` abre canais de evento nativos com
  /// nome dinâmico (um UUID por player), que não podem ser mocados por nome e
  /// lançam `MissingPluginException` assíncrona — o `flutter_test` conta isso
  /// como falha do teste que estava rodando, mesmo o app tratando o erro.
  /// Silenciar na raiz é mais honesto do que espalhar `try/catch` nos testes.
  bool _enabled = true;

  /// Desliga o áudio por completo. Chamado no `flutter_test_config.dart`.
  void disableForTests() => _enabled = false;

  bool get sfxEnabled => _sfxEnabled;
  bool get musicEnabled => _musicEnabled;
  bool get combatEnabled => _combatEnabled;
  double get masterVolume => _masterVolume;
  double get musicVolume => _musicVolume;

  /// `true` quando os arquivos já foram carregados em cache.
  bool get isReady => _ready;

  /// Carrega as preferências e pré-carrega os arquivos.
  ///
  /// Deve ser chamado no boot, mas o jogo funciona sem: sem pré-carga, o
  /// primeiro toque de cada som tem uma latência pequena.
  Future<void> initialize() async {
    if (!_enabled) return;
    try {
      final prefs = await SharedPreferences.getInstance();
      _sfxEnabled = prefs.getBool(_keySfx) ?? true;
      _musicEnabled = prefs.getBool(_keyMusic) ?? true;
      _combatEnabled = prefs.getBool(_keyCombat) ?? true;
      _masterVolume = prefs.getDouble(_keyVolume) ?? 0.7;
      _musicVolume = prefs.getDouble(_keyMusicVolume) ?? 0.35;
    } catch (error) {
      debugPrint('Preferências de áudio indisponíveis: $error');
    }

    try {
      await FlameAudio.audioCache.loadAll([
        for (final sfx in Sfx.values) sfx.asset,
        for (final jingle in Jingle.values) jingle.asset,
        for (final sfx in CombatSfx.values) sfx.asset,
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
    if (!_enabled) return;
    if (value) {
      final track = _currentTrack;
      if (track != null) await playMusic(track);
    } else {
      try {
        await FlameAudio.bgm.stop();
      } catch (_) {
        // Nada tocando.
      }
    }
  }

  Future<void> setCombatEnabled(bool value) async {
    _combatEnabled = value;
    await _persist(_keyCombat, value);
  }

  Future<void> setMusicVolume(double value) async {
    _musicVolume = value.clamp(0.0, 1.0);
    await _persist(_keyMusicVolume, _musicVolume);
    await _applyMusicVolume();
  }

  Future<void> _applyMusicVolume() async {
    if (!_enabled) return;
    try {
      await FlameAudio.bgm.audioPlayer
          .setVolume((_musicVolume * _masterVolume).clamp(0.0, 1.0));
    } catch (_) {
      // Sem trilha tocando não há volume a ajustar.
    }
  }

  Future<void> setMasterVolume(double value) async {
    _masterVolume = value.clamp(0.0, 1.0);
    await _persist(_keyVolume, _masterVolume);
    await _applyMusicVolume();
  }

  /// Silencia tudo de uma vez.
  Future<void> muteAll() async {
    await setSfxEnabled(false);
    await setMusicEnabled(false);
    await setCombatEnabled(false);
  }

  void play(Sfx sfx, {double volume = 1.0}) {
    if (!_enabled || !_sfxEnabled) return;
    _fire(sfx.asset, volume);
  }

  void playJingle(Jingle jingle, {double volume = 1.0}) {
    if (!_enabled || !_musicEnabled) return;
    // Jingles são mais altos que os efeitos na masterização original da
    // Kenney; abaixamos para não estourar sobre o resto.
    _fire(jingle.asset, volume * 0.55);
  }

  void playCombat(CombatSfx sfx, {double volume = 1.0}) {
    if (!_enabled || !_combatEnabled) return;
    _fire(sfx.asset, volume * 0.9);
  }

  // ---------------------------------------------------------------------------
  // Trilha de fundo
  // ---------------------------------------------------------------------------

  MusicTrack? _currentTrack;

  /// A faixa tocando agora, ou `null` em silêncio.
  MusicTrack? get currentTrack => _currentTrack;

  /// Troca a trilha de fundo. Repetir a faixa já tocando é ignorado — sem
  /// isso, cada rebuild da tela reiniciaria a música do zero.
  Future<void> playMusic(MusicTrack track) async {
    if (!_enabled) return;
    if (!_musicEnabled) {
      _currentTrack = track;
      return;
    }
    if (_currentTrack == track && FlameAudio.bgm.isPlaying) return;

    _currentTrack = track;
    try {
      await FlameAudio.bgm.stop();
      await FlameAudio.bgm.play(
        track.asset,
        volume: (_musicVolume * _masterVolume).clamp(0.0, 1.0),
      );
    } catch (error) {
      debugPrint('Trilha indisponível: $error');
    }
  }

  Future<void> stopMusic() async {
    _currentTrack = null;
    if (!_enabled) return;
    try {
      await FlameAudio.bgm.stop();
    } catch (error) {
      debugPrint('Não foi possível parar a trilha: $error');
    }
  }

  /// Pausa a trilha sem esquecer qual estava tocando — usado quando o app vai
  /// para segundo plano.
  Future<void> pauseMusic() async {
    try {
      await FlameAudio.bgm.pause();
    } catch (_) {
      // Pausar algo que não está tocando não é erro.
    }
  }

  Future<void> resumeMusic() async {
    if (!_musicEnabled) return;
    final track = _currentTrack;
    if (track == null) return;
    try {
      await FlameAudio.bgm.resume();
    } catch (_) {
      await playMusic(track);
    }
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
    _fireAndForget(FlameAudio.play(asset, volume: effective));
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
///
/// Usa `then(..., onError:)` em vez de `catchError`. A diferença importa:
/// `catchError` exige que o handler devolva um valor do tipo do future, e
/// `FlameAudio.play` devolve `Future<AudioPlayer>`. Tipar o parâmetro como
/// `Future<void>` esconde isso do analisador mas estoura em runtime com
/// "The error handler of Future.catchError must return a value" — que foi
/// exatamente o que quebrou a primeira versão.
void _fireAndForget(Future<Object?> future) {
  future.then<void>(
    (_) {},
    onError: (Object error) => debugPrint('Áudio falhou: $error'),
  );
}
