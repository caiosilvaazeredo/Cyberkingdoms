import { DeterministicRandom, mix } from '../core/rng';
import { Biome, biomeDef } from './biome';
import type { WorldGenerator } from './worldGen';

/**
 * O chão do terreno do jogador.
 *
 * ## Por que o lote precisa mandar no bioma
 *
 * O mundo é gerado por ruído e não sabe que existe um lote ali. Com o cenário
 * plano, um trecho de Água Morta caindo dentro do tabuleiro não vira lago
 * nenhum — vira uma mancha azulada, sem grama e sem explicação, porque a
 * densidade da água é zero e o relevo que faria dela uma poça foi achatado. O
 * Descampado dá o mesmo problema em tom mais fraco: densidade 0,18 lê como
 * chão pelado.
 *
 * O lote é a terra que o jogador limpou. Dentro dele o bioma é escolhido, não
 * sorteado.
 *
 * ## Por que não fixar um bioma único
 *
 * Um lote sempre igual apagaria a seed: o mesmo tabuleiro verde no meio de um
 * descampado, de uma mata e de um ferro-velho. O bioma vem do **vizinho de
 * terra mais próximo**, então o lote continua parecendo daquele lugar — só que
 * sempre com chão que dá para plantar e construir.
 */

/** Um retângulo em coordenadas de mundo. */
export interface Rect {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export interface PlotArea extends Rect {
  /** A cerca: o lote de verdade, sem a folga. */
  readonly fence: Rect;
  readonly biome: Biome;
}

export function insideRect(r: Rect, x: number, z: number): boolean {
  return x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;
}

export function insidePlotArea(area: PlotArea, x: number, z: number): boolean {
  return insideRect(area, x, z);
}

/** Largura da trilha batida que marca a divisa, em metros. */
export const BORDER_WIDTH = 1.6;

/**
 * A faixa pisada em volta do lote.
 *
 * ## Por que a divisa é ausência de grama, e não uma linha desenhada
 *
 * O contorno era uma `Line` de um pixel a 8 cm do chão. Numa visão de cima com
 * o campo fechado, ela simplesmente não existia: as lâminas têm meio metro e
 * passam por cima. Levantar a linha até acima da grama resolveria a
 * visibilidade e criaria outro problema — uma cerca flutuando no ar.
 *
 * Uma trilha batida some com o problema em vez de contorná-lo. É o que um lote
 * cercado tem de verdade, lê perfeitamente de cima, e custa zero em render:
 * são as mesmas lâminas que deixam de nascer.
 */
export function onPlotBorder(
  area: PlotArea,
  x: number,
  z: number,
  width = BORDER_WIDTH,
): boolean {
  const f = area.fence;
  const fora =
    x < f.minX - width ||
    x > f.maxX + width ||
    z < f.minZ - width ||
    z > f.maxZ + width;
  if (fora) return false;

  const dentro =
    x > f.minX + width &&
    x < f.maxX - width &&
    z > f.minZ + width &&
    z < f.maxZ - width;
  return !dentro;
}

/**
 * Densidade mínima de grama para um bioma valer como chão de lote.
 *
 * Acima disso o campo lê como mato; abaixo, como terra batida. 0,4 deixa passar
 * o Ferro-Velho e o Cortiço, e barra o Descampado, a Mina e a Água Morta.
 */
const DENSIDADE_MINIMA = 0.4;

/**
 * Bioma de terra mais próximo do centro, em anéis crescentes.
 *
 * Busca em anel e não varredura: o candidato quase sempre está a poucos metros,
 * e varrer o quadrado inteiro para achar o primeiro vizinho seria pagar o caso
 * ruim sempre. O passo de 3 m é maior que um tile porque manchas de bioma têm
 * dezenas de metros — amostrar de metro em metro só repetiria a resposta.
 */
export function nearestLandBiome(
  world: WorldGenerator,
  centerX: number,
  centerZ: number,
  maxRadius = 240,
): Biome {
  const serve = (b: Biome): boolean =>
    biomeDef(b).grassDensity >= DENSIDADE_MINIMA;

  const noCentro = world.biomeAt(Math.round(centerX), Math.round(centerZ));
  if (serve(noCentro)) return noCentro;

  for (let raio = 3; raio <= maxRadius; raio += 3) {
    // Oito direções por anel. Mais que isso custa caro e não muda a resposta:
    // o que se procura é a mancha vizinha, não o metro exato.
    for (let k = 0; k < 8; k++) {
      const ang = (k / 8) * Math.PI * 2;
      const x = Math.round(centerX + Math.cos(ang) * raio);
      const z = Math.round(centerZ + Math.sin(ang) * raio);
      const b = world.biomeAt(x, z);
      if (serve(b)) return b;
    }
  }

  // Mundo inteiro sem terra boa é possível numa seed extrema. A Mata Reclamada
  // é o padrão porque um lote de chão verde é sempre jogável — melhor um lote
  // que destoa do mapa do que um lote onde nada nasce.
  return Biome.reclaimedForest;
}

/**
 * Onde o lote do jogador cai no mundo.
 *
 * ## Por que não na origem
 *
 * O lote nascia em (0, 0), e isso escondia um defeito bonito: ruído de
 * gradiente vale **exatamente zero** em todo ponto de rede, e (0, 0) é ponto de
 * rede em qualquer escala. Elevação, umidade e indústria davam o mesmo número
 * ali para toda seed, então todo jogador do mundo recebia o mesmo bioma de
 * chão — Cortiço — por mais diferente que fosse o mapa em volta. A seed só
 * passava a valer alguns metros adiante.
 *
 * Sortear a posição a partir da seed resolve as duas coisas de uma vez: o lote
 * sai do ponto de rede e passa a herdar a região que aquela seed gerou.
 */
export function plotOrigin(world: WorldGenerator): { x: number; z: number } {
  const rng = new DeterministicRandom(mix(world.seed, 0x50));
  // Longe o bastante para pegar outra mancha de bioma — elas têm ordem de
  // centena de metros —, perto o bastante para o mundo continuar sendo o mesmo
  // trecho gerado.
  return {
    x: rng.range(-600, 600),
    z: rng.range(-600, 600),
  };
}

/** Monta a área a partir do centro e do tamanho do lote, em metros. */
export function plotAreaFor(
  world: WorldGenerator,
  centerX: number,
  centerZ: number,
  width: number,
  depth: number,
  /**
   * Folga além da cerca. Sem ela a troca de bioma cai exatamente na linha do
   * contorno, e a borda do lote vira uma faixa de cor — parece defeito de
   * render, não divisa de propriedade.
   */
  margin = 6,
): PlotArea {
  const fence: Rect = {
    minX: centerX - width / 2,
    maxX: centerX + width / 2,
    minZ: centerZ - depth / 2,
    maxZ: centerZ + depth / 2,
  };
  return {
    minX: fence.minX - margin,
    maxX: fence.maxX + margin,
    minZ: fence.minZ - margin,
    maxZ: fence.maxZ + margin,
    fence,
    biome: nearestLandBiome(world, centerX, centerZ),
  };
}
