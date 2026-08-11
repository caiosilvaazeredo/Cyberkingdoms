import { describe, expect, it } from 'vitest';

import { buildStartingPlot } from '../src/campaign/campaign';
import { allBuildings, buildingDef } from '../src/building/buildingType';
import { PlacedBuilding, Plot } from '../src/building/plot';
import { Settlement } from '../src/world/settlement';
import { TileCoord } from '../src/world/coords';
import {
  SPRITE_POR_CATEGORIA,
  centroDoTerreno,
  dentroDoTerreno,
  prediosDoTerreno,
  retanguloDoTerreno,
  spriteDoPredio,
} from '../src/render2d/predios';

/**
 * O que estes testes protegem.
 *
 * A camada 2D é desenho, e desenho não se testa por asserção. O que **se**
 * testa é a ponte: se o catálogo do jogo cabe inteiro no acervo do pacote, se
 * a construção aparece onde a regra diz que ela está, e se o estado de obra
 * chega até quem desenha. Um buraco em qualquer um dos três vira construção
 * invisível — o tipo de defeito que só aparece quando o jogador já pagou.
 */

const CAPITAL = new Settlement(
  'cap_teste',
  'Capital de Teste',
  'capital',
  new TileCoord(40, 60),
  'agroBio',
  30,
  12000,
);

describe('sprites do pacote para o catálogo do jogo', () => {
  it('cobre todas as categorias do catálogo', () => {
    for (const def of allBuildings) {
      expect(SPRITE_POR_CATEGORIA[def.category], def.id).toBeDefined();
      expect(spriteDoPredio(def.category)).toBeTruthy();
    }
  });

  it('não devolve sprite fora do acervo carregado', () => {
    // A lista é a mesma que `world2d.carregarAssets` busca. Um nome a mais
    // aqui é um prédio que simplesmente não desenha.
    const acervo = new Set([
      'House1', 'House2', 'House3', 'Tower', 'Barracks',
      'Archery', 'Monastery', 'Castle', 'Castle_red', 'House1_yellow',
    ]);
    for (const nomes of Object.values(SPRITE_POR_CATEGORIA)) {
      for (const n of nomes) expect(acervo.has(n), n).toBe(true);
    }
  });

  it('o nível escolhe dentro da categoria, e satura no último sprite', () => {
    expect(spriteDoPredio('housing', 1)).toBe('House1');
    expect(spriteDoPredio('housing', 3)).toBe('House3');
    // Nível acima do que a categoria oferece não pode virar `undefined`.
    expect(spriteDoPredio('housing', 9)).toBe('House3');
    expect(spriteDoPredio('refining', 5)).toBe('Barracks');
    expect(spriteDoPredio('commerce', 0)).toBe('House1_yellow');
  });
});

describe('o terreno do jogador vira desenho', () => {
  it('o retângulo cobre exatamente as células do terreno', () => {
    const plot = buildStartingPlot(CAPITAL, 'survivor');
    const r = retanguloDoTerreno(plot);
    expect(r.minX).toBe(CAPITAL.center.x + 5);
    expect(r.maxX).toBe(r.minX + plot.width - 1);
    expect(dentroDoTerreno(r, r.minX, r.minY)).toBe(true);
    expect(dentroDoTerreno(r, r.maxX, r.maxY)).toBe(true);
    expect(dentroDoTerreno(r, r.maxX + 1, r.maxY)).toBe(false);
    expect(dentroDoTerreno(r, r.minX - 1, r.minY)).toBe(false);
  });

  it('o centro cai dentro do terreno', () => {
    const plot = buildStartingPlot(CAPITAL, 'survivor');
    const c = centroDoTerreno(plot);
    expect(dentroDoTerreno(retanguloDoTerreno(plot), c.x, c.y)).toBe(true);
  });

  it('terreno recém-criado não tem construção nenhuma', () => {
    // O jogo começa com o lote vazio. A primeira versão desta tela desenhava
    // seis prédios de vitrine, e é justamente isso que não pode voltar.
    expect(prediosDoTerreno(buildStartingPlot(CAPITAL, 'survivor'))).toEqual([]);
  });

  it('converte célula do terreno em tile do mundo', () => {
    const plot = new Plot('p', 'cap_teste', { x: 100, y: 200 }, 10, 10, [
      new PlacedBuilding('b1', 'shack', 3, 4, 0),
    ]);
    const [p] = prediosDoTerreno(plot);
    expect(p!.x).toBe(103);
    expect(p!.y).toBe(204);
  });

  it('leva pegada, obra e parada para quem desenha', () => {
    const def = buildingDef('apartment');
    const plot = new Plot('p', 'cap_teste', { x: 0, y: 0 }, 16, 16, [
      new PlacedBuilding('emObra', 'apartment', 1, 1, 3),
      new PlacedBuilding('parada', 'shack', 8, 8, 0, 0, true),
    ]);
    const [obra, parada] = prediosDoTerreno(plot);

    expect(obra!.tiles).toBe(def.width);
    expect(obra!.tilesAltura).toBe(def.height);
    expect(obra!.obraDias).toBe(3);
    expect(obra!.parada).toBe(false);

    expect(parada!.obraDias).toBe(0);
    expect(parada!.parada).toBe(true);
  });

  it('o rótulo mostra o nível quando há evolução', () => {
    const plot = new Plot('p', 'cap_teste', { x: 0, y: 0 }, 16, 16, [
      new PlacedBuilding('n1', 'shack', 0, 0, 0),
      new PlacedBuilding('n2', 'shack', 2, 2, 0, 0, false, 2),
    ]);
    const [um, dois] = prediosDoTerreno(plot);
    expect(um!.rotulo).toBe('Barraco');
    expect(dois!.rotulo).toBe('Barraco II');
    // E o sprite acompanha: evoluir precisa aparecer no terreno.
    expect(dois!.sprite).not.toBe(um!.sprite);
  });
});
