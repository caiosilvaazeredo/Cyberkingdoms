import { gameModes, type GameMode, type GameServer } from '../net/gameServer';
import { el, type Screen, type ScreenRouter } from './screens';

/**
 * Escolha do modo de jogo.
 *
 * ## Por que os modos não cabem dentro de "Nova campanha"
 *
 * A tela de nova campanha já oferecia dois deles como dois botõezinhos ao lado
 * do campo de seed. Isso funcionava enquanto eram dois e enquanto a diferença
 * entre eles era pequena. Não é: um deles exige servidor, outro desliga a
 * sobrevivência inteira, e o terceiro reseta o mundo a cada 24 h para todo
 * mundo ao mesmo tempo. Escolher o modo é escolher que jogo se vai jogar, e
 * essa decisão não é um detalhe de formulário.
 *
 * ## Por que o modo online é o mais explícito
 *
 * Ele é o único que pode falhar por motivo que não é do jogador — servidor
 * fora, lotado, sem rede. A tela diz isso antes, com o selo de "exige
 * servidor", em vez de deixar o jogador escolher e bater numa mensagem de erro
 * depois de já ter dado o nome do personagem.
 */

export interface ModeSelectDeps {
  readonly server: GameServer;
  readonly router: ScreenRouter;
  /** Modo escolhido. Cabe a quem chama decidir para onde ir. */
  readonly onPick: (mode: GameMode) => void | Promise<void>;
}

export function createModeSelect(deps: ModeSelectDeps): Screen {
  const lista = el('div', { className: 'escolhas' });

  for (const info of gameModes) {
    const selos = el('div', { className: 'selos' });
    selos.appendChild(
      el('span', {
        className: info.playableOffline ? 'selo ok' : 'selo rede',
        text: info.playableOffline ? 'offline' : 'exige servidor',
      }),
    );
    selos.appendChild(
      el('span', {
        className: 'selo',
        text: info.survivalEnabled ? 'sobrevivência' : 'sem sobrevivência',
      }),
    );

    const botao = el('button', {
      className: 'escolha',
      attrs: { type: 'button', 'data-modo': info.id },
      children: [
        el('strong', { text: info.label }),
        el('span', { text: info.summary }),
        selos,
      ],
    });
    botao.addEventListener('click', () => void deps.onPick(info.id));
    lista.appendChild(botao);
  }

  const voltar = el('button', {
    className: 'secundario',
    text: 'VOLTAR',
    attrs: { type: 'button' },
  });
  voltar.addEventListener('click', () => void deps.router.pop());

  const root = el('section', {
    className: 'tela folha',
    attrs: { 'aria-label': 'Modos de jogo' },
    children: [
      el('h1', { text: 'MODOS DE JOGO' }),
      el('p', {
        className: 'nota',
        // A partida rápida saiu da lista de propósito, e a tela diz isso: um
        // modo que aparece cinza e não abre é pior que um modo ausente.
        text: 'Partida rápida fica para depois — é o único modo que precisa de sincronização em tempo real, e não do reset de 24 h que o resto assume.',
      }),
      lista,
      voltar,
    ],
  });

  return { id: 'modos', root };
}
