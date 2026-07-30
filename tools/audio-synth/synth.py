#!/usr/bin/env python3
"""Sintetiza a trilha e os efeitos de combate do CyberKingdoms.

Por que gerar em vez de usar um pack pronto:

* Os packs da Kenney não têm trilha longa — só jingles de poucos segundos.
* A locução do Voice-over Pack: Fighter tem entonação de jogo de luta de
  fliperama, que destoa do tom do GDD (economia fria, sobrevivência, política).
  O pedido foi "algo mais seco e cyberpunk", e isso significa síntese: ondas
  serra desafinadas, sub-bass, ruído filtrado e silêncio — não gritos.

Tudo aqui é determinístico: a mesma invocação produz exatamente os mesmos
arquivos, então regerar a trilha não polui o diff sem motivo.

Uso:
    python3 synth.py ../../assets/audio
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

SR = 44100

# Semente fixa: ruído é parte do timbre, e um timbre que muda a cada execução
# tornaria impossível revisar mudanças de áudio no controle de versão.
RNG = np.random.default_rng(0xC17E)


# ---------------------------------------------------------------------------
# Blocos básicos
# ---------------------------------------------------------------------------

def t(duration: float) -> np.ndarray:
    """Vetor de tempo em segundos."""
    return np.arange(int(SR * duration)) / SR


def sine(freq: float, duration: float, phase: float = 0.0) -> np.ndarray:
    return np.sin(2 * np.pi * freq * t(duration) + phase)


def saw(freq: float, duration: float) -> np.ndarray:
    """Serra por soma de harmônicos, limitada para não criar aliasing."""
    out = np.zeros(int(SR * duration))
    time = t(duration)
    harmonics = max(1, int(SR / 2 / max(freq, 1)))
    for n in range(1, min(harmonics, 40)):
        out += ((-1) ** (n + 1)) * np.sin(2 * np.pi * freq * n * time) / n
    return out * (2 / np.pi)


def square(freq: float, duration: float, duty: float = 0.5) -> np.ndarray:
    phase = (freq * t(duration)) % 1.0
    return np.where(phase < duty, 1.0, -1.0)


def noise(duration: float) -> np.ndarray:
    return RNG.uniform(-1, 1, int(SR * duration))


def adsr(
    duration: float,
    attack: float = 0.005,
    decay: float = 0.05,
    sustain: float = 0.6,
    release: float = 0.1,
) -> np.ndarray:
    """Envelope ADSR clássico, recortado ao tamanho pedido."""
    n = int(SR * duration)
    a, d, r = int(SR * attack), int(SR * decay), int(SR * release)
    s = max(0, n - a - d - r)

    env = np.concatenate([
        np.linspace(0, 1, a, endpoint=False) if a else np.array([]),
        np.linspace(1, sustain, d, endpoint=False) if d else np.array([]),
        np.full(s, sustain),
        np.linspace(sustain, 0, r) if r else np.array([]),
    ])
    return np.pad(env, (0, max(0, n - len(env))))[:n]


def lowpass(signal: np.ndarray, cutoff: float, resonance: float = 0.7) -> np.ndarray:
    """Filtro passa-baixa de 2 polos (state variable).

    É o que dá o caráter "escuro" do synthwave: cortar o brilho das serras
    deixa o som denso sem ficar estridente num fone de celular.
    """
    f = 2 * math.sin(math.pi * min(cutoff, SR / 2.5) / SR)
    q = 1.0 - resonance
    low = band = 0.0
    out = np.empty_like(signal)
    for i, sample in enumerate(signal):
        low += f * band
        high = sample - low - q * band
        band += f * high
        out[i] = low
    return out


def sweep_lowpass(
    signal: np.ndarray, start: float, end: float, resonance: float = 0.7
) -> np.ndarray:
    """Passa-baixa com corte variando ao longo do tempo (filter sweep)."""
    cutoffs = np.linspace(start, end, len(signal))
    q = 1.0 - resonance
    low = band = 0.0
    out = np.empty_like(signal)
    for i, sample in enumerate(signal):
        f = 2 * math.sin(math.pi * min(cutoffs[i], SR / 2.5) / SR)
        low += f * band
        high = sample - low - q * band
        band += f * high
        out[i] = low
    return out


def delay(signal: np.ndarray, time_s: float, feedback: float, mix: float) -> np.ndarray:
    """Delay com realimentação — substitui reverb a um custo trivial."""
    d = int(SR * time_s)
    if d <= 0 or d >= len(signal):
        return signal
    out = signal.copy()
    for i in range(d, len(out)):
        out[i] += out[i - d] * feedback
    return signal * (1 - mix) + out * mix


def soft_clip(signal: np.ndarray, drive: float = 1.0) -> np.ndarray:
    """Saturação suave. Adiciona sujeira sem estourar."""
    return np.tanh(signal * drive)


def dc_block(signal: np.ndarray) -> np.ndarray:
    """Remove offset DC.

    Ondas quadradas com duty diferente de 50% carregam DC, e um arquivo que
    começa longe de zero estala no primeiro sample. Também come headroom à toa.
    """
    return signal - np.mean(signal)


def normalize(signal: np.ndarray, peak: float = 0.85) -> np.ndarray:
    """Normaliza com margem e sem DC.

    O pico fica em 0.85, não 1.0: o encoder Vorbis reconstrói a onda com
    pequeno overshoot, e sem essa folga o arquivo final clipa — foi o que
    aconteceu com o efeito de crítico na primeira versão.
    """
    signal = dc_block(signal)
    m = np.max(np.abs(signal))
    return signal * (peak / m) if m > 0 else signal


def edge_fade(signal: np.ndarray, ms: float = 4.0) -> np.ndarray:
    """Rampa de entrada e saída de poucos milissegundos.

    Um one-shot que termina longe de zero estala quando o playback para. Não se
    aplica a loops: ali a emenda é resolvida por `wrap_tail`, e uma rampa
    criaria um buraco audível a cada volta.
    """
    n = min(int(SR * ms / 1000), len(signal) // 2)
    if n <= 0:
        return signal
    out = signal.copy()
    ramp = np.linspace(0, 1, n)
    out[:n] *= ramp
    out[-n:] *= ramp[::-1]
    return out


def oneshot(signal: np.ndarray, peak: float = 0.7) -> np.ndarray:
    """Finaliza um efeito pontual: sem DC, com rampas e com headroom.

    O pico é mais conservador que o dos loops porque transientes percussivos
    fazem o encoder Vorbis ultrapassar bastante o valor original — `impact` e
    `critical` saíam acima de 1.0 mesmo normalizados em 0.85.
    """
    return edge_fade(normalize(signal, peak))


def wrap_tail(track: np.ndarray, loop_samples: int) -> np.ndarray:
    """Fecha o loop dobrando a cauda de volta no início.

    Um loop musicalmente exato ainda estala se as caudas — release do pad,
    realimentação do delay — forem cortadas na emenda. Renderizamos com folga
    no fim e somamos o que passou do ponto de loop sobre o começo, que é
    exatamente onde essas caudas soariam na repetição seguinte.
    """
    loop = track[:loop_samples].copy()
    tail = track[loop_samples:]
    if len(tail):
        n = min(len(tail), loop_samples)
        loop[:n] += tail[:n]
    return loop


def place(track: np.ndarray, sample: np.ndarray, at: float, gain: float = 1.0) -> None:
    """Soma `sample` na trilha na posição `at` (segundos), in-place."""
    start = int(SR * at)
    end = min(start + len(sample), len(track))
    if start >= len(track):
        return
    track[start:end] += sample[: end - start] * gain


# ---------------------------------------------------------------------------
# Notas
# ---------------------------------------------------------------------------

def note(name: str) -> float:
    """Nome de nota científica ("A2", "C#4") para frequência em Hz."""
    steps = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}
    letter = name[0].upper()
    idx = 1
    semitone = steps[letter]
    while idx < len(name) and name[idx] in '#b':
        semitone += 1 if name[idx] == '#' else -1
        idx += 1
    octave = int(name[idx:])
    midi = 12 * (octave + 1) + semitone
    return 440.0 * (2 ** ((midi - 69) / 12))


# ---------------------------------------------------------------------------
# Instrumentos
# ---------------------------------------------------------------------------

def bass(freq: float, duration: float) -> np.ndarray:
    """Baixo de serra desafinada — a espinha do synthwave."""
    core = saw(freq, duration) + 0.6 * saw(freq * 1.005, duration)
    core += 0.8 * sine(freq / 2, duration)
    filtered = lowpass(core, 240 + freq * 2.2, 0.55)
    return filtered * adsr(duration, 0.008, 0.08, 0.55, 0.12)


def pad(freqs: list[float], duration: float) -> np.ndarray:
    """Acorde sustentado e escuro, com ataque lento."""
    out = np.zeros(int(SR * duration))
    for f in freqs:
        out += saw(f, duration) * 0.4
        out += saw(f * 1.008, duration) * 0.3
    out = sweep_lowpass(out, 300, 900, 0.5)
    return out * adsr(duration, duration * 0.35, duration * 0.2, 0.7, duration * 0.4)


def pluck(freq: float, duration: float, bright: float = 2200) -> np.ndarray:
    """Arpejo curto e metálico."""
    core = square(freq, duration, 0.35) * 0.5 + saw(freq, duration) * 0.5
    core = sweep_lowpass(core, bright, 400, 0.75)
    return core * adsr(duration, 0.002, duration * 0.5, 0.15, duration * 0.4)


def kick(duration: float = 0.35) -> np.ndarray:
    """Bumbo: seno com pitch caindo rápido."""
    time = t(duration)
    freq = 120 * np.exp(-time * 28) + 42
    body = np.sin(2 * np.pi * np.cumsum(freq) / SR)
    click = noise(0.006) * 0.5
    out = body * adsr(duration, 0.001, 0.06, 0.25, 0.2)
    place(out, click, 0.0)
    return soft_clip(out, 1.6)


def hat(duration: float = 0.05, open_hat: bool = False) -> np.ndarray:
    """Chimbau: ruído passa-alta simulado por subtração de passa-baixa."""
    d = 0.18 if open_hat else duration
    raw = noise(d)
    out = raw - lowpass(raw, 6000, 0.3)
    return out * adsr(d, 0.001, d * 0.3, 0.08, d * 0.6) * 0.5


def snare(duration: float = 0.22) -> np.ndarray:
    tone = sine(190, duration) * 0.35
    body = noise(duration)
    body = body - lowpass(body, 1200, 0.3)
    return (tone + body * 0.7) * adsr(duration, 0.001, 0.07, 0.2, 0.14)


# ---------------------------------------------------------------------------
# Trilhas em loop
# ---------------------------------------------------------------------------

def build_loop(
    bpm: float,
    bars: int,
    root: str,
    chords: list[list[str]],
    arp: list[str],
    *,
    drums: bool,
    arp_rate: int,
    intensity: float,
    brightness: float = 2200,
) -> np.ndarray:
    """Monta um loop de `bars` compassos 4/4.

    O loop fecha exatamente no fim do último compasso: nada de cauda sobrando,
    senão a emenda estala a cada repetição.
    """
    beat = 60.0 / bpm
    bar = beat * 4
    total = bar * bars
    loop_samples = int(SR * total)
    # Folga de dois compassos para as caudas terminarem antes de serem dobradas
    # de volta no início pelo `wrap_tail`.
    track = np.zeros(loop_samples + int(SR * bar * 2))

    # Pad: um acorde por compasso.
    for i in range(bars):
        chord = chords[i % len(chords)]
        place(track, pad([note(n) for n in chord], bar * 0.98), i * bar, 0.16 * intensity)

    # Baixo: nota na cabeça e no contratempo do 3.
    for i in range(bars):
        root_note = note(chords[i % len(chords)][0])
        place(track, bass(root_note / 2, beat * 0.9), i * bar, 0.34)
        place(track, bass(root_note / 2, beat * 0.5), i * bar + beat * 2.5, 0.24)

    # Arpejo: divisões por compasso.
    step = bar / arp_rate
    for i in range(bars * arp_rate):
        n = arp[i % len(arp)]
        place(track, pluck(note(n), step * 0.9), i * step, 0.12 * intensity)

    if drums:
        for i in range(bars):
            base = i * bar
            place(track, kick(), base, 0.55)
            place(track, kick(), base + beat * 2, 0.45)
            place(track, snare(), base + beat, 0.28)
            place(track, snare(), base + beat * 3, 0.28)
            for h in range(8):
                place(track, hat(open_hat=(h == 7)), base + h * beat / 2, 0.07)

    track = delay(track, beat * 0.75, 0.28, 0.22)
    # Corte de brilho global: chimbau e arpejo somados deixavam o mix agudo
    # demais para o tom escuro que o jogo pede.
    track = track * 0.75 + lowpass(track, brightness, 0.3) * 0.55
    track = soft_clip(track, 1.1)
    return normalize(wrap_tail(track, loop_samples), 0.72)


def track_city() -> np.ndarray:
    """Menu, cidade e mercado: lento, sombrio, quase parado."""
    return build_loop(
        bpm=84,
        bars=8,
        root='A2',
        chords=[['A2', 'C3', 'E3'], ['F2', 'A2', 'C3'],
                ['D2', 'F2', 'A2'], ['E2', 'G2', 'B2']],
        arp=['A4', 'C5', 'E5', 'C5', 'A4', 'E4', 'G4', 'E4'],
        drums=False,
        arp_rate=8,
        intensity=0.85,
        brightness=1200,
    )


def track_world() -> np.ndarray:
    """Exploração do mundo aberto: pulso constante, espaço para respirar."""
    return build_loop(
        bpm=96,
        bars=8,
        root='D2',
        chords=[['D2', 'F2', 'A2'], ['D2', 'F2', 'A2'],
                ['Bb1', 'D2', 'F2'], ['C2', 'E2', 'G2']],
        arp=['D4', 'A4', 'F4', 'A4', 'D5', 'A4', 'F4', 'C5'],
        drums=True,
        arp_rate=8,
        intensity=1.0,
        brightness=1500,
    )


def track_tension() -> np.ndarray:
    """Estrada e combate: mais rápido, baixo insistente, arpejo agressivo."""
    return build_loop(
        bpm=118,
        bars=8,
        root='E2',
        chords=[['E2', 'G2', 'B2'], ['E2', 'G2', 'B2'],
                ['C2', 'E2', 'G2'], ['B1', 'D2', 'F#2']],
        arp=['E4', 'B4', 'G4', 'B4', 'E5', 'D5', 'B4', 'G4'],
        drums=True,
        arp_rate=16,
        intensity=1.15,
        brightness=1700,
    )


# ---------------------------------------------------------------------------
# Efeitos secos de combate
# ---------------------------------------------------------------------------

def sfx_alert() -> np.ndarray:
    """Aviso de emboscada: dois bipes agudos e um sub descendo. Sem drama."""
    out = np.zeros(int(SR * 0.55))
    for i, f in enumerate([1760, 1760]):
        blip = square(f, 0.06, 0.3) * adsr(0.06, 0.001, 0.02, 0.4, 0.03)
        place(out, blip, i * 0.09, 0.45)
    sub = sine(90, 0.4) * np.exp(-t(0.4) * 6)
    place(out, sweep_lowpass(sub, 400, 60, 0.4), 0.18, 0.6)
    return oneshot(out, 0.72)


def sfx_impact() -> np.ndarray:
    """Golpe: transiente metálico curto sobre um soco de sub."""
    dur = 0.3
    metal = noise(dur)
    metal = metal - lowpass(metal, 1600, 0.4)
    metal *= adsr(dur, 0.001, 0.04, 0.1, 0.12)
    body = sine(70, dur) * adsr(dur, 0.001, 0.05, 0.2, 0.16)
    return oneshot(soft_clip(metal * 0.6 + body * 1.0, 1.4), 0.66)


def sfx_critical() -> np.ndarray:
    """Crítico: mais brilhante e distorcido que o impacto comum."""
    dur = 0.4
    metal = noise(dur)
    metal = metal - lowpass(metal, 2600, 0.5)
    metal *= adsr(dur, 0.001, 0.06, 0.15, 0.2)
    ring = (sine(880, dur) + sine(1319, dur)) * adsr(dur, 0.001, 0.1, 0.1, 0.25)
    body = sine(58, dur) * adsr(dur, 0.001, 0.06, 0.25, 0.22)
    return oneshot(soft_clip(metal * 0.7 + ring * 0.3 + body, 1.8), 0.64)


def sfx_victory() -> np.ndarray:
    """Confirmação de vitória: duas notas limpas subindo. Frio, não heroico."""
    out = np.zeros(int(SR * 0.7))
    for i, n in enumerate(['E5', 'B5']):
        blip = (sine(note(n), 0.16) + 0.3 * square(note(n), 0.16, 0.25))
        blip *= adsr(0.16, 0.004, 0.06, 0.35, 0.09)
        place(out, blip, i * 0.11, 0.5)
    return oneshot(delay(out, 0.13, 0.25, 0.3), 0.7)


def sfx_defeat() -> np.ndarray:
    """Derrota: mesma ideia, descendo e desafinando."""
    out = np.zeros(int(SR * 0.9))
    for i, f in enumerate([note('B4'), note('E4') * 0.98]):
        blip = (sine(f, 0.2) + 0.3 * square(f, 0.2, 0.25))
        blip *= adsr(0.2, 0.004, 0.08, 0.3, 0.11)
        place(out, blip, i * 0.14, 0.5)
    sub = sine(55, 0.5) * np.exp(-t(0.5) * 4)
    place(out, sub, 0.28, 0.5)
    return oneshot(delay(out, 0.16, 0.3, 0.3), 0.7)


def sfx_death() -> np.ndarray:
    """Morte permanente: drone que colapsa. Longo o suficiente para doer."""
    dur = 2.6
    time = t(dur)
    freq = 110 * np.exp(-time * 0.55) + 28
    drone = np.sin(2 * np.pi * np.cumsum(freq) / SR)
    drone += 0.4 * np.sin(2 * np.pi * np.cumsum(freq * 1.007) / SR)
    grit = noise(dur) * np.exp(-time * 1.6) * 0.25
    out = (drone * np.exp(-time * 0.7) + grit)
    out = sweep_lowpass(out, 1200, 90, 0.4)
    return oneshot(soft_clip(out, 1.3), 0.74)


def sfx_scan() -> np.ndarray:
    """Bip de terminal, para confirmações neutras."""
    dur = 0.12
    out = square(1200, dur, 0.2) * adsr(dur, 0.001, 0.03, 0.3, 0.05)
    return oneshot(out, 0.5)


# ---------------------------------------------------------------------------
# Escrita
# ---------------------------------------------------------------------------

def write(path: Path, data: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(path, data.astype(np.float32), SR, format='OGG', subtype='VORBIS')
    size_kb = path.stat().st_size / 1024
    print(f'  {path.name:28s} {len(data)/SR:5.2f}s  {size_kb:6.1f} KB')


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 1

    out = Path(sys.argv[1])

    print('Trilhas em loop:')
    write(out / 'music' / 'city.ogg', track_city())
    write(out / 'music' / 'world.ogg', track_world())
    write(out / 'music' / 'tension.ogg', track_tension())

    print('Efeitos de combate:')
    write(out / 'combat' / 'alert.ogg', sfx_alert())
    write(out / 'combat' / 'impact.ogg', sfx_impact())
    write(out / 'combat' / 'critical.ogg', sfx_critical())
    write(out / 'combat' / 'victory.ogg', sfx_victory())
    write(out / 'combat' / 'defeat.ogg', sfx_defeat())
    write(out / 'combat' / 'death.ogg', sfx_death())
    write(out / 'combat' / 'scan.ogg', sfx_scan())

    return 0


if __name__ == '__main__':
    raise SystemExit(main())
