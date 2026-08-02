import { describe, expect, it } from 'vitest';

import { PerspectiveCamera } from 'three';

import { CityCamera } from '../src/render/cityCamera';
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

describe('Câmera de construtor de cidade', () => {
  const flat = () => 0;

  function make(): CityCamera {
    const camera = new PerspectiveCamera(58, 0.5, 0.1, 900);
    return new CityCamera(camera, flat);
  }

  it('arrastar move o alvo, não gira em volta dele', () => {
    // É a diferença entre uma câmera orbital e a de um tycoon: o ponto sob o
    // dedo continua sob o dedo.
    const view = make();
    const antes = view.target.clone();
    view.pan(120, 0, 800);
    view.apply();
    expect(view.target.distanceTo(antes)).toBeGreaterThan(0);
  });

  it('o arrasto rende mais longe do que perto', () => {
    // Com fator fixo, arrastar de perto atravessa o mapa e arrastar de longe
    // não sai do lugar.
    const perto = make();
    perto.distance = 15;
    const a = perto.target.clone();
    perto.pan(100, 0, 800);
    const dPerto = perto.target.distanceTo(a);

    const longe = make();
    longe.distance = 150;
    const b = longe.target.clone();
    longe.pan(100, 0, 800);
    expect(longe.target.distanceTo(b)).toBeGreaterThan(dPerto);
  });

  it('afastar levanta a câmera sozinho', () => {
    // Longe o jogador planeja e quer ver o traçado; perto quer ver volume.
    const view = make();
    view.distance = view.limits.minDistance;
    const baixo = view.pitch;
    view.distance = view.limits.maxDistance;
    expect(view.pitch).toBeGreaterThan(baixo);
  });

  it('a inclinação respeita os limites em qualquer entrada', () => {
    const view = make();
    view.tiltBy(-99);
    expect(view.pitch).toBeGreaterThanOrEqual(view.limits.minPitch);
    view.tiltBy(99);
    expect(view.pitch).toBeLessThanOrEqual(view.limits.maxPitch);
  });

  it('o zoom respeita os limites', () => {
    const view = make();
    for (let i = 0; i < 50; i++) view.zoomBy(2);
    expect(view.distance).toBe(view.limits.minDistance);
    for (let i = 0; i < 50; i++) view.zoomBy(0.5);
    expect(view.distance).toBe(view.limits.maxDistance);
  });

  it('a câmera nunca entra no morro', () => {
    // Sem a trava, aproximar numa encosta enfia a câmera dentro do terreno e a
    // tela fica preta — um jeito rápido de o jogo parecer quebrado.
    const morro = new PerspectiveCamera(58, 1, 0.1, 900);
    const view = new CityCamera(morro, () => 40);
    view.distance = view.limits.minDistance;
    view.tiltBy(-99);
    view.apply();
    expect(morro.position.y).toBeGreaterThan(40);
  });
});
