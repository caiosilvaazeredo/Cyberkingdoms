import { describe, expect, it } from 'vitest';

import { Campaign } from '../src/campaign/campaign';
import { acampar } from '../src/campaign/camp';
import { startJourney } from '../src/campaign/journey';

/**
 * O que estes testes protegem.
 *
 * Acampar não inventa recurso: ele gasta o que está na mochila, pelo mesmo
 * caminho que o botão de comer usa. Um erro aqui é invisível na tela e fatal na
 * partida — comida sumindo sem repor vital, ou vital subindo sem gastar comida.
 */

function campanhaViajando(): Campaign {
  const c = Campaign.create({ id: 't', seedLabel: 'acampar', characterName: 'A', now: 0 });
  const outra = c.world.layout.settlements.find(
    (s) => s.isCapital && s.id !== c.currentSettlementId,
  )!;
  c.character.inventory.add('water', 10);
  c.character.inventory.add('rationPack', 10);
  const r = startJourney(c, outra.id);
  expect(r.ok).toBe(true);
  return c;
}

describe('acampar na estrada', () => {
  it('não faz nada fora da estrada', () => {
    const c = Campaign.create({ id: 't', seedLabel: 'acampar', characterName: 'A', now: 0 });
    c.character.inventory.add('water', 5);
    c.character.hunger = 10;
    c.character.thirst = 10;
    expect(acampar(c)).toEqual([]);
    expect(c.character.inventory.quantityOf('water')).toBe(5);
  });

  it('come quando o vital está baixo, e para quando ele sobe', () => {
    const c = campanhaViajando();
    c.character.hunger = 10;
    c.character.thirst = 10;
    const antes = c.character.inventory.quantityOf('water')
      + c.character.inventory.quantityOf('rationPack');

    const consumidos = acampar(c);
    expect(consumidos.length).toBeGreaterThan(0);
    expect(c.character.hunger).toBeGreaterThan(10);
    expect(c.character.thirst).toBeGreaterThan(10);

    // Cada item citado saiu do inventário. Uma linha de log sem baixa no
    // estoque seria comida saindo do nada.
    const depois = c.character.inventory.quantityOf('water')
      + c.character.inventory.quantityOf('rationPack');
    expect(antes - depois).toBe(consumidos.length);
  });

  it('não come com os vitais cheios', () => {
    const c = campanhaViajando();
    c.character.hunger = 100;
    c.character.thirst = 100;
    expect(acampar(c)).toEqual([]);
  });

  it('não esvazia a mochila num dia só', () => {
    const c = campanhaViajando();
    c.character.hunger = 0;
    c.character.thirst = 0;
    expect(acampar(c).length).toBeLessThanOrEqual(4);
    expect(c.character.inventory.quantityOf('water')).toBeGreaterThan(0);
  });

  it('sem mantimento, não estoura nem inventa vital', () => {
    const c = campanhaViajando();
    c.character.inventory.remove('water', 10);
    c.character.inventory.remove('rationPack', 10);
    c.character.hunger = 5;
    c.character.thirst = 5;
    expect(acampar(c)).toEqual([]);
    expect(c.character.hunger).toBe(5);
    expect(c.character.thirst).toBe(5);
  });

  it('gasta o mais barato primeiro, guardando a refeição boa', () => {
    const c = campanhaViajando();
    c.character.inventory.add('luxuryMeal', 2);
    c.character.hunger = 10;
    c.character.thirst = 100;
    acampar(c);
    expect(c.character.inventory.quantityOf('luxuryMeal')).toBe(2);
  });

  it('a despensa acompanha o que foi comido', () => {
    // Sem isso, o lote perecível ficaria na despensa depois do item já ter
    // saído do inventário — e venceria um estoque que não existe mais.
    const c = campanhaViajando();
    c.pantry.register('water', 10, 0);
    c.character.hunger = 10;
    c.character.thirst = 10;
    // O mesmo instante do registro: um lote de água vence em 120 h, e usar
    // `Date.now()` aqui compararia com um lote de 1970 já vencido.
    const consumidos = acampar(c, 0);
    const agua = consumidos.filter((n) => n === 'Água de Poço').length;
    expect(agua).toBeGreaterThan(0);
    expect(c.pantry.freshOf('water', 0)).toBe(10 - agua);
  });
});
