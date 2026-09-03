import { TILE } from './regras';
import type { Arena } from './arena';

/**
 * Como um bot atravessa o mapa sem entrar no lago.
 *
 * ## Campo de distância, e não caminho por bot
 *
 * A tentação é rodar um A* por bot por decisão. Doze bots decidindo três vezes
 * por segundo dão trinta e seis buscas, e cada uma joga fora o que a anterior
 * descobriu — mesmo quando todas vão para o mesmo lugar, que é o caso comum:
 * numa partida, "todo mundo indo para o cofre inimigo" é literalmente o
 * plano do time.
 *
 * Então a busca é invertida. Para cada **destino** se calcula uma vez a
 * distância de todo tile até ele, por BFS, e o resultado fica guardado. Andar
 * vira olhar os oito vizinhos e ir para o de menor distância — trabalho
 * constante por bot por tick, e um campo serve o time inteiro.
 *
 * Os destinos do jogo são poucos e quase sempre os mesmos (as duas masmorras,
 * os dois tesourarias, as casas da moeda, as chapelarias, os trigais), então o cache
 * acerta quase sempre. O teto existe para o caso móvel — perseguir um inimigo
 * que corre —, e aí o campo mais velho sai.
 *
 * ## Por que oito vizinhos, com a trava da quina
 *
 * Com quatro, o bot anda em escada e a diagonal do descampado vira zigue-zague
 * visível. Com oito, é preciso proibir cortar a quina entre dois tiles
 * bloqueados — sem isso o bot corta o canto do fosso, atravessa a água em
 * diagonal e chega ao castelo por um caminho que nenhum jogador humano pode
 * fazer.
 */

const INFINITO = 0xffff;

/**
 * Quantos campos ficam guardados. Passou disso, o menos usado sai.
 *
 * Vinte e quatro bastavam para doze bots num mapa de dois mil tiles. Não bastam
 * para sessenta e quatro num de oito mil: cada perseguição a um inimigo que
 * corre é um destino novo, e com o cache cheio **toda** decisão vira uma BFS do
 * mapa inteiro. Medido, era isso que punha o tick de dezesseis contra dezesseis
 * em 48,9 ms com um orçamento de 33.
 *
 * Um campo custa dois bytes por tile — dezesseis quilobytes na Planície. Cento
 * e vinte e oito deles são dois megabytes, que é barato perto de estourar o
 * tick.
 */
const TETO_DE_CAMPOS = 128;

/**
 * O lado do bloco a que um destino é encostado, em tiles.
 *
 * Esta é a metade que **de fato** resolveu o custo, e o cache maior é só a
 * outra metade. Um inimigo que corre muda de tile a cada poucos quadros, e cada
 * tile novo era um campo novo: sessenta e quatro bots perseguindo davam dezenas
 * de destinos distintos por segundo, e nenhum cache de tamanho razoável
 * sobrevive a isso.
 *
 * Encostando o destino num bloco de quatro por quatro, dezesseis tiles passam a
 * compartilhar um campo — e o erro que isso introduz é de no máximo quatro
 * tiles, que é exatamente a distância a partir da qual o bot já ia reto. O
 * caminho longo é grosso; o último trecho é fino. Que é como uma pessoa também
 * anda: ninguém planeja rua por rua os últimos dez metros.
 */
const BLOCO = 4;

export class Navegador {
  private readonly campos = new Map<number, Uint16Array>();
  private readonly uso = new Map<number, number>();
  private relogio = 0;

  constructor(private readonly arena: Arena) {}

  /** Campos guardados agora. Diagnóstico e teste. */
  get guardados(): number {
    return this.campos.size;
  }

  private chave(tx: number, ty: number): number {
    return ty * this.arena.largura + tx;
  }

  private campo(tx: number, ty: number): Uint16Array {
    const chave = this.chave(tx, ty);
    const existente = this.campos.get(chave);
    this.uso.set(chave, this.relogio++);
    if (existente) return existente;

    const { largura, altura } = this.arena;
    const dist = new Uint16Array(largura * altura).fill(INFINITO);
    const fila = new Int32Array(largura * altura);
    let cabeca = 0;
    let cauda = 0;
    if (!this.arena.bloqueado(tx, ty)) {
      dist[chave] = 0;
      fila[cauda++] = chave;
    }
    while (cabeca < cauda) {
      const atual = fila[cabeca++]!;
      const ax = atual % largura;
      const ay = (atual / largura) | 0;
      const d = dist[atual]!;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = ax + dx;
          const ny = ay + dy;
          if (nx < 0 || ny < 0 || nx >= largura || ny >= altura) continue;
          if (this.arena.bloqueado(nx, ny)) continue;
          // A trava da quina: a diagonal só vale se os dois ortogonais estão
          // livres. É o que impede o bot de raspar o canto do fosso.
          if (dx !== 0 && dy !== 0) {
            if (this.arena.bloqueado(ax + dx, ay) || this.arena.bloqueado(ax, ay + dy)) continue;
          }
          const vizinho = ny * largura + nx;
          if (dist[vizinho]! <= d + 1) continue;
          dist[vizinho] = d + 1;
          fila[cauda++] = vizinho;
        }
      }
    }

    if (this.campos.size >= TETO_DE_CAMPOS) this.esquecerOMaisVelho();
    this.campos.set(chave, dist);
    return dist;
  }

  private esquecerOMaisVelho(): void {
    let velho = -1;
    let quando = Infinity;
    for (const [chave, t] of this.uso) {
      if (t < quando) {
        quando = t;
        velho = chave;
      }
    }
    if (velho >= 0) {
      this.campos.delete(velho);
      this.uso.delete(velho);
    }
  }

  /**
   * A direção para dar o próximo passo rumo ao destino.
   *
   * Devolve um vetor unitário, ou `null` quando não há caminho — o que na
   * prática só acontece se alguém pedir um destino dentro d'água.
   */
  direcao(
    deX: number,
    deY: number,
    paraX: number,
    paraY: number,
  ): { x: number; y: number } | null {
    const alvoTx = Math.floor(paraX / TILE);
    const alvoTy = Math.floor(paraY / TILE);
    const meuTx = Math.floor(deX / TILE);
    const meuTy = Math.floor(deY / TILE);

    // Já está no bloco do alvo: vai reto. É o mesmo atalho de antes, medido em
    // blocos em vez de tiles — e é ele que devolve a precisão que o `BLOCO`
    // tira, porque perto do destino ninguém mais consulta campo nenhum.
    // Já está no tile do alvo: vai reto, que é mais suave que perseguir centro
    // de tile e ficar tremendo em cima do destino. **Um** tile, e não um bloco:
    // a primeira versão ia reto de dentro do bloco inteiro, e quatro tiles em
    // linha reta atravessam fosso. Medido, era isso que fazia o cortejo do
    // clássico parar de chegar em casa — duas de três seeds terminavam 0 a 0 no
    // relógio, onde antes acabavam por resgate aos cinco minutos.
    if (meuTx === alvoTx && meuTy === alvoTy) return unitario(paraX - deX, paraY - deY);

    const dist = this.campoDe(alvoTx, alvoTy, meuTx, meuTy);
    const { largura, altura } = this.arena;
    const meu = dist[meuTy * largura + meuTx] ?? INFINITO;
    if (meu === INFINITO) return null;

    let melhorX = meuTx;
    let melhorY = meuTy;
    let melhor = meu;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = meuTx + dx;
        const ny = meuTy + dy;
        if (nx < 0 || ny < 0 || nx >= largura || ny >= altura) continue;
        if (dx !== 0 && dy !== 0) {
          if (this.arena.bloqueado(meuTx + dx, meuTy) || this.arena.bloqueado(meuTx, meuTy + dy)) {
            continue;
          }
        }
        const d = dist[ny * largura + nx] ?? INFINITO;
        if (d < melhor) {
          melhor = d;
          melhorX = nx;
          melhorY = ny;
        }
      }
    }
    if (melhorX === meuTx && melhorY === meuTy) return unitario(paraX - deX, paraY - deY);
    return unitario((melhorX + 0.5) * TILE - deX, (melhorY + 0.5) * TILE - deY);
  }

  /**
   * O campo que serve um destino: o do bloco, quando ele serve; o exato, quando
   * não serve.
   *
   * ## A armadilha que o teste pegou
   *
   * Encostar o destino num bloco de quatro por quatro parece inofensivo até o
   * bloco atravessar uma parede. No Desfiladeiro isso acontece: a âncora de um
   * dos destinos caía do outro lado do fosso, e o campo dela dava infinito para
   * o destino de verdade — o bot concluía que não havia caminho para um lugar
   * a que ele chegava andando.
   *
   * A conferência é de um acesso a vetor: se o campo do bloco não alcança o
   * tile pedido, ele não vale, e o exato é usado. O caso comum — campo aberto —
   * continua compartilhando um campo entre dezesseis tiles; o caso raro paga o
   * que sempre pagou.
   *
   * Não dava para prevenir escolhendo melhor o tile do bloco: saber se dois
   * tiles estão do mesmo lado de uma parede é justamente o que a BFS responde,
   * e fazê-la antes para decidir se vale a pena fazê-la é a definição de não
   * economizar nada.
   */
  private campoDe(tx: number, ty: number, deTx?: number, deTy?: number): Uint16Array {
    // Perto do destino, o campo é o exato. O bloco existe para poupar a rota
    // **longa**, que é onde o cache sofria; a aproximação final tem de ser fina
    // ou o bot contorna a parede errada nos últimos metros.
    if (
      deTx !== undefined &&
      deTy !== undefined &&
      Math.abs(deTx - tx) <= BLOCO * 2 &&
      Math.abs(deTy - ty) <= BLOCO * 2
    ) {
      return this.campo(tx, ty);
    }
    const bx = tx - (tx % BLOCO);
    const by = ty - (ty % BLOCO);
    const largura = this.arena.largura;
    for (let dy = 0; dy < BLOCO; dy++) {
      for (let dx = 0; dx < BLOCO; dx++) {
        if (this.arena.bloqueado(bx + dx, by + dy)) continue;
        const campo = this.campo(bx + dx, by + dy);
        return campo[ty * largura + tx] === INFINITO ? this.campo(tx, ty) : campo;
      }
    }
    return this.campo(tx, ty);
  }

  /** Distância em tiles até um destino. Serve para escolher entre dois alvos. */
  distancia(deX: number, deY: number, paraX: number, paraY: number): number {
    const dist = this.campoDe(
      Math.floor(paraX / TILE),
      Math.floor(paraY / TILE),
      Math.floor(deX / TILE),
      Math.floor(deY / TILE),
    );
    const d = dist[Math.floor(deY / TILE) * this.arena.largura + Math.floor(deX / TILE)];
    return d === undefined || d === INFINITO ? Infinity : d;
  }
}

function unitario(x: number, y: number): { x: number; y: number } {
  const t = Math.hypot(x, y);
  if (t < 0.0001) return { x: 0, y: 0 };
  return { x: x / t, y: y / t };
}
