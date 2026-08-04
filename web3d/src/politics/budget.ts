import { COFRE, cz } from '../rules/eb';

/**
 * Orçamento do cofre público — EB 1.1, §26.
 *
 * ## O que o cofre é, e o que ele não é
 *
 * "Cofre transforma atividade em serviço público." Ele entra por taxas e pela
 * contribuição de 10% do trabalho, e **não** por emissão: o governo não fabrica
 * moeda, redistribui a que já circula. Por isso todo gasto aqui é limitado pelo
 * saldo, e não por uma decisão política — um governador não pode gastar o que a
 * cidade não arrecadou.
 *
 * ## Por que os tetos existem
 *
 * Reserva operacional de 20%, obras até 50% do ciclo, subsídios até 20%. Sem os
 * tetos, um governador consegue gastar o caixa inteiro em obra no primeiro dia
 * de mandato e deixar a folha de pagamento sem cobertura — e quem paga a conta
 * é o cidadão que trabalhou esperando salário, não quem decidiu.
 *
 * O teto é por **ciclo**, não por ato: é a soma do que já foi gasto na categoria
 * que conta. Limitar ato a ato seria trivial de burlar com dez atos pequenos.
 */

export type CategoriaGasto = 'obras' | 'subsidios' | 'folha' | 'compras';

export interface CicloOrcamentario {
  /** Saldo do cofre agora. */
  readonly saldo: number;
  /** Arrecadação do ciclo — a base sobre a qual os tetos incidem. */
  readonly arrecadado: number;
  /** O que já saiu por categoria neste ciclo. */
  readonly gasto: Partial<Record<CategoriaGasto, number>>;
}

export type Autorizacao =
  | { readonly ok: true; readonly valor: number }
  | { readonly ok: false; readonly reason: string };

/** Quanto ainda cabe numa categoria neste ciclo. */
export function tetoRestante(ciclo: CicloOrcamentario, categoria: CategoriaGasto): number {
  const limite =
    categoria === 'obras'
      ? COFRE.obras
      : categoria === 'subsidios'
        ? COFRE.subsidios
        : 1;
  const teto = cz(ciclo.arrecadado * limite);
  return Math.max(0, teto - (ciclo.gasto[categoria] ?? 0));
}

/**
 * Autoriza uma despesa, ou explica por que não.
 *
 * Devolve o motivo em vez de simplesmente recusar porque o EB manda publicar o
 * impacto esperado de toda mudança: um "não" sem razão é indistinguível de um
 * defeito, e o jogador não tem como corrigir a proposta.
 */
export function autorizar(
  ciclo: CicloOrcamentario,
  categoria: CategoriaGasto,
  valor: number,
): Autorizacao {
  const pedido = cz(valor);
  if (pedido <= 0) return { ok: false, reason: 'Valor inválido.' };

  // A folha vem antes da reserva: pagar quem trabalhou não é escolha de
  // governo, é obrigação assumida. Obra e subsídio é que competem pela sobra.
  const reserva = categoria === 'folha' ? 0 : cz(ciclo.saldo * COFRE.reservaOperacional);
  const disponivel = ciclo.saldo - reserva;

  if (pedido > disponivel) {
    return {
      ok: false,
      reason:
        reserva > 0
          ? `Passa do disponível: ${disponivel} Cz livres, com ${reserva} Cz de reserva operacional.`
          : `O cofre só tem ${Math.max(0, ciclo.saldo)} Cz.`,
    };
  }

  const restante = tetoRestante(ciclo, categoria);
  if (categoria === 'obras' || categoria === 'subsidios') {
    if (pedido > restante) {
      return {
        ok: false,
        reason: `Teto do ciclo para ${categoria}: cabem ${restante} Cz.`,
      };
    }
  }

  return { ok: true, valor: pedido };
}

export interface RelatorioPublico {
  readonly saldo: number;
  readonly arrecadado: number;
  readonly gasto: number;
  readonly reserva: number;
  readonly linhas: readonly { readonly categoria: CategoriaGasto; readonly valor: number }[];
  /** Quantos ciclos o cofre sustenta no ritmo atual. */
  readonly autonomiaEmCiclos: number;
}

/**
 * O relatório que o EB exige que seja público — diário ou semanal.
 *
 * A autonomia entra porque é a única linha que responde à pergunta que
 * importa: "por quanto tempo esta cidade paga o que prometeu?". Saldo sozinho
 * não diz nada — cofre grande com gasto maior ainda quebra.
 */
export function relatorio(ciclo: CicloOrcamentario): RelatorioPublico {
  const linhas = (Object.entries(ciclo.gasto) as [CategoriaGasto, number][])
    .filter(([, v]) => v > 0)
    .map(([categoria, valor]) => ({ categoria, valor }))
    .sort((a, b) => b.valor - a.valor);
  const gasto = linhas.reduce((soma, l) => soma + l.valor, 0);

  return {
    saldo: ciclo.saldo,
    arrecadado: ciclo.arrecadado,
    gasto,
    reserva: cz(ciclo.saldo * COFRE.reservaOperacional),
    linhas,
    autonomiaEmCiclos: gasto > 0 ? Math.floor(ciclo.saldo / gasto) : Number.POSITIVE_INFINITY,
  };
}
