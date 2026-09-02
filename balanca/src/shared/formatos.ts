import { IDS_DOS_MAPAS, MAPAS, porTimeMaximo, type IdDoMapa } from './mapas';

/**
 * Os tamanhos de partida com nome, como dado.
 *
 * ## Por que uma tabela, e não só um número maior
 *
 * O teto de jogadores por time subiu de seis para trinta e dois. Sozinho, isso
 * dá um contador de mais e menos com trinta e duas posições — e ninguém clica
 * vinte e seis vezes para montar uma partida grande. O que as pessoas querem
 * dizer é "dezesseis contra dezesseis", que é um **formato**, não um número.
 *
 * Cada formato é um botão. O contador continua existindo para quem quer sete
 * contra sete, porque o formato é um atalho e não uma gaiola.
 *
 * ## O campo vem junto
 *
 * Um formato carrega o mapa mínimo que ele exige, porque as duas coisas não são
 * separáveis: dezesseis por lado no Corte é uma fila na ponte. Escolher o
 * formato grande troca o campo junto, e é a única maneira de o botão cumprir o
 * que promete.
 *
 * Quem quiser dezesseis por lado num campo pequeno ainda consegue — é só mexer
 * no contador depois. O formato escolhe por você uma vez; ele não decide por
 * você para sempre.
 */
export interface Formato {
  readonly id: string;
  readonly nome: string;
  readonly porTime: number;
  /** Uma linha: o que muda quando a partida tem este tamanho. */
  readonly lema: string;
}

export const FORMATOS: readonly Formato[] = [
  {
    id: 'seis',
    nome: '6 × 6',
    porTime: 6,
    lema: 'o tamanho em que o jogo foi medido · cabe em qualquer campo',
  },
  {
    id: 'oito',
    nome: '8 × 8',
    porTime: 8,
    lema: 'o mesmo jogo com uma frente a mais · ainda cabe nos campos pequenos',
  },
  {
    id: 'dezesseis',
    nome: '16 × 16',
    porTime: 16,
    lema: 'exige campo grande · o time se divide em frentes ou não chega a lugar nenhum',
  },
  {
    id: 'trintaedois',
    nome: '32 × 32',
    porTime: 32,
    lema: 'sessenta e quatro em campo · o cortejo do baú vira uma operação de guerra',
  },
];

/**
 * O menor campo em que este formato cabe.
 *
 * Devolve `null` quando **nenhum** mapa comporta o formato, o que hoje não
 * acontece e é justamente o ponto: se um dia alguém subir o teto sem desenhar o
 * campo, isto vira `null` e a tela não oferece um botão que não funciona.
 */
export function campoPara(porTime: number): IdDoMapa | null {
  const cabem = IDS_DOS_MAPAS.filter((id) => porTimeMaximo(MAPAS[id]) >= porTime);
  if (cabem.length === 0) return null;
  // O menor que serve: um formato de oito não devia arrastar quem o escolheu
  // para o campo de trinta e dois só porque ele também caberia lá.
  return cabem.reduce((a, b) =>
    MAPAS[a].largura * MAPAS[a].altura <= MAPAS[b].largura * MAPAS[b].altura ? a : b,
  );
}
