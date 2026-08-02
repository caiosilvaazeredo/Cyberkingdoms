import { describe, expect, it } from 'vitest';

import { Inventory } from '../src/economy/inventory';
import { allItems, itemDef, itemsOfTier } from '../src/economy/item';
import {
  SurvivalTables,
  addUpkeep,
  allWork,
  applyUpkeep,
  isStarving,
  restore,
  scaleUpkeep,
} from '../src/survival/survival';

describe('Catálogo de itens', () => {
  it('carregou do JSON gerado pelo Dart', () => {
    expect(allItems.length).toBeGreaterThan(20);
  });

  it('a cadeia de três camadas do GDD existe inteira', () => {
    // Sem as três camadas povoadas não há economia dirigida por jogadores:
    // é o que obriga quem fabrica a comprar de quem extrai.
    for (const tier of ['extraction', 'refining', 'manufacturing'] as const) {
      expect(itemsOfTier(tier).length, tier).toBeGreaterThan(0);
    }
  });

  it('todo item tem preço-base positivo', () => {
    const gratis = allItems.filter((d) => d.baseValue <= 0);
    expect(gratis.map((d) => d.id)).toEqual([]);
  });

  it('item desconhecido lança em vez de virar buraco no inventário', () => {
    expect(() => itemDef('nao_existe')).toThrow(/desconhecido/);
  });
});

describe('Inventário', () => {
  const comida = allItems.find((d) => d.restoresHunger > 0)!;
  const arma = allItems.find((d) => d.attackPower > 0)!;

  it('somar e remover mantém o saldo', () => {
    const inv = new Inventory();
    inv.add(comida.id, 5);
    inv.add(comida.id, 3);
    expect(inv.quantityOf(comida.id)).toBe(8);
    expect(inv.remove(comida.id, 3)).toBe(true);
    expect(inv.quantityOf(comida.id)).toBe(5);
  });

  it('remover mais do que existe não tira nada', () => {
    // Tudo ou nada: meia remoção deixaria uma compra parcialmente paga.
    const inv = new Inventory();
    inv.add(comida.id, 2);
    expect(inv.remove(comida.id, 5)).toBe(false);
    expect(inv.quantityOf(comida.id)).toBe(2);
  });

  it('zerar o estoque desequipa o item', () => {
    // Senão sobra poder de ataque de uma arma que o jogador não tem mais.
    const inv = new Inventory();
    inv.add(arma.id, 1);
    inv.equip(arma.id);
    expect(inv.attackPower).toBe(arma.attackPower);

    inv.remove(arma.id, 1);
    expect(inv.equipped.has(arma.id)).toBe(false);
    expect(inv.attackPower).toBe(0);
  });

  it('não equipa o que não está no inventário', () => {
    expect(new Inventory().equip(arma.id)).toBe(false);
  });

  it('os modificadores de consumo travam em -80%', () => {
    // Sem o teto, empilhar equipamento zeraria a sobrevivência, que é o
    // sistema central do GDD.
    const inv = new Inventory();
    for (const def of allItems.filter((d) => d.thirstUpkeepModifier < 0)) {
      inv.add(def.id, 1);
      inv.equip(def.id);
    }
    expect(inv.upkeepModifiers.thirst).toBeGreaterThanOrEqual(-0.8);
    expect(inv.upkeepModifiers.hunger).toBeGreaterThanOrEqual(-0.8);
    expect(inv.upkeepModifiers.thirst).toBeLessThanOrEqual(0);
  });

  it('sobrevive a um save com item que saiu do catálogo', () => {
    // Recusar o save inteiro por causa de um item removido apagaria a
    // campanha do jogador.
    const inv = Inventory.fromJson({
      stacks: { [comida.id]: 4, item_que_nao_existe_mais: 9 },
      equipped: ['outro_removido'],
    });
    expect(inv.quantityOf(comida.id)).toBe(4);
    expect(inv.stacks.size).toBe(1);
    expect(inv.equipped.size).toBe(0);
  });

  it('ida e volta por JSON preserva o inventário', () => {
    const inv = new Inventory();
    inv.add(comida.id, 7);
    inv.add(arma.id, 1);
    inv.equip(arma.id);

    const copia = Inventory.fromJson(inv.toJson());
    expect(copia.quantityOf(comida.id)).toBe(7);
    expect(copia.equipped.has(arma.id)).toBe(true);
    expect(copia.estimatedValue).toBe(inv.estimatedValue);
  });
});

describe('Tabelas de sobrevivência', () => {
  it('carregaram os trabalhos das três origens', () => {
    expect(allWork.some((w) => w.kind === 'public')).toBe(true);
    expect(allWork.some((w) => w.kind === 'farm')).toBe(true);
    expect(allWork.some((w) => w.kind === 'workshop')).toBe(true);
  });

  it('trabalho mais pesado custa mais que ficar parado', () => {
    const lixao = allWork.find((w) => w.id === 'dump')!;
    expect(lixao.upkeep.thirst).toBeGreaterThan(0);
    expect(lixao.upkeep.hunger).toBeGreaterThan(0);
  });

  it('escalar arredonda, não trunca', () => {
    // A versão Dart usa `round()`. Truncar perderia meia unidade por
    // atividade, o que ao longo de uma campanha vira dias de diferença.
    expect(scaleUpkeep({ hunger: 5, thirst: 5 }, 1.5)).toEqual({
      hunger: 8,
      thirst: 8,
    });
  });

  it('somar consumos acumula os dois eixos', () => {
    expect(
      addUpkeep(SurvivalTables.idleBase, SurvivalTables.travelRoad),
    ).toEqual({
      hunger: SurvivalTables.idleBase.hunger + SurvivalTables.travelRoad.hunger,
      thirst: SurvivalTables.idleBase.thirst + SurvivalTables.travelRoad.thirst,
    });
  });

  it('os vitais nunca saem da faixa 0..100', () => {
    expect(applyUpkeep(10, 50)).toBe(0);
    expect(restore(90, 50)).toBe(100);
    expect(applyUpkeep(100, 0)).toBe(100);
  });

  it('zero de vital é inanição', () => {
    expect(isStarving(0)).toBe(true);
    expect(isStarving(1)).toBe(false);
  });
});
