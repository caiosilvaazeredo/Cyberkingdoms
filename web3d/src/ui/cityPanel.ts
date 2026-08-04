import type { Campaign } from '../campaign/campaign';
import { itemDef } from '../economy/item';
import { sellToGovernment } from '../economy/publicContract';
import { formatCz } from '../rules/eb';
import { describeCity, type BuyRow, type CityView, type SellRow } from './cityView';

/**
 * O painel da cidade: o que fazer depois de chegar.
 *
 * ## Por que ele existe
 *
 * Andar até outra cidade passou a ser possível, e o que acontecia ao chegar era
 * um aviso de quatro segundos com o nome do lugar. Isso transforma vinte
 * cidades em vinte letreiros: a viagem custa fome, sede e dias de salário, e
 * não devolve nada. O painel é a contrapartida — comprar onde é barato, vender
 * onde falta, e assumir uma vaga onde ela paga melhor.
 *
 * ## Por que é um painel do jogo, e não uma tela do roteador
 *
 * Chegar na cidade não interrompe o jogo. O mundo continua carregado atrás, o
 * personagem continua no lugar, e fechar o painel devolve o jogador exatamente
 * onde ele estava — sem descarregar pedaço nenhum. Uma tela empilhada esconderia
 * o mundo inteiro para mostrar uma lista de preços.
 *
 * ## Por que só as transações vivem aqui
 *
 * A regra de quanto vale cada coisa está em `cityView` e `publicContract`, que
 * são puras e testadas. Aqui fica o que só o navegador sabe fazer: montar
 * botão, ouvir clique e redesenhar. Foi essa divisão que permitiu verificar a
 * economia da viagem sem abrir o jogo.
 */

export interface CityPanelDeps {
  readonly campaign: () => Campaign;
  /** Depois de qualquer transação: atualiza o HUD e persiste. */
  readonly onChange: () => void;
  /** Assume uma vaga pública como o trabalho de hoje. */
  readonly onTakeJob: (work: string) => void;
  /** O trabalho já escolhido para hoje, para marcar a vaga assumida. */
  readonly currentWork: () => string | null;
}

export interface CityPanel {
  /** Abre na cidade indicada. Ignora id desconhecido. */
  open(settlementId: string): void;
  close(): void;
  readonly isOpen: boolean;
  /** Redesenha se estiver aberto. Barato quando fechado. */
  refresh(): void;
}

type Aba = 'mercado' | 'governo' | 'trabalho';

// A moeda é Cz — EB 1.1, §02. "cr" era o nome da Rev 3.0.
const cr = (n: number): string => formatCz(n);

export function createCityPanel(deps: CityPanelDeps): CityPanel {
  const raiz = document.querySelector<HTMLElement>('#cidade');
  const titulo = document.querySelector<HTMLElement>('#cidade-titulo');
  const resumo = document.querySelector<HTMLElement>('#cidade-resumo');
  const conteudo = document.querySelector<HTMLElement>('#cidade-conteudo');
  const recado = document.querySelector<HTMLElement>('#cidade-recado');
  const abas = Array.from(
    document.querySelectorAll<HTMLButtonElement>('#cidade-abas button'),
  );

  let cidadeId: string | null = null;
  let aba: Aba = 'mercado';

  function dizer(texto: string): void {
    if (recado) recado.textContent = texto;
  }

  function ficha(): CityView | null {
    return cidadeId ? describeCity(deps.campaign(), cidadeId) : null;
  }

  // ------------------------------------------------------------- transações

  function comprar(row: BuyRow, quantidade: number): void {
    const c = deps.campaign();
    if (!cidadeId) return;
    const gov = c.governmentOf(cidadeId);
    const mercado = c.marketOf(cidadeId, row.kind);
    if (!mercado) return;

    // Compra rápida: o jogador escolheu o **item**, não o anúncio, então a
    // liquidação distribui uma unidade por rodada entre as ofertas de mesmo
    // preço — EB 1.1, §13. Sem isso o primeiro anunciante da fila leva toda
    // compra e nove vendedores equivalentes nunca vendem nada.
    const r = mercado.quickBuy({
      item: row.item,
      quantity: quantidade,
      availableCredits: c.character.credits,
      taxRate: gov.taxRate,
    });
    if (!r.ok) {
      dizer(r.reason);
      return;
    }

    // O mercado só mexe no livro de ofertas. Quem move crédito, item e tesouro
    // é quem fez o negócio — é o mesmo contrato que o resto do jogo usa, e é
    // por isso que a compra simula antes de efetivar.
    //
    // A taxa **não** é somada ao que o comprador paga: ela sai do valor da
    // venda e vai para o cofre local. Quem paga a taxa é quem lucrou com ela.
    c.character.credits -= r.totalPaid;
    c.character.inventory.add(r.item, r.quantity);
    // O lote nasce agora: comida comprada hoje vence daqui a 72 h, e não junto
    // com a que já estava na mochila.
    c.pantry.register(r.item, r.quantity, Date.now());
    gov.collectTax(r.tax);
    c.log(`Comprou ${r.quantity}× ${itemDef(r.item).name} por ${r.totalPaid} Cz.`);

    const vendedores = new Set(r.fills.map((f) => f.sellerId)).size;
    dizer(
      `Comprou ${r.quantity}× ${itemDef(r.item).name} por ${cr(r.totalPaid)}` +
        (vendedores > 1 ? ` de ${vendedores} vendedores` : '') +
        (r.tax > 0 ? ` · ${cr(r.tax)} de taxa ao cofre.` : '.'),
    );
    deps.onChange();
    desenhar();
  }

  function vender(row: SellRow, quantidade: number): void {
    const c = deps.campaign();
    if (!cidadeId) return;
    const s = c.world.layout.byId(cidadeId);
    if (!s) return;

    const r = sellToGovernment({
      settlement: s,
      government: c.governmentOf(cidadeId),
      inventory: c.character.inventory,
      item: row.item,
      quantity: quantidade,
    });
    if (!r.ok) {
      dizer(r.reason);
      return;
    }

    c.character.credits += r.credited;
    c.log(`Vendeu ${r.quantity}× ${itemDef(r.item).name} a ${s.name} por ${r.credited} Cz.`);
    dizer(
      `Contrato fechado: ${cr(r.credited)} líquidos` +
        (r.tax > 0 ? ` (${cr(r.tax)} retidos de imposto).` : '.'),
    );
    deps.onChange();
    desenhar();
  }

  // --------------------------------------------------------------- desenho

  function linha(children: (HTMLElement | null)[], className = 'cidade-linha'): HTMLElement {
    const div = document.createElement('div');
    div.className = className;
    for (const c of children) if (c) div.appendChild(c);
    return div;
  }

  function botao(texto: string, aoClicar: () => void, desabilitado = false): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = texto;
    b.disabled = desabilitado;
    if (!desabilitado) b.addEventListener('click', aoClicar);
    return b;
  }

  function vazio(texto: string): HTMLElement {
    const p = document.createElement('p');
    p.className = 'cidade-vazio';
    p.textContent = texto;
    return p;
  }

  function desenharMercado(v: CityView): void {
    if (!conteudo) return;
    const credito = deps.campaign().character.credits;

    const h = document.createElement('h3');
    h.textContent = 'À VENDA AQUI';
    conteudo.appendChild(h);

    if (v.buy.length === 0) {
      conteudo.appendChild(vazio('Nenhuma oferta viva. O livro é dos jogadores: alguém precisa anunciar.'));
    }

    for (const row of v.buy.slice(0, 24)) {
      const info = document.createElement('span');
      info.className = 'cidade-info';
      info.innerHTML =
        `<strong>${row.name}${row.legal ? '' : ' ⚠'}</strong>` +
        `<em>${row.kindLabel} · ${row.supply} em estoque</em>`;

      // A referência fica na coluna do preço, e não na linha de baixo: numa
      // tela de 412px a linha de baixo é cortada por reticências, e era
      // justamente o número que justifica a viagem que sumia.
      const preco = document.createElement('span');
      preco.className = row.bargain ? 'cidade-preco pechincha' : 'cidade-preco';
      preco.innerHTML = `<strong>${cr(row.unitPrice)}</strong><em>ref ${row.baseValue}</em>`;

      conteudo.appendChild(
        linha([
          info,
          preco,
          botao('+1', () => comprar(row, 1), row.unitPrice > credito),
          botao('+10', () => comprar(row, 10), row.supply < 10),
        ]),
      );
    }

    const h2 = document.createElement('h3');
    h2.textContent = 'A CIDADE COMPRA';
    conteudo.appendChild(h2);

    if (v.sell.length === 0) {
      conteudo.appendChild(
        vazio(
          `${v.name} importa ${v.vocationLabel.toLowerCase()} — mas você não ` +
            'carrega nada que ela precise. Compre onde é barato e traga.',
        ),
      );
    }

    for (const row of v.sell) {
      const info = document.createElement('span');
      info.className = 'cidade-info';
      info.innerHTML =
        `<strong>${row.name}</strong>` +
        `<em>você tem ${row.owned} · o caixa cobre ${row.maxQuantity}</em>`;

      const preco = document.createElement('span');
      preco.className = 'cidade-preco pechincha';
      preco.innerHTML = `<strong>${cr(row.unitPrice)}</strong><em>por unidade</em>`;

      conteudo.appendChild(
        linha([
          info,
          preco,
          botao('−1', () => vender(row, 1), row.maxQuantity < 1),
          botao('TUDO', () => vender(row, row.maxQuantity), row.maxQuantity < 1),
        ]),
      );
    }
  }

  function desenharGoverno(v: CityView): void {
    if (!conteudo) return;
    const p = document.createElement('div');
    p.className = 'cidade-ficha';
    p.innerHTML =
      `<span><strong>Governador:</strong> ${v.governor ?? 'cargo vago — a cidade espera eleição'}</span>` +
      `<span><strong>Imposto:</strong> ${Math.round(v.taxRate * 100)}% sobre cada venda no Mercado Central</span>` +
      `<span><strong>Salário público:</strong> ${cr(v.publicWage)} por jornada de 2 h</span>` +
      `<span><strong>Caixa:</strong> ${cr(v.treasury)}</span>` +
      `<span><strong>Vagas públicas:</strong> ${v.publicJobSlots}</span>`;
    conteudo.appendChild(p);

    conteudo.appendChild(
      vazio(
        'A taxa sai do valor de cada venda no Central e cai neste caixa — que é ' +
          'o mesmo que paga o seu salário e as compras públicas. Quem paga a ' +
          'taxa é quem vendeu, não quem comprou. Caixa vazio é cidade que não ' +
          'compra e não paga.',
      ),
    );
  }

  function desenharTrabalho(v: CityView): void {
    if (!conteudo) return;
    const atual = deps.currentWork();

    for (const job of v.jobs) {
      const info = document.createElement('span');
      info.className = 'cidade-info';
      info.innerHTML =
        `<strong>${job.profession.label}</strong>` +
        `<em>${job.allowed ? job.profession.description : job.reason}</em>`;

      const preco = document.createElement('span');
      preco.className = 'cidade-preco';
      preco.innerHTML = `<strong>${cr(job.wage)}</strong><em>por dia</em>`;

      const assumido = atual === job.work;
      conteudo.appendChild(
        linha([
          info,
          preco,
          botao(
            assumido ? 'HOJE ✓' : 'ASSUMIR',
            () => {
              deps.onTakeJob(job.work);
              dizer(`${job.profession.label} é o trabalho de hoje.`);
              desenhar();
            },
            !job.allowed || assumido,
          ),
        ]),
      );
    }

    conteudo.appendChild(
      vazio(
        'A jornada dura 2 h de relógio e ocupa o cidadão até terminar: ela ' +
          'entra na fila em OCUPAÇÃO e roda mesmo com a aba fechada. Estudar ' +
          'troca a jornada por conhecimento — as matrículas estão em TRABALHAR.',
      ),
    );
  }

  function desenhar(): void {
    if (!raiz || !conteudo) return;
    const v = ficha();
    if (!v) {
      close();
      return;
    }

    if (titulo) titulo.textContent = v.name.toUpperCase();
    if (resumo) {
      resumo.textContent =
        `${v.kindLabel} · ${v.vocationLabel} · ` +
        `${v.population.toLocaleString('pt-BR')} habitantes`;
    }

    for (const b of abas) {
      b.setAttribute('aria-pressed', String((b.dataset.aba || '') === aba));
    }

    conteudo.textContent = '';
    if (aba === 'mercado') desenharMercado(v);
    else if (aba === 'governo') desenharGoverno(v);
    else desenharTrabalho(v);
  }

  function close(): void {
    cidadeId = null;
    raiz?.classList.remove('aberto');
  }

  for (const b of abas) {
    b.addEventListener('click', () => {
      aba = (b.dataset.aba as Aba) || 'mercado';
      // O recado é sobre a última ação, e a última ação era da outra aba: "você
      // comprou 1× refeição" debaixo da lista de vagas confunde mais do que
      // informa.
      dizer('');
      desenhar();
    });
  }
  document.querySelector('#fechar-cidade')?.addEventListener('click', () => close());

  return {
    open(settlementId) {
      if (!deps.campaign().world.layout.byId(settlementId)) return;
      cidadeId = settlementId;
      dizer('');
      raiz?.classList.add('aberto');
      desenhar();
    },
    close,
    get isOpen() {
      return cidadeId !== null;
    },
    refresh() {
      if (cidadeId) desenhar();
    },
  };
}
