import { describe, expect, it } from 'vitest';

import { DeterministicRandom } from '../src/core/rng';
import { Inventory } from '../src/economy/inventory';
import {
  Market,
  marketAccepts,
  seedMarket,
  type MarketKind,
} from '../src/economy/market';
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

describe('Mercado', () => {
  const livro = (kind: MarketKind = 'central'): Market => {
    const m = new Market('cap_0', kind);
    m.postOrder({ sellerId: 'a', sellerName: 'A', item: 'scrap', quantity: 10, unitPrice: 5, day: 1 });
    m.postOrder({ sellerId: 'b', sellerName: 'B', item: 'scrap', quantity: 10, unitPrice: 3, day: 1 });
    m.postOrder({ sellerId: 'c', sellerName: 'C', item: 'scrap', quantity: 10, unitPrice: 9, day: 1 });
    return m;
  };

  it('a cotação é a oferta mais barata, não a primeira publicada', () => {
    expect(livro().bestPrice('scrap')).toBe(3);
    expect(livro().supplyOf('scrap')).toBe(30);
  });

  it('a compra varre da mais barata para a mais cara', () => {
    // 10 a 3 + 5 a 5 = 55, e não 15 a 5.
    const m = livro();
    const r = m.buy({ item: 'scrap', quantity: 15, availableCredits: 9999, taxRate: 0 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.totalPaid).toBe(55);
    expect(m.supplyOf('scrap')).toBe(15);
  });

  it('caixa curto não deixa o livro pela metade', () => {
    // O defeito clássico: debitar oferta a oferta e desistir no meio. O
    // comprador não leva nada e o vendedor perde o estoque.
    const m = livro();
    const r = m.buy({ item: 'scrap', quantity: 25, availableCredits: 40, taxRate: 0 });
    expect(r.ok).toBe(false);
    expect(m.supplyOf('scrap')).toBe(30);
  });

  it('oferta insuficiente recusa antes de tocar no livro', () => {
    const m = livro();
    const r = m.buy({ item: 'scrap', quantity: 99, availableCredits: 999999, taxRate: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('30');
    expect(m.supplyOf('scrap')).toBe(30);
  });

  it('só o Central recolhe imposto, e ele sai da venda', () => {
    // EB 1.1, §14: a taxa incide sobre a venda concluída e vai para o cofre
    // local. Ela **não** é um acréscimo no preço do comprador — como acréscimo,
    // empurraria o Central para cima e faria o clandestino parecer barato
    // quando ele só é sonegado.
    const central = livro('central');
    const clandestino = livro('clandestine');
    const a = central.buy({ item: 'scrap', quantity: 10, availableCredits: 999, taxRate: 0.2 });
    const b = clandestino.buy({ item: 'scrap', quantity: 10, availableCredits: 999, taxRate: 0.2 });
    expect(a.ok && a.totalPaid).toBe(30);
    expect(a.ok && a.tax).toBe(6);
    expect(b.ok && b.tax).toBe(0);
  });

  it('item barato não paga taxa artificial', () => {
    // "Mínimo 0 Cz — sem taxa artificial em itens baratos." Arredondar para
    // cima cobraria 1 Cz de uma venda de 3 Cz, que é 33%.
    const m = livro('central');
    const r = m.buy({ item: 'scrap', quantity: 1, availableCredits: 999, taxRate: 0.01 });
    expect(r.ok && r.totalPaid).toBe(3);
    expect(r.ok && r.tax).toBe(0);
  });

  /**
   * A equalização por rodadas — EB 1.1, §13.
   *
   * Sem ela, o primeiro da fila leva tudo: com dez vendedores no mesmo preço,
   * um vende dez e nove não vendem nada, e o mercado passa a premiar relógio em
   * vez de preço. A meta de liquidez do EB (≥60% dos anúncios com venda) morre
   * exatamente aí.
   */
  const empatados = (): Market => {
    const m = new Market('cap_0', 'central');
    for (const id of ['a', 'b', 'c']) {
      m.postOrder({
        sellerId: id, sellerName: id.toUpperCase(),
        item: 'scrap', quantity: 10, unitPrice: 4, day: 1,
      });
    }
    return m;
  };

  const porVendedor = (r: ReturnType<Market['quickBuy']>): Record<string, number> =>
    r.ok ? Object.fromEntries(r.fills.map((f) => [f.sellerId, f.quantity])) : {};

  it('a compra rápida distribui entre ofertas equivalentes', () => {
    const m = empatados();
    const r = m.quickBuy({ item: 'scrap', quantity: 6, availableCredits: 999, taxRate: 0 });
    expect(r.ok).toBe(true);
    expect(porVendedor(r)).toEqual({ a: 2, b: 2, c: 2 });
  });

  it('preço menor continua tendo prioridade sobre a rodada', () => {
    // A rodada é dentro da faixa. Entre faixas, mercado é mercado: quem pede
    // menos vende primeiro, e nenhuma equalização inverte isso.
    const m = empatados();
    m.postOrder({
      sellerId: 'z', sellerName: 'Z', item: 'scrap', quantity: 5, unitPrice: 1, day: 1,
    });
    const r = m.quickBuy({ item: 'scrap', quantity: 6, availableCredits: 999, taxRate: 0 });
    expect(porVendedor(r).z).toBe(5);
    expect(r.ok && r.totalPaid).toBe(5 * 1 + 1 * 4);
  });

  it('o cursor avança: a compra seguinte começa em quem ficou de fora', () => {
    // Sem persistir o cursor, toda compra começaria no mesmo vendedor e a
    // rodada viraria enfeite.
    const m = empatados();
    const primeira = porVendedor(
      m.quickBuy({ item: 'scrap', quantity: 1, availableCredits: 999, taxRate: 0 }),
    );
    const segunda = porVendedor(
      m.quickBuy({ item: 'scrap', quantity: 1, availableCredits: 999, taxRate: 0 }),
    );
    expect(Object.keys(primeira)).not.toEqual(Object.keys(segunda));
  });

  it('a rodada esgota o grupo sem entrar em laço quando um vendedor acaba', () => {
    const m = new Market('cap_0', 'central');
    m.postOrder({ sellerId: 'a', sellerName: 'A', item: 'scrap', quantity: 1, unitPrice: 4, day: 1 });
    m.postOrder({ sellerId: 'b', sellerName: 'B', item: 'scrap', quantity: 9, unitPrice: 4, day: 1 });
    const r = m.quickBuy({ item: 'scrap', quantity: 10, availableCredits: 999, taxRate: 0 });
    expect(porVendedor(r)).toEqual({ a: 1, b: 9 });
    expect(m.supplyOf('scrap')).toBe(0);
  });

  it('a compra direta não passa pela rodada', () => {
    // "Direct: sem rodada — escolha do comprador." Distribuir a compra de quem
    // escolheu o anúncio seria desfazer a escolha.
    const m = empatados();
    const r = m.buy({ item: 'scrap', quantity: 6, availableCredits: 999, taxRate: 0 });
    expect(porVendedor(r)).toEqual({ a: 6 });
  });

  it('o Central recusa contrabando; o clandestino aceita tudo', () => {
    const ilegal = allItems.find((i) => !i.legal)!;
    expect(marketAccepts('central', ilegal.id)).toBe(false);
    expect(marketAccepts('clandestine', ilegal.id)).toBe(true);
    expect(marketAccepts('clandestine', 'scrap')).toBe(true);

    const m = new Market('cap_0', 'central');
    expect(
      m.postOrder({ sellerId: 'a', sellerName: 'A', item: ilegal.id, quantity: 1, unitPrice: 1, day: 1 }),
    ).toBeNull();
  });

  it('quantidade e preço não podem ser zero ou negativos', () => {
    const m = new Market('cap_0', 'central');
    expect(m.postOrder({ sellerId: 'a', sellerName: 'A', item: 'scrap', quantity: 0, unitPrice: 5, day: 1 })).toBeNull();
    expect(m.postOrder({ sellerId: 'a', sellerName: 'A', item: 'scrap', quantity: 5, unitPrice: 0, day: 1 })).toBeNull();
    expect(m.orders).toHaveLength(0);
  });

  it('ofertas velhas expiram para o livro não crescer sem fim', () => {
    const m = livro();
    m.expireOrders(20, 14);
    expect(m.orders).toHaveLength(0);
    // Dentro do prazo, ninguém sai.
    const outro = livro();
    outro.expireOrders(14, 14);
    expect(outro.orders).toHaveLength(3);
  });

  it('cidade produtora tem estoque farto e barato; consumidora, o contrário', () => {
    // É essa assimetria que cria a rota comercial. Sem ela, viajar não paga.
    const produtora = new Market('p', 'central');
    seedMarket(produtora, {
      isCapital: true,
      vocation: { produces: ['scrap'], demands: [] },
    }, new DeterministicRandom(11));

    const consumidora = new Market('c', 'central');
    seedMarket(consumidora, {
      isCapital: true,
      vocation: { produces: [], demands: ['scrap'] },
    }, new DeterministicRandom(11));

    expect(produtora.supplyOf('scrap')).toBeGreaterThan(consumidora.supplyOf('scrap'));
    expect(produtora.bestPrice('scrap')!).toBeLessThan(consumidora.bestPrice('scrap')!);
  });

  it('sobrevive à ida e volta pelo JSON', () => {
    const m = livro();
    const outro = Market.fromJson(m.toJson());
    expect(outro.supplyOf('scrap')).toBe(30);
    expect(outro.bestPrice('scrap')).toBe(3);
  });
});
