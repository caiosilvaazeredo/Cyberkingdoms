import ALDEAO_JSON from './classes-dados/aldeao.json';
import ARQUEIRO_JSON from './classes-dados/arqueiro.json';
import CLERIGO_JSON from './classes-dados/clerigo.json';
import GUERREIRO_JSON from './classes-dados/guerreiro.json';
import LANCEIRO_JSON from './classes-dados/lanceiro.json';
import LENHADOR_JSON from './classes-dados/lenhador.json';
import MINERADOR_JSON from './classes-dados/minerador.json';
import SAQUEADOR_JSON from './classes-dados/saqueador.json';

/**
 * As sete classes, o estoque de chapéus e o que cada ofício sabe fazer.
 *
 * ## Quatro que brigam, três que sustentam
 *
 * O jogo tem duas frentes, e as classes se dividem exatamente nelas. Guerreiro,
 * lanceiro, arqueiro e clérigo decidem quem passa pela ponte. Minerador,
 * lenhador e saqueador decidem quanto o reino tem para gastar — e como a balança
 * só se move com bolsa, e bolsa só existe com minério, o time que ignora o ofício
 * perde a partida sem nunca perder uma briga.
 *
 * ## O chapéu é um objeto, não uma escolha de menu
 *
 * Trocar de classe é ir até a chapelaria e pegar um chapéu que existe. O
 * estoque é finito: o segundo arqueiro do seu time é o arqueiro que o terceiro
 * não vai poder ser. E quando alguém morre, o chapéu **cai onde caiu o dono** —
 * qualquer um pega, inclusive o inimigo.
 *
 * O aldeão não tem chapéu no estoque porque é o estado natural: quem morre sem
 * chapéu volta a ser aldeão. Ele colhe qualquer coisa, e mal: é o que impede um
 * time sem chapéus de ficar sem economia, sem tirar do especialista a razão de
 * existir.
 *
 * ## Por que cada classe tem um gesto próprio
 *
 * O arco da espada, a estocada da lança, o arco sendo puxado, a picareta caindo
 * — cada uma é desenhada com um movimento diferente porque, numa briga de doze
 * bonecos iguais, o **gesto** é a única coisa que diz de longe quem é quem. A
 * silhueta do Tiny Swords é a mesma para todo mundo; a arma na mão não é.
 */

export type Classe =
  | 'aldeao'
  | 'guerreiro'
  | 'lanceiro'
  | 'arqueiro'
  | 'clerigo'
  | 'minerador'
  | 'lenhador'
  | 'saqueador';

export const CLASSES: readonly Classe[] = [
  'aldeao',
  'guerreiro',
  'lanceiro',
  'arqueiro',
  'clerigo',
  'minerador',
  'lenhador',
  'saqueador',
];

/** Como o golpe da classe atinge. */
export type TipoDeAtaque =
  /** Meia-volta à frente, no alcance. Espada, machado, picareta, faca. */
  | 'corpo'
  /** Uma linha reta à frente: atinge todos até o alcance. É a lança. */
  | 'linha'
  /** Solta um projétil que viaja. */
  | 'flecha'
  /** Não fere: cura o aliado mais ferido no alcance. */
  | 'cura';

/** O gesto do golpe. Só o desenho usa, e é o que distingue as classes na tela. */
export type Gesto = 'arco' | 'estocada' | 'disparo' | 'bencao' | 'picareta' | 'machado' | 'faca';

/** O que a classe consegue tirar do mundo. */
export type Oficio = 'ouro' | 'madeira' | 'minerio';

export interface EsquemaDeClasse {
  readonly id: string;
  readonly nome: string;
  /** Uma linha, do jeito que o jogador leria no chapéu. */
  readonly resumo: string;
  readonly vida: number;
  /** Unidades de mundo por segundo. */
  readonly velocidade: number;
  readonly ataque: TipoDeAtaque;
  readonly gesto: Gesto;
  /** Dano por acerto, ou cura, quando `ataque` é `'cura'`. */
  readonly dano: number;
  readonly alcance: number;
  /** Segundos entre dois golpes. */
  readonly cadencia: number;
  /** Segundos que o gesto do golpe dura na tela. */
  readonly duracaoDoGolpe: number;
  /**
   * O ofício em que esta classe é rápida. `null` no aldeão, que faz todos
   * devagar, e nas classes de combate, que não fazem nenhum.
   */
  readonly oficio: Oficio | null;
  /** Multiplicador do dano contra bicho. É o que faz o saqueador caçar. */
  readonly danoContraAnimal: number;
  readonly tintaDoChapeu: string;
  /** Cor da arma no desenho. */
  readonly tintaDaArma: string;
}


/**
 * Um perfil depois de carregado — o mesmo `EsquemaDeClasse`, com `id`
 * fechado para o tipo que o resto do jogo indexa.
 */
export type PerfilDeClasse = Omit<EsquemaDeClasse, 'id'> & { readonly id: Classe };

function comId<I extends Classe>(bruto: unknown, id: I): PerfilDeClasse {
  return { ...(bruto as EsquemaDeClasse), id };
}

const PERFIS: Record<Classe, PerfilDeClasse> = {
  aldeao: comId(ALDEAO_JSON, 'aldeao'),
  guerreiro: comId(GUERREIRO_JSON, 'guerreiro'),
  lanceiro: comId(LANCEIRO_JSON, 'lanceiro'),
  arqueiro: comId(ARQUEIRO_JSON, 'arqueiro'),
  clerigo: comId(CLERIGO_JSON, 'clerigo'),
  minerador: comId(MINERADOR_JSON, 'minerador'),
  lenhador: comId(LENHADOR_JSON, 'lenhador'),
  saqueador: comId(SAQUEADOR_JSON, 'saqueador'),
};

export function perfil(classe: Classe): PerfilDeClasse {
  return PERFIS[classe];
}

/** As classes que existem como chapéu, na ordem em que a chapelaria oferece. */
export const CLASSES_COM_CHAPEU: readonly Classe[] = [
  'guerreiro',
  'lanceiro',
  'arqueiro',
  'clerigo',
  'minerador',
  'lenhador',
  'saqueador',
];

/**
 * O estoque inicial da chapelaria de cada time.
 *
 * Dezesseis chapéus para seis jogadores: sobra escolha, e não sobra para todo
 * mundo virar guerreiro. A proporção diz o que o jogo espera de um time — mais
 * braço do que ofício, mas nunca ofício nenhum.
 */
export const ESTOQUE_INICIAL: Readonly<Record<Classe, number>> = {
  aldeao: 0,
  guerreiro: 3,
  lanceiro: 3,
  arqueiro: 3,
  clerigo: 2,
  minerador: 2,
  lenhador: 2,
  saqueador: 2,
};

/** Quanto o aldeão é mais lento que o especialista no mesmo trabalho. */
export const LERDEZA_DO_ALDEAO = 1.8;

/**
 * O bônus que a obra dá às classes.
 *
 * A madeira e a pedra que os ofícios trazem sobem o nível da chapelaria, e o
 * nível engorda vida e dano de todo mundo do time. É o que dá ao minerador e ao
 * lenhador um efeito visível numa briga da qual eles não participam.
 */
export function bonusDoNivel(nivel: number): number {
  return 1 + 0.15 * (Math.max(1, Math.min(3, nivel)) - 1);
}

export function vidaMaxima(classe: Classe, nivel: number): number {
  return Math.round(perfil(classe).vida * bonusDoNivel(nivel));
}

export function danoDe(classe: Classe, nivel: number): number {
  return perfil(classe).dano * bonusDoNivel(nivel);
}

/**
 * A fera: uma transformação passageira, não uma classe.
 *
 * Não entra em `Classe` de propósito. `Classe` é uma união exaustiva que
 * toda tabela do jogo precisa cobrir — chapelaria, estoque, protocolo,
 * ícone de menu, elenco na tela inicial — e o Modo Fera é um evento raro
 * dentro de **qualquer** modo, não uma oitava classe para vestir. Ele vive
 * ao lado da classe (`Unidade.fera`), não no lugar dela: quem vira Troll
 * continua sendo o mesmo aldeão ou guerreiro por baixo, e volta a ser
 * exatamente isso quando o tempo acaba.
 *
 * Os números não escalam com o nível da obra: um Troll é um Troll, em
 * qualquer partida, para o jogador sempre saber com o que está lidando.
 */
export type Fera = 'troll' | 'minotauro';

export interface PerfilDeFera {
  readonly nome: string;
  readonly vida: number;
  readonly velocidade: number;
  readonly dano: number;
  readonly alcance: number;
  readonly cadencia: number;
  readonly duracaoDoGolpe: number;
}

export const PERFIS_DE_FERA: Readonly<Record<Fera, PerfilDeFera>> = {
  troll: {
    nome: 'Troll',
    vida: 340,
    velocidade: 165,
    dano: 34,
    alcance: 70,
    cadencia: 1.6,
    duracaoDoGolpe: 0.9,
  },
  minotauro: {
    nome: 'Minotauro',
    vida: 300,
    velocidade: 195,
    dano: 30,
    alcance: 62,
    cadencia: 1.1,
    duracaoDoGolpe: 0.6,
  },
};

/** `vidaMaxima`, mas ciente de que a unidade pode estar transformada. */
export function vidaMaximaDe(classe: Classe, nivel: number, fera: Fera | null): number {
  return fera ? PERFIS_DE_FERA[fera].vida : vidaMaxima(classe, nivel);
}
