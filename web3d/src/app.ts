import { LocalGameServer } from './net/localServer';
import { gameModeInfo, type GameMode } from './net/gameServer';
import { settings } from './net/settings';
import { bootWorld } from './main';
import { createMainMenu } from './ui/mainMenu';
import { createModeSelect } from './ui/modeSelect';
import { createNewCampaign } from './ui/newCampaign';
import { createServerBrowser } from './ui/serverBrowser';
import { createSettingsScreen } from './ui/settingsScreen';
import { ScreenRouter } from './ui/screens';

/**
 * Ponto de entrada.
 *
 * O jogo abre no **menu**, não no mapa. O mapa é uma tela entre várias — tratá-lo
 * como a abertura escondia as decisões que precisam ser tomadas antes de
 * entrar: qual modo, qual mundo, qual servidor, continuar ou começar.
 *
 * O mundo 3D só é montado quando alguém entra nele. Isso não é só arrumação:
 * carregar three.js, semear dezenas de milhares de lâminas e subir a malha de
 * terreno leva segundos num celular, e fazer isso antes do jogador escolher o
 * que quer gasta bateria e paciência à toa.
 *
 * ## Por que trocar de mundo recarrega a página
 *
 * `bootWorld` monta a cena uma vez e não tem desmontagem: cria renderer,
 * governor, ouvintes de janela e o laço de quadro. Enquanto isso for verdade,
 * entrar numa segunda campanha com outra seed devolveria o **mundo da
 * primeira** — o menu diria `krom-vapor-412` e o jogador veria o mapa antigo,
 * que é bem pior que um carregamento a mais. Recarregar é honesto e cabe em
 * vinte linhas; a desmontagem completa é trabalho para quando a campanha
 * estiver portada e houver estado de verdade a preservar.
 */

const server = new LocalGameServer();
const host = document.querySelector<HTMLElement>('#telas')!;
const hud = document.querySelector<HTMLElement>('#hud')!;
const router = new ScreenRouter(host);

/** Onde fica o pedido de entrada que sobrevive ao recarregamento. */
const PENDENTE = 'ck.entrar';

let montadoCom: string | null = null;

/** Entra no mundo, montando a cena na primeira vez. */
async function entrar(
  slotId: string,
  seedLabel: string,
  _mode: GameMode,
): Promise<void> {
  if (montadoCom !== null && montadoCom !== seedLabel) {
    // Outro mundo, e a cena atual não sabe se desmontar. Guarda o destino e
    // recarrega: quem volta cai direto no mundo certo.
    try {
      sessionStorage.setItem(PENDENTE, slotId);
    } catch {
      // Aba privada pode recusar. Sem o bilhete o jogador cai no menu depois
      // do recarregamento — chato, mas ainda correto, e melhor que entregar o
      // mundo errado.
    }
    location.reload();
    return;
  }

  hud.hidden = false;
  host.hidden = true;
  if (montadoCom === null) {
    bootWorld(seedLabel);
    montadoCom = seedLabel;
  }
}

function sair(): void {
  hud.hidden = true;
  host.hidden = false;
  void router.reset('menu');
}

window.addEventListener('ck:sair', sair);

// ------------------------------------------------------------------- telas

const novaCampanha = createNewCampaign({
  server,
  router,
  async onStart(slotId, seedLabel, mode) {
    await entrar(slotId, seedLabel, mode);
  },
});
router.register(novaCampanha);

router.register(
  createMainMenu({
    server,
    router,
    async onContinue(slot) {
      await server.resumeSession(slot.id);
      await entrar(slot.id, slot.seedLabel, slot.mode);
    },
    onNewCampaign() {
      // Limpa o que a tela de modos possa ter deixado: quem entra por aqui
      // ainda não escolheu modo nenhum.
      novaCampanha.preselect(null, null);
      void router.push('nova');
    },
  }),
);

const navegador = createServerBrowser({
  server,
  router,
  onJoin(info) {
    // O servidor decide o mapa; falta o personagem. Por isso o caminho passa
    // pela mesma tela de nova campanha, só que com a seed travada.
    novaCampanha.preselect(info.mode, info);
    void router.push('nova');
  },
});
router.register(navegador);

router.register(
  createModeSelect({
    server,
    router,
    onPick(mode) {
      if (gameModeInfo(mode).playableOffline) {
        novaCampanha.preselect(mode);
        void router.push('nova');
        return;
      }
      navegador.setMode(mode);
      void router.push('servidores');
    },
  }),
);

router.register(createSettingsScreen({ store: settings(), router }));

// ------------------------------------------------------------------ abertura

/**
 * Retoma o mundo pedido antes de um recarregamento.
 *
 * O bilhete é consumido **antes** de tentar entrar, e não depois: se a entrada
 * falhar — save apagado noutra aba, armazenamento cheio —, um bilhete que
 * sobrevive faria a página recarregar de novo, e de novo.
 */
async function abrir(): Promise<void> {
  let pendente: string | null = null;
  try {
    pendente = sessionStorage.getItem(PENDENTE);
    if (pendente) sessionStorage.removeItem(PENDENTE);
  } catch {
    pendente = null;
  }

  await router.reset('menu');

  if (pendente) {
    try {
      const sessao = await server.resumeSession(pendente);
      await entrar(sessao.slotId, sessao.seedLabel, sessao.mode);
    } catch {
      // Fica no menu. O jogador vê a lista de campanhas e escolhe de novo.
    }
  }
}

void abrir();
