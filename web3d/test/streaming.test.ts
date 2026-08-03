import { describe, expect, it } from 'vitest';

import { Vector2 } from 'three';

import { DensityField } from '../src/render/density';
import { budgetFor } from '../src/render/quality';
import { CHUNK_METERS, createStreamingWorld } from '../src/render/streaming';
import { WorldGenerator } from '../src/world/worldGen';

/**
 * O mundo carregado em pedaços.
 *
 * O que estes testes prendem é a lição que custou caro: dar a cada pedaço uma
 * fatia do orçamento de lâminas produz um mundo pelado, porque densidade não
 * escala com área. Por isso a grama é um tapete só e o teste mede **lâminas
 * por metro quadrado**, não o total.
 */

function mundo(viewDistance = 60, tier: 'baixo' | 'medio' | 'alto' = 'medio') {
  const world = WorldGenerator.fromLabel('verde');
  return createStreamingWorld({
    world,
    density: new DensityField(world),
    budget: budgetFor(tier),
    bounds: null,
    plotArea: null,
    viewDistance,
    windDirection: new Vector2(1, 0.35),
    windStrength: 0.22,
  });
}

/** Carrega até não sobrar nada perto do ponto. */
function encher(w: ReturnType<typeof mundo>, x: number, z: number, teto = 400): void {
  for (let i = 0; i < teto; i++) {
    if (!w.update(x, z, {})) return;
  }
}

describe('Carregamento em pedaços', () => {
  it('monta no máximo um pedaço por chamada', () => {
    // Montar quatro de uma vez ao cruzar uma diagonal derruba o quadro de
    // forma visível. É a fila que faz o carregamento parecer progressivo.
    const w = mundo();
    w.update(0, 0, {});
    expect(w.loadedCount).toBe(1);
    w.update(0, 0, {});
    expect(w.loadedCount).toBe(2);
    w.dispose();
  });

  it('preenche o entorno e para quando está completo', () => {
    const w = mundo();
    encher(w, 0, 0);
    // Raio 2 é o mínimo: 5×5.
    expect(w.loadedCount).toBeGreaterThanOrEqual(25);
    expect(w.update(0, 0, {})).toBe(false);
    w.dispose();
  });

  it('descarta o que ficou para trás ao andar', () => {
    const w = mundo();
    encher(w, 0, 0);
    const antes = w.loadedCount;

    // Dez pedaços adiante: nada do ponto inicial continua perto.
    encher(w, CHUNK_METERS * 10, 0);
    expect(w.loadedCount).toBeLessThanOrEqual(antes);
    expect(w.loadedCount).toBeGreaterThanOrEqual(25);
    w.dispose();
  });

  it('a folga entre carregar e descartar evita o sobe-desce na fronteira', () => {
    // Sem histerese, andar em cima da divisa faz o mesmo pedaço nascer e morrer
    // a cada passo — e o custo do sobe-desce fica maior que o de manter.
    const w = mundo();
    encher(w, 0, 0);
    const cheio = w.loadedCount;

    // Um passo curto para dentro do pedaço vizinho não pode descartar nada.
    w.update(CHUNK_METERS * 1.1, 0, {});
    expect(w.loadedCount).toBeGreaterThanOrEqual(cheio);
    w.dispose();
  });

  it('zoom maior carrega mais longe', () => {
    const perto = mundo(20);
    encher(perto, 0, 0);
    const longe = mundo(200);
    encher(longe, 0, 0);
    expect(longe.loadedCount).toBeGreaterThan(perto.loadedCount);
    perto.dispose();
    longe.dispose();
  });
});

describe('O tapete de grama', () => {
  it('mantém a densidade por metro quadrado, não o total espalhado', () => {
    // O defeito original: 45 mil lâminas divididas por 25 pedaços de 64 m
    // cobriam 102 mil m² a 0,4 lâmina por metro — quarenta vezes mais ralo que
    // o trecho único de antes. Densidade é o que o olho lê.
    for (const tier of ['baixo', 'medio', 'alto'] as const) {
      const w = mundo(60, tier);
      encher(w, 0, 0);
      const lado = Math.max(
        40,
        Math.min(140, Math.sqrt(budgetFor(tier).maxBlades / 20)),
      );
      const porMetro = w.bladeCount / (lado * lado);
      expect(porMetro, `densidade em ${tier}`).toBeGreaterThan(10);
      w.dispose();
    }
  });

  it('o tapete acompanha a câmera em vez de ficar para trás', () => {
    const w = mundo();
    encher(w, 0, 0);
    const perto = w.bladeCount;
    expect(perto).toBeGreaterThan(0);

    // Longe do ponto inicial, ainda há grama: se o tapete ficasse parado, o
    // jogador andaria para fora dele e veria chão pelado.
    encher(w, 900, 900);
    expect(w.bladeCount).toBeGreaterThan(0);
    w.dispose();
  });

  it('descartar tudo libera a grama junto', () => {
    const w = mundo();
    encher(w, 0, 0);
    w.clear();
    expect(w.loadedCount).toBe(0);
    expect(w.bladeCount).toBe(0);
    w.dispose();
  });
});
