import { HOUR_MS, VALIDADE } from '../rules/eb';
import type { Inventory } from './inventory';
import { itemDef } from './item';

/**
 * Perecibilidade — Rev 4.1, §12, e EB 1.1, §21.
 *
 * ## Por que validade existe
 *
 * Sem ela, comida é patrimônio: quem produz um lote grande estoca para sempre,
 * o preço nunca sobe de novo e o mercado de alimento morre depois da primeira
 * safra. Validade é o que obriga giro — e é o que dá razão para existir
 * geladeira, prêmio de frescor e transporte rápido.
 *
 * ## Por que lotes, e não uma data por item
 *
 * Duas garrafas compradas com um dia de diferença vencem em dias diferentes.
 * Guardar uma validade por **tipo** obrigaria a escolher entre renovar tudo a
 * cada compra — validade infinita na prática — ou vencer tudo junto, o que
 * apagaria estoque bom. O lote é a unidade que o documento usa ("validade
 * acompanha o lote"), e é a única que não mente.
 *
 * ## Por que o vencimento é calculado, e não agendado
 *
 * Nada aqui roda num temporizador. `expire(agora)` compara instantes, então
 * uma aba fechada por dois dias vence os dois dias na volta — o mesmo princípio
 * da fila de ações, e a única forma de o tempo real 1:1 valer offline.
 */

export interface LoteJson {
  item: string;
  quantity: number;
  /** Instante em que este lote deixa de servir. */
  expiresAt: number;
}

export interface DespensaJson {
  lotes: LoteJson[];
}

/** Validade de um item, em horas. `null` para o que não estraga. */
export function validadeHoras(item: string): number | null {
  const def = itemDef(item);
  // Bebida preparada dura mais que comida; o resto — sucata, chip, arma — não
  // estraga, e inventar validade para eles só criaria trabalho de contabilidade
  // sem decisão nenhuma associada.
  if (def.category === 'drink') return VALIDADE.aguaTratada;
  if (def.category === 'food') return VALIDADE.alimento;
  return null;
}

export function ehPerecivel(item: string): boolean {
  return validadeHoras(item) !== null;
}

/**
 * A despensa: os lotes perecíveis do cidadão.
 *
 * Anda ao lado do inventário em vez de dentro dele porque a quantidade
 * continua sendo do inventário — a despensa só sabe **quando** cada parte dela
 * vence. Ao expirar, ela manda o inventário baixar, e é o inventário que segue
 * sendo a fonte da verdade sobre quanto existe.
 */
export class Despensa {
  private lotes: LoteJson[];

  constructor(lotes: readonly LoteJson[] = []) {
    this.lotes = lotes.map((l) => ({ ...l }));
  }

  get batches(): readonly LoteJson[] {
    return this.lotes;
  }

  /** Registra um lote novo. Item que não estraga é ignorado de propósito. */
  register(item: string, quantity: number, now: number, refrigerado = false): void {
    const horas = validadeHoras(item);
    if (horas === null || quantity <= 0) return;
    const fator = refrigerado ? VALIDADE.refrigeracao : 1;
    this.lotes.push({
      item,
      quantity,
      expiresAt: now + horas * fator * HOUR_MS,
    });
  }

  /** Quanto deste item ainda está dentro da validade. */
  freshOf(item: string, now: number): number {
    return this.lotes
      .filter((l) => l.item === item && l.expiresAt > now)
      .reduce((soma, l) => soma + l.quantity, 0);
  }

  /**
   * Baixa o que consumiram, do lote que vence primeiro.
   *
   * Primeiro a vencer, primeiro a sair: guardar o mais fresco e gastar o mais
   * velho é o que qualquer um faz com a própria geladeira, e é também o que
   * minimiza perda — o contrário desperdiçaria de propósito.
   */
  consume(item: string, quantity: number, now: number): void {
    let restante = quantity;
    const vivos = this.lotes
      .filter((l) => l.item === item && l.expiresAt > now)
      .sort((a, b) => a.expiresAt - b.expiresAt);
    for (const lote of vivos) {
      if (restante <= 0) break;
      const leva = Math.min(restante, lote.quantity);
      lote.quantity -= leva;
      restante -= leva;
    }
    this.lotes = this.lotes.filter((l) => l.quantity > 0);
  }

  /**
   * Vence o que passou do prazo e baixa do inventário.
   *
   * Devolve o que se perdeu, por item, para a interface poder dizer o que
   * estragou — perder comida sem aviso parece defeito, não regra.
   */
  expire(inventory: Inventory, now: number): Record<string, number> {
    const perdido: Record<string, number> = {};
    const sobreviventes: LoteJson[] = [];

    for (const lote of this.lotes) {
      if (lote.expiresAt > now) {
        sobreviventes.push(lote);
        continue;
      }
      // Nunca baixa mais do que existe: o jogador pode ter consumido ou
      // vendido o lote sem passar pela despensa, e um `remove` a mais deixaria
      // o inventário negativo.
      const disponivel = inventory.quantityOf(lote.item);
      const baixa = Math.min(lote.quantity, disponivel);
      if (baixa > 0) {
        inventory.remove(lote.item, baixa);
        perdido[lote.item] = (perdido[lote.item] ?? 0) + baixa;
      }
    }

    this.lotes = sobreviventes;
    return perdido;
  }

  toJson(): DespensaJson {
    return { lotes: this.lotes.map((l) => ({ ...l })) };
  }

  static fromJson(json: DespensaJson | undefined | null): Despensa {
    if (!json) return new Despensa();
    return new Despensa(
      (json.lotes ?? []).filter(
        (l) => typeof l?.item === 'string' && Number.isFinite(l?.expiresAt),
      ),
    );
  }
}
