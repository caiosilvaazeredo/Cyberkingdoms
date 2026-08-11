import {
  gameModeInfo,
  type GameMode,
  type GameServer,
  type ServerInfo,
} from '../net/gameServer';
import { el, type Screen, type ScreenRouter } from './screens';

/**
 * Nova campanha: nome, seed e modo.
 *
 * Nome e seed vêm **sorteados e preenchidos**. Campo vazio é um pedágio: o
 * jogador que só quer jogar tem de inventar dois nomes antes de ver o mundo, e
 * o que se importa continua podendo trocar.
 *
 * ## Duas portas para a mesma tela
 *
 * Dá para chegar aqui direto do menu — e aí o modo é escolhido aqui mesmo,
 * entre os que rodam sem servidor — ou pela tela de modos, e aí ele já vem
 * decidido. A tela mostra o que foi decidido em vez de reabrir a decisão:
 * oferecer de novo uma escolha que o jogador acabou de fazer parece que a
 * primeira não valeu.
 *
 * ## Por que a seed trava no mundo persistente
 *
 * A seed é o mapa. Num servidor compartilhado o mapa é do servidor: deixar o
 * campo editável prometeria um mundo que o jogador não vai receber.
 */
export interface NewCampaignDeps {
  readonly server: GameServer;
  readonly router: ScreenRouter;
  readonly onStart: (
    slotId: string,
    seedLabel: string,
    mode: GameMode,
    characterName: string,
  ) => Promise<void>;
}

export interface NewCampaignScreen extends Screen {
  /**
   * Prepara a tela para um modo, e opcionalmente para um servidor.
   * Chame antes de empilhar. `null` devolve a escolha ao jogador.
   */
  preselect(mode: GameMode | null, server?: ServerInfo | null): void;
}

const NOMES = ['Kaia Vex', 'Rui Halden', 'Nina Corvo', 'Dax Orrin', 'Sol Amaru'];
const PALAVRAS = ['corvo', 'aurora', 'carvalho', 'ferro', 'bruma', 'cinza', 'brasa'];

const sorteia = <T>(lista: readonly T[]): T =>
  lista[Math.floor(Math.random() * lista.length)]!;

export function seedSorteada(): string {
  return `${sorteia(PALAVRAS)}-${sorteia(PALAVRAS)}-${Math.floor(Math.random() * 900) + 100}`;
}

export function createNewCampaign(deps: NewCampaignDeps): NewCampaignScreen {
  const nome = el('input', {
    attrs: { id: 'campo-nome', spellcheck: 'false', autocomplete: 'off', maxlength: '24' },
  });
  const seed = el('input', {
    attrs: { id: 'campo-seed', spellcheck: 'false', autocomplete: 'off', maxlength: '32' },
  });

  /** Modo vindo da tela de modos. `null` = o jogador escolhe aqui. */
  let imposto: GameMode | null = null;
  let servidor: ServerInfo | null = null;
  let modo: GameMode = 'campaign';

  // O que já foi decidido antes de chegar aqui. Escondido quando não há nada.
  const contexto = el('div', { className: 'contexto' });

  const botoesModo = el('div', { className: 'escolhas' });
  for (const info of [gameModeInfo('campaign'), gameModeInfo('sandbox')]) {
    const b = el('button', {
      className: 'escolha',
      attrs: { type: 'button', 'aria-pressed': String(info.id === modo) },
      children: [
        el('strong', { text: info.label }),
        el('span', { text: info.summary }),
      ],
    });
    b.addEventListener('click', () => {
      modo = info.id;
      for (const outro of Array.from(botoesModo.querySelectorAll("button"))) {
        outro.setAttribute('aria-pressed', String(outro === b));
      }
    });
    botoesModo.appendChild(b);
  }
  const tituloModo = el('h2', { text: 'Modo' });

  const gerar = el('button', {
    className: 'principal',
    text: 'GERAR MUNDO',
    attrs: { type: 'button' },
  });
  const voltar = el('button', {
    className: 'secundario',
    text: 'VOLTAR',
    attrs: { type: 'button' },
  });
  const erro = el('p', { className: 'erro' });
  const notaSeed = el('p', { className: 'nota' });

  const root = el('section', {
    className: 'tela folha',
    attrs: { 'aria-label': 'Nova campanha' },
    children: [
      el('h1', { text: 'NOVA CAMPANHA' }),
      contexto,
      el('label', { text: 'Nome do personagem', attrs: { for: 'campo-nome' } }),
      nome,
      el('label', { text: 'Seed do mundo', attrs: { for: 'campo-seed' } }),
      seed,
      notaSeed,
      tituloModo,
      botoesModo,
      erro,
      gerar,
      voltar,
    ],
  });

  function preparar(): void {
    const info = gameModeInfo(imposto ?? modo);

    // Modo já decidido: os botões somem e a tela mostra o que foi escolhido.
    const decidido = imposto !== null;
    tituloModo.hidden = decidido;
    botoesModo.hidden = decidido;

    contexto.textContent = '';
    contexto.hidden = !decidido;
    if (decidido) {
      contexto.appendChild(el('strong', { text: info.label }));
      contexto.appendChild(el('span', { text: info.summary }));
      if (servidor) {
        contexto.appendChild(
          el('span', {
            className: 'servidor-escolhido',
            text: `Servidor: ${servidor.name} · ${servidor.region}`,
          }),
        );
      }
    }

    if (servidor) {
      seed.value = servidor.seedLabel;
      seed.readOnly = true;
      notaSeed.textContent =
        'A seed é do servidor: o mapa é o mesmo para todo mundo que entra nele.';
    } else {
      seed.readOnly = false;
      seed.value = seedSorteada();
      notaSeed.textContent =
        'A mesma seed gera sempre o mesmo mundo — dá para compartilhar.';
    }
  }

  gerar.addEventListener('click', () => {
    const personagem = nome.value.trim();
    const semente = seed.value.trim();
    if (!personagem || !semente) {
      erro.textContent = 'Preencha o nome e a seed.';
      return;
    }
    erro.textContent = '';
    gerar.disabled = true;
    const escolhido = imposto ?? modo;
    void (async () => {
      try {
        const sessao = await deps.server.createSession({
          mode: escolhido,
          seedLabel: semente,
          characterName: personagem,
          serverId: servidor?.id ?? null,
        });
        await deps.onStart(sessao.slotId, semente, escolhido, personagem);
      } catch (e) {
        erro.textContent = `Não foi possível criar: ${(e as Error).message}`;
      } finally {
        gerar.disabled = false;
      }
    })();
  });

  voltar.addEventListener('click', () => void deps.router.pop());

  return {
    id: 'nova',
    root,
    preselect(mode, srv = null) {
      imposto = mode;
      servidor = srv;
      if (mode) modo = mode;
    },
    onEnter() {
      nome.value = sorteia(NOMES);
      erro.textContent = '';
      preparar();
    },
  };
}
