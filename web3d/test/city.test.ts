import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { Campaign } from '../src/campaign/campaign';
import { itemDef } from '../src/economy/item';
import {
  DEMAND_PREMIUM,
  quotePublicContract,
  sellToGovernment,
} from '../src/economy/publicContract';
import { describeCity } from '../src/ui/cityView';
import { workById } from '../src/survival/survival';

/**
 * Chegar numa cidade e ter o que fazer.
 *
 * Andar até outra cidade passou a ser possível, e o que acontecia ao chegar era
 * um aviso de quatro segundos. Estes testes prendem a contrapartida: a viagem
 * custa fome, sede e dias de salário, e precisa devolver alguma coisa — comprar
 * onde é barato, vender onde falta, trabalhar onde paga.
 *
 * O que importa aqui é a **regra**, não o desenho: preço, limite de caixa e
 * qualificação são conferidos em `publicContract` e `cityView`, que são puros.
 * A tela é conferida por marcação, como o resto da interface.
 */

const campanha = (): Campaign =>
  Campaign.create({
    id: 'cidade',
    seedLabel: 'contrato-dart-ts',
    characterName: 'Viajante',
    now: 0,
  });

/** Uma cidade e um item que ela importa — a ponta que o contrato compra. */
function cidadeQueCompra(c: Campaign) {
  for (const s of c.world.layout.settlements) {
    const item = s.vocationDef.demands.find((i) => itemDef(i).legal);
    if (item) return { settlement: s, item };
  }
  throw new Error('nenhuma cidade importa produto lícito');
}

describe('Contrato público', () => {
  it('a cidade só compra o que a vocação dela importa', () => {
    // Sem esse recorte o contrato viraria um comprador universal, e a
    // geografia econômica do mapa deixaria de significar qualquer coisa:
    // valeria vender tudo na primeira cidade.
    const c = campanha();
    const { settlement, item } = cidadeQueCompra(c);
    const gov = c.governmentOf(settlement.id);

    expect(quotePublicContract(settlement, gov, item)).not.toBeNull();

    const produzido = settlement.vocationDef.produces[0]!;
    expect(quotePublicContract(settlement, gov, produzido)).toBeNull();
  });

  it('contrabando não entra em contrato público', () => {
    // Nota fiscal de item ilegal é o caminho mais curto para o clandestino
    // perder a razão de existir.
    const c = campanha();
    for (const s of c.world.layout.settlements) {
      const gov = c.governmentOf(s.id);
      for (const item of s.vocationDef.demands) {
        if (itemDef(item).legal) continue;
        expect(quotePublicContract(s, gov, item)).toBeNull();
      }
    }
  });

  it('paga acima da referência: é o prêmio que remunera o transporte', () => {
    const c = campanha();
    const { settlement, item } = cidadeQueCompra(c);
    const cotacao = quotePublicContract(settlement, c.governmentOf(settlement.id), item)!;

    expect(cotacao.unitPrice).toBeGreaterThan(itemDef(item).baseValue);
    expect(cotacao.unitPrice).toBe(
      Math.max(1, Math.round(itemDef(item).baseValue * (1 + DEMAND_PREMIUM))),
    );
  });

  it('o caixa da cidade é o teto da compra', () => {
    const c = campanha();
    const { settlement, item } = cidadeQueCompra(c);
    const gov = c.governmentOf(settlement.id);

    gov.treasury = 0;
    expect(quotePublicContract(settlement, gov, item)!.maxQuantity).toBe(0);

    c.character.inventory.add(item, 5);
    const r = sellToGovernment({
      settlement,
      government: gov,
      inventory: c.character.inventory,
      item,
      quantity: 1,
    });
    expect(r.ok).toBe(false);
    // Recusa é recusa: o item continua no inventário.
    expect(c.character.inventory.quantityOf(item)).toBe(5);
  });

  it('a venda tira o item, paga o líquido e tira do caixa só o líquido', () => {
    // O imposto sai do bruto e volta para o mesmo tesouro que pagou. Cobrar o
    // bruto do caixa faria a cidade recusar compras que ela consegue pagar.
    const c = campanha();
    const { settlement, item } = cidadeQueCompra(c);
    const gov = c.governmentOf(settlement.id);
    gov.taxRate = 0.1;
    gov.treasury = 100000;

    c.character.inventory.add(item, 4);
    const caixaAntes = gov.treasury;

    const r = sellToGovernment({
      settlement,
      government: gov,
      inventory: c.character.inventory,
      item,
      quantity: 3,
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const bruto = quotePublicContract(settlement, gov, item)!.unitPrice * 3;
    expect(r.tax).toBe(Math.round(bruto * 0.1));
    expect(r.credited).toBe(bruto - r.tax);
    expect(caixaAntes - gov.treasury).toBe(r.credited);
    expect(c.character.inventory.quantityOf(item)).toBe(1);
  });

  it('vender mais do que se tem não move nada', () => {
    const c = campanha();
    const { settlement, item } = cidadeQueCompra(c);
    const gov = c.governmentOf(settlement.id);
    gov.treasury = 100000;
    c.character.inventory.add(item, 2);

    const caixaAntes = gov.treasury;
    const r = sellToGovernment({
      settlement,
      government: gov,
      inventory: c.character.inventory,
      item,
      quantity: 3,
    });

    expect(r.ok).toBe(false);
    expect(c.character.inventory.quantityOf(item)).toBe(2);
    expect(gov.treasury).toBe(caixaAntes);
  });
});

describe('Ficha da cidade', () => {
  it('lista o que está à venda com a pechincha primeiro', () => {
    // Ordem alfabética seria arrumação. O jogador abre o mercado procurando o
    // negócio, e o negócio é o preço abaixo da referência.
    const c = campanha();
    const v = describeCity(c, c.world.layout.capitals[0]!.id)!;

    expect(v.buy.length).toBeGreaterThan(0);
    const razoes = v.buy.map((r) => r.unitPrice / r.baseValue);
    expect([...razoes].sort((a, b) => a - b)).toEqual(razoes);
    for (const r of v.buy) {
      expect(r.bargain).toBe(r.unitPrice < r.baseValue);
    }
  });

  it('só oferece para vender o que a cidade importa e o jogador carrega', () => {
    const c = campanha();
    const { settlement, item } = cidadeQueCompra(c);
    c.governmentOf(settlement.id).treasury = 100000;

    expect(describeCity(c, settlement.id)!.sell).toHaveLength(0);

    c.character.inventory.add(item, 7);
    c.character.inventory.add(settlement.vocationDef.produces[0]!, 7);

    const sell = describeCity(c, settlement.id)!.sell;
    expect(sell.map((r) => r.item)).toEqual([item]);
    expect(sell[0]!.owned).toBe(7);
  });

  it('o caixa curto aparece como quantidade, não como recusa surpresa', () => {
    // O jogador precisa ver o limite **antes** de tocar em VENDER: um botão que
    // recusa depois do toque é o mesmo que um botão quebrado.
    const c = campanha();
    const { settlement, item } = cidadeQueCompra(c);
    const gov = c.governmentOf(settlement.id);
    gov.taxRate = 0;
    gov.treasury = quotePublicContract(settlement, gov, item)!.unitPrice * 2;
    c.character.inventory.add(item, 10);

    expect(describeCity(c, settlement.id)!.sell[0]!.maxQuantity).toBe(2);
  });

  it('as vagas são só as públicas, e vêm com o motivo de estarem fechadas', () => {
    // Fazenda e oficina o jogador exerce no próprio terreno. Listá-las aqui
    // seria a cidade oferecer o que ela não tem para oferecer.
    const c = campanha();
    const v = describeCity(c, c.world.layout.capitals[0]!.id)!;

    expect(v.jobs.length).toBeGreaterThan(0);
    for (const j of v.jobs) {
      expect(workById(j.work).kind).toBe('public');
      if (!j.allowed) expect(j.reason.length).toBeGreaterThan(0);
    }
    // Sem certificado nenhum, alguma vaga de entrada tem de estar aberta —
    // senão o jogo nasce sem primeiro emprego.
    expect(v.jobs.some((j) => j.allowed)).toBe(true);
    // E o salário sai do que o governo local paga, não de uma tabela fixa: é o
    // que amarra carreira e política.
    const gov = c.governmentOf(v.id);
    expect(v.jobs.every((j) => j.wage >= gov.publicWage)).toBe(true);
  });

  it('cidade desconhecida devolve nulo em vez de estourar', () => {
    expect(describeCity(campanha(), 'nao_existe')).toBeNull();
  });
});

describe('Marcação do painel', () => {
  const html = readFileSync(new URL('../classico.html', import.meta.url), 'utf8');

  it('o painel tem as três seções e um jeito de fechar', () => {
    expect(html).toContain('id="cidade"');
    expect(html).toContain('id="fechar-cidade"');
    for (const aba of ['mercado', 'governo', 'trabalho']) {
      expect(html).toContain(`data-aba="${aba}"`);
    }
  });

  it('o botão de entrar nasce desabilitado', () => {
    // Em campo aberto não há mercado nem governo. Um botão que abre um painel
    // vazio na estrada ensina errado sobre onde a economia acontece.
    expect(html).toMatch(/id="abrir-cidade"[^>]*disabled/);
  });

  it('os alvos de toque do painel respeitam o mínimo do celular', () => {
    for (const regra of ['#cidade-abas button', '.cidade-linha button']) {
      const bloco = html.slice(html.indexOf(regra));
      expect(bloco.slice(0, 400)).toContain('min-height: var(--toque)');
    }
  });
});
