import { LocalGameServer } from './net/localServer';
import type { GameMode } from './net/gameServer';
import { bootWorld } from './main';
import { createMainMenu } from './ui/mainMenu';
import { createNewCampaign } from './ui/newCampaign';
import { ScreenRouter, el } from './ui/screens';

/**
 * Ponto de entrada.
 *
 * O jogo abre no **menu**, não no mapa. O mapa é uma tela entre várias — tratá-lo
 * como a abertura escondia as decisões que precisam ser tomadas antes de
 * entrar: qual modo, qual mundo, continuar ou começar.
 *
 * O mundo 3D só é montado quando alguém entra nele. Isso não é só arrumação:
 * carregar three.js, semear 26 mil lâminas e subir a malha de terreno leva
 * segundos num celular, e fazer isso antes do jogador escolher o que quer
 * gasta bateria e paciência à toa.
 */

const server = new LocalGameServer();
const host = document.querySelector<HTMLElement>('#telas')!;
const hud = document.querySelector<HTMLElement>('#hud')!;
const router = new ScreenRouter(host);

let mundoMontado = false;

/** Entra no mundo, montando a cena na primeira vez. */
async function entrar(seedLabel: string, _mode: GameMode): Promise<void> {
  hud.hidden = false;
  host.hidden = true;
  if (!mundoMontado) {
    bootWorld(seedLabel);
    mundoMontado = true;
  }
}

function sair(): void {
  hud.hidden = true;
  host.hidden = false;
  void router.reset('menu');
}

window.addEventListener('ck:sair', sair);

router.register(
  createMainMenu({
    server,
    router,
    async onContinue(slot) {
      await server.resumeSession(slot.id);
      await entrar(slot.seedLabel, slot.mode);
    },
  }),
);

router.register(
  createNewCampaign({
    server,
    router,
    async onStart(_slotId, seedLabel, mode) {
      await entrar(seedLabel, mode);
    },
  }),
);

// Telas ainda por fazer. Um marcador honesto é melhor que um botão que não faz
// nada: o jogador aperta, entende que o lugar existe, e não fica achando que
// quebrou.
for (const [id, titulo] of [
  ['modos', 'MODOS DE JOGO'],
  ['config', 'CONFIGURAÇÕES'],
] as const) {
  const voltar = el('button', {
    className: 'secundario',
    text: 'VOLTAR',
    attrs: { type: 'button' },
  });
  voltar.addEventListener('click', () => void router.pop());
  router.register({
    id,
    root: el('section', {
      className: 'tela folha',
      children: [
        el('h1', { text: titulo }),
        el('p', { className: 'nota', text: 'Em construção — próxima rodada.' }),
        voltar,
      ],
    }),
  });
}

void router.reset('menu');
