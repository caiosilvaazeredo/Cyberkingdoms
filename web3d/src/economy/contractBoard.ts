import { DeterministicRandom } from '../core/rng';
import { TRABALHO_PUBLICO, cz } from '../rules/eb';
import type { Settlement } from '../world/settlement';
import {
  aceitar,
  entregar,
  publicar,
  romper,
  type ContractJson,
  type ContractResult,
  type Liquidacao,
  type Parte,
  type Trabalhador,
  type Quebra,
} from './contract';

/**
 * O quadro de vagas de uma partida.
 *
 * ## O buraco que isto fecha
 *
 * `contract.ts` implementa o escrow do EB 1.1 §22 inteiro — reserva no aceite,
 * termos congelados, multa com teto, dinheiro que nunca é criado nem destruído
 * — e não tinha onde morar. Nada guardava contrato, ninguém publicava vaga, e o
 * jogador não tinha como encontrar uma. Era regra correta e inalcançável.
 *
 * ## Por que os contratantes são do mundo, e não do jogador
 *
 * No multiplayer quem publica vaga é outro jogador, e o escrow existe
 * justamente para proteger os dois lados de alguém que some. Sozinho não há
 * contraparte, então a cidade oferece as vagas: cada capital tem oficinas que
 * precisam de mão de obra, com caixa próprio e credibilidade própria.
 *
 * Isso mantém o jogador sempre do lado do **trabalhador**, e é de propósito. O
 * dia em que ele puder contratar, o dinheiro dele passa a ficar retido, e todo
 * lugar que hoje gasta `credits` precisará passar a olhar o disponível. É uma
 * mudança de invariante, não de tela — e ela merece ser feita quando houver
 * segundo jogador para justificá-la.
 *
 * ## Por que a vaga é derivada da seed, e não sorteada e salva
 *
 * As vagas de uma cidade num dia são função de (seed, cidade, dia). O jogador
 * pode fechar a aba e voltar: o quadro é o mesmo. Só o que ele **aceitou** vira
 * estado guardado — o resto se recalcula, e o save não cresce com o mundo.
 */

/** Quantas vagas uma capital publica por dia. */
const VAGAS_POR_CAPITAL = 4;
/** Satélite tem menos oferta — é o que empurra o trabalhador para a capital. */
const VAGAS_POR_SATELITE = 2;

/**
 * O quanto uma vaga privada paga a mais que a jornada pública.
 *
 * Precisa pagar mais, senão ninguém larga o serviço público: lá a vaga é
 * garantida e o risco é conhecido. O prêmio é o que compra o incômodo de ter
 * prazo, multa e patrão.
 */
const PREMIO = { min: 1.15, max: 1.75 };

export interface ContratanteJson {
  id: string;
  name: string;
  settlementId: string;
  credits: number;
  held: number;
  credibility: number;
}

export interface QuadroJson {
  contratantes: ContratanteJson[];
  /** Só o que saiu do estado `open`. O resto é derivado. */
  contratos: ContractJson[];
}

const OFICIOS = [
  { titulo: 'Turno na forja', work: 'hardware' },
  { titulo: 'Turno no tear', work: 'textiles' },
  { titulo: 'Turno na botica', work: 'laboratory' },
  { titulo: 'Turno na cozinha', work: 'kitchen' },
  { titulo: 'Escolta de carroça', work: 'gunsmith' },
  { titulo: 'Mutirão de colheita', work: 'publicFarming' },
] as const;

const NOMES_DE_CASA = [
  'Casa Ferrolho', 'Guilda do Martelo', 'Confraria do Linho', 'Casa Corvo',
  'Irmandade da Prata', 'Casa do Junco', 'Guilda dos Carreteiros',
];

export class QuadroDeContratos {
  private readonly contratantes = new Map<string, Parte & { name: string; settlementId: string }>();
  /** Contratos que saíram de `open`: aceitos, pagos, rompidos. */
  private readonly guardados: ContractJson[] = [];

  /**
   * Contratantes de uma cidade, criados sob demanda a partir da seed.
   *
   * Os nomes são sorteados **sem reposição**, de um RNG só da cidade. Um sorteio
   * por casa colide: sete nomes tirados três vezes repetem com frequência
   * incômoda, e duas oficinas homônimas na mesma praça não parecem coincidência
   * — parecem defeito.
   */
  private casasDe(settlement: Settlement, seed: number): (Parte & { name: string })[] {
    const quantas = settlement.isCapital ? 3 : 2;
    const rng = new DeterministicRandom(seed).fork(`casas_${settlement.id}`);
    const disponiveis = [...NOMES_DE_CASA];

    const casas: (Parte & { name: string })[] = [];
    for (let i = 0; i < quantas; i++) {
      const nome = disponiveis.splice(rng.range(0, disponiveis.length - 1), 1)[0]!;
      const id = `casa_${settlement.id}_${i}`;
      let parte = this.contratantes.get(id);
      if (!parte) {
        parte = {
          id,
          name: nome,
          settlementId: settlement.id,
          // Caixa que cobre as vagas do dia com folga. Uma casa sem dinheiro
          // publica vaga que ninguém consegue aceitar — o aceite reserva 100%,
          // e a recusa apareceria só no toque.
          credits: 2000 + rng.range(0, 6) * 500,
          held: 0,
          credibility: rng.range(0, 4),
        };
        this.contratantes.set(id, parte);
      }
      casas.push(parte);
    }
    return casas;
  }

  /**
   * As vagas abertas de uma cidade hoje.
   *
   * Derivadas, e não guardadas: o mesmo dia na mesma cidade dá o mesmo quadro,
   * e o que o jogador já aceitou sai da lista porque o contrato guardado tem o
   * mesmo id.
   */
  abertasEm(settlement: Settlement, seed: number, dia: number, now: number): ContractJson[] {
    const casas = this.casasDe(settlement, seed);
    const quantas = settlement.isCapital ? VAGAS_POR_CAPITAL : VAGAS_POR_SATELITE;
    const rng = new DeterministicRandom(seed).fork(`vagas_${settlement.id}_${dia}`);

    // O sorteio escolhe onde a rodada **começa**; daí em diante as casas se
    // revezam. Sorteando o contratante de cada vaga, uma oficina leva o quadro
    // inteiro com frequência — e uma cidade onde só uma casa contrata parece
    // cidade quebrada, não cidade com sorte.
    const inicio = rng.range(0, casas.length - 1);

    const vagas: ContractJson[] = [];
    for (let i = 0; i < quantas; i++) {
      const id = `ct_${settlement.id}_${dia}_${i}`;
      // Já resolvido: aceito, pago ou rompido. Não volta para o quadro.
      if (this.guardados.some((c) => c.id === id)) continue;

      const casa = casas[(inicio + i) % casas.length]!;
      const oficio = OFICIOS[rng.range(0, OFICIOS.length - 1)]!;
      const horas = [2, 2, 4, 6][rng.range(0, 3)]!;
      const premio = rng.rangeDouble(PREMIO.min, PREMIO.max);
      const pagamento = cz((TRABALHO_PUBLICO.bruto * horas * premio) / TRABALHO_PUBLICO.duracaoHoras);

      const r = publicar({
        id,
        settlementId: settlement.id,
        employer: casa,
        employerName: casa.name,
        title: oficio.titulo,
        work: oficio.work,
        payment: pagamento,
        durationHours: horas,
        // Bônus e multa saem das faixas do EB. Vaga sem prazo apertado não
        // precisa de nenhum dos dois, e é a maioria.
        bonusRate: rng.chance(0.45) ? rng.rangeDouble(0.05, 0.2) : 0,
        penaltyRate: rng.chance(0.55) ? rng.rangeDouble(0.05, 0.25) : 0,
        now,
      });
      if (r.ok) vagas.push(r.contract);
    }
    return vagas;
  }

  /** O contrato que o trabalhador está executando agora, se houver. */
  emExecucao(workerId: string): ContractJson | null {
    return this.guardados.find((c) => c.workerId === workerId && c.state === 'accepted') ?? null;
  }

  /** Histórico do trabalhador, do mais recente para o mais antigo. */
  historico(workerId: string): readonly ContractJson[] {
    return this.guardados.filter((c) => c.workerId === workerId && c.state !== 'accepted').reverse();
  }

  contratanteDe(contract: ContractJson): (Parte & { name: string }) | null {
    return this.contratantes.get(contract.employerId) ?? null;
  }

  aceitar(options: {
    contract: ContractJson;
    worker: Trabalhador;
    workerCertificates: ReadonlySet<string>;
    now: number;
  }): ContractResult<{ contract: ContractJson }> {
    const casa = this.contratantes.get(options.contract.employerId);
    if (!casa) return { ok: false, reason: 'Contratante desconhecido.' };
    // Um trabalhador de cada vez. Aceitar dois contratos com prazos
    // sobrepostos é prometer duas jornadas para o mesmo par de horas.
    if (this.emExecucao(options.worker.id)) {
      return { ok: false, reason: 'Você já tem um contrato em execução.' };
    }

    const r = aceitar({ ...options, employer: casa });
    if (r.ok) this.guardados.push(r.contract);
    return r;
  }

  entregar(options: { contract: ContractJson; worker: Trabalhador; now: number }): ContractResult<Liquidacao> {
    const casa = this.contratantes.get(options.contract.employerId);
    if (!casa) return { ok: false, reason: 'Contratante desconhecido.' };
    const r = entregar({ ...options, employer: casa });
    if (r.ok) this.substituir(r.contract);
    return r;
  }

  romper(options: {
    contract: ContractJson;
    worker: Trabalhador;
    culpado: 'employer' | 'worker';
  }): ContractResult<Quebra> {
    const casa = this.contratantes.get(options.contract.employerId);
    if (!casa) return { ok: false, reason: 'Contratante desconhecido.' };
    const r = romper({ ...options, employer: casa });
    if (r.ok) this.substituir(r.contract);
    return r;
  }

  private substituir(contract: ContractJson): void {
    const i = this.guardados.findIndex((c) => c.id === contract.id);
    if (i >= 0) this.guardados[i] = contract;
    else this.guardados.push(contract);
  }

  toJson(): QuadroJson {
    return {
      contratantes: [...this.contratantes.values()].map((c) => ({
        id: c.id,
        name: c.name,
        settlementId: c.settlementId,
        credits: c.credits,
        held: c.held,
        credibility: c.credibility,
      })),
      contratos: this.guardados.map((c) => ({ ...c })),
    };
  }

  static fromJson(json: Partial<QuadroJson> | null | undefined): QuadroDeContratos {
    const quadro = new QuadroDeContratos();
    for (const c of json?.contratantes ?? []) {
      quadro.contratantes.set(c.id, {
        id: c.id,
        name: c.name,
        settlementId: c.settlementId,
        credits: Number(c.credits) || 0,
        held: Number(c.held) || 0,
        credibility: Number(c.credibility) || 0,
      });
    }
    for (const c of json?.contratos ?? []) quadro.guardados.push({ ...c });
    return quadro;
  }
}
