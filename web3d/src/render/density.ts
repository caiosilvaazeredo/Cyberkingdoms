import { GradientNoise } from '../core/noise';
import { mix } from '../core/rng';
import { biomeDef } from '../world/biome';
import { BiomeCache } from '../world/biomeCache';
import { onPlotBorder, type PlotArea } from '../world/plotArea';
import type { WorldGenerator } from '../world/worldGen';

/**
 * Onde a grama nasce, e quanta.
 *
 * ## O pincel saiu
 *
 * Havia uma máscara que o jogador pintava por cima, herdada da ferramenta que
 * inspirou o renderizador. Ela saiu inteira: o que se queria dela era o
 * resultado — mato fechado —, não o trabalho de pintar. Agora todo tile já
 * nasce na densidade que o pincel alcançava no máximo.
 *
 * Sobra o ruído de clareira, e só ele. Sem essa variação o campo vira carpete:
 * densidade constante lê como textura, não como mato. Mas o piso é alto, então
 * a "clareira" agora é uma moita menos fechada, nunca chão pelado.
 */

export class DensityField {
  private readonly detail: GradientNoise;
  readonly biomes: BiomeCache;

  /** Escala do ruído que abre clareiras. Menor = manchas maiores. */
  private static readonly DETAIL_SCALE = 0.035;

  /**
   * Piso de densidade em qualquer bioma que tenha grama.
   *
   * É o que o pincel entregava no máximo. Deixar isso como padrão foi o pedido:
   * o jogador não deveria ter de plantar o próprio cenário.
   */
  private static readonly FLOOR = 0.92;

  constructor(
    world: WorldGenerator,
    private readonly plotArea: PlotArea | null = null,
  ) {
    this.detail = new GradientNoise(mix(world.seed, 0x6d));
    // O lote entra pelo cache de bioma, e não por uma exceção aqui: assim a
    // densidade, a cor do terreno e o tom da grama passam a concordar sozinhos.
    // Uma exceção só na densidade daria mato crescendo sobre chão pintado de
    // água.
    this.biomes = new BiomeCache(world, plotArea);
  }

  /** Densidade final em `[0, 1]` na coordenada de mundo dada. */
  at(x: number, z: number): number {
    // A divisa do lote é trilha batida, não linha desenhada: uma `Line` de um
    // pixel a 8 cm do chão desaparecia sob meio metro de grama. Ver
    // `world/plotArea.ts`.
    if (this.plotArea && onPlotBorder(this.plotArea, x, z)) return 0;

    const biome = biomeDef(this.biomes.at(x, z));
    // Água continua sem grama. É a única exceção.
    if (biome.grassDensity <= 0) return 0;

    // `fbmUniform` e não `fbmUnit`: o fBm cru se aperta em torno de 0,5 e um
    // limiar aqui quase nunca dispararia — o mesmo defeito que já apareceu na
    // distribuição de biomas.
    const clearing = this.detail.fbmUniform(
      x * DensityField.DETAIL_SCALE,
      z * DensityField.DETAIL_SCALE,
      { octaves: 3 },
    );

    // O bioma ainda diferencia — o Descampado é menos fechado que a Mata —,
    // mas comprimido para bem perto do teto. A variação virou textura, não
    // escassez.
    const porBioma = 0.72 + 0.28 * biome.grassDensity;
    return Math.min(1, DensityField.FLOOR * porBioma * (0.9 + 0.1 * clearing));
  }
}
