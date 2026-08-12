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
 * numa partida, "todo mundo indo para a masmorra inimiga" é literalmente o
 * plano do time.
 *
 * Então a busca é invertida. Para cada **destino** se calcula uma vez a
 * distância de todo tile até ele, por BFS, e o resultado fica guardado. Andar
 * vira olhar os oito vizinhos e ir para o de menor distância — trabalho
 * constante por bot por tick, e um campo serve o time inteiro.
 *
 * Os destinos do jogo são poucos e quase sempre os mesmos (as duas masmorras,
 * os dois tronos, as cozinhas, as chapelarias, os trigais), então o cache
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

/** Quantos campos ficam guardados. Passou disso, o menos usado sai. */
const TETO_DE_CAMPOS = 24;

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

    // Já está no tile do alvo: vai reto, que é mais suave que perseguir centro
    // de tile e ficar tremendo em cima do destino.
    if (meuTx === alvoTx && meuTy === alvoTy) return unitario(paraX - deX, paraY - deY);

    const dist = this.campo(alvoTx, alvoTy);
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

  /** Distância em tiles até um destino. Serve para escolher entre dois alvos. */
  distancia(deX: number, deY: number, paraX: number, paraY: number): number {
    const dist = this.campo(Math.floor(paraX / TILE), Math.floor(paraY / TILE));
    const d = dist[Math.floor(deY / TILE) * this.arena.largura + Math.floor(deX / TILE)];
    return d === undefined || d === INFINITO ? Infinity : d;
  }
}

function unitario(x: number, y: number): { x: number; y: number } {
  const t = Math.hypot(x, y);
  if (t < 0.0001) return { x: 0, y: 0 };
  return { x: x / t, y: y / t };
}
