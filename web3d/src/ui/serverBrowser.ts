import {
  gameModeInfo,
  type GameMode,
  type GameServer,
  type ServerInfo,
} from '../net/gameServer';
import { el, type Screen, type ScreenRouter } from './screens';

/**
 * O navegador de servidores.
 *
 * ## Por que ele existe antes do backend
 *
 * A lista vem sintética do `LocalGameServer`, derivada da seed e estável entre
 * aberturas. Isso não é maquete: é a tela de verdade, ligada à interface de
 * verdade, servida por uma implementação que ainda não fala rede. Quando o
 * servidor real entrar, o que muda é a implementação — esta tela não.
 *
 * O que **não** se faz é fingir. Cada linha diz `local (simulado)` na região, e
 * o topo da tela avisa. Um jogador que descobre sozinho que a lista era falsa
 * perde a confiança em todo o resto da interface.
 *
 * ## Por que ordena por ping, e não por gente
 *
 * Servidor cheio é atraente e servidor lento é insuportável. Ordenar por
 * população põe o pior lag no topo sempre que ele for popular. Lotado e fora do
 * ar caem para o fim, porque não são escolha.
 */

export interface ServerBrowserDeps {
  readonly server: GameServer;
  readonly router: ScreenRouter;
  /** Servidor escolhido. Quem chama decide o próximo passo. */
  readonly onJoin: (info: ServerInfo) => void | Promise<void>;
}

export interface ServerBrowserScreen extends Screen {
  /** Define o modo antes de empilhar a tela. */
  setMode(mode: GameMode): void;
}

/** Fora do ar por último, lotado antes dele, o resto pelo ping. */
export function sortServers(
  lista: readonly ServerInfo[],
): readonly ServerInfo[] {
  const peso = (s: ServerInfo): number => {
    if (!s.online) return 2;
    if (s.players >= s.capacity) return 1;
    return 0;
  };
  return [...lista].sort((a, b) => {
    const d = peso(a) - peso(b);
    if (d !== 0) return d;
    return (a.ping ?? 9999) - (b.ping ?? 9999);
  });
}

/** `fora do ar`, `lotado` ou `null` quando dá para entrar. */
export function joinBlocker(s: ServerInfo): string | null {
  if (!s.online) return 'fora do ar';
  if (s.players >= s.capacity) return 'lotado';
  return null;
}

export function createServerBrowser(
  deps: ServerBrowserDeps,
): ServerBrowserScreen {
  let modo: GameMode = 'persistent';

  const lista = el('div', { className: 'lista servidores' });
  const estado = el('p', { className: 'nota' });

  const atualizar = el('button', {
    className: 'secundario',
    text: 'ATUALIZAR',
    attrs: { type: 'button' },
  });
  const voltar = el('button', {
    className: 'secundario',
    text: 'VOLTAR',
    attrs: { type: 'button' },
  });
  voltar.addEventListener('click', () => void deps.router.pop());

  const root = el('section', {
    className: 'tela folha',
    attrs: { 'aria-label': 'Servidores' },
    children: [
      el('h1', { text: 'SERVIDORES' }),
      el('p', {
        className: 'aviso-simulado',
        text: 'Esta lista é simulada. O servidor de verdade ainda não existe — a tela e a interface já são as definitivas.',
      }),
      estado,
      lista,
      atualizar,
      voltar,
    ],
  });

  function linha(s: ServerInfo): HTMLElement {
    const bloqueio = joinBlocker(s);

    const item = el('button', {
      className: bloqueio ? 'servidor bloqueado' : 'servidor',
      attrs: { type: 'button' },
      children: [
        el('div', {
          className: 'servidor-topo',
          children: [
            el('strong', { text: s.name }),
            el('span', {
              className: bloqueio ? 'ping ruim' : 'ping',
              text: bloqueio ?? `${s.ping ?? '—'} ms`,
            }),
          ],
        }),
        el('span', {
          text:
            `${s.region} · dia ${s.day} · ` +
            `${s.players}/${s.capacity} jogadores`,
        }),
        el('span', { className: 'seed', text: `seed ${s.seedLabel}` }),
      ],
    });

    if (bloqueio) {
      item.disabled = true;
      item.title = `Indisponível: ${bloqueio}`;
    } else {
      item.addEventListener('click', () => void deps.onJoin(s));
    }
    return item;
  }

  async function carregar(): Promise<void> {
    estado.textContent = 'Procurando servidores…';
    lista.textContent = '';
    atualizar.disabled = true;

    try {
      const encontrados = await deps.server.listServers(modo);
      lista.textContent = '';

      if (encontrados.length === 0) {
        // Modo offline não tem servidor, e isso não é falha — a tela explica
        // em vez de mostrar uma lista vazia que parece erro de rede.
        estado.textContent = gameModeInfo(modo).playableOffline
          ? `${gameModeInfo(modo).label} não usa servidor: o mundo é seu e roda no aparelho.`
          : 'Nenhum servidor respondeu.';
        return;
      }

      estado.textContent = `${encontrados.length} servidor(es) · ${gameModeInfo(modo).label}`;
      for (const s of sortServers(encontrados)) lista.appendChild(linha(s));
    } catch (e) {
      estado.textContent = `Não foi possível listar: ${(e as Error).message}`;
    } finally {
      atualizar.disabled = false;
    }
  }

  atualizar.addEventListener('click', () => void carregar());

  return {
    id: 'servidores',
    root,
    setMode(novo) {
      modo = novo;
    },
    onEnter: carregar,
  };
}
