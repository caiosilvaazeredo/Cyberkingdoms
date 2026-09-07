import ABATE_JSON from './modos-dados/abate.json';
import ASSALTO_JSON from './modos-dados/assalto.json';
import CACA_JSON from './modos-dados/caca.json';
import CERCO_JSON from './modos-dados/cerco.json';
import CHAPELARIA_JSON from './modos-dados/chapelaria.json';
import COFRECHEIO_JSON from './modos-dados/cofrecheio.json';
import COVIL_JSON from './modos-dados/covil.json';
import FUGA_JSON from './modos-dados/fuga.json';
import OBRA_JSON from './modos-dados/obra.json';
import RESGATE_JSON from './modos-dados/resgate.json';
import VEIASECA_JSON from './modos-dados/veiaseca.json';
import VIGILIA_JSON from './modos-dados/vigilia.json';
import XAMA_JSON from './modos-dados/xama.json';

import type { Gatilho } from './gatilhos';

/**
 * Os modos de jogo: o mesmo jogo com uma alavanca puxada — agora como dado,
 * na mesma fase da engine que tirou os mapas do código (ver `mapas.ts`).
 *
 * ## Uma tabela, e não quatro caminhos no código
 *
 * A tentação de um modo de jogo é escrever `if (modo === 'assalto')` no meio do
 * tick. Feito quatro vezes, o tick vira uma árvore que ninguém consegue ler, e
 * cada regra nova precisa lembrar de todos os modos — que é como um jogo ganha
 * um modo em que o baú não anda e ninguém descobre por três meses.
 *
 * Aqui um modo é um registro de números e chaves que o tick lê no lugar das
 * constantes, e desde esta fase esse registro é um arquivo
 * `modos-dados/<id>.json` — o editor (aba "Modos") escreve exatamente este
 * formato, e o tick continua sem saber o nome de nenhum modo.
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
 *
 * ## Por que "Abate" não usa `Infinity` no JSON
 *
 * O código de antes usava `Number.POSITIVE_INFINITY` para `pontosParaVencer`
 * — "resgate não decide nada aqui". JSON não tem infinito (`JSON.stringify`
 * viraria `null`), e um milhão cumpre exatamente o mesmo papel: nenhuma
 * partida chega perto disso em oito minutos.
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

export interface EsquemaDeModo {
  readonly id: string;
  /** Como aparece na tela de criação de sala. */
  readonly nome: string;
  /** Uma linha: o que muda, dito para quem vai escolher. */
  readonly lema: string;
  /** Resgates para vencer. Ver a nota sobre "Abate" acima. */
  readonly pontosParaVencer: number;
  /** Duração, em segundos. */
  readonly duracao: number;
  /** Base do tempo de renascimento, em segundos. */
  readonly renascimentoBase: number;
  /**
   * A balança também vence: levar a própria refém ao peso mínimo — isto é,
   * empanturrar o baú que se guarda — acaba a partida na hora.
   */
  readonly vitoriaPorBalanca: boolean;
  /** A chapelaria nunca fica vazia: chapéu deixa de ser recurso disputado. */
  readonly chapeusInfinitos: boolean;
  /** O bicho abatido volta ao pasto depois de um tempo. */
  readonly animaisVoltam: boolean;
  /** Levar a chapelaria ao nível máximo vence a partida. */
  readonly vitoriaPorObra: boolean;
  /** O peso em que a balança estoura e o modo por balança acaba. */
  readonly pesoQueVence: number;
  /** Abates que vencem a partida, ou `null` quando matar não é o objetivo. */
  readonly abatesParaVencer: number | null;
  /** O Guardião nasce no meio do mapa. Ver `pve.ts` e `GUARDIAO_*`. */
  readonly temGuardiao: boolean;
  /** A Presa nasce sem parar no meio do mapa. Ver `pve.ts` e `PRESA_*`. */
  readonly temCaca: boolean;
  /** O cajado do Xamã nasce sem parar no meio do mapa. Ver `CAJADO_*`/`XAMA_*`. */
  readonly temCajado: boolean;
  /** O Menino Rei nasce no meio do mapa, à espera de ser libertado. */
  readonly temFuga: boolean;
  /** Dia e noite se alternam, e o Guardião só existe à noite. */
  readonly temNoite: boolean;
  /**
   * A fase 5 da engine: comportamento extra que não cabe numa flag booleana
   * — hoje só "avisar todo mundo a cada N segundos". Ver a nota extensa em
   * `gatilhos.ts` sobre por que o vocabulário começa (e deve continuar)
   * pequeno. `undefined`/lista vazia é a esmagadora maioria dos modos: os
   * treze que já existem não usam nenhum.
   */
  readonly gatilhos?: readonly Gatilho[];
}

/** Um modo depois de carregado — o mesmo `EsquemaDeModo`, com `id` fechado
 * para o tipo que o resto do jogo indexa. */
export type Modo = Omit<EsquemaDeModo, 'id'> & { readonly id: IdDoModo };

function comId<I extends IdDoModo>(bruto: unknown, id: I): Modo {
  return { ...(bruto as EsquemaDeModo), id };
}

/**
 * Os treze modos.
 *
 * - **Resgate** é o jogo como ele foi desenhado, e é o padrão. Os outros são
 *   desvios dele, não jogos diferentes.
 * - **Assalto** existe para o sofá: uma rodada inteira em seis minutos, com um
 *   resgate só decidindo.
 * - **Cofre Cheio** promove a balança a condição de vitória.
 * - **Chapelaria aberta** tira a escassez de chapéus.
 * - **Veia Seca**, **Obra** e **Abate** mudam a economia, a condição de
 *   vitória e o combate, cada um numa única alavanca.
 * - **Covil**, **Caça**, **Xamã** e **Cerco** somam chefes neutros — o Cerco
 *   soma os três de uma vez, sem código novo (ver a nota no arquivo de dado).
 * - **Fuga** e **Vigília** somam um objetivo e um relógio de dia/noite,
 *   cada um sua própria alavanca.
 */
export const MODOS: Readonly<Record<IdDoModo, Modo>> = {
  resgate: comId(RESGATE_JSON, 'resgate'),
  assalto: comId(ASSALTO_JSON, 'assalto'),
  cofrecheio: comId(COFRECHEIO_JSON, 'cofrecheio'),
  chapelaria: comId(CHAPELARIA_JSON, 'chapelaria'),
  veiaseca: comId(VEIASECA_JSON, 'veiaseca'),
  obra: comId(OBRA_JSON, 'obra'),
  abate: comId(ABATE_JSON, 'abate'),
  covil: comId(COVIL_JSON, 'covil'),
  caca: comId(CACA_JSON, 'caca'),
  xama: comId(XAMA_JSON, 'xama'),
  cerco: comId(CERCO_JSON, 'cerco'),
  fuga: comId(FUGA_JSON, 'fuga'),
  vigilia: comId(VIGILIA_JSON, 'vigilia'),
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
