import { GradientNoise } from '../core/noise';
import { hashLabel, mix } from '../core/rng';
import { Biome } from './biome';

/**
 * Porta do `WorldGenerator` do cliente Flutter.
 *
 * O terreno **não é armazenado**: é uma função pura `(seed, x, y) -> tile`. Um
 * mundo infinito custa zero bytes em disco, e — o que importa aqui — dois
 * motores diferentes com a mesma seed enxergam exatamente o mesmo mapa. O
 * teste `determinism.test.ts` compara esta implementação com a referência
 * gravada pelo Dart, tile a tile.
 *
 * Toda constante mágica abaixo veio de `lib/domain/world/world_gen.dart` e não
 * pode ser "arrumada" de um lado só: mudar `_waterLevel` aqui sem mudar lá
 * quebra o contrato em silêncio, e o sintoma aparece como uma ilha que existe
 * no app e não existe na web.
 */

// Escalas de amostragem. Números menores = manchas maiores no mapa.
const ELEVATION_SCALE = 0.0075;
const MOISTURE_SCALE = 0.0052;
const INDUSTRY_SCALE = 0.0036;
const CONTAMINATION_SCALE = 0.009;

/**
 * Fração do mapa coberta por água morta. Água é intransponível, então é um
 * obstáculo logístico de verdade: pouca demais não afeta nada, muita fragmenta
 * o mapa e isola cidades.
 */
const WATER_LEVEL = -0.72;

export class WorldGenerator {
  readonly seed: number;

  private readonly elevationNoise: GradientNoise;
  private readonly moistureNoise: GradientNoise;
  private readonly industryNoise: GradientNoise;
  private readonly contaminationNoise: GradientNoise;
  /**
   * Ruído de detalhe.
   *
   * Público porque a resolução de tile (`world/layout.ts`) precisa do **mesmo**
   * campo para decidir densidade de vegetação e bolsões de recurso. Um segundo
   * `GradientNoise` com a mesma semente daria o mesmo resultado, mas duplicaria
   * a construção da tabela de gradientes por gerador — e abriria a porta para
   * os dois divergirem numa mudança futura.
   */
  readonly detail: GradientNoise;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.elevationNoise = new GradientNoise(mix(this.seed, 0x31));
    this.moistureNoise = new GradientNoise(mix(this.seed, 0x37));
    this.industryNoise = new GradientNoise(mix(this.seed, 0x3d));
    this.contaminationNoise = new GradientNoise(mix(this.seed, 0x43));
    this.detail = new GradientNoise(mix(this.seed, 0x49));
  }

  static fromLabel(label: string): WorldGenerator {
    return new WorldGenerator(hashLabel(label));
  }

  /**
   * Altura contínua em `[-1, 1]`, distribuída de forma previsível.
   *
   * O fBm cru concentra tudo perto da média; a primeira versão deste método no
   * lado Dart produzia 78% do mapa num único degrau e nenhuma água. Com o campo
   * uniformizado, os limiares são percentis de verdade.
   */
  rawElevation(x: number, y: number): number {
    const fx = x * ELEVATION_SCALE;
    const fy = y * ELEVATION_SCALE;

    // Domain warping: perturbar as coordenadas antes de amostrar quebra o
    // aspecto de grade do ruído e produz costas de terreno mais naturais.
    const warpX = this.detail.sample(fx * 0.5, fy * 0.5) * 1.8;
    const warpY = this.detail.sample(fx * 0.5 + 41.7, fy * 0.5 + 19.3) * 1.8;

    const continental =
      this.elevationNoise.fbmUniform(fx + warpX, fy + warpY, {
        octaves: 5,
        persistence: 0.52,
        lacunarity: 2.05,
      }) *
        2 -
      1;

    // Expoente > 1 puxa o relevo para o meio, deixando planícies dominantes e
    // reservando picos e bacias para os extremos.
    const shaped = Math.sign(continental) * Math.pow(Math.abs(continental), 1.35);
    return Math.min(1, Math.max(-1, shaped));
  }

  /** Altura em degraus inteiros, de -4 a 4. */
  elevationAt(x: number, y: number): number {
    const raw = this.rawElevation(x, y);
    const degrau = Math.min(4, Math.max(-4, Math.round(raw * 4)));
    // `Math.round` de um negativo pequeno devolve `-0`, e `-0` não é `0` para
    // `Object.is` nem para uma comparação profunda. O Dart devolve `0` no mesmo
    // caso, e a divergência aparecia como um tile "diferente" num contrato onde
    // tudo o mais batia. Somar zero normaliza o sinal sem mexer no valor.
    return degrau + 0;
  }

  /**
   * Classifica o bioma de um tile.
   *
   * Os campos de controle passam por `fbmUniform`, então cada limiar é um
   * **percentil**: o mapa tem, por construção, aproximadamente a participação
   * anotada em cada bioma, em qualquer seed.
   */
  biomeAt(x: number, y: number): Biome {
    const elevation = this.rawElevation(x, y);
    if (elevation < WATER_LEVEL) return Biome.deadWater;

    const moisture = this.moistureNoise.fbmUniform(
      x * MOISTURE_SCALE,
      y * MOISTURE_SCALE,
      { octaves: 3 },
    );
    const industry = this.industryNoise.fbmUniform(
      x * INDUSTRY_SCALE,
      y * INDUSTRY_SCALE,
      { octaves: 3 },
    );
    const contamination = this.contaminationNoise.cellular(
      x,
      y,
      CONTAMINATION_SCALE,
    );

    // Ruínas (~4%): núcleos das células de contaminação, só onde já houve
    // ocupação industrial.
    if (contamination < 0.11 && industry > 0.4) return Biome.ruins;

    // Cinturão industrial: os 22% mais industrializados. Aqui ficam os três
    // recursos de Camada 1 que movem a economia.
    if (industry > 0.78) {
      if (moisture < 0.4) return Biome.oilFields; // ~7%
      if (elevation > 0.2) return Biome.rareEarthMine; // ~5%
      return Biome.scrapyard; // ~10%
    }

    // Cinturão verde: os 30% mais úmidos.
    if (moisture > 0.7) {
      if (elevation < -0.18) return Biome.toxicMarsh; // ~5%
      if (industry < 0.4) return Biome.reclaimedForest; // ~12%
      return Biome.bioFarm; // ~8%
    }

    if (moisture > 0.52 && industry < 0.55) return Biome.bioFarm;
    if (moisture < 0.25) return Biome.wasteland;

    return Biome.sprawl;
  }

  /**
   * Altura em metros para o renderizador 3D. **Sempre zero.**
   *
   * O cenário é plano de propósito. O relevo continua existindo no modelo —
   * `rawElevation` classifica bioma e define a linha d'água, e o cliente
   * Flutter desenha os nove degraus —, mas a visão de cima de um construtor de
   * cidade não ganha nada com morro: encosta esconde construção, a câmera
   * precisa desviar de pico, e o jogador perde a leitura da grade em que ele
   * está encaixando.
   *
   * Guardar a assinatura em vez de apagar o método mantém a porta aberta para
   * relevo suave depois, sem mexer em quem chama.
   */
  heightAt(_x: number, _y: number): number {
    return 0;
  }

  /** `true` se o ponto está abaixo da linha d'água. */
  isWater(x: number, y: number): boolean {
    return this.rawElevation(x, y) < WATER_LEVEL;
  }
}

/** Altura, em metros, de um relevo `rawElevation = 1`. */
export const TERRAIN_AMPLITUDE = 9;

/** Cota da superfície da água, nas mesmas unidades de `heightAt`. */
export const WATER_HEIGHT = WATER_LEVEL * TERRAIN_AMPLITUDE;

export { WATER_LEVEL };
