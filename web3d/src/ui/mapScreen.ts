import type { Campaign } from '../campaign/campaign';
import { itemDef } from '../economy/item';
import { SETTLED_RADIUS } from '../world/layout';
import { vocationDef, type Settlement } from '../world/settlement';
import { el, type Screen, type ScreenRouter } from './screens';

/**
 * O mapa do mundo: as vinte cidades, as estradas e onde o jogador está.
 *
 * ## Por que SVG, e não um segundo canvas 3D
 *
 * O mapa é um documento, não uma cena. Em SVG cada cidade é um elemento com
 * `<title>`, dá para tocar, tem foco de teclado e é lido por leitor de tela —
 * tudo isso de graça. Num canvas eu teria de reimplementar acerto de clique,
 * navegação e acessibilidade, e ainda pagar outro contexto WebGL num celular
 * que já tem um aberto.
 *
 * ## O que o mapa mostra, e por que essa escolha
 *
 * Vocação e população, não relevo. O relevo o jogador vê no jogo; o que ele
 * precisa **decidir** no mapa é para onde viajar, e essa decisão é econômica:
 * quem produz o que eu quero comprar barato, quem demanda o que eu tenho para
 * vender caro. Um mapa bonito que não responde a isso é papel de parede.
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
}

const VIEW = 1000;
const ESCALA = VIEW / 2 / SETTLED_RADIUS;

const nomes = (ids: readonly string[]): string =>
  ids.map((id) => itemDef(id).name).join(', ');

const CORES: Record<string, string> = {
  petrochemical: '#ffb300',
  foundry: '#90a4ae',
  agroBio: '#00e676',
  techHub: '#00e5ff',
  freePort: '#e040fb',
};

export function createMapScreen(deps: MapScreenDeps): Screen {
  const alvo = el('div', { className: 'mapa-alvo' });
  const detalhe = el('div', { className: 'mapa-detalhe' });
  const legenda = el('div', { className: 'mapa-legenda' });

  const voltar = el('button', {
    className: 'secundario',
    text: 'VOLTAR',
    attrs: { type: 'button' },
  });
  voltar.addEventListener('click', () => deps.onClose());

  const root = el('section', {
    className: 'tela folha',
    attrs: { 'aria-label': 'Mapa do mundo' },
    children: [
      el('h1', { text: 'MAPA' }),
      el('p', {
        className: 'nota',
        text: 'Toque numa cidade para ver a vocação dela: o que produz barato e o que precisa importar. É essa diferença que paga a viagem.',
      }),
      alvo,
      legenda,
      detalhe,
      voltar,
    ],
  });

  function desenhar(): void {
    const campaign = deps.campaign();
    alvo.textContent = '';
    detalhe.textContent = '';
    legenda.textContent = '';

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
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${VIEW} ${VIEW}`);
    svg.setAttribute('class', 'mapa');
    svg.setAttribute('role', 'img');
    svg.setAttribute(
      'aria-label',
      `Mapa com ${layout.settlements.length} cidades`,
    );

    const px = (n: number): number => VIEW / 2 + n * ESCALA;

    // Estradas primeiro: elas passam por baixo das cidades.
    for (const road of layout.roads) {
      const a = layout.byId(road.fromId);
      const b = layout.byId(road.toId);
      if (!a || !b) continue;
      const linha = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      linha.setAttribute('x1', String(px(a.center.x)));
      linha.setAttribute('y1', String(px(a.center.y)));
      linha.setAttribute('x2', String(px(b.center.x)));
      linha.setAttribute('y2', String(px(b.center.y)));
      // A espessura mostra o perigo: a rota curta e arriscada tem de saltar aos
      // olhos, porque é a decisão de risco que o GDD quer que exista.
      linha.setAttribute('stroke', road.danger > 0.4 ? '#ff6b6b' : '#5f7a72');
      linha.setAttribute('stroke-width', String(1.5 + road.danger * 5));
      linha.setAttribute('opacity', '0.55');
      const titulo = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      titulo.textContent =
        `${a.name} ↔ ${b.name} · ${road.travelDays} dia(s) · ` +
        `perigo ${Math.round(road.danger * 100)}%`;
      linha.appendChild(titulo);
      svg.appendChild(linha);
    }

    const aqui = campaign.currentSettlementId;
    for (const s of layout.settlements) {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'mapa-cidade');
      g.setAttribute('tabindex', '0');
      g.setAttribute('role', 'button');

      const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('cx', String(px(s.center.x)));
      c.setAttribute('cy', String(px(s.center.y)));
      c.setAttribute('r', String(s.isCapital ? 16 : 9));
      c.setAttribute('fill', CORES[s.vocation] ?? '#90a4ae');
      c.setAttribute('opacity', s.isCapital ? '0.9' : '0.65');
      if (s.id === aqui) {
        c.setAttribute('stroke', '#ffffff');
        c.setAttribute('stroke-width', '4');
      }
      g.appendChild(c);

      const rotulo = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      rotulo.setAttribute('x', String(px(s.center.x)));
      rotulo.setAttribute('y', String(px(s.center.y) - (s.isCapital ? 22 : 14)));
      rotulo.setAttribute('text-anchor', 'middle');
      rotulo.setAttribute('class', s.isCapital ? 'mapa-nome capital' : 'mapa-nome');
      rotulo.textContent = s.name;
      g.appendChild(rotulo);

      const titulo = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      titulo.textContent = `${s.name} · ${vocationDef(s.vocation).label}`;
      g.appendChild(titulo);

      const abrir = (): void => mostrar(s, campaign);
      g.addEventListener('click', abrir);
      g.addEventListener('keydown', (e) => {
        if ((e as KeyboardEvent).key === 'Enter') abrir();
      });
      svg.appendChild(g);
    }

    alvo.appendChild(svg);

    for (const v of Object.keys(CORES)) {
      legenda.appendChild(
        el('span', {
          className: 'mapa-chip',
          html:
            `<i style="background:${CORES[v]}"></i>` +
            vocationDef(v as never).label,
        }),
      );
    }

    const capital = layout.capitals.length;
    detalhe.appendChild(
      el('p', {
        className: 'nota',
        text:
          `${layout.settlements.length} cidades: ${capital} capitais e ` +
          `${layout.settlements.length - capital} satélites, ligadas por ` +
          `${layout.roads.length} estradas. Toda estrada é zona PvP.`,
      }),
    );
  }

  function mostrar(s: Settlement, campaign: Campaign): void {
    const v = vocationDef(s.vocation);
    const governo = campaign.governments.get(s.id);
    const visitada = campaign.visitedSettlements.has(s.id);

    detalhe.textContent = '';
    detalhe.appendChild(
      el('div', {
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
      }),
    );
  }

  return { id: 'mapa', root, onEnter: desenhar };
}
