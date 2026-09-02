import { MAPA_PADRAO, mapaDe, type IdDoMapa, type Pincel } from './mapas';
import { DeterministicRandom } from './rng';
import { ARENA_ALTURA, ARENA_LARGURA, TILE, TIMES, type Time } from './regras';

/**
 * O campo de batalha: dois castelos ilhados, um descampado no meio.
 *
 * ## Por que o mapa não trafega na rede
 *
 * A arena é uma **função pura da seed**. Servidor e cliente rodam este mesmo
 * arquivo e chegam ao mesmo tile, então o servidor manda um número e o cliente
 * monta o mapa inteiro. Não há mapa serializado para versionar, nem risco de o
 * cliente desenhar uma ponte onde o servidor vê água — o desencontro seria
 * invisível até alguém atravessar.
 *
 * ## Por que fosso, e não muralha
 *
 * O pacote de arte não tem muro. Tem água, e tem espuma que se desenha sozinha
 * onde a terra encosta no mar. Cercar cada castelo com um fosso resolve as duas
 * coisas ao mesmo tempo: dá o estrangulamento que o jogo precisa — só se entra
 * por duas pontes, e é nelas que a partida acontece — e sai bonito de graça,
 * porque o mesmo autotiling que desenha a costa desenha o fosso.
 *
 * ## Simetria por espelho
 *
 * Só o lado azul é escrito. O vermelho é o espelho em X, montado por código.
 * Um mapa competitivo assimétrico exige balanceamento que este jogo não tem
 * como pagar, e duas listas de coordenadas para manter iguais é a receita para
 * o dia em que a Casa da Moeda vermelha fica um tile mais longe do que a azul.
 */

export const AGUA = 0;
export const GRAMA = 1;
export const PONTE = 2;

export type TipoDeEstrutura =
  /** O castelo. Entregar o baú aqui vale ponto. */
  | 'tesouraria'
  /** O cofre onde dorme o baú **inimiga**. É aqui que se alimenta. */
  | 'cofre'
  /** Recebe trigo, devolve bolsa. */
  | 'casaDaMoeda'
  /** O estoque de chapéus do time. */
  | 'chapelaria'
  /** Onde o time renasce. */
  | 'nascedouro';

export interface Estrutura {
  readonly tipo: TipoDeEstrutura;
  readonly time: Time;
  /** Centro, em unidades de mundo. */
  readonly x: number;
  readonly y: number;
  /** Canto superior esquerdo da pegada, em tiles. Só o desenho usa. */
  readonly tx: number;
  readonly ty: number;
}

/** O que uma jazida rende: árvore dá madeira, pedra de ouro dá ouro. */
export type TipoDeJazida = 'arvore' | 'ouro';

export interface Jazida {
  readonly id: number;
  readonly tipo: TipoDeJazida;
  readonly x: number;
  readonly y: number;
  /** `null` quando é do meio do campo, disputada pelos dois. */
  readonly lado: Time | null;
  /** Variante do sprite, para a mata não sair toda igual. */
  readonly variante: number;
}

/** Onde um bicho nasce e para onde ele volta se ninguém o incomodar. */
export interface Pasto {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly lado: Time | null;
}

export interface Arena {
  readonly seed: number;
  /** De que mapa este campo veio. O desenho e o HUD mostram o nome. */
  readonly mapa: IdDoMapa;
  readonly largura: number;
  readonly altura: number;
  readonly tiles: Uint8Array;
  readonly estruturas: readonly Estrutura[];
  readonly jazidas: readonly Jazida[];
  readonly pastos: readonly Pasto[];
  tile(tx: number, ty: number): number;
  ehChao(tx: number, ty: number): boolean;
  bloqueado(tx: number, ty: number): boolean;
  /** O mato deste tile, já resolvido na criação da arena. Ver `decoracaoEm`. */
  decoracao(tx: number, ty: number): DecoracaoNoChao | null;
  estrutura(tipo: TipoDeEstrutura, time: Time): Estrutura;
}

/** Espelha uma coluna para o lado vermelho. */
export const espelhar = (tx: number): number => ARENA_LARGURA - 1 - tx;

/**
 * O castelo do mapa clássico. Reexportado porque o desenho e os testes antigos
 * o conhecem pelo nome; a definição mora com o mapa a que ele pertence.
 */
export { CASTELO, PONTES_Y } from './mapas';

/**
 * O desenho econômico, que agora é de cada mapa e não do arquivo.
 *
 * A divisão continua valendo para todos: parte das jazidas fica **dentro** do
 * castelo e parte em campo aberto. Só com jazida em campo aberto, um time
 * encurralado perde a economia junto com o território e não tem como voltar; só
 * com jazida em casa, ninguém precisaria sair e o meio do mapa seria enfeite.
 * Com as duas, a obra mínima é segura e a obra que **decide a partida** exige
 * sair de casa. O mesmo vale para os pastos: o grosso das ovelhas fica no meio,
 * e um pasto por castelo garante que um time cercado ainda tenha o que comer.
 *
 * O que muda de mapa para mapa é **quanto** cada uma dessas coisas custa. Ver
 * `mapas.ts`.
 */

const centro = (tx: number, ty: number): { x: number; y: number } => ({
  x: (tx + 0.5) * TILE,
  y: (ty + 0.5) * TILE,
});

export function criarArena(seed: number, idDoMapa: IdDoMapa = MAPA_PADRAO): Arena {
  const mapa = mapaDe(idDoMapa);
  const largura = ARENA_LARGURA;
  const altura = ARENA_ALTURA;
  const tiles = new Uint8Array(largura * altura);

  const por = (tx: number, ty: number, v: number): void => {
    if (tx < 0 || ty < 0 || tx >= largura || ty >= altura) return;
    tiles[ty * largura + tx] = v;
  };

  // Chão por toda parte, e uma moldura de água de dois tiles. A moldura não é
  // decoração: é o que impede a câmera de mostrar o vazio fora do mapa.
  tiles.fill(GRAMA);
  for (let ty = 0; ty < altura; ty++) {
    for (let tx = 0; tx < largura; tx++) {
      if (tx < 2 || ty < 2 || tx >= largura - 2 || ty >= altura - 2) por(tx, ty, AGUA);
    }
  }

  // O relevo do mapa. O pincel escreve **nos dois lados** a cada traço, então o
  // mapa só descreve a metade azul e a simetria sai de graça — em vez de sair
  // de duas listas de coordenadas que alguém tem de manter iguais.
  //
  // As curvas do meio ficam certas pelo mesmo motivo: o eixo do espelho é
  // `(largura - 1) / 2`, que cai **entre** dois tiles. Um lago centrado no tile
  // do meio ficaria meio tile deslocado, e a arena deixaria de ser simétrica
  // exatamente onde os dois times se encontram.
  const pincel: Pincel = {
    largura,
    altura,
    agua: (tx, ty) => {
      por(tx, ty, AGUA);
      por(espelhar(tx), ty, AGUA);
    },
    ponte: (tx, ty) => {
      por(tx, ty, PONTE);
      por(espelhar(tx), ty, PONTE);
    },
    chao: (tx, ty) => {
      por(tx, ty, GRAMA);
      por(espelhar(tx), ty, GRAMA);
    },
  };
  mapa.relevo(pincel);

  const estruturas: Estrutura[] = [];
  for (const time of TIMES) {
    for (const tipo of Object.keys(mapa.planta) as TipoDeEstrutura[]) {
      const [tx, ty] = mapa.planta[tipo];
      const cx = time === 'azul' ? tx : espelhar(tx);
      estruturas.push({ tipo, time, tx: cx, ty, ...centro(cx, ty) });
    }
  }

  const jazidas: Jazida[] = [];
  let idJazida = 0;
  for (const time of TIMES) {
    for (const [tx, ty, tipo] of mapa.jazidasDoLado) {
      const cx = time === 'azul' ? tx : espelhar(tx);
      jazidas.push({
        id: idJazida++,
        tipo,
        lado: time,
        variante: (tx + ty) % 4,
        ...centro(cx, ty),
      });
    }
  }
  for (const [tx, ty, tipo] of mapa.jazidasDoMeio) {
    jazidas.push({ id: idJazida++, tipo, lado: null, variante: (tx + ty) % 4, ...centro(tx, ty) });
  }

  const pastos: Pasto[] = [];
  let idPasto = 0;
  for (const time of TIMES) {
    for (const [tx, ty] of mapa.pastosDoLado) {
      const cx = time === 'azul' ? tx : espelhar(tx);
      pastos.push({ id: idPasto++, lado: time, ...centro(cx, ty) });
    }
  }
  for (const [tx, ty] of mapa.pastosDoMeio) {
    pastos.push({ id: idPasto++, lado: null, ...centro(tx, ty) });
  }

  // Nada pode nascer dentro d'água — o lago do meio é grande e a planta é
  // escrita à mão. Errar isso deixaria uma jazida inalcançável, e a economia do
  // time morreria por um erro de digitação.
  for (const ponto of [...jazidas, ...pastos]) {
    const tx = Math.floor(ponto.x / TILE);
    const ty = Math.floor(ponto.y / TILE);
    if (tiles[ty * largura + tx] === AGUA) {
      throw new Error(`ponto ${ponto.id} caiu na água em (${tx}, ${ty})`);
    }
  }

  const tile = (tx: number, ty: number): number => {
    if (tx < 0 || ty < 0 || tx >= largura || ty >= altura) return AGUA;
    return tiles[ty * largura + tx]!;
  };

  // A decoração é derivada da seed, e desde que ela passou a **barrar
  // passagem** virou consulta de caminho: a busca em largura do navegador
  // pergunta `bloqueado` por tile do mapa, e a colisão pergunta quatro vezes
  // por unidade por tick. Calculada na hora, cada pergunta varria estruturas,
  // jazidas e pastos e ainda montava um gerador — mil vezes mais caro do que
  // ler um índice. Por isso o mato é resolvido uma vez, aqui, e guardado: são
  // 2040 tiles, o custo é de milissegundos na criação da sala, e depois disso
  // `bloqueado` é um acesso a array.
  const decoracoes: (DecoracaoNoChao | null)[] = new Array(largura * altura).fill(null);
  const bloqueados = new Uint8Array(largura * altura);

  const arena: Arena = {
    seed,
    mapa: mapa.id,
    largura,
    altura,
    tiles,
    estruturas,
    jazidas,
    pastos,
    tile,
    ehChao: (tx, ty) => tile(tx, ty) !== AGUA,
    decoracao: (tx, ty) =>
      tx < 0 || ty < 0 || tx >= largura || ty >= altura ? null : decoracoes[ty * largura + tx]!,
    // Fora do mapa é água, e água barra: quem sai do quadro é empurrado de
    // volta em vez de cair no vazio.
    bloqueado: (tx, ty) =>
      tx < 0 || ty < 0 || tx >= largura || ty >= altura
        ? true
        : bloqueados[ty * largura + tx] === 1,
    estrutura(tipo, time) {
      const achada = estruturas.find((e) => e.tipo === tipo && e.time === time);
      if (!achada) throw new Error(`estrutura ausente: ${tipo}/${time}`);
      return achada;
    },
  };

  for (let ty = 0; ty < altura; ty++) {
    for (let tx = 0; tx < largura; tx++) {
      const deco = calcularDecoracao(arena, tx, ty);
      decoracoes[ty * largura + tx] = deco;
      bloqueados[ty * largura + tx] = tile(tx, ty) === AGUA || deco !== null ? 1 : 0;
    }
  }
  return arena;
}

/**
 * Empurra um círculo para fora dos tiles bloqueados.
 *
 * Resolve um eixo de cada vez, e nessa ordem por um motivo prático: com os dois
 * juntos, quem corre encostado numa parede gruda na quina de cada tile. Um eixo
 * de cada vez faz a unidade **deslizar** ao longo da parede, que é o que a mão
 * do jogador espera quando segura a diagonal.
 */
export function resolverColisao(
  arena: Arena,
  x: number,
  y: number,
  raio: number,
): { x: number; y: number } {
  let px = x;
  let py = y;
  for (let passo = 0; passo < 2; passo++) {
    const tx0 = Math.floor((px - raio) / TILE);
    const tx1 = Math.floor((px + raio) / TILE);
    const ty0 = Math.floor((py - raio) / TILE);
    const ty1 = Math.floor((py + raio) / TILE);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (!arena.bloqueado(tx, ty)) continue;
        const esq = tx * TILE;
        const dir = esq + TILE;
        const topo = ty * TILE;
        const base = topo + TILE;
        const maisPertoX = Math.max(esq, Math.min(px, dir));
        const maisPertoY = Math.max(topo, Math.min(py, base));
        const dx = px - maisPertoX;
        const dy = py - maisPertoY;
        const d2 = dx * dx + dy * dy;
        if (d2 >= raio * raio) continue;
        if (d2 > 0.0001) {
          const d = Math.sqrt(d2);
          px += (dx / d) * (raio - d);
          py += (dy / d) * (raio - d);
        } else {
          // Centro exatamente dentro do tile: não há direção de saída, então
          // vale o eixo de menor penetração. Acontece quando alguém nasce em
          // cima de uma quina, e sem este caso a unidade ficaria presa.
          const paraEsq = px - esq;
          const paraDir = dir - px;
          const paraTopo = py - topo;
          const paraBase = base - py;
          const menor = Math.min(paraEsq, paraDir, paraTopo, paraBase);
          if (menor === paraEsq) px = esq - raio;
          else if (menor === paraDir) px = dir + raio;
          else if (menor === paraTopo) py = topo - raio;
          else py = base + raio;
        }
      }
    }
  }
  return { x: px, y: py };
}

/** Se a reta entre dois pontos passa por água. Vale para flecha e para bola. */
export function linhaLivre(
  arena: Arena,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): boolean {
  const passos = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (TILE / 2));
  for (let i = 1; i < passos; i++) {
    const t = i / passos;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    if (arena.bloqueado(Math.floor(x / TILE), Math.floor(y / TILE))) return false;
  }
  return true;
}

export type Decoracao = 'arvore' | 'arbusto' | 'pedra';

export interface DecoracaoNoChao {
  tipo: Decoracao;
  variante: number;
  deslocamento: number;
}

/**
 * O mato deste tile.
 *
 * Ele é **derivado da seed e da coordenada**, e é isso que permite que ele
 * atrapalhe a corrida: a árvore que empata o carregador precisa estar no mesmo
 * lugar para os doze jogadores, e derivá-la dá esse acordo de graça, sem
 * mandar uma lista de obstáculos pela rede.
 *
 * A conta em si está em `calcularDecoracao` e roda uma vez por tile, na criação
 * da arena; aqui só se lê a tabela. Continua sendo uma função para quem tem uma
 * arena na mão e quer o mato de um ponto — o desenho, e os testes.
 */
export function decoracaoEm(arena: Arena, tx: number, ty: number): DecoracaoNoChao | null {
  return arena.decoracao(tx, ty);
}

/**
 * A conta do mato: onde ele pode nascer, e o que nasce.
 *
 * Chamada só por `criarArena`, uma vez por tile. As exclusões são de jogo, não
 * de estética: pátio de castelo é limpo para não entulhar a saída, e o entorno
 * de jazida e pasto é limpo para que ninguém precise contornar uma pedra para
 * chegar ao ouro que o mapa prometeu.
 */
function calcularDecoracao(arena: Arena, tx: number, ty: number): DecoracaoNoChao | null {
  if (!arena.ehChao(tx, ty) || arena.tile(tx, ty) === PONTE) return null;
  // Perto de qualquer estrutura o chão é limpo: é pátio de castelo, não mata.
  for (const e of arena.estruturas) {
    if (Math.abs(e.tx - tx) <= 2 && Math.abs(e.ty - ty) <= 2) return null;
  }
  for (const ponto of [...arena.jazidas, ...arena.pastos]) {
    if (
      Math.abs(ponto.x / TILE - 0.5 - tx) <= 1.5 &&
      Math.abs(ponto.y / TILE - 0.5 - ty) <= 1.5
    ) {
      return null;
    }
  }
  const dado = new DeterministicRandom(
    (arena.seed ^ (tx * 374761393) ^ (ty * 668265263)) >>> 0,
  );
  const sorte = dado.nextDouble();
  const variante = dado.nextIntBelow(4);
  const deslocamento = dado.nextIntBelow(8);
  if (sorte < 0.07) return { tipo: 'arvore', variante, deslocamento };
  if (sorte < 0.12) return { tipo: 'arbusto', variante, deslocamento };
  if (sorte < 0.15) return { tipo: 'pedra', variante, deslocamento };
  return null;
}
