import type { Campaign } from '../campaign/campaign';
import { daysOfSupplies, planJourney, startJourney } from '../campaign/journey';
import { itemDef } from '../economy/item';
import { Biome, biomeDef } from '../world/biome';
import { vocationDef, type Settlement } from '../world/settlement';
import { el, type Screen, type ScreenRouter } from './screens';

/**
 * O mapa do mundo: as cidades, as estradas, onde o jogador está e para onde dá
 * para ir.
 *
 * ## O que estava errado na primeira versão
 *
 * Ela desenhava vinte bolinhas com vinte rótulos sobre fundo preto, num quadro
 * de proporção fixa. Três defeitos, e nenhum deles é acabamento:
 *
 * 1. **Sem geografia.** Fundo preto não diz nada. O jogador não tinha como
 *    saber que a rota curta atravessa pântano, nem por que a cidade do norte é
 *    agro e a do leste é petroquímica — as duas informações estão no terreno, e
 *    o terreno não aparecia.
 * 2. **Rótulos empilhados.** Vinte nomes num retângulo de 412 px colidem entre
 *    si e vazam pela borda. Escrever o nome de tudo é o mesmo que não escrever
 *    nenhum: nada fica legível.
 * 3. **Enquadramento fixo.** O quadro cobria o raio inteiro do mundo assentado,
 *    mas as cidades ocupam só o miolo dele — metade da tela era margem vazia.
 *
 * ## Como esta versão resolve
 *
 * **Fundo de biomas num canvas.** O bioma é função pura da seed e sai do mesmo
 * gerador que o mundo 3D, então o mapa mostra o terreno de verdade: água morta
 * escura, mata fechada verde, descampado ocre. Canvas e não SVG porque são
 * milhares de células — em SVG seriam milhares de nós no DOM, e o navegador de
 * celular engasga muito antes disso.
 *
 * **Vetor só onde precisa ser interativo.** Cidade e estrada continuam em SVG,
 * por cima: cada cidade é um elemento com foco de teclado, `<title>` e alvo de
 * toque grande, o que num canvas exigiria reimplementar acerto de clique e
 * acessibilidade do zero.
 *
 * **Rótulo com hierarquia.** Só as capitais têm nome sempre; o satélite ganha o
 * dele quando é tocado. É a mesma regra de um mapa de papel — o que é grande
 * está escrito, o resto se lê aproximando.
 *
 * **Enquadramento pelo que existe.** O quadro sai do extremo das cidades mais o
 * jogador, com uma margem. O mapa passa a preencher a tela em qualquer seed,
 * inclusive numa que espalhe as cidades de forma desigual.
 */

export interface MapScreenDeps {
  readonly router: ScreenRouter;
  /** A campanha atual, ou `null` quando ninguém entrou ainda. */
  readonly campaign: () => Campaign | null;
  /**
   * Sair do mapa.
   *
   * Não é `router.pop()` porque o mapa também é aberto **do jogo**, com a pilha
   * zerada — e ali um `pop` não teria para onde voltar, deixando o jogador
   * preso numa tela sem saída. Quem abriu sabe para onde devolver.
   */
  readonly onClose: () => void;
  /**
   * Avisa que o jogador entrou na estrada.
   *
   * O mapa começa a viagem porque é onde a decisão acontece, mas quem manda no
   * mundo 3D é o jogo — ele precisa saber para bloquear o passo, salvar, e
   * recentrar a cena quando a viagem terminar.
   */
  readonly onTravelStarted?: (destinationId: string) => void;
}

const VIEW = 1000;
/** Células do fundo por lado. 96² = 9216 amostras, pintadas uma vez por seed. */
const AMOSTRAS = 96;

const nomes = (ids: readonly string[]): string =>
  ids.map((id) => itemDef(id).name).join(', ');

const CORES: Record<string, string> = {
  petrochemical: '#ffb300',
  foundry: '#90a4ae',
  agroBio: '#00e676',
  techHub: '#00e5ff',
  freePort: '#e040fb',
};

const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

/**
 * Cor de um bioma **no mapa**.
 *
 * Não é a cor do solo: `soil` é o que fica embaixo da grama no mundo 3D, e
 * sozinho pinta o mapa inteiro de um marrom-arroxeado em que mata fechada e
 * terra devastada ficam iguais. Misturar a ponta da lâmina na proporção da
 * densidade devolve a leitura que se espera de um mapa — verde onde há mato,
 * ocre no descampado, azul escuro na água morta, que tem densidade zero.
 */
export function corDoBioma(biome: Biome): string {
  const def = biomeDef(biome);
  const t = Math.min(1, def.grassDensity * 0.8);
  const mistura = (deslocamento: number): number => {
    const a = (def.soil >> deslocamento) & 0xff;
    const b = (def.grassTip >> deslocamento) & 0xff;
    return Math.round(a + (b - a) * t) & 0xff;
  };
  return hex((mistura(16) << 16) | (mistura(8) << 8) | mistura(0));
}

/** O quadro do mapa, em tiles. Quadrado, para o fundo não distorcer. */
interface Quadro {
  readonly minX: number;
  readonly minY: number;
  readonly lado: number;
}

export function enquadrar(
  pontos: readonly { readonly x: number; readonly y: number }[],
): Quadro {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of pontos) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }

  // Margem de 8% do maior lado, e nunca menos que 60 tiles: sem ela a cidade do
  // extremo fica colada na borda e o rótulo dela vaza para fora do quadro.
  const largura = maxX - minX;
  const altura = maxY - minY;
  const lado = Math.max(largura, altura, 200);
  const margem = Math.max(lado * 0.08, 60);

  // Centraliza o eixo menor: um quadro quadrado sobre um mundo achatado
  // deixaria tudo encostado numa das bordas.
  return {
    minX: minX - margem - (lado - largura) / 2,
    minY: minY - margem - (lado - altura) / 2,
    lado: lado + margem * 2,
  };
}

/** Passo redondo da régua, em tiles. Régua boa é a que se lê. */
export function passoDaEscala(lado: number): number {
  const bruto = lado / 5;
  const ordem = 10 ** Math.floor(Math.log10(bruto));
  return Math.max(ordem, Math.round(bruto / ordem) * ordem);
}

export function createMapScreen(deps: MapScreenDeps): Screen {
  const alvo = el('div', { className: 'mapa-alvo' });
  const detalhe = el('div', { className: 'mapa-detalhe' });
  const legenda = el('div', { className: 'mapa-legenda' });
  const transito = el('p', { className: 'mapa-transito' });

  const voltar = el('button', {
    className: 'secundario',
    text: 'VOLTAR',
    attrs: { type: 'button' },
  });
  voltar.addEventListener('click', () => deps.onClose());

  const root = el('section', {
    className: 'tela folha',
    attrs: { 'aria-label': 'Mapa do mundo' },
    children: [el('h1', { text: 'MAPA' }), transito, alvo, legenda, detalhe, voltar],
  });

  /** Cidade aberta na ficha. */
  let selecionada: string | null = null;
  /** Fundo já pintado, por seed: repintar 9 mil amostras a cada toque trava. */
  let fundoDe: number | null = null;
  let fundo: HTMLCanvasElement | null = null;

  function pintarFundo(campaign: Campaign, quadro: Quadro): HTMLCanvasElement {
    if (fundo && fundoDe === campaign.seed) return fundo;

    const canvas = document.createElement('canvas');
    canvas.width = AMOSTRAS;
    canvas.height = AMOSTRAS;
    canvas.className = 'mapa-fundo';
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const passo = quadro.lado / AMOSTRAS;
      for (let j = 0; j < AMOSTRAS; j++) {
        for (let i = 0; i < AMOSTRAS; i++) {
          const x = Math.round(quadro.minX + (i + 0.5) * passo);
          const y = Math.round(quadro.minY + (j + 0.5) * passo);
          // `biomeAt` e não `tileAt`: o tile inteiro carrega feature, recurso e
          // elevação, e nada disso aparece no mapa — pagar por eles seria gerar
          // chunk atrás de chunk para jogar fora.
          ctx.fillStyle = corDoBioma(campaign.world.generator.biomeAt(x, y));
          ctx.fillRect(i, j, 1, 1);
        }
      }
    }

    fundo = canvas;
    fundoDe = campaign.seed;
    return canvas;
  }

  function desenhar(): void {
    const campaign = deps.campaign();
    alvo.textContent = '';
    detalhe.textContent = '';
    legenda.textContent = '';
    transito.textContent = '';

    if (!campaign) {
      alvo.appendChild(
        el('p', {
          className: 'vazio',
          text: 'Nenhuma campanha aberta. O mapa é gerado junto com o mundo.',
        }),
      );
      return;
    }

    const layout = campaign.world.layout;
    const quadro = enquadrar([
      ...layout.settlements.map((s) => s.center),
      campaign.character.position,
    ]);
    const pxX = (n: number): number => ((n - quadro.minX) / quadro.lado) * VIEW;
    const pxY = (n: number): number => ((n - quadro.minY) / quadro.lado) * VIEW;

    alvo.appendChild(pintarFundo(campaign, quadro));

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${VIEW} ${VIEW}`);
    svg.setAttribute('class', 'mapa');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `Mapa com ${layout.settlements.length} cidades`);

    // A rota da cidade selecionada, para acender as estradas por onde se passa.
    const plano = selecionada ? planJourney(campaign, selecionada) : null;
    const paradas = plano?.ok ? plano.route.stops : [];

    for (const road of layout.roads) {
      const a = layout.byId(road.fromId);
      const b = layout.byId(road.toId);
      if (!a || !b) continue;

      const i = paradas.indexOf(a.id);
      const j = paradas.indexOf(b.id);
      const daRota = i >= 0 && j >= 0 && Math.abs(i - j) === 1;

      const linha = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      linha.setAttribute('x1', String(pxX(a.center.x)));
      linha.setAttribute('y1', String(pxY(a.center.y)));
      linha.setAttribute('x2', String(pxX(b.center.x)));
      linha.setAttribute('y2', String(pxY(b.center.y)));
      // A espessura mostra o perigo: a rota curta e arriscada tem de saltar aos
      // olhos, porque é a decisão de risco que o GDD quer que exista.
      linha.setAttribute(
        'stroke',
        daRota ? '#9ff0cf' : road.danger > 0.4 ? '#ff6b6b' : '#e8f2ee',
      );
      linha.setAttribute('stroke-width', String((daRota ? 6 : 2.5) + road.danger * 5));
      linha.setAttribute('opacity', daRota ? '0.95' : '0.5');
      linha.setAttribute('stroke-linecap', 'round');
      const titulo = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      titulo.textContent =
        `${a.name} ↔ ${b.name} · ${road.travelDays} dia(s) · ` +
        `perigo ${Math.round(road.danger * 100)}%`;
      linha.appendChild(titulo);
      svg.appendChild(linha);
    }

    // Camada dos nomes: desenhada depois das cidades e sem receber toque.
    const rotulos = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    rotulos.setAttribute('class', 'mapa-rotulos');

    /**
     * Escolhe a altura do nome, desviando de quem já foi escrito.
     *
     * Duas capitais próximas escreviam uma por cima da outra e nenhuma das duas
     * ficava legível. Tentar acima, abaixo e mais acima resolve os casos reais
     * com uma conta de nada; se nem assim couber, o nome vai onde deu — melhor
     * um nome apertado do que um buraco no mapa.
     */
    const ocupados: { x: number; y: number }[] = [];
    const posicaoDoNome = (cx: number, cy: number, capital: boolean): number => {
      const base = capital ? 22 : 15;
      for (const dy of [-base, base + 14, -base - 22, base + 36]) {
        const y = cy + dy;
        const colide = ocupados.some(
          (o) => Math.abs(o.x - cx) < 150 && Math.abs(o.y - y) < 22,
        );
        if (!colide) {
          ocupados.push({ x: cx, y });
          return y;
        }
      }
      ocupados.push({ x: cx, y: cy - base });
      return cy - base;
    };

    const aqui = campaign.currentSettlementId;
    for (const s of layout.settlements) {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'mapa-cidade');
      g.setAttribute('tabindex', '0');
      g.setAttribute('role', 'button');
      g.setAttribute('aria-label', `${s.name}, ${vocationDef(s.vocation).label}`);

      const cx = pxX(s.center.x);
      const cy = pxY(s.center.y);

      // Alvo de toque invisível: o ponto de um satélite tem 8 unidades de raio,
      // o que num celular dá menos de 5 px. Sem esta área o mapa é impossível de
      // usar com o dedo.
      const toque = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      toque.setAttribute('cx', String(cx));
      toque.setAttribute('cy', String(cy));
      toque.setAttribute('r', '26');
      toque.setAttribute('fill', 'transparent');
      g.appendChild(toque);

      const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('cx', String(cx));
      c.setAttribute('cy', String(cy));
      c.setAttribute('r', String(s.isCapital ? 15 : 8));
      c.setAttribute('fill', CORES[s.vocation] ?? '#90a4ae');
      c.setAttribute('stroke', s.id === selecionada ? '#ffffff' : '#0b1210');
      c.setAttribute('stroke-width', s.id === selecionada ? '4' : '2');
      g.appendChild(c);

      if (s.id === aqui) {
        // Anel de "você está aqui" em volta da cidade, e não uma cor diferente:
        // a cor já é da vocação, e trocá-la esconderia a informação mais usada
        // do mapa para mostrar a que o jogador já sabe.
        const anel = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        anel.setAttribute('cx', String(cx));
        anel.setAttribute('cy', String(cy));
        anel.setAttribute('r', String(s.isCapital ? 23 : 16));
        anel.setAttribute('fill', 'none');
        anel.setAttribute('stroke', '#ffffff');
        anel.setAttribute('stroke-width', '2.5');
        anel.setAttribute('opacity', '0.85');
        g.appendChild(anel);
      }

      // Nome só para capital, para a selecionada e para onde o jogador está.
      // Vinte nomes numa tela de celular colidem e nenhum fica legível.
      //
      // O rótulo vai numa camada à parte, e **não** dentro do grupo da cidade.
      // Dentro, ele esticava a caixa do grupo para cima: o centro da área
      // clicável passava a cair no vão entre o nome e o ponto, e o toque não
      // acertava cidade nenhuma. Fora, a camada ainda fica por cima de todos os
      // pontos, então nenhum nome é encoberto pelo vizinho.
      if (s.isCapital || s.id === selecionada || s.id === aqui) {
        const rotulo = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        // Perto da borda o texto centralizado vaza. Ancorar do lado de dentro
        // mantém o nome inteiro dentro do quadro sem mover a cidade.
        const ancora = cx < VIEW * 0.18 ? 'start' : cx > VIEW * 0.82 ? 'end' : 'middle';
        rotulo.setAttribute('x', String(cx));
        rotulo.setAttribute('y', String(posicaoDoNome(cx, cy, s.isCapital)));
        rotulo.setAttribute('text-anchor', ancora);
        rotulo.setAttribute('class', s.isCapital ? 'mapa-nome capital' : 'mapa-nome');
        rotulo.textContent = s.name;
        rotulos.appendChild(rotulo);
      }

      const titulo = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      titulo.textContent = `${s.name} · ${vocationDef(s.vocation).label}`;
      g.appendChild(titulo);

      const abrir = (): void => {
        selecionada = s.id;
        desenhar();
      };
      g.addEventListener('click', abrir);
      g.addEventListener('keydown', (e) => {
        if ((e as KeyboardEvent).key === 'Enter') abrir();
      });
      svg.appendChild(g);
    }

    svg.appendChild(rotulos);

    // O jogador. Aparece mesmo fora de cidade — é a única coisa no mapa que diz
    // onde ele está depois de sair andando pela estrada.
    const eu = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    eu.setAttribute('class', 'mapa-eu');
    const euX = pxX(campaign.character.position.x);
    const euY = pxY(campaign.character.position.y);
    for (const [x1, y1, x2, y2] of [
      [euX - 13, euY, euX + 13, euY],
      [euX, euY - 13, euX, euY + 13],
    ]) {
      const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      l.setAttribute('x1', String(x1));
      l.setAttribute('y1', String(y1));
      l.setAttribute('x2', String(x2));
      l.setAttribute('y2', String(y2));
      l.setAttribute('stroke', '#ffffff');
      l.setAttribute('stroke-width', '3');
      eu.appendChild(l);
    }
    const tituloEu = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    tituloEu.textContent = 'Você está aqui';
    eu.appendChild(tituloEu);
    svg.appendChild(eu);

    svg.appendChild(regua(quadro));
    alvo.appendChild(svg);

    for (const v of Object.keys(CORES)) {
      legenda.appendChild(
        el('span', {
          className: 'mapa-chip',
          html: `<i style="background:${CORES[v]}"></i>` + vocationDef(v as never).label,
        }),
      );
    }

    if (campaign.character.isTravelling) {
      const destino = campaign.character.travellingTo
        ? layout.byId(campaign.character.travellingTo)
        : null;
      transito.textContent =
        `Em trânsito para ${destino?.name ?? 'o destino'} — ` +
        `${campaign.character.travelDaysRemaining} dia(s). ` +
        'Encerre o dia para avançar na estrada.';
    }

    if (selecionada) {
      const s = layout.byId(selecionada);
      if (s) mostrar(s, campaign);
    } else {
      const capital = layout.capitals.length;
      detalhe.appendChild(
        el('p', {
          className: 'nota',
          text:
            `${layout.settlements.length} cidades: ${capital} capitais e ` +
            `${layout.settlements.length - capital} satélites, ligadas por ` +
            `${layout.roads.length} estradas. Toque numa cidade para ver a ` +
            'vocação dela e viajar até lá. Toda estrada é zona PvP.',
        }),
      );
    }
  }

  /** Régua do mapa: sem ela nenhuma distância no quadro significa alguma coisa. */
  function regua(quadro: Quadro): SVGElement {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const passo = passoDaEscala(quadro.lado);
    const largura = (passo / quadro.lado) * VIEW;

    const y = VIEW - 24;
    const x = 24;
    const linha = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    linha.setAttribute('x1', String(x));
    linha.setAttribute('y1', String(y));
    linha.setAttribute('x2', String(x + largura));
    linha.setAttribute('y2', String(y));
    linha.setAttribute('stroke', '#ffffff');
    linha.setAttribute('stroke-width', '3');
    linha.setAttribute('stroke-linecap', 'square');
    g.appendChild(linha);

    const texto = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    texto.setAttribute('x', String(x));
    texto.setAttribute('y', String(y - 8));
    texto.setAttribute('class', 'mapa-escala');
    // Um tile é um metro, a mesma régua que a caminhada usa para cobrar
    // distância no reset.
    texto.textContent = `${passo.toLocaleString('pt-BR')} m`;
    g.appendChild(texto);
    return g;
  }

  function mostrar(s: Settlement, campaign: Campaign): void {
    const v = vocationDef(s.vocation);
    const governo = campaign.governments.get(s.id);
    const visitada = campaign.visitedSettlements.has(s.id);
    const plano = planJourney(campaign, s.id);

    const ficha = el('div', {
      className: 'mapa-ficha',
      children: [
        el('strong', { text: `${s.name}${visitada ? '' : ' · nunca visitada'}` }),
        el('span', {
          text: `${s.isCapital ? 'Capital' : 'Satélite'} · ${v.label} · ${s.population.toLocaleString('pt-BR')} habitantes`,
        }),
        // Nome do item, não o id: "scrap, circuitBoard" é o banco de dados
        // vazando na tela, e o jogador não reconhece o que está lendo.
        el('span', { text: `Produz barato: ${nomes(v.produces)}` }),
        el('span', { text: `Importa caro: ${nomes(v.demands)}` }),
        el('span', {
          text: governo
            ? `Governo: imposto ${Math.round(governo.taxRate * 100)}%, ` +
              `salário base ${governo.publicWage} cr` +
              (governo.governorName ? ` · ${governo.governorName}` : ' · sem governador')
            : 'Sem governo registrado.',
        }),
        el('span', {
          className: 'mapa-vagas',
          text: `${s.publicJobSlots} vagas em serviços públicos.`,
        }),
      ],
    });

    if (plano.ok) {
      const escalas = plano.route.stops.length - 2;
      ficha.appendChild(
        el('span', {
          className: 'mapa-rota',
          text:
            `Viagem: ${plano.route.days} dia(s) de estrada · ` +
            `perigo da rota ${Math.round(plano.route.danger * 100)}%` +
            (escalas > 0 ? ` · passa por ${escalas} cidade(s)` : ' · direto'),
        }),
      );

      // Não existe mercado no meio do caminho. Sair com mantimento para três
      // dias numa viagem de dez é morte por abandono, e o jogador precisa ver
      // isso **antes** de partir — depois não há como voltar atrás.
      const aguenta = daysOfSupplies(campaign);
      const falta = aguenta < plano.route.days;
      ficha.appendChild(
        el('span', {
          className: falta ? 'mapa-mantimento curto' : 'mapa-mantimento',
          text: falta
            ? `Mantimento para ${aguenta} dia(s): não dá para chegar. ` +
              'Compre comida e água antes de sair.'
            : `Mantimento para ${aguenta} dia(s) — cobre a viagem.`,
        }),
      );
    }

    const viajar = el('button', {
      className: 'mapa-viajar',
      text: plano.ok ? `VIAJAR — ${plano.route.days} DIA(S)` : plano.reason.toUpperCase(),
      attrs: { type: 'button' },
    }) as HTMLButtonElement;
    viajar.disabled = !plano.ok;
    if (plano.ok) {
      viajar.addEventListener('click', () => {
        if (!startJourney(campaign, s.id).ok) return;
        deps.onTravelStarted?.(s.id);
        // Fecha o mapa: a viagem acontece no jogo, e ficar aqui depois de
        // partir sugere que ainda dá para escolher outro destino.
        deps.onClose();
      });
    }
    ficha.appendChild(viajar);

    detalhe.appendChild(ficha);
  }

  return {
    id: 'mapa',
    root,
    onEnter() {
      // A seleção não sobrevive à saída: reabrir o mapa depois de viajar tem de
      // mostrar o mundo, não a ficha de quem foi escolhido da última vez.
      selecionada = null;
      desenhar();
    },
  };
}
