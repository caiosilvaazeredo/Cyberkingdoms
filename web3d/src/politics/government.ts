import type { DeterministicRandom } from '../core/rng';

/**
 * O sistema político da seção 8 do GDD.
 *
 * ## Por que o governo é um objeto de cidade, e não do mundo
 *
 * Cada capital tem o próprio imposto, o próprio salário público e o próprio
 * caixa. É isso que dá razão para migrar: um jogador insatisfeito com o
 * governador não precisa derrubá-lo, pode se mudar. Um governo único global
 * transformaria política em votação anual sem consequência espacial.
 */

export type PoliticalOffice =
  | 'governor'
  | 'districtAdmin'
  | 'interimGovernor'
  | 'militia';

export interface PoliticalOfficeDef {
  readonly id: PoliticalOffice;
  readonly label: string;
  readonly description: string;
}

export const allOffices: readonly PoliticalOfficeDef[] = [
  {
    id: 'governor',
    label: 'Governador',
    description: 'Controla impostos, salários públicos e segurança.',
  },
  {
    id: 'districtAdmin',
    label: 'Administrador de Distrito',
    description: 'Gere um distrito da capital.',
  },
  {
    id: 'interimGovernor',
    label: 'Governador Provisório',
    description: 'Assume após um golpe, até a próxima eleição.',
  },
  {
    id: 'militia',
    label: 'Milícia',
    description: 'Braço armado do governo. Reprime rebeliões.',
  },
];

/**
 * Teto de imposto de mercado — EB 1.1, §14 e §25.
 *
 * Eram 40%, herdados da Rev 3.0. O EB fixa a taxa base em 1% e o teto inicial
 * de governança em 5%, com o argumento de que acima disso o Mercado Central
 * deixa de competir com o clandestino e o governador mata a própria
 * arrecadação sem perceber.
 */
export const MAX_TAX_RATE = 0.05;
export const MIN_TAX_RATE = 0;
/** Intervalo entre eleições, em dias. */
/** Mandato de Governador: 60 dias. A Rev 4.1 revoga os 30 dias anteriores. */
export const TERM_LENGTH_IN_DAYS = 60;

export interface GovernmentJson {
  settlementId: string;
  governorId: string | null;
  governorName: string | null;
  taxRate: number;
  publicWage: number;
  treasury: number;
  securityBudget: number;
  militiaIds: string[];
  wantedIds: string[];
  interim: boolean;
}

export class Government {
  governorId: string | null;
  governorName: string | null;
  /** Imposto sobre transações no Mercado Central. O governador escolhe. */
  taxRate: number;
  /** Salário diário de quem trabalha em Serviços Públicos. */
  publicWage: number;
  /** Caixa da cidade. É isto que os rebeldes saqueiam num golpe. */
  treasury: number;
  /** Parcela gasta em segurança: soma à defesa e reduz assalto nas estradas. */
  securityBudget: number;
  /** `true` quando o cargo veio de um golpe, não de uma eleição. */
  interim: boolean;

  private readonly militia = new Set<string>();
  private readonly wanted = new Set<string>();

  constructor(
    readonly settlementId: string,
    options: Partial<Omit<GovernmentJson, 'settlementId'>> = {},
  ) {
    this.governorId = options.governorId ?? null;
    this.governorName = options.governorName ?? null;
    this.taxRate = options.taxRate ?? 0.01;
    this.publicWage = options.publicWage ?? 20;
    this.treasury = options.treasury ?? 0;
    this.securityBudget = options.securityBudget ?? 0;
    this.interim = options.interim ?? false;
    for (const id of options.militiaIds ?? []) this.militia.add(id);
    for (const id of options.wantedIds ?? []) this.wanted.add(id);
  }

  get militiaIds(): readonly string[] {
    return [...this.militia];
  }

  get wantedIds(): readonly string[] {
    return [...this.wanted];
  }

  get hasGovernor(): boolean {
    return this.governorId !== null;
  }

  setTaxRate(rate: number): void {
    // Teto de 40%: acima disso o Mercado Central deixa de ser competitivo com o
    // clandestino, e o governador consegue matar a própria arrecadação sem
    // perceber. O teto é o que mantém a escolha interessante.
    this.taxRate = Math.min(MAX_TAX_RATE, Math.max(MIN_TAX_RATE, rate));
  }

  collectTax(amount: number): void {
    this.treasury += amount;
  }

  /**
   * Paga a folha pública. Devolve quanto saiu de fato.
   *
   * Caixa curto não trava o pagamento: o governo paga o que dá, e o resto vira
   * insatisfação. Um governo que simplesmente não paga é um governo que o
   * jogador não tem como avaliar.
   */
  payWages(workerCount: number): number {
    const devido = this.publicWage * workerCount;
    const pago = Math.min(devido, this.treasury);
    this.treasury -= pago;
    return pago;
  }

  /** Força defensiva numa rebelião: milícia mais dinheiro em segurança. */
  get defenseStrength(): number {
    return this.militia.size * 10 + this.securityBudget / 100;
  }

  enlistMilitia(citizenId: string): void {
    this.militia.add(citizenId);
  }

  dismissMilitia(citizenId: string): void {
    this.militia.delete(citizenId);
  }

  markWanted(citizenId: string): void {
    this.wanted.add(citizenId);
  }

  pardon(citizenId: string): void {
    this.wanted.delete(citizenId);
  }

  isWanted(citizenId: string): boolean {
    return this.wanted.has(citizenId);
  }

  /**
   * Aplica um golpe bem-sucedido: o governador cai, o tesouro é saqueado e o
   * líder rebelde assume como provisório.
   */
  applyCoup(rebelLeaderId: string, rebelLeaderName: string): number {
    const saqueado = this.treasury;
    this.treasury = 0;
    this.governorId = rebelLeaderId;
    this.governorName = rebelLeaderName;
    this.interim = true;
    this.militia.clear();
    // A lista de procurados também zera: quem o governo anterior perseguia
    // deixa de ser inimigo do governo que acabou de tomar o poder.
    this.wanted.clear();
    return saqueado;
  }

  toJson(): GovernmentJson {
    return {
      settlementId: this.settlementId,
      governorId: this.governorId,
      governorName: this.governorName,
      taxRate: this.taxRate,
      publicWage: this.publicWage,
      treasury: this.treasury,
      securityBudget: this.securityBudget,
      militiaIds: [...this.militia],
      wantedIds: [...this.wanted],
      interim: this.interim,
    };
  }

  static fromJson(json: GovernmentJson): Government {
    return new Government(json.settlementId, json);
  }
}

export interface Candidacy {
  readonly citizenId: string;
  readonly citizenName: string;
  /** A plataforma é o que o eleitor avalia. */
  readonly platformTaxRate: number;
  readonly platformWage: number;
  votes: number;
}

export interface ElectionJson {
  settlementId: string;
  scheduledForDay: number;
  candidates: Candidacy[];
  resolved: boolean;
  winnerId: string | null;
}

/**
 * Eleição para governador.
 *
 * **Qualquer jogador pode disputar, independente do nível** — regra explícita
 * do GDD. É o único caminho de poder que não passa por dinheiro.
 */
export class Election {
  private readonly list: Candidacy[];
  resolved: boolean;
  winnerId: string | null;

  constructor(
    readonly settlementId: string,
    readonly scheduledForDay: number,
    candidates: readonly Candidacy[] = [],
    resolved = false,
    winnerId: string | null = null,
  ) {
    this.list = candidates.map((c) => ({ ...c }));
    this.resolved = resolved;
    this.winnerId = winnerId;
  }

  get candidates(): readonly Candidacy[] {
    return this.list;
  }

  register(candidacy: Omit<Candidacy, 'votes'> & { votes?: number }): boolean {
    if (this.resolved) return false;
    if (this.list.some((c) => c.citizenId === candidacy.citizenId)) return false;
    this.list.push({ ...candidacy, votes: candidacy.votes ?? 0 });
    return true;
  }

  /**
   * Apura.
   *
   * O eleitorado é simulado: cada eleitor pesa imposto baixo e salário alto,
   * com um ruído determinístico que representa carisma. Status entra na conta —
   * reputação vira voto, e é assim que a economia se liga à política.
   */
  resolve(options: {
    electorate: number;
    rng: DeterministicRandom;
    statusOf: (citizenId: string) => number;
  }): Candidacy | null {
    if (this.resolved || this.list.length === 0) return null;

    for (const candidato of this.list) {
      const taxAppeal = (MAX_TAX_RATE - candidato.platformTaxRate) / MAX_TAX_RATE;
      const wageAppeal = Math.min(1.5, Math.max(0, candidato.platformWage / 120));
      const statusAppeal = options.statusOf(candidato.citizenId) / 12;

      const score = taxAppeal * 0.45 + wageAppeal * 0.35 + statusAppeal * 0.2;
      const noise = options.rng.rangeDouble(0.85, 1.15);
      candidato.votes = Math.min(
        options.electorate,
        Math.max(
          0,
          Math.round((options.electorate * score * noise) / this.list.length),
        ),
      );
    }

    this.list.sort((a, b) => b.votes - a.votes);
    this.resolved = true;
    this.winnerId = this.list[0]!.citizenId;
    return this.list[0]!;
  }

  toJson(): ElectionJson {
    return {
      settlementId: this.settlementId,
      scheduledForDay: this.scheduledForDay,
      candidates: this.list.map((c) => ({ ...c })),
      resolved: this.resolved,
      winnerId: this.winnerId,
    };
  }

  static fromJson(json: ElectionJson): Election {
    return new Election(
      json.settlementId,
      json.scheduledForDay,
      json.candidates ?? [],
      json.resolved ?? false,
      json.winnerId ?? null,
    );
  }
}

export interface CoupResult {
  readonly succeeded: boolean;
  readonly rebelStrength: number;
  readonly governmentStrength: number;
  readonly lootedTreasury: number;
  readonly wantedIds: readonly string[];
}

/**
 * Comitê Revolucionário.
 *
 * Se a força rebelde superar a do governo, é golpe. Senão, todo o comitê vira
 * procurado — inclusive quem só entrou para somar número. O risco assimétrico
 * é o que impede a revolução de ser a jogada óbvia todo mês.
 */
export class RevolutionaryCommittee {
  private readonly membros = new Map<string, number>();

  constructor(
    readonly settlementId: string,
    readonly leaderId: string,
    readonly leaderName: string,
    members: Iterable<[string, number]> = [],
  ) {
    for (const [id, forca] of members) this.membros.set(id, forca);
  }

  get members(): ReadonlyMap<string, number> {
    return this.membros;
  }

  join(citizenId: string, strength: number): void {
    this.membros.set(citizenId, strength);
  }

  leave(citizenId: string): void {
    this.membros.delete(citizenId);
  }

  get strength(): number {
    let soma = 0;
    for (const f of this.membros.values()) soma += f;
    return soma;
  }

  attemptCoup(government: Government): CoupResult {
    const rebelStrength = this.strength;
    const governmentStrength = government.defenseStrength;

    if (rebelStrength > governmentStrength) {
      const lootedTreasury = government.applyCoup(this.leaderId, this.leaderName);
      return {
        succeeded: true,
        rebelStrength,
        governmentStrength,
        lootedTreasury,
        wantedIds: [],
      };
    }

    for (const id of this.membros.keys()) government.markWanted(id);
    government.markWanted(this.leaderId);

    return {
      succeeded: false,
      rebelStrength,
      governmentStrength,
      lootedTreasury: 0,
      wantedIds: [...this.membros.keys(), this.leaderId],
    };
  }
}
