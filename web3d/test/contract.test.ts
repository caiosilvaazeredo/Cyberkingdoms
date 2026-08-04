import { describe, expect, it } from 'vitest';

import {
  BONUS_MAXIMO,
  MULTA_MAXIMA,
  aceitar,
  cancelar,
  entregar,
  publicar,
  romper,
  type ContractJson,
  type Parte,
} from '../src/economy/contract';
import { autorizar, relatorio, tetoRestante } from '../src/politics/budget';
import { COFRE, HOUR_MS } from '../src/rules/eb';

/**
 * Contratos e cofre — Rev 4.1 §23/§26 e EB 1.1 §22/§26.
 *
 * O que estes testes defendem é uma invariante contábil: escrow não cria nem
 * destrói moeda. Toda operação aqui move dinheiro entre bolsos conhecidos, e a
 * soma antes é a soma depois — é isso que o EB chama de "diferença entre oferta
 * calculada e razão = 0", e é a única forma de a economia ser auditável.
 */

const parte = (id: string, credits: number): Parte => ({
  id,
  credits,
  held: 0,
  credibility: 0,
});

const semCertificado = new Set<string>();

function vaga(employer: Parte, extras: Partial<Parameters<typeof publicar>[0]> = {}) {
  const r = publicar({
    id: 'ct1',
    settlementId: 'cap_0',
    employer,
    employerName: 'Oficina',
    title: 'Operador de linha',
    work: 'hardware',
    payment: 16,
    durationHours: 2,
    now: 0,
    ...extras,
  });
  if (!r.ok) throw new Error(r.reason);
  return r.contract;
}

/** A soma de tudo que existe. Precisa ser igual antes e depois. */
const massa = (...partes: Parte[]): number =>
  partes.reduce((soma, p) => soma + p.credits, 0);

describe('Contrato de trabalho', () => {
  it('publicar não retém nada', () => {
    // Publicar é anunciar intenção. Travar caixa de toda vaga anunciada
    // congelaria o dinheiro de quem está só procurando gente.
    const patrao = parte('e', 100);
    const c = vaga(patrao);
    expect(c.state).toBe('open');
    expect(patrao.held).toBe(0);
  });

  it('o aceite reserva 100% e o dinheiro deixa de ser gastável', () => {
    // "Pagamento é reservado"; "Reserva 100% no aceite". Sem isso, aceitar um
    // contrato é aceitar uma promessa: o empregador gasta em outro lugar e o
    // trabalhador descobre no fim que não há com que pagar.
    const patrao = parte('e', 100);
    const obreiro = parte('w', 5);
    const c = vaga(patrao, { bonusRate: 0.1 });

    const r = aceitar({
      contract: c,
      employer: patrao,
      worker: obreiro,
      workerCertificates: semCertificado,
      now: 0,
    });
    expect(r.ok).toBe(true);
    expect(patrao.held).toBe(18);
    expect(patrao.credits).toBe(100);
    if (r.ok) {
      expect(r.contract.state).toBe('accepted');
      expect(r.contract.deadlineAt).toBe(2 * HOUR_MS);
    }
  });

  it('o mesmo Cz não garante dois contratos', () => {
    // O disponível é o saldo menos o retido. Sem descontar, um empregador com
    // 20 Cz aceitaria dez contratos de 20.
    const patrao = parte('e', 20);
    const a = parte('a', 0);
    const b = parte('b', 0);
    const c1 = vaga(patrao);
    const c2 = vaga(patrao, { id: 'ct2' });

    expect(
      aceitar({ contract: c1, employer: patrao, worker: a, workerCertificates: semCertificado, now: 0 }).ok,
    ).toBe(true);
    const segundo = aceitar({
      contract: c2, employer: patrao, worker: b, workerCertificates: semCertificado, now: 0,
    });
    expect(segundo.ok).toBe(false);
  });

  it('ninguém contrata a si mesmo', () => {
    // Moveria dinheiro do bolso para o mesmo bolso e serviria só para forjar
    // histórico de credibilidade.
    const p = parte('e', 100);
    const c = vaga(p);
    const r = aceitar({ contract: c, employer: p, worker: p, workerCertificates: semCertificado, now: 0 });
    expect(r.ok).toBe(false);
  });

  it('vaga com requisito recusa quem não tem o certificado', () => {
    const patrao = parte('e', 100);
    const obreiro = parte('w', 0);
    const c = vaga(patrao, { requiresCertificate: 'industrial' });

    expect(
      aceitar({ contract: c, employer: patrao, worker: obreiro, workerCertificates: semCertificado, now: 0 }).ok,
    ).toBe(false);
    expect(
      aceitar({
        contract: c, employer: patrao, worker: obreiro,
        workerCertificates: new Set(['industrial']), now: 0,
      }).ok,
    ).toBe(true);
  });

  it('a entrega no prazo paga com bônus e libera o retido', () => {
    const patrao = parte('e', 100);
    const obreiro = parte('w', 0);
    const antes = massa(patrao, obreiro);
    const c = aceitarOk(vaga(patrao, { bonusRate: 0.2 }), patrao, obreiro);

    const r = entregar({ contract: c, employer: patrao, worker: obreiro, now: HOUR_MS });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.bonus).toBe(3);
    expect(r.pago).toBe(19);
    expect(obreiro.credits).toBe(19);
    expect(patrao.credits).toBe(81);
    // Nada preso depois de pagar, e nada criado nem destruído no caminho.
    expect(patrao.held).toBe(0);
    expect(massa(patrao, obreiro)).toBe(antes);
    expect(obreiro.credibility).toBe(1);
  });

  it('entrega atrasada paga sem bônus, e o retido volta inteiro', () => {
    // Pagar bônus a quem entregou atrasado tiraria o sentido do prazo; deixar o
    // bônus congelado para sempre seria pior ainda.
    const patrao = parte('e', 100);
    const obreiro = parte('w', 0);
    const c = aceitarOk(vaga(patrao, { bonusRate: 0.2 }), patrao, obreiro);

    const r = entregar({ contract: c, employer: patrao, worker: obreiro, now: 99 * HOUR_MS });
    expect(r.ok && r.bonus).toBe(0);
    expect(r.ok && r.pago).toBe(16);
    expect(patrao.held).toBe(0);
    expect(patrao.credits).toBe(84);
  });

  it('quem quebra paga a multa, limitada a 25%', () => {
    const patrao = parte('e', 100);
    const obreiro = parte('w', 50);
    const antes = massa(patrao, obreiro);
    const c = aceitarOk(vaga(patrao, { penaltyRate: 0.9 }), patrao, obreiro);
    // A publicação já corta no teto: cláusula impossível vira armadilha.
    expect(c.penaltyRate).toBe(MULTA_MAXIMA);

    const r = romper({ contract: c, employer: patrao, worker: obreiro, culpado: 'worker' });
    expect(r.ok && r.multa).toBe(4);
    expect(obreiro.credits).toBe(46);
    expect(patrao.credits).toBe(104);
    expect(patrao.held).toBe(0);
    expect(massa(patrao, obreiro)).toBe(antes);
    expect(obreiro.credibility).toBe(-2);
  });

  it('a multa nunca deixa saldo negativo', () => {
    // "Saldo negativo: nunca permitido" — nem por dívida contratual.
    const patrao = parte('e', 100);
    const obreiro = parte('w', 1);
    const c = aceitarOk(vaga(patrao, { payment: 80, penaltyRate: 0.25 }), patrao, obreiro);
    const r = romper({ contract: c, employer: patrao, worker: obreiro, culpado: 'worker' });
    expect(r.ok && r.multa).toBe(1);
    expect(obreiro.credits).toBe(0);
  });

  it('quando o contratante quebra, a multa sai do bolso dele', () => {
    const patrao = parte('e', 100);
    const obreiro = parte('w', 0);
    const c = aceitarOk(vaga(patrao, { penaltyRate: 0.25 }), patrao, obreiro);
    romper({ contract: c, employer: patrao, worker: obreiro, culpado: 'employer' });
    expect(obreiro.credits).toBe(4);
    expect(patrao.credits).toBe(96);
    expect(patrao.credibility).toBe(-2);
  });

  it('bônus e multa ficam dentro das faixas do EB', () => {
    const patrao = parte('e', 1000);
    const c = vaga(patrao, { bonusRate: 5, penaltyRate: 5 });
    expect(c.bonusRate).toBe(BONUS_MAXIMO);
    expect(c.penaltyRate).toBe(MULTA_MAXIMA);
  });

  it('só vaga aberta pode ser retirada, e o que já rodou não volta', () => {
    const patrao = parte('e', 100);
    const obreiro = parte('w', 0);
    const aberta = vaga(patrao);
    expect(cancelar(aberta).ok).toBe(true);

    const aceita = aceitarOk(vaga(patrao, { id: 'ct9' }), patrao, obreiro);
    expect(cancelar(aceita).ok).toBe(false);
    expect(entregar({ contract: { ...aceita, state: 'paid' }, employer: patrao, worker: obreiro, now: 0 }).ok).toBe(false);
  });

  function aceitarOk(c: ContractJson, employer: Parte, worker: Parte): ContractJson {
    const r = aceitar({ contract: c, employer, worker, workerCertificates: semCertificado, now: 0 });
    if (!r.ok) throw new Error(r.reason);
    return r.contract;
  }
});

describe('Orçamento do cofre', () => {
  const ciclo = (over: Partial<Parameters<typeof autorizar>[0]> = {}) => ({
    saldo: 1000,
    arrecadado: 400,
    gasto: {},
    ...over,
  });

  it('a reserva operacional segura 20% do caixa', () => {
    // Sem ela, um governador gasta o caixa inteiro em obra no primeiro dia e
    // deixa a folha sem cobertura — e quem paga é quem trabalhou.
    const r = autorizar(ciclo(), 'compras', 900);
    expect(r.ok).toBe(false);
    expect(autorizar(ciclo(), 'compras', 800).ok).toBe(true);
    expect(COFRE.reservaOperacional).toBe(0.2);
  });

  it('a folha passa antes da reserva', () => {
    // Pagar quem trabalhou não é escolha de governo, é obrigação assumida.
    expect(autorizar(ciclo(), 'folha', 1000).ok).toBe(true);
    expect(autorizar(ciclo(), 'folha', 1001).ok).toBe(false);
  });

  it('obras e subsídios têm teto por ciclo, e ele é sobre o acumulado', () => {
    // Limitar ato a ato seria trivial de burlar com dez atos pequenos.
    expect(tetoRestante(ciclo(), 'obras')).toBe(200);
    expect(tetoRestante(ciclo({ gasto: { obras: 150 } }), 'obras')).toBe(50);
    expect(autorizar(ciclo({ gasto: { obras: 150 } }), 'obras', 80).ok).toBe(false);
    expect(autorizar(ciclo({ gasto: { obras: 150 } }), 'obras', 50).ok).toBe(true);
    expect(tetoRestante(ciclo(), 'subsidios')).toBe(80);
  });

  it('o cofre nunca fica negativo', () => {
    expect(autorizar(ciclo({ saldo: 0 }), 'folha', 1).ok).toBe(false);
    expect(autorizar(ciclo({ saldo: 10 }), 'obras', 10).ok).toBe(false);
  });

  it('a recusa explica o motivo', () => {
    // Um "não" sem razão é indistinguível de defeito, e o jogador não tem como
    // corrigir a proposta.
    const r = autorizar(ciclo(), 'obras', 900);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.length).toBeGreaterThan(10);
  });

  it('o relatório responde por quantos ciclos a cidade paga o que prometeu', () => {
    // Saldo sozinho não diz nada: cofre grande com gasto maior ainda quebra.
    const r = relatorio(ciclo({ gasto: { obras: 100, folha: 150 } }));
    expect(r.gasto).toBe(250);
    expect(r.autonomiaEmCiclos).toBe(4);
    expect(r.linhas[0]!.categoria).toBe('folha');
    expect(r.reserva).toBe(200);
    expect(relatorio(ciclo()).autonomiaEmCiclos).toBe(Number.POSITIVE_INFINITY);
  });
});
