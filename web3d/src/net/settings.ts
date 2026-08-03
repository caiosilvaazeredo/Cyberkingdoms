import type { DeviceTier } from '../render/quality';
import { resolveStore, type KeyValueStore } from './localServer';

/**
 * Preferências do jogador.
 *
 * ## Por que só cinco
 *
 * Cada ajuste aqui está ligado a alguma coisa que o jogo de fato faz. Um menu
 * de configurações cheio de chaves decorativas é pior que um menu curto: o
 * jogador mexe, não vê diferença, e passa a desconfiar de todas as outras.
 * Quando houver áudio portado e mais de um idioma, entram aqui — não antes.
 *
 * ## Por que não existe "OK" nem "Cancelar"
 *
 * Cada mudança vale na hora e é gravada na hora. Num celular o jogador sai da
 * tela pelo botão físico de voltar, que não passa por botão nenhum de
 * confirmação — um formulário com "salvar" perderia a alteração exatamente no
 * caminho mais usado.
 *
 * ## Por que tudo é validado ao ler
 *
 * `localStorage` é do usuário: dá para editar à mão, e um save de outra versão
 * pode ter campos que não existem mais. Uma velocidade de câmera que virou
 * `NaN` congela o jogo numa tela que não explica nada. Ler é sempre sanear.
 */

export type QualityChoice = 'auto' | DeviceTier;

export interface GameSettings {
  /** `auto` deixa o medidor de quadros decidir; o resto trava a classe. */
  readonly quality: QualityChoice;
  /** Arrastar move a câmera em vez de arrastar o chão sob o dedo. */
  readonly invertDrag: boolean;
  /** Multiplicador do arrasto e do teclado. */
  readonly cameraSpeed: number;
  /** Vento na grama. Desligar economiza GPU e ajuda quem enjoa com movimento. */
  readonly wind: boolean;
  /** Mostra bioma, lâminas e classe do aparelho no painel. */
  readonly showStats: boolean;
  /**
   * Modo Dev: todas as construções liberadas, sem exigência de nível.
   *
   * Fica nas configurações e não escondido atrás de um atalho porque o objetivo
   * é montar e testar conteúdo, não trapacear em silêncio — e o HUD anuncia
   * quando está ligado.
   */
  readonly devMode: boolean;
}

export const defaultSettings: GameSettings = {
  quality: 'auto',
  invertDrag: false,
  cameraSpeed: 1,
  wind: true,
  showStats: true,
  devMode: false,
};

export const SPEED_RANGE = { min: 0.5, max: 2 } as const;

const QUALITY_CHOICES: readonly QualityChoice[] = [
  'auto',
  'baixo',
  'medio',
  'alto',
];

export const qualityLabels: Record<QualityChoice, string> = {
  auto: 'Automático',
  baixo: 'Baixo',
  medio: 'Médio',
  alto: 'Alto',
};

/**
 * Devolve configurações utilizáveis a partir de qualquer coisa.
 *
 * Campo inválido cai para o padrão em vez de derrubar a tela: perder a
 * preferência de velocidade é irritante, não abrir o jogo é fatal.
 */
export function sanitizeSettings(raw: unknown): GameSettings {
  if (typeof raw !== 'object' || raw === null) return defaultSettings;
  const obj = raw as Record<string, unknown>;

  const quality = QUALITY_CHOICES.includes(obj.quality as QualityChoice)
    ? (obj.quality as QualityChoice)
    : defaultSettings.quality;

  // `Number()` de `null` é 0, e 0 travaria a câmera — daí o teste explícito de
  // tipo antes de qualquer conversão.
  const rawSpeed = obj.cameraSpeed;
  const cameraSpeed =
    typeof rawSpeed === 'number' && Number.isFinite(rawSpeed)
      ? Math.min(SPEED_RANGE.max, Math.max(SPEED_RANGE.min, rawSpeed))
      : defaultSettings.cameraSpeed;

  const bool = (v: unknown, fallback: boolean): boolean =>
    typeof v === 'boolean' ? v : fallback;

  return {
    quality,
    cameraSpeed,
    invertDrag: bool(obj.invertDrag, defaultSettings.invertDrag),
    wind: bool(obj.wind, defaultSettings.wind),
    showStats: bool(obj.showStats, defaultSettings.showStats),
    devMode: bool(obj.devMode, defaultSettings.devMode),
  };
}

const SETTINGS_KEY = 'ck.settings';

export type SettingsListener = (settings: GameSettings) => void;

export class SettingsStore {
  private value: GameSettings;
  private readonly listeners = new Set<SettingsListener>();

  constructor(private readonly store: KeyValueStore = resolveStore()) {
    const raw = this.store.getItem(SETTINGS_KEY);
    let parsed: unknown = null;
    try {
      parsed = raw === null ? null : JSON.parse(raw);
    } catch {
      parsed = null;
    }
    this.value = sanitizeSettings(parsed);
  }

  get current(): GameSettings {
    return this.value;
  }

  /** Aplica um pedaço, grava e avisa. Devolve o resultado já saneado. */
  update(patch: Partial<GameSettings>): GameSettings {
    const next = sanitizeSettings({ ...this.value, ...patch });
    this.value = next;
    this.store.setItem(SETTINGS_KEY, JSON.stringify(next));
    for (const fn of this.listeners) fn(next);
    return next;
  }

  reset(): GameSettings {
    return this.update(defaultSettings);
  }

  /**
   * Escuta mudanças. Devolve o cancelamento.
   *
   * O mundo 3D fica montado enquanto o jogador vai ao menu e volta, então uma
   * mudança feita nas configurações precisa alcançar uma cena que já existe —
   * ler as preferências só na montagem faria o ajuste só valer na próxima
   * abertura do jogo.
   */
  subscribe(fn: SettingsListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

/**
 * A instância que o jogo usa.
 *
 * Preguiçosa de propósito: `resolveStore()` escreve no `localStorage` para
 * testar se ele funciona, e fazer isso no carregamento do módulo cobraria esse
 * custo até de quem só importou o tipo.
 */
let compartilhada: SettingsStore | null = null;

export function settings(): SettingsStore {
  compartilhada ??= new SettingsStore();
  return compartilhada;
}
