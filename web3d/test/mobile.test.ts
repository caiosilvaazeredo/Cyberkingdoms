import { describe, expect, it } from 'vitest';

import { QualityGovernor, budgetFor, grassOptionsFor, guessTier } from '../src/render/quality';

/**
 * O jogo é mobile-first, e continuou sendo depois da troca de motor.
 *
 * Estes testes cobrem a parte da decisão mobile que é lógica pura. O resto —
 * tamanho de alvo de toque, área segura, teclado virtual — está no CSS e só a
 * captura em viewport de celular verifica.
 */
describe('Orçamento de render por aparelho', () => {
  it('aparelho fraco recebe menos lâminas e menos resolução', () => {
    const baixo = budgetFor('baixo');
    const alto = budgetFor('alto');

    expect(baixo.maxBlades).toBeLessThan(alto.maxBlades);
    expect(baixo.pixelRatio).toBeLessThan(alto.pixelRatio);
    expect(baixo.terrainSegments).toBeLessThan(alto.terrainSegments);
  });

  it('mesmo no orçamento mínimo o campo continua sendo um campo', () => {
    // Abaixo de umas dezenas de milhares de lâminas dá para contar as folhas,
    // e o renderizador instanciado perde o motivo de existir. É melhor mostrar
    // menos mundo do que mostrar mundo pelado.
    const baixo = budgetFor('baixo');
    const porMetro = baixo.maxBlades / (baixo.patchSize * baixo.patchSize);
    expect(porMetro).toBeGreaterThan(8);
  });

  it('a densidade pedida deixa o teto ser quem manda', () => {
    // O teto representa o orçamento do aparelho. Se a densidade por metro
    // quadrado fosse o limite efetivo, mudar de classe não mudaria nada.
    for (const tier of ['baixo', 'medio', 'alto'] as const) {
      const budget = budgetFor(tier);
      const options = grassOptionsFor(budget);
      const tentativas =
        options.patchSize * options.patchSize * options.bladesPerSquareMeter;
      expect(tentativas, tier).toBeGreaterThan(options.maxBlades);
    }
  });

  it('a heurística inicial não chuta alto num aparelho de toque fraco', () => {
    const fraco = {
      hardwareConcurrency: 4,
      deviceMemory: 2,
    } as unknown as Navigator;
    expect(guessTier(fraco)).toBe('baixo');
  });
});

describe('Governador de qualidade', () => {
  /** Alimenta o governador com `seconds` de quadros a um FPS constante. */
  function feed(governor: QualityGovernor, fps: number, seconds: number): void {
    const delta = 1 / fps;
    for (let t = 0; t < seconds; t += delta) governor.sample(delta);
  }

  it('cai de classe depois de meio segundo ruim', () => {
    // Engasgo o jogador sente na hora; a reação tem de ser rápida.
    const governor = new QualityGovernor('alto');
    feed(governor, 30, 1);
    expect(governor.tier).toBe('medio');
  });

  it('não sobe de classe por um sopro de bom desempenho', () => {
    // Subir custa refazer a grama. Subir cedo demais transformaria o remédio
    // na doença.
    const governor = new QualityGovernor('baixo');
    feed(governor, 60, 1);
    expect(governor.tier).toBe('baixo');
  });

  it('sobe depois de vários segundos estáveis', () => {
    const governor = new QualityGovernor('baixo');
    feed(governor, 60, 6);
    expect(governor.tier).toBe('medio');
  });

  it('a faixa morta impede a oscilação de classe', () => {
    // Um aparelho parado em 50 FPS não pode ficar trocando de classe a cada
    // segundo: cada troca reconstrói o campo inteiro.
    const governor = new QualityGovernor('medio');
    feed(governor, 50, 12);
    expect(governor.tier).toBe('medio');
  });

  it('nunca passa dos extremos', () => {
    const chao = new QualityGovernor('baixo');
    feed(chao, 12, 6);
    expect(chao.tier).toBe('baixo');

    const teto = new QualityGovernor('alto');
    feed(teto, 120, 40);
    expect(teto.tier).toBe('alto');
  });

  it('ignora quadros absurdos de aba oculta', () => {
    // Voltar de segundo plano entrega um delta de minutos. Tratar isso como
    // desempenho ruim derrubaria a qualidade de um aparelho que está bem.
    const governor = new QualityGovernor('alto');
    for (let i = 0; i < 20; i++) governor.sample(30);
    expect(governor.tier).toBe('alto');
  });

  it('avisa quem precisa reconstruir a cena', () => {
    const trocas: string[] = [];
    const governor = new QualityGovernor('alto', (tier) => trocas.push(tier));
    feed(governor, 20, 2);
    expect(trocas).toContain('medio');
  });
});
