/**
 * EB 1.1 — a baseline econômica, num lugar só e versionada.
 *
 * ## Por que um módulo de parâmetros, e não números espalhados
 *
 * O EB manda registrar `rule_version` em tudo que a economia produz, e manda
 * calibrar "≤10%, uma família por vez". Isso só é possível se os valores
 * morarem juntos: espalhados por dez arquivos, ninguém consegue dizer que
 * versão gerou um pagamento, e a calibração vira caça ao número.
 *
 * ## O que mudou da Rev 3.0 para a Rev 4.1 / EB 1.1
 *
 * Não é ajuste de valor, é troca de fundamento. A Rev 3.0 tinha **reset diário
 * à meia-noite**: o dia era a unidade de decisão e o mundo virava de página. A
 * Rev 4.1 tem **tempo real 1:1** e fila de ações — trabalhar custa duas horas
 * de relógio, dormir custa oito, e nada "vira" à meia-noite. Os números daqui
 * são por **ação**, não por dia, e é por isso que os antigos não podiam ser
 * só reescalados.
 *
 * A outra troca de fundamento: HP zero não apaga o cidadão, e ficar offline
 * nunca produz morte permanente. A Rev 3.0 matava por abandono, o que fazia
 * sentido quando o dia passava sozinho; com tempo real, matar quem fechou a
 * aba é punir por não jogar.
 */

/**
 * Versão das regras que produziram um valor.
 *
 * Vai junto de pagamento, ordem e ato público. Sem isso, uma calibração
 * silenciosa reescreve o passado: o jogador vê um salário de ontem calculado
 * pela tabela de hoje e não tem como saber qual era a regra no aceite.
 */
export const RULE_VERSION = 'EB-1.1';

/** Uma hora de mundo é uma hora de relógio — Rev 4.1, §05. */
export const HOUR_MS = 60 * 60 * 1000;

// --------------------------------------------------------------------- moeda

/**
 * A moeda é inteira, sem fração, e nunca fica negativa.
 *
 * `bigint` seria o tipo fiel ao EB, mas o `number` do JavaScript representa
 * inteiros exatos até 2^53 — dez mil vezes o patrimônio de um servidor cheio.
 * O que importa da regra é o que esta função garante: nada de centavo, nada de
 * `0.1 + 0.2`, e nada abaixo de zero.
 */
export function cz(valor: number): number {
  return Math.max(0, Math.round(valor));
}

/** Formata para a interface. A unidade é Cz e vem sempre grudada no número. */
export function formatCz(valor: number): string {
  return `Cz ${Math.round(valor).toLocaleString('pt-BR')}`;
}

// ------------------------------------------------------------------ carteira

export const WALLET = {
  /** Saldo na criação do cidadão. */
  inicial: 30,
  /** Distribuído por marcos do tutorial. */
  tutorial: 70,
  /** Soma que o onboarding entrega — nem um Cz a mais. */
  get total(): number {
    return this.inicial + this.tutorial;
  },
} as const;

// -------------------------------------------------------------- custo de vida

export const CESTA = {
  /** Preço de referência da água, por unidade. */
  agua: 2,
  /** Preço de referência do alimento, por unidade. */
  alimento: 4,
  /** Cesta diária: 30% do que rende um trabalho de 2 h. */
  get diaria(): number {
    return this.agua + this.alimento;
  },
  /** Reserva considerada segura: três dias de cesta. */
  get reservaSegura(): number {
    return this.diaria * 3;
  },
} as const;

// ------------------------------------------------------------ trabalho público

export const TRABALHO_PUBLICO = {
  /** Duração de uma jornada. Ação exclusiva. */
  duracaoHoras: 2,
  /** Pagamento bruto. */
  bruto: 20,
  /** Fatia que vai para o cofre da capital. */
  contribuicaoCofre: 0.1,
  /** O que sobra para o cidadão: Cz 18. */
  get liquido(): number {
    return cz(this.bruto * (1 - this.contribuicaoCofre));
  },
  /** O que entra no cofre: Cz 2. */
  get cofre(): number {
    return this.bruto - this.liquido;
  },
  /** Faixa de acidente por jornada básica. */
  acidente: { min: 0.01, max: 0.03 },
} as const;

/** Vagas simultâneas por fonte pública, conforme o nível da infraestrutura. */
export const VAGAS_POR_NIVEL = [10, 15, 22] as const;

// ------------------------------------------------------------------ vitais

/**
 * Consumo de uma ação de 2 h e recuperação do sono.
 *
 * Os três descem juntos porque o EB os define juntos: quem trabalha oito horas
 * seguidas chega no fim sem energia antes de chegar sem comida, e é essa ordem
 * que faz o sono ser uma decisão e não um enfeite.
 */
export const VITAIS = {
  /** Piso e teto de todo status. */
  min: 0,
  max: 100,
  /** Custo de uma ação de 2 h. */
  porAcao: { fome: 4, sede: 5, energia: 8 },
  /** Sono de 8 h. */
  sono: { horas: 8, energia: 60 },
  /** Dano de um acidente leve. */
  acidenteHp: { min: 5, max: 15 },
} as const;

/** Custo de uma ação proporcional à duração. Ação de 2 h é a unidade. */
export function custoDaAcao(horas: number): {
  fome: number;
  sede: number;
  energia: number;
} {
  const fator = horas / TRABALHO_PUBLICO.duracaoHoras;
  return {
    fome: Math.round(VITAIS.porAcao.fome * fator),
    sede: Math.round(VITAIS.porAcao.sede * fator),
    energia: Math.round(VITAIS.porAcao.energia * fator),
  };
}

// ------------------------------------------------------- educação e profissão

export const EDUCACAO = {
  /** Ganho de conhecimento por aula de 2 h, antes da Inteligência. */
  ganhoPorAula: 2,
  /** Multiplicador: 0,75 + Inteligência × 0,005, em escala 0..100. */
  base: 0.75,
  porPontoDeInteligencia: 0.005,
  /** Conhecimento necessário para uma certificação. */
  certificacao: 100,
} as const;

/**
 * Quanto conhecimento uma aula rende para esta Inteligência.
 *
 * Inteligência **acelera**, não substitui: com I=0 o multiplicador é 0,75 e com
 * I=100 é 1,25 — quem tem o dobro de Inteligência não aprende o dobro, aprende
 * um terço mais rápido. É o que impede o atributo de virar o único caminho.
 */
export function ganhoDeAula(inteligencia: number, horas = 2): number {
  const i = Math.max(0, Math.min(100, inteligencia));
  const mult = EDUCACAO.base + i * EDUCACAO.porPontoDeInteligencia;
  return (EDUCACAO.ganhoPorAula * mult * horas) / 2;
}

// ------------------------------------------------------------------ mercado

export const MERCADO = {
  /** Taxa sobre venda concluída. Vai para o cofre local. */
  taxaBase: 0.01,
  /** Teto inicial que a governança pode praticar. */
  taxaMaxima: 0.05,
  /** Multiplicador de preço por qualidade. */
  qualidade: { normal: 1, superior: 1.15, raro: 1.35 },
  /** Margem alvo de um produto normal. */
  margem: { min: 0.1, max: 0.3 },
} as const;

/** Validade dos perecíveis, em horas. */
export const VALIDADE = {
  alimento: 72,
  aguaTratada: 120,
  /** Geladeira dobra a vida útil. */
  refrigeracao: 2,
} as const;

// ------------------------------------------------------------- propriedades

export const PROPRIEDADE = {
  fazendaN1: 60,
  oficinaN1: 180,
  /** Manutenção semanal por nível, sobre o valor da propriedade. */
  manutencao: [0.02, 0.03, 0.04],
  /** Eficiência perdida por ciclo de manutenção atrasada. */
  penalidadeAtraso: 0.1,
  /** Limite na visão completa: duas fazendas e uma instalação industrial. */
  limite: { fazendas: 2, industriais: 1 },
  /** Taxa de transferência na revenda. */
  taxaTransferencia: 0.01,
} as const;

// ----------------------------------------------------------------- política

export const POLITICA = {
  /** Mandato de Governador, em dias. Substitui os 30 dias da Rev 3.0. */
  mandatoGovernador: 60,
  /** Mandato do Presidente Mundial: quatro ciclos regionais. */
  mandatoPresidente: 240,
  /** Prazo de autoaprovação de um ato departamental. */
  autoaprovacaoHoras: 24,
  /** Prazo de emergência, quando autorizado. */
  emergenciaHoras: 6,
} as const;

export const COFRE = {
  /** Reserva operacional que o cofre deveria manter. */
  reservaOperacional: 0.2,
  /** Teto de obras por ciclo. */
  obras: 0.5,
  /** Teto de subsídios por ciclo. */
  subsidios: 0.2,
} as const;

/** Teto de pena, em horas, por gravidade — Rev 4.1, §36. */
export const PENA_HORAS = {
  leve: 3,
  moderado: 12,
  grave: 24,
  critico: 72,
} as const;

/** Faixas de risco por contexto — EB §30. */
export const RISCO = {
  trabalhoBasico: { min: 0.01, max: 0.03 },
  industrialSemManutencao: { min: 0.02, max: 0.06 },
  viagemSegura: { min: 0.01, max: 0.03 },
  rotaHostil: { min: 0.05, max: 0.15 },
} as const;
