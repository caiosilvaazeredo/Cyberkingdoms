import { describe, expect, it } from 'vitest';

import { AGUA, criarArena } from '../src/shared/arena';
import { posicaoDoTubarao } from '../src/client/desenho';
import { IDS_DOS_MAPAS } from '../src/shared/mapas';
import { TILE } from '../src/shared/regras';

/**
 * O tubarão: só nada no Vau e no Arquipélago, e só dentro d'água.
 *
 * A água desses dois mapas é um canal estreito, cortado por pontes a poucos
 * tiles do centro — um raio de passeio generoso bate na margem ou numa ponte
 * antes de completar a volta. Este teste varre um ciclo inteiro do relógio
 * de parede e confere tile a tile, porque "parece que nada direito" não é
 * algo que se vê olhando o código.
 */
describe('o tubarão', () => {
  it('nada só no Vau e no Arquipélago', () => {
    for (const id of IDS_DOS_MAPAS) {
      const arena = criarArena(7, id);
      const dentro = id === 'vau' || id === 'arquipelago';
      const p = posicaoDoTubarao(arena, 10);
      if (dentro) expect(p, id).not.toBeNull();
      else expect(p, id).toBeNull();
    }
  });

  it('fica dentro d\'água o ciclo inteiro, nos dois mapas, em várias seeds', () => {
    for (const id of ['vau', 'arquipelago'] as const) {
      for (const seed of [1, 7, 42, 123, 999]) {
        const arena = criarArena(seed, id);
        for (let t = 0; t < 200; t += 0.1) {
          const p = posicaoDoTubarao(arena, t);
          expect(p, `${id}/${seed}/t=${t}`).not.toBeNull();
          const tx = Math.floor(p!.x / TILE);
          const ty = Math.floor(p!.y / TILE);
          expect(arena.tile(tx, ty), `${id}/${seed}/t=${t}`).toBe(AGUA);
        }
      }
    }
  });
});
