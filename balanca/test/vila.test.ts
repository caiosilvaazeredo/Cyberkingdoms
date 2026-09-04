import { describe, expect, it } from 'vitest';

import { criarArena, PONTE } from '../src/shared/arena';
import { posicaoDaVilaDeGnomos } from '../src/client/decoracao';
import { IDS_DOS_MAPAS } from '../src/shared/mapas';
import { TILE } from '../src/shared/regras';

/**
 * A vila de gnomos: cenário de fundo perto da árvore do meio.
 *
 * Sem árvore central (o Arquipélago não tem uma), ela simplesmente não
 * aparece — o mesmo "some em vez de flutuar" do resto da vida selvagem. Onde
 * aparece, o ponto achado precisa ser chão seco, sem ponte e sem decoração
 * bloqueando — senão as duas casas nascem em cima de uma pedra ou da própria
 * água.
 */
describe('a vila de gnomos', () => {
  it('acha um cantinho seco e livre perto da árvore, em todo mapa que tiver uma', () => {
    for (const id of IDS_DOS_MAPAS) {
      for (const seed of [1, 7, 42, 123]) {
        const arena = criarArena(seed, id);
        const vila = posicaoDaVilaDeGnomos(arena);
        if (!vila) continue; // sem árvore central neste mapa — comportamento esperado
        const tx = Math.floor(vila.x / TILE);
        const ty = Math.floor(vila.y / TILE);
        expect(arena.ehChao(tx, ty), `${id}/${seed}`).toBe(true);
        expect(arena.bloqueado(tx, ty), `${id}/${seed}`).toBe(false);
        expect(arena.tile(tx, ty), `${id}/${seed}`).not.toBe(PONTE);
      }
    }
  });

  it('é a mesma posição sempre — não depende do relógio de parede', () => {
    const arena = criarArena(1, 'corte');
    const a = posicaoDaVilaDeGnomos(arena);
    const b = posicaoDaVilaDeGnomos(arena);
    expect(a).toEqual(b);
  });
});
