import { describe, expect, it } from 'vitest';

import { InstancedBufferAttribute } from 'three';

import { DensityField } from '../src/render/density';
import { createGrassField, defaultGrassOptions } from '../src/render/grass';
import { budgetFor, grassOptionsFor } from '../src/render/quality';
import { Biome, biomeDef } from '../src/world/biome';
import {
  nearestLandBiome,
  onPlotBorder,
  plotAreaFor,
  plotOrigin,
} from '../src/world/plotArea';
import { WorldGenerator } from '../src/world/worldGen';

/**
 * O campo de grama tem de cobrir o trecho **inteiro**.
 *
 * O bug que estes testes prendem: o teto de lâminas era aplicado como um
 * `break` no meio de um laço que varre linha por linha em +Z. Estourar o teto
 * não ralava o campo — cortava fora tudo dali para a frente, e o trecho nascia
 * pelado sempre do mesmo lado. No orçamento médio isso era dois terços da área.
 *
 * Contar lâminas não pegaria: o total ficava certinho no teto. Só olhar **onde**
 * elas caem denuncia.
 *
 * A seed `verde` é usada de propósito nos testes de cobertura: ela não tem água
 * no trecho central. Água legitimamente não tem grama, e misturar as duas
 * coisas faria o teste falhar por um motivo e passar por outro.
 */

function semear(maxBlades: number, patchSize = 52, seed = 'verde') {
  const world = WorldGenerator.fromLabel(seed);
  const density = new DensityField(world);
  const field = createGrassField(world, density, 0, 0, {
    ...defaultGrassOptions,
    patchSize,
    maxBlades,
  });
  const attr = field.mesh.geometry.getAttribute(
    'aOffset',
  ) as InstancedBufferAttribute;

  const pontos: { x: number; z: number }[] = [];
  for (let i = 0; i < field.bladeCount; i++) {
    pontos.push({ x: attr.getX(i), z: attr.getZ(i) });
  }
  field.dispose();
  return { pontos, patchSize };
}

describe('Cobertura do campo de grama', () => {
  it('semeia os quatro quadrantes mesmo com o teto apertado', () => {
    // Teto bem abaixo do que a densidade pediria: é exatamente o caso em que o
    // corte antigo aparecia.
    const { pontos } = semear(4_000);
    expect(pontos.length).toBeGreaterThan(1_000);

    const quadrantes = [0, 0, 0, 0];
    for (const p of pontos) {
      quadrantes[(p.x < 0 ? 0 : 1) + (p.z < 0 ? 0 : 2)]!++;
    }

    // Nenhum quadrante pode ficar vazio, e nenhum pode carregar o campo
    // sozinho. Com o corte por linha, dois deles zeravam.
    const total = pontos.length;
    for (const n of quadrantes) {
      expect(n).toBeGreaterThan(total * 0.18);
    }
  });

  it('a última faixa do trecho recebe tanta grama quanto a primeira', () => {
    // O corte antigo era em +Z: a faixa final era a que sumia.
    const { pontos, patchSize } = semear(4_000);
    const half = patchSize / 2;
    const faixa = patchSize / 10;

    const primeira = pontos.filter((p) => p.z < -half + faixa).length;
    const ultima = pontos.filter((p) => p.z > half - faixa).length;

    expect(primeira).toBeGreaterThan(0);
    expect(ultima).toBeGreaterThan(0);
    expect(ultima / primeira).toBeGreaterThan(0.65);
    expect(ultima / primeira).toBeLessThan(1.55);
  });

  it('respeita o teto do orçamento sem desperdiçá-lo', () => {
    // Cobrir o trecho todo não pode virar desculpa para ignorar o aparelho —
    // nem para deixar orçamento na mesa e devolver um campo ralo.
    for (const tier of ['baixo', 'medio', 'alto'] as const) {
      const opcoes = grassOptionsFor(budgetFor(tier));
      const world = WorldGenerator.fromLabel('verde');
      const field = createGrassField(
        world,
        new DensityField(world),
        0,
        0,
        opcoes,
      );
      expect(field.bladeCount).toBeLessThanOrEqual(opcoes.maxBlades);
      expect(field.bladeCount).toBeGreaterThan(opcoes.maxBlades * 0.7);
      field.dispose();
    }
  });

  it('a densidade efetiva por metro quadrado fecha o campo', () => {
    // A conta que decide se o campo lê como mato ou como carpete puído.
    for (const tier of ['baixo', 'medio', 'alto'] as const) {
      const b = budgetFor(tier);
      expect(b.maxBlades / (b.patchSize * b.patchSize)).toBeGreaterThan(25);
    }
  });
});

describe('Chão do terreno do jogador', () => {
  const water = WorldGenerator.fromLabel('grama-buraco');

  it('o lote nunca cai sobre bioma sem grama', () => {
    // Com o cenário plano, Água Morta dentro do tabuleiro não vira lago: vira
    // mancha pelada sem explicação. Era o "não tem mato no meu tabuleiro".
    const area = plotAreaFor(water, -26, 12, 32, 32);
    expect(biomeDef(area.biome).grassDensity).toBeGreaterThan(0.4);
    expect(area.biome).not.toBe(Biome.deadWater);
  });

  it('a densidade dentro do lote é alta em todo ponto', () => {
    const area = plotAreaFor(water, -26, 12, 32, 32);
    const density = new DensityField(water, area);
    for (let x = area.minX; x <= area.maxX; x += 2) {
      for (let z = area.minZ; z <= area.maxZ; z += 2) {
        // A trilha da divisa é a única exceção, e é de propósito: ela existe
        // justamente por ser a falta de grama.
        if (onPlotBorder(area, x, z)) continue;
        expect(density.at(x, z)).toBeGreaterThan(0.6);
      }
    }
  });

  it('a divisa é uma faixa pisada, fechada e dos dois lados da cerca', () => {
    const area = plotAreaFor(water, 0, 0, 40, 40);
    const density = new DensityField(water, area);
    const f = area.fence;

    // Em cima da cerca, nos quatro lados.
    for (const [x, z] of [
      [f.minX, 0],
      [f.maxX, 0],
      [0, f.minZ],
      [0, f.maxZ],
    ] as const) {
      expect(density.at(x, z)).toBe(0);
    }

    // Um metro para dentro e um para fora ainda é trilha; três metros já é
    // mato dos dois lados. Sem isso a divisa seria uma linha, e linha some sob
    // a grama — que foi exatamente o problema original.
    expect(density.at(f.minX + 1, 0)).toBe(0);
    expect(density.at(f.minX - 1, 0)).toBe(0);
    expect(density.at(f.minX + 3, 0)).toBeGreaterThan(0.6);
    expect(density.at(f.minX - 3, 0)).toBeGreaterThan(0.6);
  });

  it('fora do lote o mundo continua sendo o mundo', () => {
    // O lote impõe o chão dele, não repinta o mapa. Sem esta garantia, a
    // correção viraria "some com a água do mundo inteiro".
    const area = plotAreaFor(water, 0, 0, 32, 32);
    const comLote = new DensityField(water, area);
    const semLote = new DensityField(water);
    let diferentes = 0;
    for (let x = -120; x <= 120; x += 7) {
      for (let z = -120; z <= 120; z += 7) {
        const dentro =
          x >= area.minX && x <= area.maxX && z >= area.minZ && z <= area.maxZ;
        if (dentro) continue;
        if (comLote.at(x, z) !== semLote.at(x, z)) diferentes++;
      }
    }
    expect(diferentes).toBe(0);
  });

  it('o bioma do lote vem do vizinho, e não de uma constante', () => {
    // Um lote sempre igual apagaria a seed. Duas regiões diferentes têm de
    // poder dar chões diferentes.
    const vistos = new Set<Biome>();
    for (const seed of ['verde', 'krom', 'pradaria', 'vale-seco', 'campo-aberto']) {
      const w = WorldGenerator.fromLabel(seed);
      const o = plotOrigin(w);
      vistos.add(nearestLandBiome(w, o.x, o.z));
    }
    expect(vistos.size).toBeGreaterThan(1);
  });

  it('a origem do lote sai do ponto de rede e varia com a seed', () => {
    // Ruído de gradiente vale zero em todo ponto de rede, e (0,0) é um deles em
    // qualquer escala: o lote na origem recebia o mesmo bioma para toda seed.
    const origens = new Set<string>();
    for (const seed of ['verde', 'krom', 'pradaria', 'vale-seco', 'campo-aberto']) {
      const o = plotOrigin(WorldGenerator.fromLabel(seed));
      expect(o.x === 0 && o.z === 0).toBe(false);
      origens.add(`${o.x},${o.z}`);
    }
    expect(origens.size).toBe(5);
  });

  it('a mesma seed devolve sempre o mesmo lote', () => {
    // Sem isto, reabrir a campanha mudaria o lugar do vilarejo.
    const a = plotOrigin(WorldGenerator.fromLabel('neon-tokyo'));
    const b = plotOrigin(WorldGenerator.fromLabel('neon-tokyo'));
    expect(a).toEqual(b);
  });
});
