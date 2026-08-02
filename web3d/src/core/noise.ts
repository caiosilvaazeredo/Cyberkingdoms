import { DeterministicRandom } from './rng';

/**
 * Porta do `GradientNoise` do cliente Flutter.
 *
 * Ruído de gradiente 2D com tabela de permutação derivada da seed. É o que dá
 * ao mundo a continuidade orgânica do Minecraft: valores próximos no espaço
 * produzem alturas próximas, sem repetição perceptível.
 */

const TABLE_SIZE = 256;
const TABLE_MASK = 255;

/** 8 direções unitárias — evita `sin`/`cos` no caminho quente. */
const GRAD_X = [1, -1, 1, -1, 1, -1, 0, 0];
const GRAD_Y = [1, 1, -1, -1, 0, 0, 1, -1];

/**
 * Desvio-padrão empírico do `fbmUnit` por número de oitavas, medido sobre 32k
 * amostras no lado Dart.
 *
 * A soma de oitavas converge para uma distribuição quase normal centrada em 0,5
 * e **estreita** (σ ≈ 0,08), não uniforme. Sem corrigir isso, um limiar como
 * `> 0.72` fica a ~2,7σ da média e quase nunca dispara — foi o que fez a
 * primeira versão do gerador cobrir 80% do mapa com um bioma só.
 */
const FBM_STD_DEV: Record<number, number> = {
  1: 0.14,
  2: 0.0929,
  3: 0.0819,
  4: 0.0775,
  5: 0.0746,
};

export interface FbmOptions {
  octaves?: number;
  frequency?: number;
  persistence?: number;
  lacunarity?: number;
}

export class GradientNoise {
  private readonly perm: Int32Array;

  constructor(seed: number) {
    const rng = new DeterministicRandom(seed);
    const base = Array.from({ length: TABLE_SIZE }, (_, i) => i);
    rng.shuffle(base);
    // Duplicada para evitar `% 256` dentro do laço de amostragem.
    this.perm = Int32Array.from([...base, ...base]);
  }

  private static fade(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  private gradIndex(x: number, y: number): number {
    return this.perm[(this.perm[x & TABLE_MASK]! + y) & TABLE_MASK]! & 7;
  }

  private dotGrad(gx: number, gy: number, dx: number, dy: number): number {
    const g = this.gradIndex(gx, gy);
    return GRAD_X[g]! * dx + GRAD_Y[g]! * dy;
  }

  /** Amostra em `[-1, 1]`. */
  sample(x: number, y: number): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const dx = x - x0;
    const dy = y - y0;

    const u = GradientNoise.fade(dx);
    const v = GradientNoise.fade(dy);

    const n00 = this.dotGrad(x0, y0, dx, dy);
    const n10 = this.dotGrad(x0 + 1, y0, dx - 1, dy);
    const n01 = this.dotGrad(x0, y0 + 1, dx, dy - 1);
    const n11 = this.dotGrad(x0 + 1, y0 + 1, dx - 1, dy - 1);

    const nx0 = n00 + u * (n10 - n00);
    const nx1 = n01 + u * (n11 - n01);
    return nx0 + v * (nx1 - nx0);
  }

  /** Amostra normalizada em `[0, 1]`. */
  sampleUnit(x: number, y: number): number {
    return (this.sample(x, y) + 1) * 0.5;
  }

  /** Soma de oitavas (fractal Brownian motion). */
  fbm(x: number, y: number, options: FbmOptions = {}): number {
    const {
      octaves = 4,
      frequency = 1,
      persistence = 0.5,
      lacunarity = 2,
    } = options;

    let amplitude = 1;
    let total = 0;
    let normalization = 0;
    let freq = frequency;

    for (let i = 0; i < octaves; i++) {
      total += this.sample(x * freq, y * freq) * amplitude;
      normalization += amplitude;
      amplitude *= persistence;
      freq *= lacunarity;
    }
    return normalization === 0 ? 0 : total / normalization;
  }

  fbmUnit(x: number, y: number, options: FbmOptions = {}): number {
    return (this.fbm(x, y, options) + 1) * 0.5;
  }

  /**
   * Amostra do fBm remapeada para uma distribuição **uniforme** em `[0, 1]`.
   *
   * Com isso um limiar passa a significar o que parece: `> 0.85` seleciona os
   * 15% mais altos do campo, em qualquer seed. É o que torna a mistura de
   * biomas projetável em vez de acidental.
   */
  fbmUniform(x: number, y: number, options: FbmOptions = {}): number {
    const octaves = options.octaves ?? 3;
    const raw = this.fbmUnit(x, y, { ...options, octaves });
    const sd = FBM_STD_DEV[octaves] ?? 0.08;
    // Aproximação logística da CDF normal: Φ(z) ≈ 1 / (1 + e^(-1.702 z)).
    const z = (raw - 0.5) / sd;
    return 1 / (1 + Math.exp(-1.702 * z));
  }

  /**
   * Ruído celular (Worley). Distância normalizada até o ponto de atração mais
   * próximo — usado nas manchas de contaminação que viram Ruínas.
   */
  cellular(x: number, y: number, frequency = 1): number {
    const px = x * frequency;
    const py = y * frequency;
    const cx = Math.floor(px);
    const cy = Math.floor(py);

    let best = Infinity;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const gx = cx + ox;
        const gy = cy + oy;
        const jitterX = this.perm[gx & TABLE_MASK]! / TABLE_SIZE;
        const jitterY =
          this.perm[(this.perm[gx & TABLE_MASK]! + gy) & TABLE_MASK]! /
          TABLE_SIZE;
        const featureX = gx + jitterX;
        const featureY = gy + jitterY;
        const d =
          (featureX - px) * (featureX - px) + (featureY - py) * (featureY - py);
        if (d < best) best = d;
      }
    }
    return Math.min(1, Math.max(0, Math.sqrt(best)));
  }
}
