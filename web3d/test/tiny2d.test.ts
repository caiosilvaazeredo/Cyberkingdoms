import { describe, expect, it } from 'vitest';

import { buildStartingPlot } from '../src/campaign/campaign';
import { allBuildings, buildingDef } from '../src/building/buildingType';
import { PlacedBuilding, Plot } from '../src/building/plot';
import { Settlement } from '../src/world/settlement';
import { TileCoord } from '../src/world/coords';
import {
  CORES_USADAS,
  ESTILOS,
  FORMAS_USADAS,
  LARGURA_DA_FORMA,
  construcoesSemEstilo,
  estiloDe,
} from '../src/render2d/estilos';
import {
  centroDoTerreno,
  dentroDoTerreno,
  prediosDoTerreno,
  retanguloDoTerreno,
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

describe('a identidade visual das construções', () => {
  it('as 41 construções do catálogo têm estilo próprio', () => {
    // Sem entrada, a construção cai no estilo de reserva da categoria e vira
    // gêmea de outra. O buraco é invisível na tela: dois prédios iguais não
    // parecem defeito, parecem descuido de arte.
    expect(construcoesSemEstilo()).toEqual([]);
  });

  it('nenhuma construção é visualmente igual a outra', () => {
    const vistas = new Map<string, string>();
    for (const def of allBuildings) {
      const e = estiloDe(def.id, def.category);
      const assinatura =
        `${e.forma}|${e.cor}|${e.anexo ?? ''}|${[...e.enfeites].sort().join(',')}|${e.fx ?? ''}`;
      const gemea = vistas.get(assinatura);
      expect(gemea, `${def.id} é idêntica a ${gemea}`).toBeUndefined();
      vistas.set(assinatura, def.id);
    }
    expect(vistas.size).toBe(allBuildings.length);
  });

  it('só usa forma e cor que existem no acervo carregado', () => {
    const formas = new Set<string>(FORMAS_USADAS);
    const cores = new Set<string>(CORES_USADAS);
    for (const [id, e] of Object.entries(ESTILOS)) {
      expect(formas.has(e.forma), `${id}: ${e.forma}`).toBe(true);
      expect(cores.has(e.cor), `${id}: ${e.cor}`).toBe(true);
      if (e.anexo) expect(formas.has(e.anexo), `${id}: anexo ${e.anexo}`).toBe(true);
    }
    // `world2d` carrega cor × forma; a matriz precisa fechar.
    expect(FORMAS_USADAS.length * CORES_USADAS.length).toBe(40);
  });

  it('a forma não passa de um tile além da pegada da construção', () => {
    // Um sprite de cinco colunas num terreno de 8×8 cobriria o vizinho. O
    // desenho corta pela largura nativa, e a tabela precisa concordar.
    for (const def of allBuildings) {
      const e = estiloDe(def.id, def.category);
      expect(
        LARGURA_DA_FORMA[e.forma],
        `${def.id}: ${e.forma} tem ${LARGURA_DA_FORMA[e.forma]} tiles para pegada ${def.width}`,
      ).toBeLessThanOrEqual(Math.max(def.width + 1, 2) + 1);
    }
  });

  it('a reserva cobre id fora do catálogo sem estourar', () => {
    const e = estiloDe('construcaoQueNaoExiste', 'civic');
    expect(e.forma).toBe('Monastery');
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

    expect(obra!.forma).toBe(estiloDe('apartment', 'housing').forma);
    expect(obra!.tiles).toBe(def.width);
    expect(obra!.tilesAltura).toBe(def.height);
    expect(obra!.obraDias).toBe(3);
    expect(obra!.parada).toBe(false);

    expect(parada!.obraDias).toBe(0);
    expect(parada!.parada).toBe(true);
  });

  it('o rótulo mostra o nível, e o porte cresce sem trocar a identidade', () => {
    const plot = new Plot('p', 'cap_teste', { x: 0, y: 0 }, 16, 16, [
      new PlacedBuilding('n1', 'shack', 0, 0, 0),
      new PlacedBuilding('n2', 'shack', 2, 2, 0, 0, false, 2),
    ]);
    const [um, dois] = prediosDoTerreno(plot);
    const nome = buildingDef('shack').name;
    expect(um!.rotulo).toBe(nome);
    expect(dois!.rotulo).toBe(`${nome} II`);
    // Evoluir aparece no porte. A forma e a cor **não** mudam: um barraco
    // melhorado continua sendo aquele barraco.
    expect(dois!.escala).toBeGreaterThan(um!.escala);
    expect(dois!.forma).toBe(um!.forma);
    expect(dois!.cor).toBe(um!.cor);
  });

  it('só solta fumaça quem está produzindo', () => {
    const plot = new Plot('p', 'cap_teste', { x: 0, y: 0 }, 16, 16, [
      new PlacedBuilding('pronta', 'foundry', 0, 0, 0),
      new PlacedBuilding('obra', 'foundry', 4, 0, 2),
      new PlacedBuilding('parada', 'foundry', 8, 0, 0, 0, true),
    ]);
    const [pronta, obra, parada] = prediosDoTerreno(plot);
    expect(pronta!.fx).toBe('fogo');
    expect(obra!.fx).toBeUndefined();
    expect(parada!.fx).toBeUndefined();
  });
});
