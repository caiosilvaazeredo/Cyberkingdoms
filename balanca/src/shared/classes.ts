/**
 * As cinco classes, e o estoque de chapéus que as distribui.
 *
 * ## O chapéu é um objeto, não uma escolha de menu
 *
 * Trocar de classe não é abrir uma tela: é ir até a chapelaria do seu castelo e
 * pegar um chapéu que existe fisicamente. O estoque é finito, e é por isso que
 * a composição do time é uma decisão coletiva — o segundo mago do seu time é o
 * mago que o terceiro não vai poder ser.
 *
 * E, o que dá a virada: quando alguém morre, o chapéu **cai onde caiu o dono**.
 * Qualquer um pega, inclusive o inimigo. Vencer uma troca no meio do campo pode
 * significar voltar para casa vestindo o chapéu de arqueiro que o outro time
 * acabou de perder — e o outro time fica sem ele até matar você.
 *
 * O aldeão não tem chapéu no estoque porque é o estado natural: quem morre sem
 * chapéu, ou entrega o seu, volta a ser aldeão. Sempre há aldeão disponível, e
 * é ele quem sustenta a economia do bolo.
 */

export type Classe = 'aldeao' | 'guerreiro' | 'arqueiro' | 'mago' | 'sacerdote';

export const CLASSES: readonly Classe[] = [
  'aldeao',
  'guerreiro',
  'arqueiro',
  'mago',
  'sacerdote',
];

/** Como o ataque da classe atinge. */
export type TipoDeAtaque =
  /** Toca no alcance, na hora. */
  | 'corpo'
  /** Solta um projétil que viaja. */
  | 'flecha'
  /** Projétil lento que estoura numa área. */
  | 'bola'
  /** Não fere: cura o aliado mais ferido no alcance. */
  | 'cura';

export interface PerfilDeClasse {
  readonly id: Classe;
  readonly nome: string;
  /** Uma linha, do jeito que o jogador leria no chapéu. */
  readonly resumo: string;
  readonly vida: number;
  /** Unidades de mundo por segundo. */
  readonly velocidade: number;
  readonly ataque: TipoDeAtaque;
  /** Dano por acerto, ou cura, quando `ataque` é `'cura'`. */
  readonly dano: number;
  readonly alcance: number;
  /** Segundos entre dois ataques. */
  readonly cadencia: number;
  /** Raio do estouro, para `'bola'`. */
  readonly raioDoEstouro: number;
  /** Só o aldeão colhe trigo. É o preço de virar guerreiro. */
  readonly colhe: boolean;
  /** Cor do capuz no desenho, sobre a cor do time. */
  readonly tintaDoChapeu: string;
}

const PERFIS: Record<Classe, PerfilDeClasse> = {
  aldeao: {
    id: 'aldeao',
    nome: 'Aldeão',
    resumo: 'Colhe trigo, abastece a cozinha e apanha se ficar na frente.',
    vida: 90,
    velocidade: 215,
    ataque: 'corpo',
    dano: 9,
    alcance: 46,
    cadencia: 0.55,
    raioDoEstouro: 0,
    colhe: true,
    tintaDoChapeu: '#d9c8a2',
  },
  guerreiro: {
    id: 'guerreiro',
    nome: 'Guerreiro',
    resumo: 'Aguenta pancada e segura portão. O corpo a corpo é dele.',
    vida: 170,
    velocidade: 195,
    ataque: 'corpo',
    dano: 26,
    alcance: 58,
    cadencia: 0.7,
    raioDoEstouro: 0,
    colhe: false,
    tintaDoChapeu: '#c0392b',
  },
  arqueiro: {
    id: 'arqueiro',
    nome: 'Arqueiro',
    resumo: 'Fura a linha de longe. Frágil se deixarem chegar perto.',
    vida: 95,
    velocidade: 205,
    ataque: 'flecha',
    dano: 21,
    alcance: 520,
    cadencia: 0.95,
    raioDoEstouro: 0,
    colhe: false,
    tintaDoChapeu: '#27ae60',
  },
  mago: {
    id: 'mago',
    nome: 'Mago',
    resumo: 'Bola de fogo lenta que estoura em área. Limpa aglomeração.',
    vida: 80,
    velocidade: 180,
    ataque: 'bola',
    dano: 34,
    alcance: 430,
    cadencia: 1.7,
    raioDoEstouro: 95,
    colhe: false,
    tintaDoChapeu: '#8e44ad',
  },
  sacerdote: {
    id: 'sacerdote',
    nome: 'Sacerdote',
    resumo: 'Cura quem está carregando a princesa. Ganha a partida sem matar.',
    vida: 105,
    velocidade: 200,
    ataque: 'cura',
    dano: 24,
    alcance: 250,
    cadencia: 1.0,
    raioDoEstouro: 0,
    colhe: false,
    tintaDoChapeu: '#ecf0f1',
  },
};

export function perfil(classe: Classe): PerfilDeClasse {
  return PERFIS[classe];
}

/**
 * O estoque inicial da chapelaria de cada time.
 *
 * Onze chapéus para seis jogadores: sobra escolha, mas não sobra para todo
 * mundo virar mago. O aldeão não aparece aqui — é o padrão, e é infinito.
 */
export const ESTOQUE_INICIAL: Readonly<Record<Classe, number>> = {
  aldeao: 0,
  guerreiro: 4,
  arqueiro: 3,
  mago: 2,
  sacerdote: 2,
};

/** As classes que existem como chapéu, na ordem em que a chapelaria mostra. */
export const CLASSES_COM_CHAPEU: readonly Classe[] = [
  'guerreiro',
  'arqueiro',
  'mago',
  'sacerdote',
];
