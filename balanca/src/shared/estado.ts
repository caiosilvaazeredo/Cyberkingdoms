import type { Classe, Oficio } from './classes';
import type { IdDoModo } from './modos';
import type { Time } from './regras';

/**
 * O estado de uma partida — os tipos, sem nenhuma regra.
 *
 * Separar tipo de lógica não é cerimônia: o cliente precisa dos tipos para
 * desenhar, os bots para decidir e o servidor para simular, mas só o servidor
 * roda o tick. Se os tipos morassem junto com o tick, importar "o formato de
 * uma unidade" arrastaria a simulação inteira para dentro do navegador.
 */

export type Fase = 'aquecimento' | 'jogando' | 'ponto' | 'fim';

/** O que a unidade tem nas mãos. Uma coisa de cada vez, sempre. */
export type Carga = 'nada' | 'madeira' | 'ouro' | 'carne' | 'bolo' | 'princesa';

/** A carga que cada ofício produz. */
export const CARGA_DO_OFICIO: Readonly<Record<Oficio, Carga>> = {
  madeira: 'madeira',
  ouro: 'ouro',
  carne: 'carne',
};

export interface Unidade {
  id: number;
  time: Time;
  nome: string;
  /** Um bot é um jogador que o servidor controla; nada mais o distingue. */
  bot: boolean;
  classe: Classe;
  x: number;
  y: number;
  /** Última direção com intenção de movimento. Só o desenho usa. */
  olharX: number;
  olharY: number;
  vida: number;
  vivo: boolean;
  /** Segundos até renascer. Só vale com `vivo` falso. */
  renasceEm: number;
  /** Segundos até o próximo ataque poder sair. */
  recarga: number;
  /**
   * Segundos restantes do gesto do golpe.
   *
   * É o relógio da animação: o desenho divide isto pela duração da classe e
   * sabe em que ponto do arco, da estocada ou da puxada de arco o boneco está.
   * Vem no retrato justamente para que o gesto do vizinho apareça igual na sua
   * tela e na dele.
   */
  golpe: number;
  carga: Carga;
  /** Progresso do trabalho, de 0 a 1. */
  colheita: number;
  /** Jazida em que está trabalhando. */
  colhendoId: number | null;
  abates: number;
  mortes: number;
  /** Fatias entregues à refém. É o placar do diferencial. */
  fatias: number;
  resgates: number;
  /** Carga entregue em casa: carne, madeira e pedra somadas. */
  entregas: number;
  /** Último comando confirmado, para o cliente reconciliar a previsão. */
  ultimoComando: number;
}

/**
 * Uma princesa, e onde ela está.
 *
 * `time` é de quem ela **é**, não onde está: a princesa azul começa a partida
 * dentro da masmorra vermelha. Confundir isso inverte o jogo inteiro, e é o
 * tipo de erro que só aparece quando alguém marca ponto para o time errado.
 */
export interface Princesa {
  time: Time;
  peso: number;
  onde: 'jaula' | 'carregada' | 'chao' | 'salva';
  x: number;
  y: number;
  /** Quem está na frente do cortejo. */
  portador: number | null;
  /** Segundos até voltar sozinha para a masmorra, largada no chão. */
  voltaEm: number;
  /** Carregadores encostados no último tick. Diagnóstico e HUD. */
  ajudantes: number;
}

export type TipoDeProjetil = 'flecha';

export interface Projetil {
  id: number;
  tipo: TipoDeProjetil;
  time: Time;
  dono: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  dano: number;
  /** Segundos até sumir sozinho. */
  vida: number;
}

export type TipoDeItem = 'chapeu' | 'bolo' | 'carne' | 'madeira' | 'ouro';

export interface Item {
  id: number;
  tipo: TipoDeItem;
  /** Só chapéu tem classe. */
  classe: Classe | null;
  /** De qual chapelaria o chapéu saiu. O resto é de quem pegar. */
  origem: Time | null;
  x: number;
  y: number;
  /** Segundos até o chapéu voltar para a chapelaria de origem. */
  voltaEm: number;
}

/** Uma árvore de corte ou uma pedreira. Onde ela fica é coisa da arena. */
export interface Jazida {
  id: number;
  /** Falso enquanto se recompõe: árvore vira toco, pedreira vira cascalho. */
  cheia: boolean;
  /** Segundos até voltar a render. */
  voltaEm: number;
  /** Quem está trabalhando nela agora. Dois na mesma pedra não somam. */
  ocupadaPor: number | null;
}

/**
 * Um bicho, que é o único jeito de conseguir carne.
 *
 * O caçador não enche uma barra de progresso: ele **mata** o bicho, e o bicho
 * corre. É a única fonte de recurso do jogo que exige mirar, e é de propósito —
 * dá ao ofício mais barulhento um gesto de combate em vez de um de espera.
 */
export interface Animal {
  id: number;
  x: number;
  y: number;
  vida: number;
  vivo: boolean;
  /** Segundos até outro bicho aparecer no lugar deste. */
  voltaEm: number;
  /** Para onde está caminhando agora. */
  destinoX: number;
  destinoY: number;
  /** Segundos até escolher outro destino. */
  pensaEm: number;
  /** Segundos restantes de pânico: assustado, ele corre em vez de pastar. */
  fugindo: number;
}

export interface Cozinha {
  time: Time;
  carne: number;
  /** Segundos de forno restantes. Zero quando não há nada assando. */
  assando: number;
  /** Bolos prontos esperando alguém pegar. */
  bolos: number;
}

/**
 * A obra do reino: o que o minerador e o lenhador constroem.
 *
 * Madeira e pedra entregues na chapelaria sobem o nível dela, e o nível engorda
 * vida e dano de todo o time. É por aqui que um ofício que nunca chega perto da
 * ponte decide quem ganha a briga na ponte.
 */
export interface Oficina {
  time: Time;
  madeira: number;
  ouro: number;
  /** De 1 a 3. */
  nivel: number;
}

export type Evento =
  | { tipo: 'abate'; algoz: number; vitima: number }
  | { tipo: 'fatia'; unidade: number; princesa: Time; peso: number }
  | { tipo: 'resgate'; unidade: number; time: Time }
  | { tipo: 'chapeu'; unidade: number; classe: Classe; roubado: boolean }
  | { tipo: 'pegouPrincesa'; unidade: number; princesa: Time }
  | { tipo: 'largouPrincesa'; princesa: Time }
  | { tipo: 'caca'; unidade: number }
  | { tipo: 'cura'; clerigo: number; alvo: number }
  | { tipo: 'nivel'; time: Time; nivel: number }
  | { tipo: 'fim'; vencedor: Time | null };

export interface Estado {
  tick: number;
  /**
   * O modo desta partida.
   *
   * Mora no estado, e não na sala, porque o cliente prevê o movimento rodando a
   * mesma simulação do servidor: com o modo só do lado do servidor, a previsão
   * rodaria com as regras erradas. Aqui ele viaja no retrato e os dois lados
   * concordam de graça. Ver `modos.ts`.
   */
  modo: IdDoModo;
  fase: Fase;
  /** Segundos restantes da fase (aquecimento, pausa de ponto). */
  faseEm: number;
  /** Segundos restantes da partida. */
  relogio: number;
  placar: Record<Time, number>;
  /**
   * Baixas causadas por cada time, acumuladas na partida.
   *
   * Guardadas aqui e não somadas das unidades: quem sai da sala leva os abates
   * dele, e no modo Abate isso faria o placar andar para trás.
   */
  abates: Record<Time, number>;
  unidades: Unidade[];
  princesas: Princesa[];
  projeteis: Projetil[];
  itens: Item[];
  jazidas: Jazida[];
  animais: Animal[];
  cozinhas: Cozinha[];
  oficinas: Oficina[];
  /** Chapéus ainda guardados, por time e classe. */
  estoque: Record<Time, Record<Classe, number>>;
  /** Zerado a cada tick; o servidor despacha e esquece. */
  eventos: Evento[];
  vencedor: Time | null;
  proximoId: number;
}

export function unidade(estado: Estado, id: number | null): Unidade | undefined {
  if (id === null) return undefined;
  return estado.unidades.find((u) => u.id === id);
}

export function princesaDe(estado: Estado, time: Time): Princesa {
  const p = estado.princesas.find((x) => x.time === time);
  if (!p) throw new Error(`princesa ausente: ${time}`);
  return p;
}

export function cozinhaDe(estado: Estado, time: Time): Cozinha {
  const c = estado.cozinhas.find((x) => x.time === time);
  if (!c) throw new Error(`cozinha ausente: ${time}`);
  return c;
}

export function oficinaDe(estado: Estado, time: Time): Oficina {
  const o = estado.oficinas.find((x) => x.time === time);
  if (!o) throw new Error(`oficina ausente: ${time}`);
  return o;
}

export function nivelDe(estado: Estado, time: Time): number {
  return estado.oficinas.find((x) => x.time === time)?.nivel ?? 1;
}
