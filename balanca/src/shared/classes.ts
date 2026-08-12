/**
 * As sete classes, o estoque de chapéus e o que cada ofício sabe fazer.
 *
 * ## Quatro que brigam, três que sustentam
 *
 * O jogo tem duas frentes, e as classes se dividem exatamente nelas. Guerreiro,
 * lanceiro, arqueiro e clérigo decidem quem passa pela ponte. Minerador,
 * lenhador e caçador decidem quanto o reino tem para gastar — e como a balança
 * só se move com bolo, e bolo só existe com carne, o time que ignora o ofício
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
  | 'cacador';

export const CLASSES: readonly Classe[] = [
  'aldeao',
  'guerreiro',
  'lanceiro',
  'arqueiro',
  'clerigo',
  'minerador',
  'lenhador',
  'cacador',
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
export type Oficio = 'ouro' | 'madeira' | 'carne';

export interface PerfilDeClasse {
  readonly id: Classe;
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
  /** Multiplicador do dano contra bicho. É o que faz o caçador caçar. */
  readonly danoContraAnimal: number;
  readonly tintaDoChapeu: string;
  /** Cor da arma no desenho. */
  readonly tintaDaArma: string;
}

const PERFIS: Record<Classe, PerfilDeClasse> = {
  aldeao: {
    id: 'aldeao',
    nome: 'Aldeão',
    resumo: 'Sem chapéu. Junta de tudo, devagar, e apanha se ficar na frente.',
    vida: 90,
    velocidade: 215,
    ataque: 'corpo',
    gesto: 'faca',
    dano: 8,
    alcance: 46,
    cadencia: 0.55,
    duracaoDoGolpe: 0.22,
    oficio: null,
    danoContraAnimal: 1,
    tintaDoChapeu: '#d9c8a2',
    tintaDaArma: '#b9a27a',
  },
  guerreiro: {
    id: 'guerreiro',
    nome: 'Guerreiro',
    resumo: 'Espada em arco: acerta tudo à frente. Aguenta pancada e segura ponte.',
    vida: 175,
    velocidade: 195,
    ataque: 'corpo',
    gesto: 'arco',
    dano: 26,
    alcance: 60,
    cadencia: 0.7,
    duracaoDoGolpe: 0.3,
    oficio: null,
    danoContraAnimal: 1,
    tintaDoChapeu: '#c0392b',
    tintaDaArma: '#d6dde4',
  },
  lanceiro: {
    id: 'lanceiro',
    nome: 'Lanceiro',
    resumo: 'Estocada que fura a fila: alcança longe e atinge todos na linha.',
    vida: 130,
    velocidade: 200,
    ataque: 'linha',
    gesto: 'estocada',
    dano: 23,
    alcance: 108,
    cadencia: 0.85,
    duracaoDoGolpe: 0.26,
    oficio: null,
    danoContraAnimal: 1,
    tintaDoChapeu: '#2f6fd0',
    tintaDaArma: '#9aa7b4',
  },
  arqueiro: {
    id: 'arqueiro',
    nome: 'Arqueiro',
    resumo: 'Puxa o arco e fura a linha de longe. Frágil se deixarem chegar perto.',
    vida: 95,
    velocidade: 205,
    ataque: 'flecha',
    gesto: 'disparo',
    dano: 22,
    alcance: 520,
    cadencia: 0.95,
    duracaoDoGolpe: 0.35,
    oficio: null,
    danoContraAnimal: 1.5,
    tintaDoChapeu: '#27ae60',
    tintaDaArma: '#8a5a2b',
  },
  clerigo: {
    id: 'clerigo',
    nome: 'Clérigo',
    resumo: 'Ergue o cajado e cura quem carrega a princesa. Ganha sem matar.',
    vida: 110,
    velocidade: 200,
    ataque: 'cura',
    gesto: 'bencao',
    dano: 26,
    alcance: 250,
    cadencia: 1,
    duracaoDoGolpe: 0.45,
    oficio: null,
    danoContraAnimal: 1,
    tintaDoChapeu: '#ecf0f1',
    tintaDaArma: '#f5c542',
  },
  minerador: {
    id: 'minerador',
    nome: 'Minerador',
    resumo: 'Picareta na veia de ouro. O ouro levanta a chapelaria — e a picareta dói.',
    vida: 125,
    velocidade: 195,
    ataque: 'corpo',
    gesto: 'picareta',
    dano: 17,
    alcance: 50,
    cadencia: 0.8,
    duracaoDoGolpe: 0.32,
    oficio: 'ouro',
    danoContraAnimal: 1,
    tintaDoChapeu: '#7f8c8d',
    tintaDaArma: '#95a5a6',
  },
  lenhador: {
    id: 'lenhador',
    nome: 'Lenhador',
    resumo: 'Machado na árvore, e no inimigo se precisar. A madeira levanta o reino.',
    vida: 130,
    velocidade: 200,
    ataque: 'corpo',
    gesto: 'machado',
    dano: 21,
    alcance: 54,
    cadencia: 0.9,
    duracaoDoGolpe: 0.34,
    oficio: 'madeira',
    danoContraAnimal: 1.2,
    tintaDoChapeu: '#8a5a2b',
    tintaDaArma: '#c0392b',
  },
  cacador: {
    id: 'cacador',
    nome: 'Caçador',
    resumo: 'Come quem corre: abate o bicho e leva a carne para a cozinha.',
    vida: 100,
    velocidade: 212,
    ataque: 'corpo',
    gesto: 'faca',
    dano: 14,
    alcance: 58,
    cadencia: 0.55,
    duracaoDoGolpe: 0.18,
    oficio: 'carne',
    danoContraAnimal: 4,
    tintaDoChapeu: '#6b8e23',
    tintaDaArma: '#e8e0c8',
  },
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
  'cacador',
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
  cacador: 2,
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
