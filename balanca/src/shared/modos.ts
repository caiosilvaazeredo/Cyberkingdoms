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
 * um modo em que o baú não anda e ninguém descobre por três meses.
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
  | 'cofrecheio'
  | 'chapelaria'
  | 'veiaseca'
  | 'obra'
  | 'abate'
  | 'covil'
  | 'caca'
  | 'xama'
  | 'cerco'
  | 'fuga'
  | 'vigilia';

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
   * A balança também vence: levar a próprio baú ao peso mínimo — isto é,
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
   * Desligado, o minério do mapa é finito — e como bolsa sai de minério, a balança
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
   * O peso em que a balança estoura e o Cofre Cheio acaba.
   *
   * Um número por modo, e não a constante do jogo, porque medindo se descobriu
   * que os dois extremos não funcionam. No talo (`PESO_MINIMO`, 40), a balança
   * decidia uma partida em dez: mover sessenta unidades de peso é caro demais
   * para dar tempo antes de alguém somar três resgates. Este limiar é o que faz
   * a promessa do modo acontecer — e continua sendo a **mesma barra** que já
   * está na tela, só que o fim é declarado um pouco antes do fim dela.
   */
  readonly pesoQueVence: number;
  /**
   * Abates que vencem a partida, ou `null` quando matar não é o objetivo.
   *
   * Combate puro: sem cortejo, sem logística de bolsa. É o modo de quem abre o
   * jogo só para brigar — e o único em que o baú é cenário.
   */
  readonly abatesParaVencer: number | null;
  /**
   * O Guardião nasce no meio do mapa: um chefe neutro, cuja queda dá ao time
   * que baixou a vida dele um tempo de velocidade extra. Ver `pve.ts` e
   * `GUARDIAO_*` em regras.ts.
   */
  readonly temGuardiao: boolean;
  /**
   * A Presa nasce sozinha, sem dono, com frequência bem maior que o
   * Guardião: derrubá-la dá um buff de dano curto pro time. Ver `pve.ts` e
   * `PRESA_*` em regras.ts.
   */
  readonly temCaca: boolean;
  /**
   * Um cajado neutro nasce sem parar no meio do mapa: quem tocar nele ganha
   * um feitiço de transformação — usar (`E`) perto de um inimigo o transforma
   * em porco por um tempo, sem ataque, sem colheita. Ver `pve.ts` e
   * `CAJADO_*`/`XAMA_*`/`PORCO_*` em regras.ts.
   */
  readonly temCajado: boolean;
  /**
   * O Menino Rei (Modo Fuga): um cativo neutro nasce no meio do mapa e
   * espera. Apertar "usar" (`E`) perto dele vence a partida na hora, mas só
   * quando a guarda inimiga ao redor já foi limpa. Ver `pve.ts`, `usar()`
   * em partida.ts e `MENINO_REI_*`/`guardasParaLiberar` em regras.ts.
   */
  readonly temFuga: boolean;
  /**
   * A Vigília: um relógio de dia e noite. À noite, e só à noite, o
   * Guardião existe — desperta ao anoitecer e foge, vivo ou morto, ao
   * amanhecer. Ver `moverCicloDoDia` em pve.ts.
   */
  readonly temNoite: boolean;
}

/**
 * Os quatro modos.
 *
 * - **Resgate** é o jogo como ele foi desenhado, e é o padrão. Os outros três
 *   são desvios dele, não jogos diferentes.
 * - **Assalto** existe para o sofá: uma rodada inteira em seis minutos, com um
 *   resgate só decidindo. O renascimento mais curto é o que impede a partida
 *   curta de virar uma partida em que metade do tempo se passa esperando.
 * - **Cofre Cheio** promove a mecânica-assinatura a condição de vitória. A barra
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
    abatesParaVencer: null,
    pesoQueVence: PESO_MINIMO,
    temGuardiao: false,
    temCaca: false,
    temCajado: false,
    temFuga: false,
    temNoite: false,
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
    abatesParaVencer: null,
    pesoQueVence: PESO_MINIMO,
    temGuardiao: false,
    temCaca: false,
    temCajado: false,
    temFuga: false,
    temNoite: false,
  },
  cofrecheio: {
    id: 'cofrecheio',
    nome: 'Cofre Cheio',
    lema: 'a balança vence: entulhe o baú refém até o talo da barra',
    pontosParaVencer: PONTOS_PARA_VENCER,
    duracao: DURACAO_DA_PARTIDA,
    renascimentoBase: RENASCIMENTO_BASE,
    vitoriaPorBalanca: true,
    chapeusInfinitos: false,
    animaisVoltam: true,
    vitoriaPorObra: false,
    abatesParaVencer: null,
    // Setenta, e não o talo da barra. Medindo dez seeds: no talo (40) a balança
    // decidia **uma** partida em dez e o modo era o clássico com outro nome; em
    // 82 ela decidia oito e o resgate virava enfeite. Em 70 são quatro pela
    // balança e seis por resgate — os dois caminhos vivos, que é o que o lema
    // promete.
    pesoQueVence: 70,
    temGuardiao: false,
    temCaca: false,
    temCajado: false,
    temFuga: false,
    temNoite: false,
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
    abatesParaVencer: null,
    pesoQueVence: PESO_MINIMO,
    temGuardiao: false,
    temCaca: false,
    temCajado: false,
    temFuga: false,
    temNoite: false,
  },
  veiaseca: {
    id: 'veiaseca',
    nome: 'Veia Seca',
    lema: 'a mula derrubada não volta · o minério do mapa é tudo o que existe',
    pontosParaVencer: PONTOS_PARA_VENCER,
    duracao: DURACAO_DA_PARTIDA,
    renascimentoBase: RENASCIMENTO_BASE,
    vitoriaPorBalanca: false,
    chapeusInfinitos: false,
    animaisVoltam: false,
    vitoriaPorObra: false,
    abatesParaVencer: null,
    pesoQueVence: PESO_MINIMO,
    temGuardiao: false,
    temCaca: false,
    temCajado: false,
    temFuga: false,
    temNoite: false,
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
    abatesParaVencer: null,
    pesoQueVence: PESO_MINIMO,
    temGuardiao: false,
    temCaca: false,
    temCajado: false,
    temFuga: false,
    temNoite: false,
  },
  abate: {
    id: 'abate',
    nome: 'Abate',
    lema: 'trinta baixas vencem · sem cortejo, sem moeda, só briga',
    // Resgate não decide nada aqui. Medindo, ele decidia duas de três partidas
    // antes de alguém chegar às trinta baixas — e um modo cujo lema promete "só
    // briga" e termina por cortejo é um modo que mente. O baú continua em
    // campo e continua carregável; o que ela deixou de ser é o placar.
    pontosParaVencer: Number.POSITIVE_INFINITY,
    duracao: 8 * 60,
    renascimentoBase: 4,
    vitoriaPorBalanca: false,
    chapeusInfinitos: false,
    animaisVoltam: true,
    vitoriaPorObra: false,
    abatesParaVencer: 30,
    pesoQueVence: PESO_MINIMO,
    temGuardiao: false,
    temCaca: false,
    temCajado: false,
    temFuga: false,
    temNoite: false,
  },
  covil: {
    id: 'covil',
    nome: 'Covil',
    lema: 'um Guardião nasce no meio do mapa · derrubá-lo acelera o time inteiro',
    pontosParaVencer: PONTOS_PARA_VENCER,
    duracao: DURACAO_DA_PARTIDA,
    renascimentoBase: RENASCIMENTO_BASE,
    vitoriaPorBalanca: false,
    chapeusInfinitos: false,
    animaisVoltam: true,
    vitoriaPorObra: false,
    abatesParaVencer: null,
    pesoQueVence: PESO_MINIMO,
    temGuardiao: true,
    temCaca: false,
    temCajado: false,
    temFuga: false,
    temNoite: false,
  },
  caca: {
    id: 'caca',
    nome: 'Caça',
    lema: 'uma Presa nasce sem parar no meio do mapa · derrubá-la turbina o dano do time por um tempo',
    pontosParaVencer: PONTOS_PARA_VENCER,
    duracao: DURACAO_DA_PARTIDA,
    renascimentoBase: RENASCIMENTO_BASE,
    vitoriaPorBalanca: false,
    chapeusInfinitos: false,
    animaisVoltam: true,
    vitoriaPorObra: false,
    abatesParaVencer: null,
    pesoQueVence: PESO_MINIMO,
    temGuardiao: false,
    temCaca: true,
    temCajado: false,
    temFuga: false,
    temNoite: false,
  },
  xama: {
    id: 'xama',
    nome: 'Xamã',
    lema: 'um cajado nasce sem parar no meio do mapa · quem pega pode transformar um inimigo em porco',
    pontosParaVencer: PONTOS_PARA_VENCER,
    duracao: DURACAO_DA_PARTIDA,
    renascimentoBase: RENASCIMENTO_BASE,
    vitoriaPorBalanca: false,
    chapeusInfinitos: false,
    animaisVoltam: true,
    vitoriaPorObra: false,
    abatesParaVencer: null,
    pesoQueVence: PESO_MINIMO,
    temGuardiao: false,
    temCaca: false,
    temCajado: true,
    temFuga: false,
    temNoite: false,
  },
  /**
   * O Cerco: os três chefes neutros de uma vez, e não um por partida.
   *
   * Guardião, Presa e cajado já nasceram desenhados para não saber uns dos
   * outros — cada um lê só a própria chave do modo (`temGuardiao`/`temCaca`/
   * `temCajado`) e nasce no próprio canto do mapa (`covilDe`/`tocaDaPresaDe`/
   * `cajadoDe`, três cantos distintos de propósito). O Cerco não soma código
   * novo: soma as três chaves na mesma linha da tabela, e o tick continua sem
   * saber que este modo existe — a mesma garantia que qualquer outro modo
   * daqui já tem.
   */
  cerco: {
    id: 'cerco',
    nome: 'Cerco',
    lema: 'o Guardião, a Presa e o cajado do Xamã, todos ao mesmo tempo',
    pontosParaVencer: PONTOS_PARA_VENCER,
    duracao: DURACAO_DA_PARTIDA,
    renascimentoBase: RENASCIMENTO_BASE,
    vitoriaPorBalanca: false,
    chapeusInfinitos: false,
    animaisVoltam: true,
    vitoriaPorObra: false,
    abatesParaVencer: null,
    pesoQueVence: PESO_MINIMO,
    temGuardiao: true,
    temCaca: true,
    temCajado: true,
    temFuga: false,
    temNoite: false,
  },
  /**
   * A Fuga: um cativo neutro no meio do mapa — o Menino Rei — que qualquer
   * um dos dois times pode libertar apertando "usar" perto dele, desde que
   * a guarda inimiga ao redor já tenha sido limpa. Ao contrário do
   * Guardião e da Presa, ele não é alvo do sistema de combate: a conta é só
   * de gente perto, e vencer é libertá-lo — não derrubá-lo. Ver `pve.ts` e
   * `usar()` em partida.ts.
   */
  fuga: {
    id: 'fuga',
    nome: 'Fuga',
    lema: 'liberte o Menino Rei — mas só depois de afastar a guarda dele',
    pontosParaVencer: PONTOS_PARA_VENCER,
    duracao: DURACAO_DA_PARTIDA,
    renascimentoBase: RENASCIMENTO_BASE,
    vitoriaPorBalanca: false,
    chapeusInfinitos: false,
    animaisVoltam: true,
    vitoriaPorObra: false,
    abatesParaVencer: null,
    pesoQueVence: PESO_MINIMO,
    temGuardiao: false,
    temCaca: false,
    temCajado: false,
    temFuga: true,
    temNoite: false,
  },
  /**
   * A Vigília: dia e noite se alternam, e o Guardião só existe na noite —
   * desperta ao anoitecer, foge (vivo ou morto) ao amanhecer. O resto do
   * modo é o clássico: a economia do dia é o que decide se o time chega
   * pronto para a próxima noite. Ver `moverCicloDoDia` em pve.ts.
   */
  vigilia: {
    id: 'vigilia',
    nome: 'Vigília',
    lema: 'dia e noite se alternam — o Guardião só existe na escuridão',
    pontosParaVencer: PONTOS_PARA_VENCER,
    duracao: DURACAO_DA_PARTIDA,
    renascimentoBase: RENASCIMENTO_BASE,
    vitoriaPorBalanca: false,
    chapeusInfinitos: false,
    animaisVoltam: true,
    vitoriaPorObra: false,
    abatesParaVencer: null,
    pesoQueVence: PESO_MINIMO,
    temGuardiao: false,
    temCaca: false,
    temCajado: false,
    temFuga: false,
    temNoite: true,
  },
};

export const MODO_PADRAO: IdDoModo = 'resgate';

/** A lista, na ordem em que a tela de criação mostra. */
export const IDS_DOS_MODOS: readonly IdDoModo[] = [
  'resgate',
  'assalto',
  'cofrecheio',
  'chapelaria',
  'veiaseca',
  'obra',
  'abate',
  'covil',
  'caca',
  'xama',
  'cerco',
  'fuga',
  'vigilia',
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

/** O peso em que a balança estoura, para o modo que vence por ela. */
export const pesoQueVence = (id: IdDoModo): number => modoDe(id).pesoQueVence;
