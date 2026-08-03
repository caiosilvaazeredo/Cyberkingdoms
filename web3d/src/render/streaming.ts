import * as THREE from 'three';

import type { DensityField } from './density';
import { createGrassField, type GrassField } from './grass';
import type { QualityBudget } from './quality';
import { createTerrain, type Terrain } from './terrain';
import type { VillageBounds } from './villageBounds';
import type { PlotArea } from '../world/plotArea';
import type { WorldGenerator } from '../world/worldGen';

/**
 * Terreno e grama carregados em pedaços, conforme o jogador anda.
 *
 * ## O que havia antes, e por que não servia mais
 *
 * A cena montava **um** trecho de terreno centrado na câmera e o refazia
 * inteiro sempre que o alvo andava 30% do lado. Isso funcionou enquanto o jogo
 * cabia dentro de um lote: o trecho nunca precisava crescer, e refazer 50 mil
 * lâminas de uma vez a cada dez passos era um engasgo que ninguém via porque
 * ninguém andava.
 *
 * Andar até outra cidade quebra as duas premissas. O caminho tem centenas de
 * metros, o refazer passa a acontecer o tempo todo, e cada um deles descarta
 * terreno que continuava perfeitamente válido — o pedaço atrás do jogador é o
 * mesmo antes e depois do passo.
 *
 * ## As três decisões que fazem isto funcionar
 *
 * **Um pedaço por quadro.** Montar um chunk custa dezenas de milissegundos:
 * subdividir a malha, amostrar bioma vértice a vértice e semear a grama. Fazer
 * quatro de uma vez ao cruzar uma diagonal derruba o quadro de forma visível.
 * A fila entrega um por vez, o mais perto da câmera primeiro, e o mundo se
 * completa em alguns quadros — que é exatamente o efeito de carregamento
 * progressivo que se espera.
 *
 * **Histerese entre carregar e descartar.** O raio que descarta é maior que o
 * que carrega. Sem essa folga, um jogador andando em cima da fronteira faria o
 * mesmo pedaço nascer e morrer a cada passo, e o custo do sobe-desce seria
 * maior que o de simplesmente manter.
 *
 * **A grama não é dividida em pedaços.** Esta foi a lição cara. A primeira
 * versão dava a cada pedaço uma fatia do orçamento de lâminas, e o resultado
 * foi um mundo pelado: 45 mil lâminas espalhadas por 25 pedaços de 64 m cobrem
 * 102 mil metros quadrados a **0,4 lâmina por metro** — quarenta vezes mais
 * ralo que o trecho único que existia antes. Densidade não escala com área: o
 * orçamento é fixo e a área cresce com o quadrado do raio.
 *
 * Então o terreno é fatiado — ele é barato e é o que impede a borda no vazio —
 * e a grama continua sendo **um tapete só, centrado na câmera**, do tamanho do
 * que se enxerga. Lâmina é o item mais caro da cena e o primeiro a virar
 * sub-pixel com a distância: gastar orçamento com ela longe é gastar no que
 * ninguém vê.
 */

/**
 * Lado de um pedaço, em metros.
 *
 * 64 m é quatro chunks de jogo (16 tiles cada) e cabe numa tela de celular em
 * zoom médio. Menor multiplicaria o número de draw calls; maior faria cada
 * carregamento ser um solavanco perceptível.
 */
export const CHUNK_METERS = 64;

export interface StreamingOptions {
  readonly world: WorldGenerator;
  readonly density: DensityField;
  readonly budget: QualityBudget;
  readonly bounds: VillageBounds | null;
  readonly plotArea: PlotArea | null;
  /** Raio de carga em metros. Sai do zoom da câmera. */
  readonly viewDistance: number;
  readonly windDirection: THREE.Vector2;
  readonly windStrength: number;
}

interface Pedaco {
  readonly cx: number;
  readonly cz: number;
  readonly terrain: Terrain;
}

const chave = (cx: number, cz: number): string => `${cx}:${cz}`;

export interface StreamingWorld {
  readonly group: THREE.Group;
  /**
   * Ajusta o conjunto carregado ao redor de um ponto.
   *
   * Devolve `true` quando montou alguma coisa — o chamador usa isso para saber
   * que vale reportar o estado. Monta **no máximo um** pedaço por chamada.
   */
  update(centerX: number, centerZ: number, options: Partial<StreamingOptions>): boolean;
  /** Avança o vento de todos os pedaços. */
  animate(elapsedSeconds: number): void;
  setWind(direction: THREE.Vector2, strength: number): void;
  readonly loadedCount: number;
  readonly bladeCount: number;
  /** Descarta tudo. Use ao trocar o orçamento de render. */
  clear(): void;
  dispose(): void;
}

export function createStreamingWorld(inicial: StreamingOptions): StreamingWorld {
  const group = new THREE.Group();
  const carregados = new Map<string, Pedaco>();
  let opcoes = inicial;
  let direcaoVento = inicial.windDirection.clone();
  let forcaVento = inicial.windStrength;

  /** O tapete de grama: um só, centrado na câmera. */
  let grama: GrassField | null = null;
  const gramaEm = new THREE.Vector2(Number.NaN, Number.NaN);

  /**
   * Raios de carga, em pedaços.
   *
   * O de terreno acompanha o zoom para a malha nunca acabar dentro da tela; o
   * de grama é fixo e curto, porque lâmina a 200 m não ocupa pixel.
   */
  function raios(): { terreno: number; descarte: number } {
    const visivel = opcoes.viewDistance * 2.2;
    // Teto de 4 pedaços de raio, ou 81 no total. Cada um é uma chamada de
    // desenho, e um celular mediano aguenta poucas centenas por quadro — o
    // resto do orçamento é da grama, do lote e da interface.
    const terreno = Math.max(2, Math.min(4, Math.ceil(visivel / CHUNK_METERS)));
    return {
      terreno,
      // Um pedaço de folga antes de descartar: sem ela, andar em cima da
      // fronteira faz o mesmo pedaço nascer e morrer a cada passo.
      descarte: terreno + 1,
    };
  }

  /**
   * Lado do tapete de grama, em metros.
   *
   * Sai do orçamento de lâminas e da densidade que se quer manter, e não do
   * zoom: é a conta invertida. Com 95 mil lâminas e a meta de 20 por metro
   * quadrado, o tapete tem 69 m de lado — cresce em aparelho melhor e encolhe
   * em aparelho fraco, mas a **densidade** fica igual, que é o que o olho lê.
   */
  function ladoDaGrama(): number {
    const alvoPorMetro = 20;
    return Math.max(40, Math.min(140, Math.sqrt(opcoes.budget.maxBlades / alvoPorMetro)));
  }

  function refazerGrama(centerX: number, centerZ: number): void {
    if (grama) {
      group.remove(grama.mesh);
      grama.dispose();
    }
    grama = createGrassField(
      opcoes.world,
      opcoes.density,
      centerX,
      centerZ,
      {
        patchSize: ladoDaGrama(),
        bladesPerSquareMeter: 70,
        maxBlades: opcoes.budget.maxBlades,
      },
      opcoes.bounds,
    );
    grama.setWind(direcaoVento, forcaVento);
    group.add(grama.mesh);
    gramaEm.set(centerX, centerZ);
  }

  function montar(cx: number, cz: number): Pedaco {
    const centroX = cx * CHUNK_METERS + CHUNK_METERS / 2;
    const centroZ = cz * CHUNK_METERS + CHUNK_METERS / 2;

    const terrain = createTerrain(
      opcoes.world,
      centroX,
      centroZ,
      // Uma fração a mais que o lado do pedaço: malhas exatamente adjacentes
      // deixam uma costura de um pixel entre elas quando a câmera se move, e a
      // sobreposição some com isso sem custar vértice perceptível.
      CHUNK_METERS * 1.02,
      Math.max(24, Math.round(opcoes.budget.terrainSegments / 3)),
      opcoes.density.biomes,
      opcoes.bounds,
      opcoes.plotArea,
    );

    // A água **não** entra na cena.
    //
    // `createTerrain` devolve um plano na cota da água, que faz sentido num
    // mundo com relevo. Aqui o cenário é plano por decisão de projeto, e a cota
    // da água fica 6,5 m abaixo do chão: o plano nunca aparece. Adicioná-lo
    // custaria uma chamada de desenho por pedaço — oitenta chamadas para
    // desenhar nada, num celular que aguenta umas duzentas no total.
    group.add(terrain.mesh);
    return { cx, cz, terrain };
  }

  function descartar(p: Pedaco): void {
    group.remove(p.terrain.mesh);
    p.terrain.dispose();
  }

  return {
    group,

    update(centerX, centerZ, patch) {
      opcoes = { ...opcoes, ...patch };
      const { terreno, descarte } = raios();

      // O tapete de grama segue a câmera, com 45% do lado de folga. Refazer
      // custa dezenas de milissegundos, e um limiar apertado ressemeia a cada
      // passo — o que aparece como engasgo justamente enquanto se caminha.
      const aqui = new THREE.Vector2(centerX, centerZ);
      if (!grama || gramaEm.distanceTo(aqui) > ladoDaGrama() * 0.45) {
        refazerGrama(centerX, centerZ);
      }

      const ccx = Math.floor(centerX / CHUNK_METERS);
      const ccz = Math.floor(centerZ / CHUNK_METERS);

      // Descarte primeiro: libera memória antes de alocar, e é barato.
      for (const [k, p] of [...carregados]) {
        const d = Math.max(Math.abs(p.cx - ccx), Math.abs(p.cz - ccz));
        if (d > descarte) {
          descartar(p);
          carregados.delete(k);
        }
      }

      // Um pedaço por chamada, o mais perto primeiro. A fila é construída em
      // ordem de anel para o mundo se completar de dentro para fora — é o que
      // faz o carregamento parecer natural em vez de aleatório.
      let melhor: { cx: number; cz: number; d: number } | null = null;
      for (let dz = -terreno; dz <= terreno; dz++) {
        for (let dx = -terreno; dx <= terreno; dx++) {
          const cx = ccx + dx;
          const cz = ccz + dz;
          if (carregados.has(chave(cx, cz))) continue;
          const d = Math.max(Math.abs(dx), Math.abs(dz));
          if (!melhor || d < melhor.d) melhor = { cx, cz, d };
        }
      }

      if (!melhor) return false;
      carregados.set(chave(melhor.cx, melhor.cz), montar(melhor.cx, melhor.cz));
      return true;
    },

    animate(elapsedSeconds) {
      grama?.update(elapsedSeconds);
    },

    setWind(direction, strength) {
      direcaoVento = direction.clone();
      forcaVento = strength;
      grama?.setWind(direction, strength);
    },

    get loadedCount() {
      return carregados.size;
    },

    get bladeCount() {
      return grama?.bladeCount ?? 0;
    },

    clear() {
      for (const p of carregados.values()) descartar(p);
      carregados.clear();
      if (grama) {
        group.remove(grama.mesh);
        grama.dispose();
        grama = null;
      }
      gramaEm.set(Number.NaN, Number.NaN);
    },

    dispose() {
      this.clear();
    },
  };
}
