import {
  DURACAO_DA_PARTIDA,
  PESO_MINIMO,
  PONTOS_PARA_VENCER,
  RENASCIMENTO_BASE,
} from './regras';

/**
 * Os modos de jogo: o mesmo jogo com uma alavanca puxada.
 *
 * ## Uma tabela, e não quatro caminhos no código
 *
 * A tentação de um modo de jogo é escrever `if (modo === 'assalto')` no meio do
 * tick. Feito quatro vezes, o tick vira uma árvore que ninguém consegue ler, e
 * cada regra nova precisa lembrar de todos os modos — que é como um jogo ganha
 * um modo em que a princesa não anda e ninguém descobre por três meses.
 *
 * Aqui um modo é **dado**: um registro de números e chaves que o tick lê no
 * lugar das constantes. Acrescentar um modo é acrescentar uma linha nesta
 * tabela, e a garantia de que ele funciona é que o tick nunca soube o nome de
 * nenhum deles.
 *
 * ## A regra do desenho: uma alavanca por modo
 *
 * Cada modo aqui muda **uma** coisa em relação ao clássico, e a coisa que ele
 * muda é a que dá nome a ele. É o que faz um modo ser explicável numa linha na
 * tela de criação de sala — e é o que impede a lista de virar seis variações
 * que ninguém sabe distinguir na hora de escolher.
 *
 * ## Por que o modo mora no estado, e não na sala
 *
 * O cliente prevê o movimento rodando **a mesma simulação** do servidor. Se o
 * modo vivesse só no servidor, a previsão rodaria com as regras erradas todas
 * as vezes em que o modo mexesse em algo que o cliente também calcula. Estando
 * no estado, ele viaja no retrato e os dois lados concordam de graça.
 */

export type IdDoModo =
  | 'resgate'
  | 'assalto'
  | 'banquete'
  | 'chapelaria'
  | 'fome'
  | 'obra'
  | 'abate';

export interface Modo {
  readonly id: IdDoModo;
  /** Como aparece na tela de criação de sala. */
  readonly nome: string;
  /** Uma linha: o que muda, dito para quem vai escolher. */
  readonly lema: string;
  /** Resgates para vencer. */
  readonly pontosParaVencer: number;
  /** Duração, em segundos. */
  readonly duracao: number;
  /** Base do tempo de renascimento, em segundos. */
  readonly renascimentoBase: number;
  /**
   * A balança também vence: levar a própria princesa ao peso mínimo — isto é,
   * empanturrar a refém que se guarda — acaba a partida na hora.
   *
   * Esta chave puxa **duas** coisas no tick, e a segunda é o que faz a primeira
   * existir: o fim por peso, e a balança deixar de relaxar depois de um ponto.
   * Sem a segunda, cada resgate devolvia metade do caminho andado e a barra
   * nunca chegava ao talo — o modo terminava idêntico ao clássico. Ver o
   * comentário em `recomecarRodada`.
   */
  readonly vitoriaPorBalanca: boolean;
  /** A chapelaria nunca fica vazia: chapéu deixa de ser recurso disputado. */
  readonly chapeusInfinitos: boolean;
  /**
   * O bicho abatido volta ao pasto depois de um tempo.
   *
   * Desligado, a carne do mapa é finita — e como bolo sai de carne, a balança
   * ganha um teto que ninguém pode ultrapassar. Caçar cedo deixa de ser rotina
   * e vira investimento.
   */
  readonly animaisVoltam: boolean;
  /**
   * Levar a chapelaria ao nível máximo vence a partida.
   *
   * Promove minerador e lenhador a decisivos. Nos outros modos a obra é uma
   * melhoria lateral que o time faz quando sobra gente; aqui ela é o objetivo,
   * e quem manda todo mundo para a briga perde por falta de picareta.
   */
  readonly vitoriaPorObra: boolean;
  /**
   * Quanto a obra custa, em múltiplos do preço normal.
   *
   * Existe pelo mesmo motivo que a balança do Banquete não relaxa: sem isso, a
   * alavanca do modo não vira jogo. Medindo com bots, o Obra decidia em 115
   * segundos de mediana — quase tão rápido quanto o Assalto, que é o modo
   * expresso de propósito. Uma corrida de construção que acaba antes de o
   * inimigo chegar à jazida não é corrida: é um sprint com um corredor só.
   */
  readonly custoDaObra: number;
  /**
   * Abates que vencem a partida, ou `null` quando matar não é o objetivo.
   *
   * Combate puro: sem cortejo, sem logística de bolo. É o modo de quem abre o
   * jogo só para brigar — e o único em que a princesa é cenário.
   */
  readonly abatesParaVencer: number | null;
}

/**
 * Os quatro modos.
 *
 * - **Resgate** é o jogo como ele foi desenhado, e é o padrão. Os outros três
 *   são desvios dele, não jogos diferentes.
 * - **Assalto** existe para o sofá: uma rodada inteira em seis minutos, com um
 *   resgate só decidindo. O renascimento mais curto é o que impede a partida
 *   curta de virar uma partida em que metade do tempo se passa esperando.
 * - **Banquete** promove a mecânica-assinatura a condição de vitória. A barra
 *   da balança já está no alto da tela a partida inteira; aqui chegar ao fim
 *   dela ganha o jogo, e não só o desempate. Resgatar continua valendo — são
 *   dois caminhos, e escolher entre eles é o modo.
 * - **Chapelaria aberta** tira a escassez de chapéus. É o modo de quem quer
 *   jogar de arqueiro sem disputar o arco, e ele muda a partida mais do que
 *   parece: sem estoque para roubar, matar deixa de desmontar a composição do
 *   inimigo e a briga vira só briga.
 */
export const MODOS: Readonly<Record<IdDoModo, Modo>> = {
  resgate: {
    id: 'resgate',
    nome: 'Resgate',
    lema: 'o clássico: três resgates vencem, a balança desempata',
    pontosParaVencer: PONTOS_PARA_VENCER,
    duracao: DURACAO_DA_PARTIDA,
    renascimentoBase: RENASCIMENTO_BASE,
    vitoriaPorBalanca: false,
    chapeusInfinitos: false,
    animaisVoltam: true,
    vitoriaPorObra: false,
    custoDaObra: 1,
    abatesParaVencer: null,
  },
  assalto: {
    id: 'assalto',
    nome: 'Assalto',
    lema: 'um resgate decide · seis minutos · volta-se rápido para o campo',
    pontosParaVencer: 1,
    duracao: 6 * 60,
    renascimentoBase: 3,
    vitoriaPorBalanca: false,
    chapeusInfinitos: false,
    animaisVoltam: true,
    vitoriaPorObra: false,
    custoDaObra: 1,
    abatesParaVencer: null,
  },
  banquete: {
    id: 'banquete',
    nome: 'Banquete',
    lema: 'a balança vence: empanturre a refém até o talo da barra',
    pontosParaVencer: PONTOS_PARA_VENCER,
    duracao: DURACAO_DA_PARTIDA,
    renascimentoBase: RENASCIMENTO_BASE,
    vitoriaPorBalanca: true,
    chapeusInfinitos: false,
    animaisVoltam: true,
    vitoriaPorObra: false,
    custoDaObra: 1,
    abatesParaVencer: null,
  },
  chapelaria: {
    id: 'chapelaria',
    nome: 'Chapelaria aberta',
    lema: 'chapéu à vontade: ninguém disputa arco, ninguém rouba composição',
    pontosParaVencer: PONTOS_PARA_VENCER,
    duracao: DURACAO_DA_PARTIDA,
    renascimentoBase: RENASCIMENTO_BASE,
    vitoriaPorBalanca: false,
    chapeusInfinitos: true,
    animaisVoltam: true,
    vitoriaPorObra: false,
    custoDaObra: 1,
    abatesParaVencer: null,
  },
  fome: {
    id: 'fome',
    nome: 'Fome',
    lema: 'o bicho abatido não volta · a carne do mapa é tudo o que existe',
    pontosParaVencer: PONTOS_PARA_VENCER,
    duracao: DURACAO_DA_PARTIDA,
    renascimentoBase: RENASCIMENTO_BASE,
    vitoriaPorBalanca: false,
    chapeusInfinitos: false,
    animaisVoltam: false,
    vitoriaPorObra: false,
    custoDaObra: 1,
    abatesParaVencer: null,
  },
  obra: {
    id: 'obra',
    nome: 'Obra',
    lema: 'vence quem terminar a chapelaria · picareta e machado decidem',
    pontosParaVencer: PONTOS_PARA_VENCER,
    duracao: DURACAO_DA_PARTIDA,
    renascimentoBase: RENASCIMENTO_BASE,
    vitoriaPorBalanca: false,
    chapeusInfinitos: false,
    animaisVoltam: true,
    vitoriaPorObra: true,
    custoDaObra: 3,
    abatesParaVencer: null,
  },
  abate: {
    id: 'abate',
    nome: 'Abate',
    lema: 'trinta baixas vencem · sem cortejo, sem bolo, só briga',
    // Resgate não decide nada aqui. Medindo, ele decidia duas de três partidas
    // antes de alguém chegar às trinta baixas — e um modo cujo lema promete "só
    // briga" e termina por cortejo é um modo que mente. A princesa continua em
    // campo e continua carregável; o que ela deixou de ser é o placar.
    pontosParaVencer: Number.POSITIVE_INFINITY,
    duracao: 8 * 60,
    renascimentoBase: 4,
    vitoriaPorBalanca: false,
    chapeusInfinitos: false,
    animaisVoltam: true,
    vitoriaPorObra: false,
    custoDaObra: 1,
    abatesParaVencer: 30,
  },
};

export const MODO_PADRAO: IdDoModo = 'resgate';

/** A lista, na ordem em que a tela de criação mostra. */
export const IDS_DOS_MODOS: readonly IdDoModo[] = [
  'resgate',
  'assalto',
  'banquete',
  'chapelaria',
  'fome',
  'obra',
  'abate',
];

/**
 * O modo de um id vindo de fora.
 *
 * Tolerante de propósito: o id chega pela rede, de um cliente velho ou de
 * alguém brincando com o protocolo. Um id desconhecido cai no clássico em vez
 * de derrubar a sala — recusar a conexão por causa de um nome de modo seria
 * punir o jogador pelo erro de outra pessoa.
 */
export function modoDe(id: unknown): Modo {
  return typeof id === 'string' && id in MODOS ? MODOS[id as IdDoModo] : MODOS[MODO_PADRAO];
}

/**
 * O peso em que a balança "estoura" e o Banquete acaba.
 *
 * É o mesmo `PESO_MINIMO` que o resto do jogo já respeita: `alimentar` nunca
 * deixa uma princesa passar dele. Ter um número só significa que a barra na
 * tela e a condição de vitória são a mesma coisa — quem vê a barra encostar no
 * fim viu o jogo acabar, sem precisar aprender um segundo limiar.
 */
export const PESO_QUE_VENCE = PESO_MINIMO;
