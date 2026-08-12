import type { Classe } from './classes';
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
export type Carga = 'nada' | 'trigo' | 'bolo' | 'princesa';

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
  /** Segundos restantes da pose de ataque. Só o desenho usa. */
  golpe: number;
  carga: Carga;
  /** Progresso da colheita, de 0 a 1. */
  colheita: number;
  /** Trigal em que está colhendo. */
  colhendoId: number | null;
  abates: number;
  mortes: number;
  /** Fatias entregues à refém. É o placar do diferencial. */
  fatias: number;
  resgates: number;
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

export type TipoDeProjetil = 'flecha' | 'bola';

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
  raioDoEstouro: number;
  /** Segundos até sumir sozinho. */
  vida: number;
}

export type TipoDeItem = 'chapeu' | 'bolo';

export interface Item {
  id: number;
  tipo: TipoDeItem;
  /** Só chapéu tem classe. */
  classe: Classe | null;
  /** De qual chapelaria o chapéu saiu. Bolo é de quem pegar. */
  origem: Time | null;
  x: number;
  y: number;
  /** Segundos até o chapéu voltar para a chapelaria de origem. */
  voltaEm: number;
}

export interface Trigal {
  id: number;
  maduro: boolean;
  /** Segundos até crescer de novo. */
  cresceEm: number;
  /** Quem está colhendo agora. Dois aldeões no mesmo pé não somam. */
  ocupadoPor: number | null;
}

export interface Cozinha {
  time: Time;
  trigo: number;
  /** Segundos de forno restantes. Zero quando não há nada assando. */
  assando: number;
  /** Bolos prontos esperando alguém pegar. */
  bolos: number;
}

export type Evento =
  | { tipo: 'abate'; algoz: number; vitima: number }
  | { tipo: 'fatia'; unidade: number; princesa: Time; peso: number }
  | { tipo: 'resgate'; unidade: number; time: Time }
  | { tipo: 'chapeu'; unidade: number; classe: Classe; roubado: boolean }
  | { tipo: 'pegouPrincesa'; unidade: number; princesa: Time }
  | { tipo: 'largouPrincesa'; princesa: Time }
  | { tipo: 'fim'; vencedor: Time | null };

export interface Estado {
  tick: number;
  fase: Fase;
  /** Segundos restantes da fase (aquecimento, pausa de ponto). */
  faseEm: number;
  /** Segundos restantes da partida. */
  relogio: number;
  placar: Record<Time, number>;
  unidades: Unidade[];
  princesas: Princesa[];
  projeteis: Projetil[];
  itens: Item[];
  trigais: Trigal[];
  cozinhas: Cozinha[];
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
