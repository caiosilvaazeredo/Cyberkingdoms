import { citizenRank, type CitizenLevel } from '../building/buildingType';
import type { Attribute, AttributeSet } from '../character/attributes';
import { SurvivalTables, workById, type Upkeep } from '../survival/survival';

/**
 * Profissões, qualificação e estudo.
 *
 * ## O buraco que isto fecha
 *
 * O GDD já tinha trabalho — o jogador escolhia uma atividade e o governo pagava
 * um salário fixo. Faltava o que torna trabalho uma **trajetória**: qualquer um
 * podia fazer qualquer coisa no primeiro dia, e o salário era o mesmo do lixão
 * ao laboratório. Sem barreira de entrada não existe carreira, e sem carreira o
 * trabalho vira um botão que dá dinheiro.
 *
 * ## Como a qualificação funciona
 *
 * Cada profissão pede um **certificado**, e certificado vem de curso. Curso
 * custa dinheiro, custa dias, e cobra Fome e Sede como qualquer outra
 * atividade: estudar é uma decisão econômica, exatamente como comer.
 *
 * Três coisas que a barreira **não** é:
 *
 * - Não é atributo. Atributo é sorteado e não treina — o GDD é explícito nisso.
 *   Amarrar profissão a atributo condenaria uma rolagem ruim para sempre.
 *   Atributo entra como *desconto* no curso, não como porta.
 * - Não é nível de cidadania. O nível vem de dinheiro acumulado; a profissão
 *   tem de ser o caminho de **quem não tem** dinheiro.
 * - Não é permanente para o mundo. O certificado é do personagem, e morrer
 *   permanentemente leva tudo junto.
 */

export type Certificate =
  | 'basic'
  | 'agro'
  | 'industrial'
  | 'chemistry'
  | 'gunsmithing';

export interface CertificateDef {
  readonly id: Certificate;
  readonly label: string;
  readonly description: string;
  /** Créditos cobrados na matrícula. */
  readonly tuition: number;
  /** Dias de curso. Cada dia cobra Fome e Sede como um dia de trabalho. */
  readonly days: number;
  /** Certificados que precisam vir antes. */
  readonly requires: readonly Certificate[];
  /** Atributo que encurta o curso. */
  readonly favouredBy: Attribute;
}

export const allCertificates: readonly CertificateDef[] = [
  {
    id: 'basic',
    label: 'Alfabetização Técnica',
    description:
      'Ler um manual, assinar um contrato e não morrer no primeiro turno. ' +
      'É o que separa o catador do trabalhador registrado.',
    tuition: 120,
    days: 2,
    requires: [],
    favouredBy: 'perception',
  },
  {
    id: 'agro',
    label: 'Manejo Agro-Bio',
    description:
      'Hidroponia, biomassa e bioreatores. A cadeia de comida é a única que ' +
      'ninguém pode deixar de comprar.',
    tuition: 400,
    days: 3,
    requires: ['basic'],
    favouredBy: 'intelligence',
  },
  {
    id: 'industrial',
    label: 'Operação Industrial',
    description:
      'Prensa, tecelagem e placa de circuito. Sem isto, oficina é só um ' +
      'galpão com ferramenta cara dentro.',
    tuition: 700,
    days: 4,
    requires: ['basic'],
    favouredBy: 'intelligence',
  },
  {
    id: 'chemistry',
    label: 'Química Aplicada',
    description:
      'Catalisador, refino e o que mais o laboratório aceitar. É a licença ' +
      'que separa o farmacêutico do envenenador.',
    tuition: 1400,
    days: 5,
    requires: ['industrial'],
    favouredBy: 'intelligence',
  },
  {
    id: 'gunsmithing',
    label: 'Armeiro Licenciado',
    description:
      'Montar e manter arma de fogo. A licença é cara porque o governo ' +
      'prefere que ela seja.',
    tuition: 2200,
    days: 5,
    requires: ['industrial'],
    favouredBy: 'strength',
  },
];

export function certificateDef(id: Certificate): CertificateDef {
  const found = allCertificates.find((c) => c.id === id);
  if (!found) throw new Error(`certificado desconhecido: "${id}"`);
  return found;
}

export interface ProfessionDef {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  /** Id do trabalho em `survival/survival.ts` que a profissão exerce. */
  readonly work: string;
  readonly requires: Certificate | null;
  /**
   * Multiplicador do salário público em relação ao piso.
   *
   * Trabalho que exige curso paga mais — é o retorno do investimento, e é o que
   * torna estudar uma decisão em vez de um enfeite.
   */
  readonly wageFactor: number;
  /** Nível de cidadania mínimo, quando a vaga é restrita. */
  readonly minLevel: CitizenLevel;
}

export const allProfessions: readonly ProfessionDef[] = [
  {
    id: 'catador',
    label: 'Catador',
    description:
      'Sucata do lixão da capital. Não pede nada de ninguém, e é por isso ' +
      'que todo mundo começa aqui.',
    work: 'dump',
    requires: null,
    wageFactor: 1,
    minLevel: 'survivor',
  },
  {
    id: 'lavrador',
    label: 'Lavrador Público',
    description: 'Turno no cultivo público. Paga pouco, mas paga todo dia.',
    work: 'publicFarming',
    requires: null,
    wageFactor: 1,
    minLevel: 'survivor',
  },
  {
    id: 'petroleiro',
    label: 'Petroleiro',
    description: 'Bomba de óleo. Trabalho sujo, salário melhor.',
    work: 'oil',
    requires: 'basic',
    wageFactor: 1.35,
    minLevel: 'survivor',
  },
  {
    id: 'mineiro',
    label: 'Mineiro de Terras Raras',
    description:
      'A camada 1 mais disputada do mapa. É daqui que sai o chip, e é por ' +
      'isso que o gargalo da economia começa nesta mina.',
    work: 'rareEarth',
    requires: 'basic',
    wageFactor: 1.6,
    minLevel: 'survivor',
  },
  {
    id: 'hidroponista',
    label: 'Hidroponista',
    description: 'Estufa da própria fazenda. Rende mais com Inteligência alta.',
    work: 'hydroponics',
    requires: 'agro',
    wageFactor: 1.4,
    minLevel: 'farmer',
  },
  {
    id: 'biotecnico',
    label: 'Biotécnico',
    description: 'Bioreatores: carne cultivada, a base da ração de verdade.',
    work: 'bioreactors',
    requires: 'agro',
    wageFactor: 1.7,
    minLevel: 'farmer',
  },
  {
    id: 'tecelao',
    label: 'Tecelão',
    description: 'Oficina de tecidos. A roupa é o primeiro luxo que alguém compra.',
    work: 'textiles',
    requires: 'industrial',
    wageFactor: 1.5,
    minLevel: 'farmer',
  },
  {
    id: 'eletricista',
    label: 'Eletricista Industrial',
    description: 'Placa de circuito — o insumo que trava a linha inteira.',
    work: 'hardware',
    requires: 'industrial',
    wageFactor: 1.9,
    minLevel: 'industrialist',
  },
  {
    id: 'quimico',
    label: 'Químico',
    description: 'Catalisador. Metade das receitas de refino passa por aqui.',
    work: 'laboratory',
    requires: 'chemistry',
    wageFactor: 2.3,
    minLevel: 'industrialist',
  },
  {
    id: 'armeiro',
    label: 'Armeiro',
    description: 'Pistola e rifle. Legal, caro, e sempre com fila.',
    work: 'gunsmith',
    requires: 'gunsmithing',
    wageFactor: 2.6,
    minLevel: 'industrialist',
  },
];

export function professionDef(id: string): ProfessionDef {
  const found = allProfessions.find((p) => p.id === id);
  if (!found) throw new Error(`profissão desconhecida: "${id}"`);
  return found;
}

/** A profissão que exerce um trabalho, se alguma. */
export function professionForWork(work: string): ProfessionDef | null {
  return allProfessions.find((p) => p.work === work) ?? null;
}

export type QualificationBlock =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/** Se o personagem pode exercer a profissão hoje. */
export function canPractise(
  profession: ProfessionDef,
  options: { certificates: ReadonlySet<Certificate>; level: CitizenLevel },
): QualificationBlock {
  if (profession.requires && !options.certificates.has(profession.requires)) {
    return {
      ok: false,
      reason: `Exige o certificado: ${certificateDef(profession.requires).label}.`,
    };
  }
  if (citizenRank[options.level] < citizenRank[profession.minLevel]) {
    return { ok: false, reason: 'Vaga restrita a um nível de cidadania acima.' };
  }
  return { ok: true };
}

/**
 * Salário diário da profissão numa cidade.
 *
 * Sai do salário público que o **governador** definiu, multiplicado pelo fator
 * da profissão. Isso amarra carreira e política: eleger quem promete salário
 * alto vale mais para quem estudou, e é o eleitorado qualificado que o
 * candidato precisa convencer.
 */
export function dailyWage(profession: ProfessionDef, publicWage: number): number {
  return Math.round(publicWage * profession.wageFactor);
}

/** Custo de Fome e Sede de exercer a profissão por um dia. */
export function professionUpkeep(profession: ProfessionDef): Upkeep {
  return workById(profession.work).upkeep;
}

// --------------------------------------------------------------- estudo

/**
 * Quantos dias o curso leva para este personagem.
 *
 * O atributo favorecido encurta em até dois dias, e o piso é um: um curso de
 * zero dia seria só um botão de comprar certificado, e a decisão — abrir mão de
 * dias de salário — é justamente o que dá peso ao estudo.
 */
export function studyDaysFor(
  certificate: CertificateDef,
  attributes: AttributeSet,
): number {
  const pontos = attributes.get(certificate.favouredBy);
  const desconto = Math.min(2, Math.max(0, Math.floor((pontos - 6) / 3)));
  return Math.max(1, certificate.days - desconto);
}

/** Custo diário de estudar. Menor que trabalhar, mas longe de zero. */
export const STUDY_UPKEEP: Upkeep = {
  hunger: Math.round(SurvivalTables.idleBase.hunger * 1.25),
  thirst: Math.round(SurvivalTables.idleBase.thirst * 1.25),
};

export type EnrolResult =
  | { readonly ok: true; readonly days: number; readonly tuition: number }
  | { readonly ok: false; readonly reason: string };

/** Se dá para se matricular agora. */
export function canEnrol(
  certificate: CertificateDef,
  options: {
    certificates: ReadonlySet<Certificate>;
    credits: number;
    attributes: AttributeSet;
    studying: boolean;
  },
): EnrolResult {
  if (options.studying) {
    return { ok: false, reason: 'Você já está num curso.' };
  }
  if (options.certificates.has(certificate.id)) {
    return { ok: false, reason: 'Você já tem este certificado.' };
  }
  for (const anterior of certificate.requires) {
    if (!options.certificates.has(anterior)) {
      return {
        ok: false,
        reason: `Antes: ${certificateDef(anterior).label}.`,
      };
    }
  }
  if (options.credits < certificate.tuition) {
    return {
      ok: false,
      reason: `Matrícula custa ${certificate.tuition.toLocaleString('pt-BR')} créditos.`,
    };
  }
  return {
    ok: true,
    days: studyDaysFor(certificate, options.attributes),
    tuition: certificate.tuition,
  };
}
