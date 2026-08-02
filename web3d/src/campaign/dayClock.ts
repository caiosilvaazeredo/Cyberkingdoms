/**
 * O relógio do reset diário.
 *
 * ## O que existia, e o que faltava
 *
 * O motor já sabia virar o dia: `runPlotTick` desconta a obra, cobra
 * manutenção e produz. O que nunca existiu, nem no cliente Flutter, foi **o
 * gatilho** — `day` era um inteiro que alguém incrementava. O GDD diz que o
 * mundo reseta a cada 24 h, mas isso não estava em lugar nenhum do código, e
 * sem isso o jogador não tinha como saber que uma obra de três dias tem prazo,
 * nem quando ele vence.
 *
 * Este relógio é esse gatilho. Ele guarda um instante de âncora e deriva tudo
 * do relógio de parede: quantos dias já passaram, quanto falta para o próximo.
 *
 * ## Por que derivar em vez de contar
 *
 * Um contador que soma um a cada 24 h só funciona com o jogo aberto. Fechar a
 * aba na quinta e voltar no sábado tem de valer dois dias — é o que "reset
 * diário" significa —, e derivar da âncora entrega isso de graça, inclusive
 * depois de o aparelho dormir, de o navegador congelar a aba, ou de o jogador
 * ter jogado em outro dispositivo.
 *
 * ## Por que também existe "encerrar o dia"
 *
 * Esperar 24 h para ver um galpão ficar pronto não é ritmo de jogo, é castigo.
 * Encerrar o dia à mão é mecânica de sobrevivência conhecida — dormir —, e faz
 * a âncora andar de um período inteiro, o que mantém a conta derivada íntegra:
 * não é um contador paralelo, é a mesma linha do tempo empurrada.
 */

/** Duração de um dia de jogo, em milissegundos. */
export const DAY_MS = 24 * 60 * 60 * 1000;

export interface DayClockJson {
  /** Instante em que o dia 1 começou. */
  anchor: number;
  /** Dias já encerrados à mão, somados à conta derivada. */
  skipped: number;
}

export class DayClock {
  constructor(
    private anchor: number,
    private skipped = 0,
    private readonly period = DAY_MS,
  ) {}

  static start(now = Date.now(), period = DAY_MS): DayClock {
    return new DayClock(now, 0, period);
  }

  static fromJson(json: DayClockJson, period = DAY_MS): DayClock {
    // Âncora inválida vira "agora". Um `NaN` aqui contaminaria o dia, o
    // contador e o prazo de toda obra — e a tela mostraria "dia NaN" sem dar
    // ao jogador nenhuma saída.
    const anchor = Number.isFinite(json.anchor) ? json.anchor : Date.now();
    const skipped = Number.isFinite(json.skipped) ? Math.max(0, json.skipped) : 0;
    return new DayClock(anchor, skipped, period);
  }

  toJson(): DayClockJson {
    return { anchor: this.anchor, skipped: this.skipped };
  }

  /** Dia atual, começando em 1. */
  day(now = Date.now()): number {
    return 1 + this.elapsedDays(now) + this.skipped;
  }

  private elapsedDays(now: number): number {
    return Math.max(0, Math.floor((now - this.anchor) / this.period));
  }

  /** Milissegundos até o próximo reset. */
  remaining(now = Date.now()): number {
    const decorrido = (now - this.anchor) % this.period;
    // Âncora no futuro (relógio do sistema andou para trás) daria resto
    // negativo e um prazo maior que um dia inteiro. O módulo positivo fecha
    // esse caso sem precisar confiar no relógio do aparelho.
    const dentro = ((decorrido % this.period) + this.period) % this.period;
    return this.period - dentro;
  }

  /**
   * Quantos dias viraram desde a última consulta.
   *
   * O laço de render chama isto todo quadro; devolver o número de viradas — e
   * não um booleano — é o que faz a aba que ficou dormindo dois dias aplicar
   * dois ticks, em vez de um só.
   */
  consumeElapsed(lastSeenDay: number, now = Date.now()): number {
    return Math.max(0, this.day(now) - lastSeenDay);
  }

  /** Empurra a linha do tempo um dia para a frente. */
  endDay(): void {
    this.skipped++;
  }
}

/** `03:12:40` — a partir de milissegundos. */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const dois = (n: number): string => String(n).padStart(2, '0');
  return `${dois(h)}:${dois(m)}:${dois(s)}`;
}

/** `3 dias`, `1 dia`, `pronto`. */
export function formatDays(days: number): string {
  if (days <= 0) return 'pronto';
  return days === 1 ? '1 dia' : `${days} dias`;
}
