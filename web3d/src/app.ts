import { LocalGameServer } from './net/localServer';
import { gameModeInfo, type GameMode } from './net/gameServer';
import { Campaign, type CampaignJson } from './campaign/campaign';
import { settings } from './net/settings';
import { bootWorld } from './main';
import { createMainMenu } from './ui/mainMenu';
import { createModeSelect } from './ui/modeSelect';
import { createNewCampaign } from './ui/newCampaign';
import { createServerBrowser } from './ui/serverBrowser';
import { createSettingsScreen } from './ui/settingsScreen';
import { createDevScreen } from './ui/devScreen';
import { createMapScreen } from './ui/mapScreen';
import { createWorldEditor } from './ui/worldEditor';
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
/** A campanha aberta, para as telas que a leem sem poder montá-la. */
let campanhaAtual: Campaign | null = null;

/**
 * Salva a campanha no servidor.
 *
 * Com espaçamento: o reset diário pode disparar várias vezes seguidas quando a
 * aba volta de dias fechada, e gravar um JSON de campanha a cada virada
 * travaria o quadro. Meio segundo agrupa a rajada sem arriscar perder o
 * progresso — a última gravação sempre acontece.
 */
function persistidor(slotId: string): (campaign: Campaign) => void {
  let agendado: ReturnType<typeof setTimeout> | null = null;
  let pendente: Campaign | null = null;

  const gravar = (): void => {
    agendado = null;
    const alvo = pendente;
    pendente = null;
    if (!alvo) return;
    void server.saveState(slotId, alvo.toJson()).catch(() => {
      // Armazenamento cheio ou aba privada. Perder o save é ruim, mas derrubar
      // o laço de render por causa disso é pior: o jogador perderia a sessão
      // inteira em vez de um dia.
    });
  };

  return (campaign) => {
    pendente = campaign;
    if (agendado === null) agendado = setTimeout(gravar, 500);
  };
}

/** Entra no mundo, montando a cena na primeira vez. */
async function entrar(
  slotId: string,
  seedLabel: string,
  _mode: GameMode,
  campanha: Campaign,
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
  campanhaAtual = campanha;
  if (montadoCom === null) {
    bootWorld(campanha, { onPersist: persistidor(slotId) });
    montadoCom = seedLabel;
  }
}

/**
 * Recupera a campanha de um save, ou cria uma nova.
 *
 * Save corrompido ou de outra versão não vira tela de erro: o mundo é função
 * pura da seed, então dá para recomeçar aquela seed do dia 1. Perder o
 * progresso é ruim; ficar preso numa tela da qual não se sai é pior.
 */
async function carregarCampanha(slot: {
  id: string;
  seedLabel: string;
  characterName: string;
}): Promise<Campaign> {
  const bruto = await server.loadState(slot.id);
  if (bruto) {
    try {
      return Campaign.fromJson(bruto as CampaignJson);
    } catch {
      // Cai para a criação abaixo.
    }
  }
  return Campaign.create({
    id: slot.id,
    seedLabel: slot.seedLabel,
    characterName: slot.characterName,
  });
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
  async onStart(slotId, seedLabel, mode, characterName) {
    const campanha = Campaign.create({ id: slotId, seedLabel, characterName });
    // Grava antes de entrar: se a aba fechar durante o carregamento da cena, o
    // jogador reencontra a campanha em vez de um slot vazio no menu.
    await server.saveState(slotId, campanha.toJson());
    await entrar(slotId, seedLabel, mode, campanha);
  },
});
router.register(novaCampanha);

router.register(
  createMainMenu({
    server,
    router,
    async onContinue(slot) {
      await server.resumeSession(slot.id);
      const campanha = await carregarCampanha(slot);
      await entrar(slot.id, slot.seedLabel, slot.mode, campanha);
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
router.register(createDevScreen({ router }));
router.register(
  createMapScreen({
    router,
    campaign: () => campanhaAtual,
    onClose() {
      // Voltou do mapa: se há mundo montado, o lugar de volta é o jogo.
      if (campanhaAtual && montadoCom !== null) {
        hud.hidden = false;
        host.hidden = true;
        return;
      }
      void router.reset('menu');
    },
  }),
);
router.register(createWorldEditor({ server, router }));

// O mapa é aberto pelo HUD, que vive fora do roteador — o mundo 3D continua
// montado atrás dele, e voltar não recarrega nada.
window.addEventListener('ck:mapa', () => {
  hud.hidden = true;
  host.hidden = false;
  void router.reset('mapa');
});

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
      const saves = await server.listSaves();
      const slot = saves.find((s) => s.id === sessao.slotId);
      const campanha = await carregarCampanha({
        id: sessao.slotId,
        seedLabel: sessao.seedLabel,
        characterName: slot?.characterName ?? 'Anônimo',
      });
      await entrar(sessao.slotId, sessao.seedLabel, sessao.mode, campanha);
    } catch {
      // Fica no menu. O jogador vê a lista de campanhas e escolhe de novo.
    }
  }
}

void abrir();
