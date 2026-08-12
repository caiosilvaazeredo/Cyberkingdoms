import { describe, expect, it } from 'vitest';

import { Campaign } from '../src/campaign/campaign';
import type { ContractJson } from '../src/economy/contract';
import { QuadroDeContratos } from '../src/economy/contractBoard';

/**
 * O que estes testes protegem.
 *
 * `contract.ts` já garante o escrow em si; o que entra aqui é a **coleção**: se
 * a vaga que a cidade oferece é a mesma depois de fechar a aba, se o dinheiro
 * do contratante sai e volta pelo caminho certo, e se um contrato resolvido não
 * reaparece no quadro. Um erro aqui multiplica dinheiro sem que nenhuma
 * asserção de `contract.ts` acuse.
 */

function nova(): Campaign {
  return Campaign.create({ id: 'q', seedLabel: 'vagas', characterName: 'A', now: 0 });
}

describe('quadro de vagas', () => {
  it('a mesma cidade no mesmo dia oferece o mesmo quadro', () => {
    const c = nova();
    const cidade = c.world.layout.byId(c.character.homeSettlementId)!;
    const a = c.contracts.abertasEm(cidade, c.seed, 1, 0);
    const b = c.contracts.abertasEm(cidade, c.seed, 1, 0);
    expect(a.map((x) => x.id)).toEqual(b.map((x) => x.id));
    expect(a.map((x) => x.payment)).toEqual(b.map((x) => x.payment));
    expect(a.length).toBeGreaterThan(0);
  });

  it('o dia seguinte traz outro quadro', () => {
    const c = nova();
    const cidade = c.world.layout.byId(c.character.homeSettlementId)!;
    const hoje = c.contracts.abertasEm(cidade, c.seed, 1, 0);
    const amanha = c.contracts.abertasEm(cidade, c.seed, 2, 0);
    expect(hoje.map((x) => x.id)).not.toEqual(amanha.map((x) => x.id));
  });

  it('a vaga paga mais que a jornada pública equivalente', () => {
    // Se pagasse igual, ninguém trocaria a vaga garantida do serviço público
    // por uma com prazo, multa e patrão.
    const c = nova();
    const cidade = c.world.layout.byId(c.character.homeSettlementId)!;
    for (const vaga of c.contracts.abertasEm(cidade, c.seed, 1, 0)) {
      expect(vaga.payment).toBeGreaterThan(10 * vaga.durationHours);
    }
  });

  it('aceitar reserva no caixa do contratante, e entregar paga', () => {
    const c = nova();
    const cidade = c.world.layout.byId(c.character.homeSettlementId)!;
    const vaga = c.contracts.abertasEm(cidade, c.seed, 1, 0)[0]!;
    const casa = c.contracts.contratanteDe(vaga)!;
    const caixaAntes = casa.credits;
    const bolsoAntes = c.character.credits;

    const aceito = c.contracts.aceitar({
      contract: vaga,
      worker: c.character,
      workerCertificates: c.character.certificates,
      now: 0,
    });
    expect(aceito.ok).toBe(true);
    // Reservar não gasta: o dinheiro sai do disponível, não do saldo.
    expect(casa.credits).toBe(caixaAntes);
    expect(casa.held).toBeGreaterThanOrEqual(vaga.payment);

    if (!aceito.ok) return;
    const pago = c.contracts.entregar({
      contract: aceito.contract,
      worker: c.character,
      now: 1,
    });
    expect(pago.ok).toBe(true);
    if (!pago.ok) return;

    // Dinheiro conservado: o que saiu de um entrou no outro, e o retido zerou.
    expect(casa.held).toBe(0);
    expect(caixaAntes - casa.credits).toBe(pago.pago);
    expect(c.character.credits - bolsoAntes).toBe(pago.pago);
    expect(c.character.credibility).toBe(1);
  });

  it('vaga aceita sai do quadro e não volta', () => {
    const c = nova();
    const cidade = c.world.layout.byId(c.character.homeSettlementId)!;
    const vaga = c.contracts.abertasEm(cidade, c.seed, 1, 0)[0]!;
    c.contracts.aceitar({
      contract: vaga,
      worker: c.character,
      workerCertificates: c.character.certificates,
      now: 0,
    });
    const depois = c.contracts.abertasEm(cidade, c.seed, 1, 0);
    expect(depois.map((v) => v.id)).not.toContain(vaga.id);
  });

  it('recusa um segundo contrato enquanto o primeiro roda', () => {
    const c = nova();
    const cidade = c.world.layout.byId(c.character.homeSettlementId)!;
    const vagas = c.contracts.abertasEm(cidade, c.seed, 1, 0);
    c.contracts.aceitar({
      contract: vagas[0]!,
      worker: c.character,
      workerCertificates: c.character.certificates,
      now: 0,
    });
    const segundo = c.contracts.aceitar({
      contract: vagas[1]!,
      worker: c.character,
      workerCertificates: c.character.certificates,
      now: 0,
    });
    expect(segundo.ok).toBe(false);
    if (!segundo.ok) expect(segundo.reason).toContain('já tem um contrato');
  });

  it('romper devolve o retido e cobra a multa do trabalhador', () => {
    const c = nova();
    c.character.credits = 5000;
    const cidade = c.world.layout.byId(c.character.homeSettlementId)!;
    // Multa é opcional na maioria das vagas, então procura por dia em vez de
    // fixar um: prender o teste ao quadro de um dia o quebra a cada ajuste no
    // sorteio, sem que nada de verdade tenha mudado.
    let vaga: ContractJson | undefined;
    for (let dia = 1; dia <= 20 && !vaga; dia++) {
      vaga = c.contracts.abertasEm(cidade, c.seed, dia, 0).find((v) => v.penaltyRate > 0);
    }
    expect(vaga, 'nenhuma vaga com multa em vinte dias').toBeDefined();
    if (!vaga) return;
    const casa = c.contracts.contratanteDe(vaga)!;
    const caixaAntes = casa.credits;
    const bolsoAntes = c.character.credits;

    const aceito = c.contracts.aceitar({
      contract: vaga,
      worker: c.character,
      workerCertificates: c.character.certificates,
      now: 0,
    });
    if (!aceito.ok) throw new Error('não aceitou');

    const quebra = c.contracts.romper({
      contract: aceito.contract,
      worker: c.character,
      culpado: 'worker',
    });
    expect(quebra.ok).toBe(true);
    if (!quebra.ok) return;

    expect(casa.held).toBe(0);
    expect(quebra.multa).toBeGreaterThan(0);
    expect(bolsoAntes - c.character.credits).toBe(quebra.multa);
    expect(casa.credits - caixaAntes).toBe(quebra.multa);
    expect(c.character.credibility).toBe(-2);
  });

  it('sobrevive à ida e volta pelo JSON', () => {
    const c = nova();
    const cidade = c.world.layout.byId(c.character.homeSettlementId)!;
    const vaga = c.contracts.abertasEm(cidade, c.seed, 1, 0)[0]!;
    c.contracts.aceitar({
      contract: vaga,
      worker: c.character,
      workerCertificates: c.character.certificates,
      now: 0,
    });

    const voltou = QuadroDeContratos.fromJson(c.contracts.toJson());
    expect(voltou.emExecucao(c.character.id)?.id).toBe(vaga.id);
    // O retido também precisa voltar: sem ele, recarregar o save liberaria
    // dinheiro que estava preso num contrato.
    expect(voltou.contratanteDe(vaga)?.held).toBe(
      c.contracts.contratanteDe(vaga)!.held,
    );
  });

  it('a campanha inteira guarda e recarrega o quadro', () => {
    const c = nova();
    const cidade = c.world.layout.byId(c.character.homeSettlementId)!;
    const vaga = c.contracts.abertasEm(cidade, c.seed, 1, 0)[0]!;
    c.contracts.aceitar({
      contract: vaga,
      worker: c.character,
      workerCertificates: c.character.certificates,
      now: 0,
    });
    const recarregada = Campaign.fromJson(c.toJson());
    expect(recarregada.contracts.emExecucao('player')?.title).toBe(vaga.title);
    expect(recarregada.character.credibility).toBe(c.character.credibility);
  });
});
