import { hashLabel } from '../core/rng';
import type { GameServer, WorldBlueprint } from '../net/gameServer';
import { TileCoord } from '../world/coords';
import {
  SETTLED_RADIUS,
  WorldLayout,
  generateLayout,
  type WorldLayoutJson,
} from '../world/layout';
import {
  Road,
  Settlement,
  allVocations,
  type CityVocation,
} from '../world/settlement';
import { WorldGenerator } from '../world/worldGen';
import { el, type Screen, type ScreenRouter } from './screens';

/**
 * Editor de mundo: monta a planta à mão e grava como mundo jogável.
 *
 * ## Por que editar a planta, e não o terreno
 *
 * O terreno é função pura da seed: 65 mil tiles por chunk, gerados sob demanda
 * e descartados. Editá-lo tile a tile exigiria persistir o mundo inteiro, e o
 * arquivo cresceria sem limite. A **planta** — quais cidades existem, onde,
 * com que vocação, ligadas por quais estradas — é a parte que o jogo já
 * persiste, e é o que de fato decide como o mundo se joga.
 *
 * Trocar a vocação de uma capital muda o que ela produz barato, o que ela
 * importa caro, e portanto as rotas comerciais inteiras. Isso é mais poder
 * sobre o jogo do que mover uma pedra de lugar.
 *
 * ## Isto **é** o formato de servidor
 *
 * Um mundo de servidor é exatamente esta planta: nome, seed e layout. Não há um
 * segundo formato esperando ser inventado — quando o backend existir, ele
 * publica um `WorldBlueprint` e esta tela continua igual.
 */

export interface WorldEditorDeps {
  readonly server: GameServer;
  readonly router: ScreenRouter;
}

interface Rascunho {
  id: string;
  name: string;
  seedLabel: string;
  settlements: Settlement[];
  roads: Road[];
}

export function createWorldEditor(deps: WorldEditorDeps): Screen {
  let rascunho: Rascunho | null = null;
  let mensagem = '';

  const listaMundos = el('div', { className: 'lista' });
  const editor = el('div', { className: 'editor' });
  const aviso = el('p', { className: 'nota' });

  const voltar = el('button', {
    className: 'secundario',
    text: 'VOLTAR',
    attrs: { type: 'button' },
  });
  voltar.addEventListener('click', () => void deps.router.pop());

  const root = el('section', {
    className: 'tela folha',
    attrs: { 'aria-label': 'Editor de mundo' },
    children: [
      el('h1', { text: 'MUNDOS' }),
      el('p', {
        className: 'nota',
        text:
          'Um mundo é a planta: nome, seed e as cidades. O terreno vem da seed ' +
          'e não é guardado — dois clientes com a mesma planta veem o mesmo mapa. ' +
          'Este é o mesmo formato que um servidor vai publicar.',
      }),
      aviso,
      listaMundos,
      editor,
      voltar,
    ],
  });

  // ------------------------------------------------------------------ lista

  async function montarLista(): Promise<void> {
    listaMundos.textContent = '';
    aviso.textContent = mensagem;

    const novo = el('button', {
      className: 'principal',
      text: 'MUNDO NOVO A PARTIR DE UMA SEED',
      attrs: { type: 'button' },
    });
    novo.addEventListener('click', () => {
      abrirRascunho(null);
    });
    listaMundos.appendChild(novo);

    const mundos = await deps.server.listWorlds();
    if (mundos.length === 0) {
      listaMundos.appendChild(
        el('p', { className: 'vazio', text: 'Nenhum mundo montado ainda.' }),
      );
      return;
    }

    listaMundos.appendChild(el('h2', { text: 'Seus mundos' }));
    for (const m of mundos) {
      const item = el('button', {
        className: 'save',
        attrs: { type: 'button' },
        children: [
          el('strong', { text: m.name }),
          el('span', {
            text: `${m.settlementCount} cidades · seed ${m.seedLabel}`,
          }),
        ],
      });
      item.addEventListener('click', () => abrirRascunho(m));
      listaMundos.appendChild(item);
    }
  }

  // --------------------------------------------------------------- rascunho

  function abrirRascunho(mundo: WorldBlueprint | null): void {
    if (mundo) {
      const layout = WorldLayout.fromJson(mundo.layout as WorldLayoutJson);
      rascunho = {
        id: mundo.id,
        name: mundo.name,
        seedLabel: mundo.seedLabel,
        settlements: [...layout.settlements],
        roads: [...layout.roads],
      };
    } else {
      const seedLabel = `mundo-${Math.floor(Math.random() * 9000) + 1000}`;
      const gerado = generateLayout(WorldGenerator.fromLabel(seedLabel));
      rascunho = {
        id: `w${Date.now().toString(36)}`,
        name: 'Mundo sem nome',
        seedLabel,
        settlements: [...gerado.settlements],
        roads: [...gerado.roads],
      };
    }
    montarEditor();
  }

  function montarEditor(): void {
    editor.textContent = '';
    if (!rascunho) return;
    const r = rascunho;

    const nome = el('input', {
      attrs: { id: 'campo-mundo-nome', maxlength: '40', autocomplete: 'off' },
    }) as HTMLInputElement;
    nome.value = r.name;
    nome.addEventListener('input', () => {
      r.name = nome.value;
    });

    const seed = el('input', {
      attrs: { id: 'campo-mundo-seed', maxlength: '32', autocomplete: 'off' },
    }) as HTMLInputElement;
    seed.value = r.seedLabel;

    const regerar = el('button', {
      className: 'secundario',
      text: 'REGERAR CIDADES A PARTIR DESTA SEED',
      attrs: { type: 'button' },
    });
    regerar.addEventListener('click', () => {
      // Regerar joga fora a edição manual, e a tela diz isso antes: o layout é
      // o trabalho, e perdê-lo por um toque seria caro.
      r.seedLabel = seed.value.trim() || r.seedLabel;
      const gerado = generateLayout(WorldGenerator.fromLabel(r.seedLabel));
      r.settlements = [...gerado.settlements];
      r.roads = [...gerado.roads];
      montarEditor();
    });

    editor.appendChild(el('h2', { text: 'Planta' }));
    editor.appendChild(
      el('label', { text: 'Nome do mundo', attrs: { for: 'campo-mundo-nome' } }),
    );
    editor.appendChild(nome);
    editor.appendChild(
      el('label', { text: 'Seed do terreno', attrs: { for: 'campo-mundo-seed' } }),
    );
    editor.appendChild(seed);
    editor.appendChild(
      el('p', {
        className: 'nota',
        text: 'A seed decide bioma, relevo e recurso. Regerar substitui todas as cidades pelas sorteadas — a edição manual se perde.',
      }),
    );
    editor.appendChild(regerar);

    editor.appendChild(
      el('h2', { text: `Cidades (${r.settlements.length})` }),
    );

    for (const s of r.settlements) {
      editor.appendChild(cartaoCidade(s));
    }

    const adicionar = el('button', {
      className: 'secundario',
      text: 'ADICIONAR CIDADE',
      attrs: { type: 'button' },
    });
    adicionar.addEventListener('click', () => {
      const n = r.settlements.length;
      r.settlements.push(
        new Settlement(
          `cap_manual_${n}`,
          `Cidade ${n + 1}`,
          'capital',
          new TileCoord(0, 0),
          allVocations[n % allVocations.length]!.id,
          28,
          200000,
        ),
      );
      montarEditor();
    });
    editor.appendChild(adicionar);

    const salvar = el('button', {
      className: 'principal',
      text: 'SALVAR MUNDO',
      attrs: { type: 'button' },
    });
    salvar.addEventListener('click', () => void gravar());
    editor.appendChild(salvar);

    const apagar = el('button', {
      className: 'secundario',
      text: 'APAGAR ESTE MUNDO',
      attrs: { type: 'button' },
    });
    apagar.addEventListener('click', () => {
      void deps.server.deleteWorld(r.id).then(() => {
        rascunho = null;
        editor.textContent = '';
        mensagem = 'Mundo apagado.';
        void montarLista();
      });
    });
    editor.appendChild(apagar);
  }

  function cartaoCidade(s: Settlement): HTMLElement {
    const r = rascunho!;
    const indice = r.settlements.indexOf(s);

    const campo = (
      rotulo: string,
      valor: string,
      aplicar: (v: string) => void,
      tipo = 'text',
    ): HTMLElement => {
      const input = el('input', { attrs: { type: tipo } }) as HTMLInputElement;
      input.value = valor;
      input.addEventListener('change', () => {
        aplicar(input.value);
        montarEditor();
      });
      return el('div', {
        className: 'campo-linha',
        children: [el('span', { text: rotulo }), input],
      });
    };

    const trocar = (patch: Partial<{
      name: string;
      kind: 'capital' | 'satellite';
      x: number;
      y: number;
      vocation: CityVocation;
      radius: number;
      population: number;
    }>): void => {
      r.settlements[indice] = new Settlement(
        s.id,
        patch.name ?? s.name,
        patch.kind ?? s.kind,
        new TileCoord(patch.x ?? s.center.x, patch.y ?? s.center.y),
        patch.vocation ?? s.vocation,
        patch.radius ?? s.radius,
        patch.population ?? s.population,
        s.capitalId,
      );
    };

    const vocacoes = el('div', { className: 'escolhas linha-chips' });
    for (const v of allVocations) {
      const chip = el('button', {
        className: 'chip',
        text: v.label,
        attrs: { type: 'button', 'aria-pressed': String(v.id === s.vocation) },
      });
      chip.addEventListener('click', () => {
        trocar({ vocation: v.id });
        montarEditor();
      });
      vocacoes.appendChild(chip);
    }

    const remover = el('button', {
      className: 'secundario dev-restaurar',
      text: 'REMOVER',
      attrs: { type: 'button' },
    });
    remover.addEventListener('click', () => {
      r.settlements.splice(indice, 1);
      // As estradas que tocavam a cidade removida saem junto: uma estrada para
      // lugar nenhum viraria linha solta no mapa e destino inválido na viagem.
      r.roads = r.roads.filter((e) => e.fromId !== s.id && e.toId !== s.id);
      montarEditor();
    });

    return el('div', {
      className: 'dev-item',
      children: [
        el('h2', { text: `${s.name} · ${s.isCapital ? 'capital' : 'satélite'}` }),
        campo('Nome', s.name, (v) => trocar({ name: v })),
        campo('X', String(s.center.x), (v) => trocar({ x: inteiro(v, s.center.x) }), 'number'),
        campo('Y', String(s.center.y), (v) => trocar({ y: inteiro(v, s.center.y) }), 'number'),
        campo('Raio', String(s.radius), (v) => trocar({ radius: preso(inteiro(v, s.radius), 4, 80) }), 'number'),
        campo('População', String(s.population), (v) => trocar({ population: Math.max(0, inteiro(v, s.population)) }), 'number'),
        el('span', { className: 'dev-caminho', text: `id: ${s.id}` }),
        vocacoes,
        remover,
      ],
    });
  }

  async function gravar(): Promise<void> {
    if (!rascunho) return;
    const r = rascunho;
    const layout = new WorldLayout(hashLabel(r.seedLabel), r.settlements, r.roads);

    const blueprint: WorldBlueprint = {
      id: r.id,
      name: r.name.trim() || 'Mundo sem nome',
      seedLabel: r.seedLabel,
      layout: layout.toJson(),
      createdAt: Date.now(),
      settlementCount: r.settlements.length,
    };

    await deps.server.saveWorld(blueprint);
    mensagem = `"${blueprint.name}" salvo com ${blueprint.settlementCount} cidades.`;
    await montarLista();
  }

  return {
    id: 'mundos',
    root,
    onEnter() {
      mensagem = '';
      rascunho = null;
      editor.textContent = '';
      void montarLista();
    },
  };
}

function inteiro(texto: string, padrao: number): number {
  const n = Number(texto);
  return Number.isFinite(n) ? Math.trunc(n) : padrao;
}

function preso(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export { SETTLED_RADIUS };
