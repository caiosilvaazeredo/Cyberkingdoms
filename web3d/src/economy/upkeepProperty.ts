import { PROPRIEDADE, cz } from '../rules/eb';

/**
 * Manutenção de propriedade — EB 1.1, §16, e Rev 4.1, §18.
 *
 * ## Por que uma propriedade precisa custar para existir
 *
 * Sem manutenção, comprar é uma decisão de uma vez só: a fazenda produz para
 * sempre, o patrimônio só cresce, e quem chegou primeiro acumula sem limite.
 * O EB chama isso de "crescimento sem custo" e coloca a manutenção como o
 * sumidouro que segura a curva — 2% do valor por semana no nível 1, 3% no 2,
 * 4% no 3, porque instalação maior custa mais para manter de pé.
 *
 * ## Por que atrasar não destrói
 *
 * "Nunca destrói instantaneamente sem aviso." Quem passou uma semana sem entrar
 * não pode voltar e encontrar a oficina demolida — num jogo de tempo real, isso
 * pune ausência, não má administração. O atraso corta 10% da eficiência por
 * ciclo, acumulando até um piso: a propriedade fica ruim, não some, e voltar a
 * pagar recupera.
 */

/** Piso de eficiência. Abaixo disso a propriedade seria abandono, não atraso. */
export const EFICIENCIA_MINIMA = 0.4;

/** Custo semanal de manter uma propriedade deste valor e nível. */
export function custoSemanal(valor: number, nivel: number): number {
  const taxa =
    PROPRIEDADE.manutencao[Math.max(0, Math.min(PROPRIEDADE.manutencao.length - 1, nivel - 1))]!;
  return cz(valor * taxa);
}

/** Eficiência depois de `ciclos` semanas sem pagar. */
export function eficienciaApos(ciclosAtrasados: number): number {
  const perda = Math.max(0, ciclosAtrasados) * PROPRIEDADE.penalidadeAtraso;
  return Math.max(EFICIENCIA_MINIMA, 1 - perda);
}

export interface CobrancaResultado {
  /** Quanto saiu do bolso. */
  readonly pago: number;
  /** Quanto ficou devendo — vira ciclo atrasado. */
  readonly devido: number;
  readonly eficiencia: number;
}

/**
 * Cobra a manutenção da semana com o saldo disponível.
 *
 * Paga o que dá e registra o resto como atraso, em vez de recusar tudo: um
 * pagamento parcial recusado deixaria o jogador com dinheiro no bolso e a
 * propriedade em atraso total, que é o pior dos dois mundos.
 */
export function cobrarManutencao(options: {
  valor: number;
  nivel: number;
  saldo: number;
  ciclosAtrasados: number;
}): CobrancaResultado {
  const devidoTotal = custoSemanal(options.valor, options.nivel);
  const pago = Math.min(devidoTotal, Math.max(0, options.saldo));
  const devido = devidoTotal - pago;
  const ciclos = devido > 0 ? options.ciclosAtrasados + 1 : 0;
  return { pago, devido, eficiencia: eficienciaApos(ciclos) };
}

export type CategoriaPropriedade = 'farm' | 'industrial';

/**
 * Se cabe mais uma propriedade desta categoria.
 *
 * "Até 2 fazendas e 1 instalação industrial por jogador na visão completa." O
 * limite existe para que escala venha de contratar gente, e não de empilhar
 * instalações — é o que mantém o mercado de trabalho relevante.
 */
export function cabeMaisUma(
  categoria: CategoriaPropriedade,
  jaTem: number,
): boolean {
  const teto =
    categoria === 'farm'
      ? PROPRIEDADE.limite.fazendas
      : PROPRIEDADE.limite.industriais;
  return jaTem < teto;
}
