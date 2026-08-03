import { gameModes, type GameServer, type SaveSlot } from '../net/gameServer';
import { el, type Screen, type ScreenRouter } from './screens';

/**
 * Menu inicial.
 *
 * O jogo abria direto no mapa. Além de não parecer jogo, isso escondia
 * decisões que precisam ser tomadas antes de entrar: qual modo, qual mundo,
 * continuar ou começar. Um menu não é enfeite — é onde essas escolhas cabem.
 *
 * **Continuar vem primeiro e é o botão maior.** Quem volta ao jogo quer voltar
 * ao jogo; enterrar isso sob "Novo" cobra um toque extra de todo mundo, todo
 * dia, para servir a quem chega uma vez.
 */

export interface MainMenuDeps {
  readonly server: GameServer;
  readonly router: ScreenRouter;
  /** Entra num save existente. */
  readonly onContinue: (slot: SaveSlot) => Promise<void>;
  /**
   * Começa uma campanha sem modo decidido.
   *
   * O menu não empilha a tela nova sozinho porque ela guarda o modo escolhido
   * na visita anterior: quem passou pelos modos, escolheu "Mundo Persistente" e
   * voltou ao menu encontraria esse modo ainda grudado ao apertar "Nova
   * campanha". Quem sabe limpar é quem montou as telas.
   */
  readonly onNewCampaign: () => void;
}

export function createMainMenu(deps: MainMenuDeps): Screen {
  const saveList = el('div', { className: 'lista' });

  const continuar = el('button', {
    className: 'principal',
    text: 'CONTINUAR',
    attrs: { type: 'button' },
  });

  const novo = el('button', {
    className: 'secundario',
    text: 'NOVA CAMPANHA',
    attrs: { type: 'button' },
  });

  const modos = el('button', {
    className: 'secundario',
    text: 'MODOS DE JOGO',
    attrs: { type: 'button' },
  });

  const mundos = el('button', {
    className: 'secundario',
    text: 'MUNDOS',
    attrs: { type: 'button' },
  });

  const config = el('button', {
    className: 'secundario',
    text: 'CONFIGURAÇÕES',
    attrs: { type: 'button' },
  });

  const root = el('section', {
    className: 'tela menu',
    attrs: { 'aria-label': 'Menu inicial' },
    children: [
      el('div', {
        className: 'marca',
        children: [
          el('h1', { text: 'CYBERKINGDOMS' }),
          el('p', {
            className: 'subtitulo',
            text: 'economia · política · sobrevivência',
          }),
        ],
      }),
      el('div', {
        className: 'acoes',
        children: [continuar, novo, modos, mundos, config],
      }),
      saveList,
      el('p', {
        className: 'rodape',
        text: 'v0.1 · mundo gerado por seed · offline',
      }),
    ],
  });

  let saves: readonly SaveSlot[] = [];

  async function refresh(): Promise<void> {
    saves = await deps.server.listSaves();

    // Sem save, "Continuar" não some — fica desabilitado e explicado. Um botão
    // que aparece e desaparece faz o menu dançar entre aberturas, e o jogador
    // perde a referência de onde as coisas ficam.
    const vazio = saves.length === 0;
    continuar.disabled = vazio;
    continuar.title = vazio ? 'Nenhuma campanha salva ainda' : '';

    saveList.textContent = '';
    if (vazio) {
      saveList.appendChild(
        el('p', {
          className: 'vazio',
          text: 'Nenhuma campanha salva. Comece uma nova.',
        }),
      );
      return;
    }

    saveList.appendChild(el('h2', { text: 'Campanhas' }));
    for (const slot of saves.slice(0, 4)) {
      const modo = gameModes.find((m) => m.id === slot.mode);
      const item = el('button', {
        className: 'save',
        attrs: { type: 'button' },
        children: [
          el('strong', { text: slot.characterName }),
          el('span', {
            text: `${modo?.label ?? slot.mode} · dia ${slot.day} · ${slot.seedLabel}`,
          }),
        ],
      });
      item.addEventListener('click', () => void deps.onContinue(slot));
      saveList.appendChild(item);
    }
  }

  continuar.addEventListener('click', () => {
    const mais = saves[0];
    if (mais) void deps.onContinue(mais);
  });
  novo.addEventListener('click', () => deps.onNewCampaign());
  modos.addEventListener('click', () => void deps.router.push('modos'));
  mundos.addEventListener('click', () => void deps.router.push('mundos'));
  config.addEventListener('click', () => void deps.router.push('config'));

  return {
    id: 'menu',
    root,
    onEnter: refresh,
  };
}
