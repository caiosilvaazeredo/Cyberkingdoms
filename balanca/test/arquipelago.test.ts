import { describe, expect, it } from 'vitest';

import { AGUA, criarArena } from '../src/shared/arena';
import { posicaoDoBarco, posicaoDoCavaloMarinho } from '../src/client/desenho';
import { IDS_DOS_MAPAS } from '../src/shared/mapas';
import { TILE } from '../src/shared/regras';

/**
 * O barco e o cavalo-marinho: só no Arquipélago, e só dentro d'água — o
 * mesmo compromisso do tubarão, reaproveitando o raio que já foi medido
 * tile a tile para o canal estreito desse mapa.
 */
describe('o barco e o cavalo-marinho', () => {
  it('só aparecem no Arquipélago', () => {
    for (const id of IDS_DOS_MAPAS) {
      const arena = criarArena(7, id);
      const dentro = id === 'arquipelago';
      if (dentro) {
        expect(posicaoDoBarco(arena), id).not.toBeNull();
        expect(posicaoDoCavaloMarinho(arena, 10), id).not.toBeNull();
      } else {
        expect(posicaoDoBarco(arena), id).toBeNull();
        expect(posicaoDoCavaloMarinho(arena, 10), id).toBeNull();
      }
    }
  });

  it('o barco flutua em chão de água, em várias seeds', () => {
    for (const seed of [1, 7, 42, 123, 999]) {
      const arena = criarArena(seed, 'arquipelago');
      const p = posicaoDoBarco(arena);
      expect(p, `seed ${seed}`).not.toBeNull();
      const tx = Math.floor(p!.x / TILE);
      const ty = Math.floor(p!.y / TILE);
      expect(arena.tile(tx, ty), `seed ${seed}`).toBe(AGUA);
    }
  });

  it('o cavalo-marinho fica dentro d\'água o ciclo inteiro, em várias seeds', () => {
    for (const seed of [1, 7, 42, 123, 999]) {
      const arena = criarArena(seed, 'arquipelago');
      for (let t = 0; t < 200; t += 0.1) {
        const p = posicaoDoCavaloMarinho(arena, t);
        expect(p, `seed ${seed}/t=${t}`).not.toBeNull();
        const tx = Math.floor(p!.x / TILE);
        const ty = Math.floor(p!.y / TILE);
        expect(arena.tile(tx, ty), `seed ${seed}/t=${t}`).toBe(AGUA);
      }
    }
  });
});
