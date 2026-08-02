import { gameModeInfo, type GameMode, type GameServer } from '../net/gameServer';
import { el, type Screen, type ScreenRouter } from './screens';

/**
 * Nova campanha: nome, seed e modo.
 *
 * Nome e seed vêm **sorteados e preenchidos**. Campo vazio é um pedágio: o
 * jogador que só quer jogar tem de inventar dois nomes antes de ver o mundo, e
 * o que se importa continua podendo trocar.
 */
export interface NewCampaignDeps {
  readonly server: GameServer;
  readonly router: ScreenRouter;
  readonly onStart: (slotId: string, seedLabel: string, mode: GameMode) => Promise<void>;
}

const NOMES = ['Kaia Vex', 'Rui Halden', 'Nina Corvo', 'Dax Orrin', 'Sol Amaru'];
const PALAVRAS = ['neon', 'aurora', 'krom', 'ferro', 'vapor', 'cinza', 'brasa'];

const sorteia = <T>(lista: readonly T[]): T =>
  lista[Math.floor(Math.random() * lista.length)]!;

export function seedSorteada(): string {
  return `${sorteia(PALAVRAS)}-${sorteia(PALAVRAS)}-${Math.floor(Math.random() * 900) + 100}`;
}

export function createNewCampaign(deps: NewCampaignDeps): Screen {
  const nome = el('input', {
    attrs: { id: 'campo-nome', spellcheck: 'false', autocomplete: 'off', maxlength: '24' },
  });
  const seed = el('input', {
    attrs: { id: 'campo-seed', spellcheck: 'false', autocomplete: 'off', maxlength: '32' },
  });

  let modo: GameMode = 'campaign';
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

  const root = el('section', {
    className: 'tela folha',
    attrs: { 'aria-label': 'Nova campanha' },
    children: [
      el('h1', { text: 'NOVA CAMPANHA' }),
      el('label', { text: 'Nome do personagem', attrs: { for: 'campo-nome' } }),
      nome,
      el('label', { text: 'Seed do mundo', attrs: { for: 'campo-seed' } }),
      seed,
      el('p', {
        className: 'nota',
        text: 'A mesma seed gera sempre o mesmo mundo — dá para compartilhar.',
      }),
      el('h2', { text: 'Modo' }),
      botoesModo,
      erro,
      gerar,
      voltar,
    ],
  });

  gerar.addEventListener('click', () => {
    const personagem = nome.value.trim();
    const semente = seed.value.trim();
    if (!personagem || !semente) {
      erro.textContent = 'Preencha o nome e a seed.';
      return;
    }
    erro.textContent = '';
    gerar.disabled = true;
    void (async () => {
      try {
        const sessao = await deps.server.createSession({
          mode: modo,
          seedLabel: semente,
          characterName: personagem,
          serverId: null,
        });
        await deps.onStart(sessao.slotId, semente, modo);
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
    onEnter() {
      nome.value = sorteia(NOMES);
      seed.value = seedSorteada();
      erro.textContent = '';
    },
  };
}
