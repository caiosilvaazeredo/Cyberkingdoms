import { GradientNoise } from '../core/noise';
import { mix } from '../core/rng';
import { biomeDef } from '../world/biome';
import { BiomeCache } from '../world/biomeCache';
import type { WorldGenerator } from '../world/worldGen';

/**
 * Onde a grama nasce, e quanta.
 *
 * Duas fontes somadas:
 *
 * 1. **O mundo.** Cada bioma tem sua densidade — a Mata Reflorestada fecha, o
 *    Descampado é ralo — modulada por um ruído fino que abre clareiras e fecha
 *    moitas. Sem esse ruído a densidade seria constante dentro de um bioma e o
 *    campo viraria carpete.
 * 2. **O pincel.** Uma máscara que o jogador pinta por cima, como na ferramenta
 *    que serviu de referência. É aditiva e subtrativa: dá para plantar grama
 *    num descampado e abrir uma trilha na mata.
 *
 * A máscara é um `Float32Array` numa grade fixa em torno da origem, não um
 * mapa infinito: pintar é uma ação local, e um dicionário esparso custaria uma
 * consulta com alocação no laço mais quente da semeadura.
 */

/** Lado da grade de pintura, em células. */
const MASK_RESOLUTION = 512;

/** Metros cobertos pela grade de pintura. */
const MASK_EXTENT = 400;

export interface BrushOptions {
  /** Raio em metros. */
  radius: number;
  /** Positivo planta, negativo arranca. */
  strength: number;
  /** 0 = borda dura, 1 = borda toda esfumada. */
  falloff: number;
}

export class DensityField {
  private readonly detail: GradientNoise;
  private readonly mask: Float32Array;

  /** Escala do ruído que abre clareiras. Menor = manchas maiores. */
  private static readonly DETAIL_SCALE = 0.035;

  readonly biomes: BiomeCache;

  constructor(world: WorldGenerator) {
    this.detail = new GradientNoise(mix(world.seed, 0x6d));
    this.mask = new Float32Array(MASK_RESOLUTION * MASK_RESOLUTION);
    this.biomes = new BiomeCache(world);
  }

  /** Densidade final em `[0, 1]` na coordenada de mundo dada. */
  at(x: number, z: number): number {
    const biome = biomeDef(this.biomes.at(x, z));
    if (biome.grassDensity <= 0) return 0;

    // `fbmUniform` e não `fbmUnit`: o fBm cru se aperta em torno de 0,5 e um
    // limiar aqui quase nunca dispararia — o mesmo defeito que já apareceu na
    // distribuição de biomas do gerador.
    const clearing = this.detail.fbmUniform(
      x * DensityField.DETAIL_SCALE,
      z * DensityField.DETAIL_SCALE,
      { octaves: 3 },
    );

    // A clareira modula, não zera: mesmo no mínimo sobra 45% da densidade do
    // bioma, senão a mata fica com buracos redondos evidentes.
    const natural = biome.grassDensity * (0.45 + 0.55 * clearing);

    return Math.min(1, Math.max(0, natural + this.maskAt(x, z)));
  }

  /** Só a contribuição do pincel, em `[-1, 1]`. */
  maskAt(x: number, z: number): number {
    const i = this.indexOf(x, z);
    return i < 0 ? 0 : this.mask[i]!;
  }

  /**
   * Pinta um círculo na máscara.
   *
   * O acúmulo é limitado a `[-1, 1]` a cada passada, e não no fim: sem isso
   * arrastar o pincel devagar sobre o mesmo ponto empilharia valores enormes
   * que só apareceriam ao tentar apagar depois.
   */
  paint(x: number, z: number, options: BrushOptions): void {
    const { radius, strength, falloff } = options;
    const cell = MASK_EXTENT / MASK_RESOLUTION;
    const cells = Math.ceil(radius / cell);
    const cx = Math.round((x + MASK_EXTENT / 2) / cell);
    const cz = Math.round((z + MASK_EXTENT / 2) / cell);

    for (let dz = -cells; dz <= cells; dz++) {
      for (let dx = -cells; dx <= cells; dx++) {
        const gx = cx + dx;
        const gz = cz + dz;
        if (gx < 0 || gz < 0 || gx >= MASK_RESOLUTION || gz >= MASK_RESOLUTION) {
          continue;
        }
        const distance = Math.hypot(dx, dz) * cell;
        if (distance > radius) continue;

        const t = distance / radius;
        // `smoothstep` invertido: 1 no centro, 0 na borda, com a suavidade
        // controlada por `falloff`.
        const edge = 1 - Math.min(1, Math.max(0, (t - (1 - falloff)) / Math.max(falloff, 1e-4)));
        const weight = edge * edge * (3 - 2 * edge);

        const i = gz * MASK_RESOLUTION + gx;
        this.mask[i] = Math.min(1, Math.max(-1, this.mask[i]! + strength * weight));
      }
    }
  }

  /** Zera a pintura, mantendo a densidade natural do mundo. */
  clearPaint(): void {
    this.mask.fill(0);
  }

  /** `true` se o ponto está dentro da área pintável. */
  covers(x: number, z: number): boolean {
    return this.indexOf(x, z) >= 0;
  }

  private indexOf(x: number, z: number): number {
    const cell = MASK_EXTENT / MASK_RESOLUTION;
    const gx = Math.round((x + MASK_EXTENT / 2) / cell);
    const gz = Math.round((z + MASK_EXTENT / 2) / cell);
    if (gx < 0 || gz < 0 || gx >= MASK_RESOLUTION || gz >= MASK_RESOLUTION) {
      return -1;
    }
    return gz * MASK_RESOLUTION + gx;
  }
}

export { MASK_EXTENT, MASK_RESOLUTION };
