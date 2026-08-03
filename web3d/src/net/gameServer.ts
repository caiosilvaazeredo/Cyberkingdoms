/**
 * A fronteira entre o cliente e o servidor.
 *
 * ## Por que esta interface existe antes de qualquer servidor
 *
 * O jogo é um MMO: o estado que vale é o do servidor, não o da tela. Se o
 * cliente for escrito contra uma implementação concreta — Firestore, WebSocket,
 * o que for —, as chamadas de rede vazam para dentro das telas e trocar de
 * backend vira cirurgia. Escrever a fronteira primeiro custa um arquivo e
 * economiza a refatoração inteira.
 *
 * Por enquanto só existe a implementação local (`LocalGameServer`), que roda no
 * navegador e persiste em `localStorage`. Ela não é um protótipo descartável:
 * é o **modo offline** do jogo, e continua útil depois que o servidor real
 * existir — para jogar sem rede, para testar, e para o Sandbox, que não precisa
 * de servidor nenhum.
 *
 * ## A regra que a interface impõe
 *
 * Tudo é assíncrono, **inclusive no modo local**. Uma chamada que hoje devolve
 * na hora e amanhã leva 200 ms de rede quebraria cada tela que a trata como
 * síncrona. Fazer doer desde o começo é mais barato que descobrir depois.
 */

export type GameMode = 'campaign' | 'persistent' | 'sandbox';

export interface GameModeInfo {
  readonly id: GameMode;
  readonly label: string;
  readonly summary: string;
  /** `false` quando o modo depende de um servidor compartilhado. */
  readonly playableOffline: boolean;
  /** Sobrevivência, custo e reset diário valem neste modo. */
  readonly survivalEnabled: boolean;
}

export const gameModes: readonly GameModeInfo[] = [
  {
    id: 'campaign',
    label: 'Campanha',
    summary:
      'Mundo procedural a partir de uma seed. 17 missões, reset a cada 24 h, ' +
      'economia e política simuladas. Joga sozinho, no seu ritmo.',
    playableOffline: true,
    survivalEnabled: true,
  },
  {
    id: 'persistent',
    label: 'Mundo Persistente',
    summary:
      'Todos no mesmo mundo. A economia é dos jogadores, o governo é eleito, ' +
      'e o dia vira para todo mundo ao mesmo tempo.',
    playableOffline: false,
    survivalEnabled: true,
  },
  {
    id: 'sandbox',
    label: 'Sandbox',
    summary:
      'Sem fome, sem sede, sem custo. Constrói o vilarejo que quiser e ' +
      'planta grama onde bem entender.',
    playableOffline: true,
    survivalEnabled: false,
  },
];

export function gameModeInfo(id: GameMode): GameModeInfo {
  const found = gameModes.find((m) => m.id === id);
  if (!found) throw new Error(`modo desconhecido: "${id}"`);
  return found;
}

/** Um servidor visível no navegador de servidores. */
export interface ServerInfo {
  readonly id: string;
  readonly name: string;
  readonly region: string;
  readonly mode: GameMode;
  /** Seed do mundo. Dois servidores com a mesma seed têm o mesmo mapa. */
  readonly seedLabel: string;
  readonly players: number;
  readonly capacity: number;
  /** Latência em ms, ou `null` enquanto não medida. */
  readonly ping: number | null;
  /** Dia do servidor. O reset de 24 h avança este número. */
  readonly day: number;
  readonly online: boolean;
}

/**
 * Um mundo montado à mão, pronto para virar mundo de servidor.
 *
 * É exatamente o que um servidor precisa publicar: um nome, uma seed e o
 * layout — as cidades, as vocações e as estradas. O terreno não entra porque é
 * função pura da seed, então dois clientes com a mesma planta veem o mesmo
 * mapa sem trocar um byte de tile.
 *
 * Hoje o `LocalGameServer` guarda no navegador. Quando o servidor existir, esta
 * mesma estrutura é o corpo do `GET /worlds` — a tela do editor e a de seleção
 * de mundo não mudam.
 */
export interface WorldBlueprint {
  readonly id: string;
  readonly name: string;
  readonly seedLabel: string;
  /** `WorldLayoutJson`, mantido opaco aqui para a fronteira não depender do domínio. */
  readonly layout: unknown;
  readonly createdAt: number;
  /** Quantas cidades a planta tem. Evita desserializar só para listar. */
  readonly settlementCount: number;
}

export interface SaveSlot {
  readonly id: string;
  readonly mode: GameMode;
  readonly characterName: string;
  readonly seedLabel: string;
  readonly day: number;
  readonly updatedAt: number;
}

export interface CreateSessionOptions {
  readonly mode: GameMode;
  readonly seedLabel: string;
  readonly characterName: string;
  /** Servidor escolhido. `null` nos modos offline. */
  readonly serverId: string | null;
}

export interface SessionHandle {
  readonly slotId: string;
  readonly mode: GameMode;
  readonly seedLabel: string;
  readonly serverId: string | null;
}

export type ConnectionState =
  | 'offline'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'failed';

/**
 * O que o cliente pode pedir ao servidor.
 *
 * Deliberadamente pequena. Cada método que entra aqui é um método que a
 * implementação real vai ter de honrar com autoridade — validando, e não
 * confiando no cliente. Uma interface que reflete a UI vira um servidor que
 * obedece à UI, e num jogo com dinheiro em disputa isso é o mesmo que não ter
 * servidor.
 */
export interface GameServer {
  readonly connection: ConnectionState;

  /** Servidores disponíveis para um modo. Vazio nos modos offline. */
  listServers(mode: GameMode): Promise<readonly ServerInfo[]>;

  /** Mundos montados à mão, mais recente primeiro. */
  listWorlds(): Promise<readonly WorldBlueprint[]>;

  /** Grava ou substitui um mundo. Devolve o que ficou gravado. */
  saveWorld(blueprint: WorldBlueprint): Promise<WorldBlueprint>;

  deleteWorld(id: string): Promise<void>;

  /** Saves do jogador, mais recente primeiro. */
  listSaves(): Promise<readonly SaveSlot[]>;

  createSession(options: CreateSessionOptions): Promise<SessionHandle>;

  resumeSession(slotId: string): Promise<SessionHandle>;

  deleteSave(slotId: string): Promise<void>;

  /** Estado bruto da campanha, para o cliente reidratar. */
  loadState(slotId: string): Promise<unknown | null>;

  /**
   * Envia o estado.
   *
   * No modo local grava direto. Num servidor de verdade isto vira uma
   * *proposta*: o servidor recalcula o dia com o mesmo motor determinístico e
   * aceita ou recusa. É por isso que o método devolve o estado aceito em vez
   * de `void` — o cliente tem de estar preparado para receber de volta algo
   * diferente do que mandou.
   */
  saveState(slotId: string, state: unknown): Promise<unknown>;

  disconnect(): Promise<void>;
}
