import type { GrassOptions } from './grass';

/**
 * Orçamento de render que se ajusta ao aparelho.
 *
 * ## Por que não uma constante
 *
 * O jogo é mobile-first, e "celular" vai de um aparelho de entrada com GPU
 * integrada a um topo de linha. Um número fixo de lâminas ou serve mal ao
 * primeiro, ou desperdiça o segundo. Pior: eu não tenho como medir aqui num
 * aparelho real — o que existe neste ambiente é rasterizador por software, que
 * não diz nada sobre o desempenho de um Snapdragon.
 *
 * Então o orçamento não é adivinhado, é **medido em execução**. Começa num
 * palpite conservador pela classe do aparelho e sobe ou desce conforme o tempo
 * de quadro real. Um palpite errado se corrige em dois segundos; uma constante
 * errada fica.
 *
 * ## Por que a resolução cai antes da grama
 *
 * Num celular o gargalo quase sempre é preenchimento, não vértice: a tela tem
 * `devicePixelRatio` 3 e o shader roda uma vez por pixel. Baixar de 2,0 para
 * 1,5 corta 44% dos pixels e quase não se vê; cortar 44% das lâminas deixa o
 * campo ralo, que é exatamente o que este renderizador existe para evitar.
 */

export type DeviceTier = 'baixo' | 'medio' | 'alto';

export interface QualityBudget {
  /** Multiplicador do `devicePixelRatio`, já limitado. */
  readonly pixelRatio: number;
  /** Teto de lâminas de grama. */
  readonly maxBlades: number;
  /** Lado do trecho semeado, em metros. */
  readonly patchSize: number;
  /** Subdivisões da malha de terreno por eixo. */
  readonly terrainSegments: number;
}

const budgets: Record<DeviceTier, QualityBudget> = {
  // Aparelho de entrada: um trecho menor, e o suficiente de grama para o campo
  // ainda ler como campo. Abaixo disso é melhor mostrar menos mundo do que
  // mostrar mundo pelado.
  baixo: { pixelRatio: 1, maxBlades: 26_000, patchSize: 42, terrainSegments: 96 },
  medio: { pixelRatio: 1.5, maxBlades: 60_000, patchSize: 52, terrainSegments: 140 },
  alto: { pixelRatio: 2, maxBlades: 110_000, patchSize: 64, terrainSegments: 200 },
};

/**
 * Palpite inicial pela classe do aparelho.
 *
 * Só heurística — `deviceMemory` e `hardwareConcurrency` não são medidas de
 * GPU, e nem todo navegador expõe as duas. Serve para não começar alto demais
 * num aparelho fraco e derrubar os primeiros segundos, que é justamente quando
 * o jogador decide se fica.
 */
export function guessTier(nav: Navigator = navigator): DeviceTier {
  const memory = (nav as Navigator & { deviceMemory?: number }).deviceMemory;
  const cores = nav.hardwareConcurrency ?? 4;
  const coarse =
    typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

  if (memory !== undefined && memory <= 2) return 'baixo';
  if (cores <= 4) return coarse ? 'baixo' : 'medio';
  if (coarse && cores <= 6) return 'medio';
  return coarse ? 'medio' : 'alto';
}

export function budgetFor(tier: DeviceTier): QualityBudget {
  return budgets[tier];
}

export function grassOptionsFor(budget: QualityBudget): GrassOptions {
  return {
    patchSize: budget.patchSize,
    // Densidade por metro quadrado alta o bastante para o teto ser o que manda:
    // é o teto que representa o orçamento do aparelho, não a densidade.
    bladesPerSquareMeter: 70,
    maxBlades: budget.maxBlades,
  };
}

const order: DeviceTier[] = ['baixo', 'medio', 'alto'];

/**
 * Observa o tempo de quadro e sobe ou desce a classe.
 *
 * As duas assimetrias abaixo são de propósito:
 *
 * - **Desce rápido, sobe devagar.** Engasgo o jogador sente na hora; ganho de
 *   qualidade ele nem repara. Descer exige meio segundo ruim, subir exige
 *   quatro segundos bons.
 * - **Histerese larga.** Descer em 45 FPS e subir em 58 deixa uma faixa morta
 *   de 13 quadros entre as duas decisões. Sem ela, um aparelho parado
 *   exatamente no limite alternaria de classe a cada segundo, e a mudança de
 *   classe custa refazer a grama — o remédio viraria a doença.
 */
export class QualityGovernor {
  private frames = 0;
  private accumulated = 0;
  private goodStreak = 0;

  constructor(
    private currentTier: DeviceTier = guessTier(),
    private readonly onChange: (tier: DeviceTier) => void = () => {},
  ) {}

  get tier(): DeviceTier {
    return this.currentTier;
  }

  get budget(): QualityBudget {
    return budgets[this.currentTier];
  }

  /** Alimenta o medidor com o delta do quadro, em segundos. */
  sample(delta: number): void {
    // Quadros absurdos (aba oculta, depurador aberto) não são sintoma de
    // aparelho lento e envenenariam a média.
    if (delta <= 0 || delta > 0.5) return;

    this.frames++;
    this.accumulated += delta;
    if (this.accumulated < 0.5) return;

    const fps = this.frames / this.accumulated;
    this.frames = 0;
    this.accumulated = 0;

    if (fps < 45) {
      this.goodStreak = 0;
      this.step(-1);
      return;
    }

    if (fps > 58) {
      this.goodStreak++;
      // Oito janelas de meio segundo = quatro segundos estáveis.
      if (this.goodStreak >= 8) {
        this.goodStreak = 0;
        this.step(1);
      }
      return;
    }

    this.goodStreak = 0;
  }

  private step(direction: -1 | 1): void {
    const index = order.indexOf(this.currentTier);
    const next = order[index + direction];
    if (!next || next === this.currentTier) return;
    this.currentTier = next;
    this.onChange(next);
  }
}
