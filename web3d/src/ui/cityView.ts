import type { Campaign } from '../campaign/campaign';
import {
  allProfessions,
  canPractise,
  dailyWage,
  type ProfessionDef,
} from '../career/profession';
import { itemDef } from '../economy/item';
import { marketKindLabels, type MarketKind } from '../economy/market';
import { quotePublicContract } from '../economy/publicContract';
import { workById } from '../survival/survival';

/**
 * O que uma cidade oferece a quem chega — como dado, não como DOM.
 *
 * ## Por que o modelo é separado da tela
 *
 * A suíte não roda navegador: as telas são conferidas por texto do HTML e o
 * resto por lógica pura (ver `serverBrowser`, que tem a mesma divisão). Se a
 * regra "esta cidade compra isto por tanto" morar dentro do `innerHTML`, ela só
 * pode ser verificada abrindo o jogo — e é exatamente a regra que decide se
 * viajar até aqui valeu a pena.
 *
 * ## O que entra, e por quê
 *
 * Três perguntas, que são as três razões de existir uma cidade no GDD: o que dá
 * para comprar barato, o que dá para vender caro, e o que dá para trabalhar.
 * Relevo, clima e enfeite ficam de fora — isso o jogador vê andando.
 */

export interface BuyRow {
  readonly item: string;
  readonly name: string;
  readonly kind: MarketKind;
  readonly kindLabel: string;
  readonly unitPrice: number;
  readonly supply: number;
  /** Preço de referência, para o jogador julgar se está caro. */
  readonly baseValue: number;
  /** `true` quando o preço está abaixo da referência: é a pechincha. */
  readonly bargain: boolean;
  readonly legal: boolean;
}

export interface SellRow {
  readonly item: string;
  readonly name: string;
  /** Quanto o jogador carrega. */
  readonly owned: number;
  /** Bruto por unidade pago pelo contrato público. */
  readonly unitPrice: number;
  /** Teto imposto pelo caixa da cidade. Zero = tesouro no fim. */
  readonly maxQuantity: number;
}

export interface JobRow {
  readonly profession: ProfessionDef;
  /** Id do trabalho, para o painel de trabalho assumir a vaga. */
  readonly work: string;
  readonly wage: number;
  readonly allowed: boolean;
  readonly reason: string;
}

export interface CityView {
  readonly id: string;
  readonly name: string;
  readonly kindLabel: string;
  readonly vocationLabel: string;
  readonly population: number;
  readonly taxRate: number;
  readonly publicWage: number;
  readonly treasury: number;
  readonly governor: string | null;
  readonly publicJobSlots: number;
  readonly buy: readonly BuyRow[];
  readonly sell: readonly SellRow[];
  readonly jobs: readonly JobRow[];
}

/**
 * Monta a ficha da cidade. `null` quando o id não existe no mapa.
 *
 * As listas saem ordenadas do jeito que se decide: compra pela pechincha (mais
 * abaixo da referência primeiro), venda pelo que rende mais no total. Ordem
 * alfabética seria arrumação, não ajuda — o jogador está procurando o negócio,
 * não o item.
 */
export function describeCity(campaign: Campaign, settlementId: string): CityView | null {
  const s = campaign.world.layout.byId(settlementId);
  if (!s) return null;

  const gov = campaign.governmentOf(s.id);
  const inv = campaign.character.inventory;

  const buy: BuyRow[] = [];
  for (const market of campaign.marketsAt(s.id)) {
    for (const item of market.listedItems) {
      const price = market.bestPrice(item);
      if (price === null) continue;
      const def = itemDef(item);
      buy.push({
        item,
        name: def.name,
        kind: market.kind,
        kindLabel: marketKindLabels[market.kind],
        unitPrice: price,
        supply: market.supplyOf(item),
        baseValue: def.baseValue,
        bargain: price < def.baseValue,
        legal: def.legal,
      });
    }
  }
  buy.sort((a, b) => a.unitPrice / a.baseValue - b.unitPrice / b.baseValue);

  const sell: SellRow[] = [];
  for (const [item, owned] of inv.stacks) {
    if (owned <= 0) continue;
    const cotacao = quotePublicContract(s, gov, item);
    if (!cotacao) continue;
    sell.push({
      item,
      name: itemDef(item).name,
      owned,
      unitPrice: cotacao.unitPrice,
      maxQuantity: Math.min(owned, cotacao.maxQuantity),
    });
  }
  sell.sort((a, b) => b.unitPrice * b.maxQuantity - a.unitPrice * a.maxQuantity);

  // Só as profissões públicas: são as que esta cidade contrata e paga do
  // tesouro dela. Fazenda e oficina o jogador exerce no próprio terreno, e
  // aparecem no painel de trabalho — repetir aqui seria dizer que a cidade
  // oferece algo que ela não oferece.
  const jobs: JobRow[] = [];
  for (const p of allProfessions) {
    if (workById(p.work).kind !== 'public') continue;
    const check = canPractise(p, {
      certificates: campaign.character.certificates,
      level: campaign.character.level,
    });
    jobs.push({
      profession: p,
      work: p.work,
      wage: dailyWage(p, gov.publicWage),
      allowed: check.ok,
      reason: check.ok ? 'Pode assumir hoje.' : check.reason,
    });
  }
  jobs.sort((a, b) => b.wage - a.wage);

  return {
    id: s.id,
    name: s.name,
    kindLabel: s.isCapital ? 'Capital' : 'Satélite',
    vocationLabel: s.vocationDef.label,
    population: s.population,
    taxRate: gov.taxRate,
    publicWage: gov.publicWage,
    treasury: gov.treasury,
    governor: gov.governorName,
    publicJobSlots: s.publicJobSlots,
    buy,
    sell,
    jobs,
  };
}
