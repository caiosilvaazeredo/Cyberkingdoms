import { HOUR_MS, cz } from '../rules/eb';

/**
 * Contratos de trabalho com pagamento reservado — Rev 4.1, §23, e EB 1.1, §22.
 *
 * ## Por que o pagamento fica preso
 *
 * "Pagamento é reservado"; "Escrow não cria moeda". As duas frases juntas
 * definem o mecanismo: no aceite, o valor sai do saldo disponível do
 * contratante e fica retido — não é destruído nem duplicado, só deixa de poder
 * ser gasto em outra coisa. Sem isso, aceitar um contrato é aceitar uma
 * promessa: o empregador gasta o dinheiro em outro lugar e o trabalhador
 * descobre no fim da jornada que não há com que pagar.
 *
 * O retido é o que transforma "vaga publicada" em obrigação. É também o que
 * torna a multa exequível: ela sai de dinheiro que já está separado.
 *
 * ## Por que os termos congelam no aceite
 *
 * "Aceitar cria vínculo com termos imutáveis." Um contrato cujo pagamento pode
 * ser editado depois do aceite não é contrato, é sugestão — e a parte com mais
 * poder sempre edita a favor dela. Por isso `accept` copia os termos para
 * dentro do vínculo e nada mais os altera.
 *
 * ## Por que a quebra tem teto
 *
 * A multa é limitada a 25% dos termos. Sem teto, uma cláusula desenhada para
 * ser impossível transformaria o mercado de trabalho numa armadilha, e o EB é
 * explícito em que consequência precisa ser proporcional.
 */

export type ContractState =
  | 'open'
  | 'accepted'
  | 'delivered'
  | 'paid'
  | 'broken'
  | 'cancelled';

/** Teto de multa por quebra, sobre o valor do contrato. */
export const MULTA_MAXIMA = 0.25;
/** Teto de bônus por entrega. */
export const BONUS_MAXIMO = 0.2;

export interface ContractJson {
  id: string;
  settlementId: string;
  employerId: string;
  employerName: string;
  workerId: string | null;
  title: string;
  /** Id do trabalho que a vaga executa. */
  work: string;
  payment: number;
  durationHours: number;
  bonusRate: number;
  penaltyRate: number;
  state: ContractState;
  createdAt: number;
  acceptedAt: number | null;
  /** Prazo final para entregar, contado do aceite. */
  deadlineAt: number | null;
  /** Certificado exigido, se algum. */
  requiresCertificate: string | null;
}

export type ContractResult<T> =
  | ({ readonly ok: true } & T)
  | { readonly ok: false; readonly reason: string };

/**
 * O lado que **executa** o contrato.
 *
 * Não tem retido: só quem paga precisa separar dinheiro. Estreitar o tipo aqui
 * é o que permite ao personagem do jogador ser trabalhador sem carregar um
 * campo que, do lado dele, seria sempre zero — e um campo sempre zero é um
 * convite a alguém, um dia, tentar usá-lo.
 */
export interface Trabalhador {
  readonly id: string;
  credits: number;
  credibility: number;
}

/** O lado que **paga**: precisa reservar, então tem retido. */
export interface Parte extends Trabalhador {
  /** O que está retido em contratos aceitos. Nunca gastável. */
  held: number;
}

export function publicar(options: {
  id: string;
  settlementId: string;
  employer: Parte;
  employerName: string;
  title: string;
  work: string;
  payment: number;
  durationHours: number;
  bonusRate?: number;
  penaltyRate?: number;
  requiresCertificate?: string | null;
  now: number;
}): ContractResult<{ contract: ContractJson }> {
  const payment = cz(options.payment);
  if (payment <= 0) return { ok: false, reason: 'Pagamento precisa ser maior que zero.' };
  if (options.durationHours <= 0) {
    return { ok: false, reason: 'Duração inválida.' };
  }

  return {
    ok: true,
    contract: {
      id: options.id,
      settlementId: options.settlementId,
      employerId: options.employer.id,
      employerName: options.employerName,
      workerId: null,
      title: options.title,
      work: options.work,
      payment,
      durationHours: options.durationHours,
      // Fora da faixa, corta no teto em vez de recusar: o EB dá faixas, e uma
      // vaga recusada por 1% a mais de bônus não protege ninguém.
      bonusRate: Math.max(0, Math.min(BONUS_MAXIMO, options.bonusRate ?? 0)),
      penaltyRate: Math.max(0, Math.min(MULTA_MAXIMA, options.penaltyRate ?? 0)),
      state: 'open',
      createdAt: options.now,
      acceptedAt: null,
      deadlineAt: null,
      requiresCertificate: options.requiresCertificate ?? null,
    },
  };
}

/**
 * Aceita a vaga e retém o pagamento.
 *
 * A retenção acontece **aqui**, e não na publicação: publicar é anunciar
 * intenção, e travar caixa de toda vaga anunciada congelaria o dinheiro de
 * quem está só procurando gente. No aceite existe uma contraparte, e é a partir
 * dela que a obrigação é real.
 */
export function aceitar(options: {
  contract: ContractJson;
  employer: Parte;
  worker: Trabalhador;
  workerCertificates: ReadonlySet<string>;
  now: number;
}): ContractResult<{ contract: ContractJson }> {
  const { contract, employer, worker, now } = options;

  if (contract.state !== 'open') return { ok: false, reason: 'Vaga não está aberta.' };
  // "Partes precisam ser distintas e autorizadas": contratar a si mesmo move
  // dinheiro do bolso para o mesmo bolso e serviria só para forjar histórico
  // de credibilidade.
  if (employer.id === worker.id) {
    return { ok: false, reason: 'Não dá para contratar a si mesmo.' };
  }
  if (
    contract.requiresCertificate &&
    !options.workerCertificates.has(contract.requiresCertificate)
  ) {
    return { ok: false, reason: `Exige o certificado ${contract.requiresCertificate}.` };
  }

  // Reserva de 100% no aceite. O disponível é o saldo menos o que já está
  // retido — senão o mesmo Cz garantiria dois contratos.
  const disponivel = employer.credits - employer.held;
  const maximo = cz(contract.payment * (1 + contract.bonusRate));
  if (disponivel < maximo) {
    return {
      ok: false,
      reason: `O contratante não tem ${maximo} Cz livres para reservar.`,
    };
  }
  employer.held += maximo;

  return {
    ok: true,
    contract: {
      ...contract,
      workerId: worker.id,
      state: 'accepted',
      acceptedAt: now,
      deadlineAt: now + contract.durationHours * HOUR_MS,
    },
  };
}

export interface Liquidacao {
  readonly contract: ContractJson;
  /** O que o trabalhador recebeu. */
  readonly pago: number;
  /** Bônus aplicado, já incluído em `pago`. */
  readonly bonus: number;
}

/**
 * Entrega aprovada: libera o retido e paga.
 *
 * O bônus só entra quando a entrega chega **antes** do prazo — é o que o EB
 * chama de "bônus entrega, 0 a 20%, opcional". Pagar bônus a quem entregou
 * atrasado tiraria o sentido do prazo.
 */
export function entregar(options: {
  contract: ContractJson;
  employer: Parte;
  worker: Trabalhador;
  now: number;
}): ContractResult<Liquidacao> {
  const { contract, employer, worker, now } = options;
  if (contract.state !== 'accepted') {
    return { ok: false, reason: 'Contrato não está em execução.' };
  }

  const noPrazo = contract.deadlineAt === null || now <= contract.deadlineAt;
  const bonus = noPrazo ? cz(contract.payment * contract.bonusRate) : 0;
  const pago = contract.payment + bonus;
  const reservado = cz(contract.payment * (1 + contract.bonusRate));

  // O retido sai inteiro; o que não virou pagamento volta a ser gastável. Sem
  // esta devolução, um bônus não pago ficaria congelado para sempre.
  employer.held -= reservado;
  employer.credits -= pago;
  worker.credits += pago;
  worker.credibility += 1;

  return {
    ok: true,
    contract: { ...contract, state: 'paid' },
    pago,
    bonus,
  };
}

export interface Quebra {
  readonly contract: ContractJson;
  /** Multa efetivamente transferida. */
  readonly multa: number;
  /** Quanto de credibilidade quem quebrou perdeu. */
  readonly credibilidade: number;
}

/**
 * Rescinde o contrato e aplica a consequência.
 *
 * Quem quebra paga: se foi o trabalhador, a multa sai do bolso dele para o
 * contratante; se foi o contratante, sai do retido para o trabalhador. Nos dois
 * casos o resto do retido volta a ser gastável, porque escrow não destrói
 * dinheiro.
 */
export function romper(options: {
  contract: ContractJson;
  employer: Parte;
  worker: Trabalhador;
  culpado: 'employer' | 'worker';
}): ContractResult<Quebra> {
  const { contract, employer, worker, culpado } = options;
  if (contract.state !== 'accepted') {
    return { ok: false, reason: 'Só contrato em execução pode ser rompido.' };
  }

  const reservado = cz(contract.payment * (1 + contract.bonusRate));
  const multaCheia = cz(contract.payment * contract.penaltyRate);
  employer.held -= reservado;

  let multa = 0;
  if (culpado === 'worker') {
    // Nunca cobra mais do que o trabalhador tem: dívida negativa violaria
    // "saldo negativo nunca permitido".
    multa = Math.min(multaCheia, worker.credits);
    worker.credits -= multa;
    employer.credits += multa;
    worker.credibility -= 2;
  } else {
    multa = Math.min(multaCheia, employer.credits);
    employer.credits -= multa;
    worker.credits += multa;
    employer.credibility -= 2;
  }

  return {
    ok: true,
    contract: { ...contract, state: 'broken' },
    multa,
    credibilidade: -2,
  };
}

/** Retira uma vaga que ninguém aceitou. Nada foi retido, nada a devolver. */
export function cancelar(contract: ContractJson): ContractResult<{ contract: ContractJson }> {
  if (contract.state !== 'open') {
    return { ok: false, reason: 'Só vaga aberta pode ser retirada.' };
  }
  return { ok: true, contract: { ...contract, state: 'cancelled' } };
}
