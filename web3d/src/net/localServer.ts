import { hashLabel } from '../core/rng';
import {
  gameModeInfo,
  type ConnectionState,
  type CreateSessionOptions,
  type GameMode,
  type GameServer,
  type SaveSlot,
  type ServerInfo,
  type SessionHandle,
  type WorldBlueprint,
} from './gameServer';

/**
 * Servidor local, guardando tudo no navegador.
 *
 * Não é um protótipo descartável — é o **modo offline** do jogo, e continua
 * valendo depois que o servidor real existir: para jogar sem rede, para testar,
 * e para o Sandbox, que não precisa de servidor nenhum.
 *
 * A lista de servidores é sintética, derivada da seed, para que o navegador de
 * servidores possa ser montado e usado antes de existir backend. Ela se
 * identifica como tal: `region` diz "local", e a interface mostra isso. Um
 * jogador precisa saber quando está olhando para algo de mentira.
 */

const STORAGE_PREFIX = 'ck.save.';
const INDEX_KEY = 'ck.saves';
const WORLDS_KEY = 'ck.worlds';

/** Armazenamento que aceita ser substituído nos testes. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Guarda em memória. Serve aos testes e ao navegador em aba privada, onde
 * `localStorage` existe mas lança ao gravar.
 */
export class MemoryStore implements KeyValueStore {
  private readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

/**
 * Devolve o `localStorage` se ele **de fato** funcionar.
 *
 * Existir não basta: em aba privada do Safari o objeto está lá e `setItem`
 * lança. Testar escrevendo de verdade é a única checagem que vale, e é o que
 * evita perder a campanha do jogador num `catch` genérico mais tarde.
 */
export function resolveStore(): KeyValueStore {
  try {
    const probe = '__ck__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return new MemoryStore();
  }
}

export class LocalGameServer implements GameServer {
  private state: ConnectionState = 'offline';

  constructor(private readonly store: KeyValueStore = resolveStore()) {}

  get connection(): ConnectionState {
    return this.state;
  }

  async listServers(mode: GameMode): Promise<readonly ServerInfo[]> {
    await tick();
    if (gameModeInfo(mode).playableOffline) return [];

    // Lista sintética e estável: os mesmos servidores em toda abertura, para
    // que a tela possa ser usada de verdade antes do backend existir.
    return SERVER_NAMES.map((name, i) => {
      const seedLabel = `${name.toLowerCase().replace(/\s+/g, '-')}-${i}`;
      const seed = hashLabel(seedLabel);
      return {
        id: `local-${i}`,
        name,
        // Assumido como local de propósito: o jogador tem de saber que está
        // olhando para algo que ainda não é servidor de verdade.
        region: 'local (simulado)',
        mode,
        seedLabel,
        players: seed % 180,
        capacity: 200,
        ping: 8 + (seed % 40),
        day: 1 + (seed % 90),
        online: true,
      };
    });
  }

  async listWorlds(): Promise<readonly WorldBlueprint[]> {
    await tick();
    return this.readWorlds().sort((a, b) => b.createdAt - a.createdAt);
  }

  async saveWorld(blueprint: WorldBlueprint): Promise<WorldBlueprint> {
    await tick();
    const outros = this.readWorlds().filter((w) => w.id !== blueprint.id);
    this.writeWorlds([...outros, blueprint]);
    return blueprint;
  }

  async deleteWorld(id: string): Promise<void> {
    await tick();
    this.writeWorlds(this.readWorlds().filter((w) => w.id !== id));
  }

  private readWorlds(): WorldBlueprint[] {
    const raw = this.store.getItem(WORLDS_KEY);
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as WorldBlueprint[]) : [];
    } catch {
      return [];
    }
  }

  private writeWorlds(worlds: WorldBlueprint[]): void {
    this.store.setItem(WORLDS_KEY, JSON.stringify(worlds));
  }

  async listSaves(): Promise<readonly SaveSlot[]> {
    await tick();
    return this.readIndex().sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async createSession(options: CreateSessionOptions): Promise<SessionHandle> {
    await tick();
    this.state = 'connected';

    const slotId = `s${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
    const slot: SaveSlot = {
      id: slotId,
      mode: options.mode,
      characterName: options.characterName,
      seedLabel: options.seedLabel,
      day: 1,
      updatedAt: Date.now(),
    };
    this.writeIndex([...this.readIndex(), slot]);

    return {
      slotId,
      mode: options.mode,
      seedLabel: options.seedLabel,
      serverId: options.serverId,
    };
  }

  async resumeSession(slotId: string): Promise<SessionHandle> {
    await tick();
    const slot = this.readIndex().find((s) => s.id === slotId);
    if (!slot) throw new Error(`save não encontrado: ${slotId}`);
    this.state = 'connected';
    return {
      slotId,
      mode: slot.mode,
      seedLabel: slot.seedLabel,
      serverId: null,
    };
  }

  async deleteSave(slotId: string): Promise<void> {
    await tick();
    this.store.removeItem(STORAGE_PREFIX + slotId);
    this.writeIndex(this.readIndex().filter((s) => s.id !== slotId));
  }

  async loadState(slotId: string): Promise<unknown | null> {
    await tick();
    const raw = this.store.getItem(STORAGE_PREFIX + slotId);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      // Save corrompido: devolve nulo em vez de lançar. O cliente trata como
      // "não existe" e oferece uma campanha nova — melhor que uma tela de erro
      // da qual não se sai.
      return null;
    }
  }

  async saveState(slotId: string, state: unknown): Promise<unknown> {
    await tick();
    this.store.setItem(STORAGE_PREFIX + slotId, JSON.stringify(state));

    // Mantém o índice em dia para a lista de saves mostrar o dia certo sem
    // precisar abrir cada arquivo.
    const day =
      typeof state === 'object' && state !== null && 'day' in state
        ? Number((state as { day: unknown }).day) || 1
        : 1;
    this.writeIndex(
      this.readIndex().map((s) =>
        s.id === slotId ? { ...s, day, updatedAt: Date.now() } : s,
      ),
    );
    // No local o servidor aceita o que veio. Num servidor de verdade, aqui
    // voltaria o estado recalculado.
    return state;
  }

  async disconnect(): Promise<void> {
    this.state = 'offline';
  }

  private readIndex(): SaveSlot[] {
    const raw = this.store.getItem(INDEX_KEY);
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as SaveSlot[]) : [];
    } catch {
      return [];
    }
  }

  private writeIndex(slots: SaveSlot[]): void {
    this.store.setItem(INDEX_KEY, JSON.stringify(slots));
  }
}

/**
 * Um salto de microtarefa.
 *
 * Todo método é assíncrono mesmo no modo local, de propósito: uma chamada que
 * hoje devolve na hora e amanhã leva 200 ms de rede quebraria cada tela que a
 * tratasse como síncrona.
 */
const tick = (): Promise<void> => Promise.resolve();

const SERVER_NAMES = [
  'Krom Central',
  'Aurora Sul',
  'Setor Vermelho',
  'Baía Morta',
  'Distrito 9',
];
