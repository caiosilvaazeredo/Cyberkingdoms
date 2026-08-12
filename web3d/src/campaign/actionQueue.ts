import { HOUR_MS } from '../rules/eb';

/**
 * A fila de ações — o relógio do jogo depois da Rev 4.1.
 *
 * ## O que ela substitui
 *
 * A Rev 3.0 girava em torno do **reset da meia-noite**: o jogador escolhia o
 * que faria "hoje", apertava para virar o dia, e o mundo liquidava tudo de uma
 * vez. Era um jogo de turnos com fantasia de tempo real.
 *
 * A Rev 4.1 diz outra coisa, e diz de forma explícita: uma hora real é uma hora
 * de mundo, o tempo não para offline, e cada cidadão enfileira até dez
 * ocupações futuras. Trabalhar custa duas horas de relógio; dormir custa oito.
 * Não existe mais "virar o dia" — existe o que já terminou e o que ainda está
 * em andamento.
 *
 * ## Por que a fila é feita de instantes, e não de contadores
 *
 * A tentação é guardar "faltam 43 minutos" e descontar a cada quadro. Isso
 * quebra das três formas: com a aba fechada ninguém desconta, com a aba oculta
 * o navegador estrangula o temporizador, e com o relógio do sistema mexido o
 * contador anda ao contrário.
 *
 * Guardando **quando começou** e **quanto dura**, o estado é uma função pura do
 * relógio: reabrir a aba três dias depois liquida os três dias na hora, e é o
 * mesmo cálculo que roda no servidor quando ele existir. `advanceTo(agora)` é
 * a única porta de entrada — chame com o relógio real, ou com um valor de
 * teste, e o resultado é o mesmo.
 *
 * ## O que a fila garante
 *
 * **Exclusividade.** Uma ocupação por vez. É o que dá peso à escolha: aceitar
 * uma jornada de duas horas é abrir mão de outra coisa nessas duas horas.
 *
 * **Liquidação única.** Cada ação conclui exatamente uma vez, mesmo que
 * `advanceTo` seja chamado dez vezes no mesmo milissegundo, mesmo que o save
 * seja recarregado no meio. É a invariante que o GDD repete em quase todo
 * capítulo — "liquidar resultado uma única vez" — porque é ela que impede pagar
 * o mesmo salário duas vezes.
 *
 * **Sem cancelamento do que já começou.** O topo em execução não volta atrás:
 * cancelar depois de ver o resultado seria escolher o resultado.
 */

/** Teto de ocupações futuras por cidadão — Rev 4.1, §06. */
export const MAX_FILA = 10;

export type ActionKind =
  | 'publicWork'
  | 'sleep'
  | 'study'
  | 'travel'
  | 'produce'
  | 'rest'
  /** Jornada de um contrato aceito. Ver `economy/contractBoard`. */
  | 'contract';

export interface QueuedActionJson {
  id: string;
  kind: ActionKind;
  label: string;
  durationMs: number;
  /** Instante em que virou topo. `null` enquanto espera na fila. */
  startedAt: number | null;
  /** Dados da ação: id do trabalho, destino da viagem, receita. */
  payload?: Record<string, unknown>;
}

export interface ActionQueueJson {
  items: QueuedActionJson[];
  /** Até quando a fila já foi liquidada. Impede pagar duas vezes. */
  settledUpTo: number;
}

export interface CompletedAction {
  readonly action: QueuedActionJson;
  /** Instante em que terminou — pode ser bem no passado, se ficou offline. */
  readonly finishedAt: number;
}

export interface QueueProgress {
  /** A ação em execução, se alguma. */
  readonly current: QueuedActionJson | null;
  /** Fração concluída da atual, de 0 a 1. */
  readonly progress: number;
  /** Quanto falta da atual, em milissegundos. */
  readonly remainingMs: number;
  /** As que ainda não começaram, na ordem. */
  readonly pending: readonly QueuedActionJson[];
}

let contador = 0;

export function novaAcao(options: {
  kind: ActionKind;
  label: string;
  hours: number;
  payload?: Record<string, unknown>;
}): QueuedActionJson {
  contador += 1;
  return {
    id: `act_${Date.now().toString(36)}_${contador}`,
    kind: options.kind,
    label: options.label,
    durationMs: Math.max(1, Math.round(options.hours * HOUR_MS)),
    startedAt: null,
    payload: options.payload,
  };
}

export class ActionQueue {
  private readonly itens: QueuedActionJson[];
  /**
   * Marca d'água da liquidação.
   *
   * Guardada junto da fila, e não deduzida do relógio: sem ela, um save
   * recarregado não teria como distinguir "esta ação terminou e já foi paga" de
   * "esta ação terminou agora", e toda recarga pagaria de novo.
   */
  private liquidadoAte: number;

  constructor(itens: readonly QueuedActionJson[] = [], liquidadoAte = 0) {
    this.itens = itens.map((i) => ({ ...i }));
    this.liquidadoAte = liquidadoAte;
  }

  get length(): number {
    return this.itens.length;
  }

  get isFull(): boolean {
    return this.itens.length >= MAX_FILA;
  }

  get items(): readonly QueuedActionJson[] {
    return this.itens;
  }

  /**
   * Enfileira. Devolve `false` quando a fila está cheia.
   *
   * O limite é do GDD e não é decorativo: sem teto, o jogador programa um mês
   * de trabalho num clique e o jogo deixa de pedir decisão — vira uma planilha
   * que roda sozinha.
   */
  enqueue(action: QueuedActionJson, now: number): boolean {
    if (this.isFull) return false;
    // A primeira da fila já começa: deixar o cidadão parado esperando um tique
    // faria a ação custar mais tempo do que a duração dela.
    if (this.itens.length === 0) action.startedAt = Math.max(now, this.liquidadoAte);
    this.itens.push(action);
    return true;
  }

  /**
   * Tira uma ação **que ainda não começou**.
   *
   * O topo em execução não sai: o GDD é explícito em "ações em execução não são
   * canceláveis pelo usuário", e a razão é simples — quem cancela depois de ver
   * o dado rolando está escolhendo o resultado.
   */
  cancel(id: string): boolean {
    const i = this.itens.findIndex((a) => a.id === id);
    if (i <= 0) return false;
    this.itens.splice(i, 1);
    return true;
  }

  /**
   * Liquida tudo que terminou até `now` e devolve o que concluiu, em ordem.
   *
   * Idempotente por construção: uma ação só conclui quando o fim dela é maior
   * que `liquidadoAte`, e `liquidadoAte` avança junto. Chamar duas vezes com o
   * mesmo relógio devolve lista vazia na segunda.
   */
  advanceTo(now: number): CompletedAction[] {
    const concluidas: CompletedAction[] = [];

    for (;;) {
      const topo = this.itens[0];
      if (!topo) break;
      if (topo.startedAt === null) topo.startedAt = Math.max(now, this.liquidadoAte);

      const fim = topo.startedAt + topo.durationMs;
      if (fim > now) break;

      this.itens.shift();
      this.liquidadoAte = Math.max(this.liquidadoAte, fim);
      concluidas.push({ action: topo, finishedAt: fim });

      // A próxima começa **quando a anterior terminou**, e não agora: uma fila
      // montada de véspera precisa render as oito horas que se passaram, senão
      // ficar offline seria perder tempo de mundo.
      const proxima = this.itens[0];
      if (proxima) proxima.startedAt = fim;
    }

    if (now > this.liquidadoAte) this.liquidadoAte = now;
    return concluidas;
  }

  /** Estado para a interface, sem alterar nada. */
  progress(now: number): QueueProgress {
    const topo = this.itens[0] ?? null;
    if (!topo) {
      return { current: null, progress: 0, remainingMs: 0, pending: [] };
    }
    const inicio = topo.startedAt ?? now;
    const decorrido = Math.max(0, now - inicio);
    const progresso = Math.min(1, decorrido / topo.durationMs);
    return {
      current: topo,
      progress: progresso,
      remainingMs: Math.max(0, topo.durationMs - decorrido),
      pending: this.itens.slice(1),
    };
  }

  toJson(): ActionQueueJson {
    return {
      items: this.itens.map((i) => ({ ...i })),
      settledUpTo: this.liquidadoAte,
    };
  }

  static fromJson(json: ActionQueueJson | undefined | null): ActionQueue {
    if (!json) return new ActionQueue();
    const itens = (json.items ?? []).filter(
      (i): i is QueuedActionJson =>
        typeof i?.id === 'string' && Number.isFinite(i?.durationMs),
    );
    return new ActionQueue(itens, Number(json.settledUpTo) || 0);
  }
}

/** "1 h 30" — o formato curto que cabe no HUD de um celular. */
export function formatarDuracao(ms: number): string {
  const total = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${String(m).padStart(2, '0')}`;
}
