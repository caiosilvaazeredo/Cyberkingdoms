import { describe, expect, it } from 'vitest';

import { GradientNoise } from '../src/core/noise';
import { DeterministicRandom, hashLabel, mix, whiteNoise2D } from '../src/core/rng';
import { WorldGenerator } from '../src/world/worldGen';

import fixture from './worldgen-fixture.json';

/**
 * O contrato entre os dois clientes.
 *
 * A referência em `worldgen-fixture.json` é gravada pelo Dart
 * (`flutter test test/fixture_export_test.dart`). Se este arquivo passa, a
 * seed `neon-tokyo` abre o mesmo mundo no app e no navegador — mesmo bioma,
 * mesma altura, no mesmo tile.
 *
 * As camadas são verificadas separadamente de propósito. Quando o contrato
 * quebra, saber *onde* divergiu é a diferença entre um minuto e uma tarde: se
 * o RNG bate e o ruído não, o problema está na tabela de permutação, não na
 * aritmética de 32 bits.
 */
describe('Contrato com o gerador do cliente Flutter', () => {
  describe('RNG', () => {
    it('hashLabel devolve o mesmo número para os mesmos rótulos', () => {
      for (const [label, expected] of Object.entries(fixture.hashLabel)) {
        expect(hashLabel(label), `rótulo "${label}"`).toBe(expected);
      }
    });

    it('hashLabel percorre unidades UTF-16, não pontos de código', () => {
      // O rótulo com acento e ideograma está no fixture justamente por isso:
      // iterar com `[...label]` pareceria mais correto em JS e daria outro
      // número para qualquer caractere fora do BMP.
      expect(hashLabel('ãé漢')).toBe(fixture.hashLabel['ãé漢']);
    });

    it('mix combina duas seeds igual ao Dart', () => {
      for (const entry of fixture.mix) {
        expect(mix(entry.a, entry.b), `mix(${entry.a}, ${entry.b})`).toBe(
          entry.out,
        );
      }
    });

    it('a sequência do Mulberry32 é idêntica', () => {
      const rng = new DeterministicRandom(fixture.seed);
      const produced = fixture.nextInt32.map(() => rng.nextInt32());
      expect(produced).toEqual(fixture.nextInt32);
    });

    it('whiteNoise2D concorda em coordenadas negativas', () => {
      for (const entry of fixture.whiteNoise2D) {
        expect(
          whiteNoise2D(fixture.seed, entry.x, entry.y),
          `(${entry.x}, ${entry.y})`,
        ).toBeCloseTo(entry.out, 12);
      }
    });
  });

  describe('Ruído', () => {
    const noise = new GradientNoise(mix(fixture.seed, 0x31));

    it('sample, fbmUniform e cellular batem com a referência', () => {
      for (const entry of fixture.noiseSample) {
        const where = `(${entry.x.toFixed(2)}, ${entry.y.toFixed(2)})`;
        expect(noise.sample(entry.x, entry.y), `sample ${where}`).toBeCloseTo(
          entry.sample,
          12,
        );
        expect(
          noise.fbmUniform(entry.x, entry.y, { octaves: 3 }),
          `fbmUniform ${where}`,
        ).toBeCloseTo(entry.fbmUniform, 12);
        expect(
          noise.cellular(entry.x, entry.y, 0.009),
          `cellular ${where}`,
        ).toBeCloseTo(entry.cellular, 12);
      }
    });
  });

  describe('Mundo', () => {
    const generator = new WorldGenerator(fixture.seed);

    it('a seed textual vira o mesmo número', () => {
      expect(WorldGenerator.fromLabel(fixture.seedLabel).seed).toBe(
        fixture.seed,
      );
    });

    it('todos os 400 tiles da referência batem', () => {
      const divergentes: string[] = [];
      for (const tile of fixture.tiles) {
        const biome = generator.biomeAt(tile.x, tile.y);
        const elevation = generator.elevationAt(tile.x, tile.y);
        if (biome !== tile.biome || elevation !== tile.elevation) {
          divergentes.push(
            `(${tile.x},${tile.y}) dart=${tile.biome}/${tile.elevation} ` +
              `ts=${biome}/${elevation}`,
          );
        }
      }
      expect(divergentes, divergentes.slice(0, 8).join('\n')).toHaveLength(0);
    });

    it('a amostra cobre biomas suficientes para o teste valer', () => {
      // Um fixture que só pegasse Descampado passaria sem verificar nada dos
      // ramos de decisão do gerador.
      const biomes = new Set(fixture.tiles.map((t) => t.biome));
      expect(biomes.size).toBeGreaterThanOrEqual(9);
    });
  });

  describe('Extensões só da web', () => {
    const generator = new WorldGenerator(fixture.seed);

    it('heightAt é contínuo e concorda em sinal com os degraus do app', () => {
      // O cliente isométrico arredonda para 9 degraus porque sprites não
      // interpolam; a malha 3D usa a altura contínua. Os dois têm de descrever
      // o mesmo relevo, não a mesma quantização.
      for (const tile of fixture.tiles.slice(0, 120)) {
        const height = generator.heightAt(tile.x, tile.y);
        if (tile.elevation > 0) expect(height).toBeGreaterThan(0);
        if (tile.elevation < 0) expect(height).toBeLessThan(0);
      }
    });

    it('isWater concorda com o bioma de Água Morta', () => {
      for (const tile of fixture.tiles) {
        expect(
          generator.isWater(tile.x, tile.y),
          `(${tile.x},${tile.y})`,
        ).toBe(tile.biome === 'deadWater');
      }
    });
  });
});
