/**
 * Coordenadas do mundo, espelhando `lib/domain/world/coords.dart`.
 *
 * ## Por que valor imutável, e não `{x, y}` solto
 *
 * A conversão tile → chunk usa divisão **por baixo**, e é aí que mora o erro
 * fácil: em JavaScript `-1 / 16 | 0` dá `0`, não `-1`. Um quadrante do mundo
 * inteiro cairia na chunk errada, e o defeito só apareceria em coordenada
 * negativa — ou seja, depois de o jogador andar para o lado errado. Deixar a
 * regra num lugar só é o que impede isso de ser reescrito à mão em cada uso.
 */

export const CHUNK_SIZE = 16;

/** Divisão inteira por baixo, correta também para negativos. */
export function floorDiv(a: number, b: number): number {
  return Math.floor(a / b);
}

export class TileCoord {
  constructor(
    readonly x: number,
    readonly y: number,
  ) {}

  get chunk(): ChunkCoord {
    return new ChunkCoord(floorDiv(this.x, CHUNK_SIZE), floorDiv(this.y, CHUNK_SIZE));
  }

  /** Posição dentro da chunk, sempre em `[0, CHUNK_SIZE)`. */
  get localX(): number {
    return this.x - this.chunk.x * CHUNK_SIZE;
  }

  get localY(): number {
    return this.y - this.chunk.y * CHUNK_SIZE;
  }

  translate(dx: number, dy: number): TileCoord {
    return new TileCoord(this.x + dx, this.y + dy);
  }

  /** Chebyshev — o custo real de andar num grid que aceita diagonal. */
  chebyshevTo(other: TileCoord): number {
    return Math.max(Math.abs(this.x - other.x), Math.abs(this.y - other.y));
  }

  euclideanTo(other: TileCoord): number {
    return Math.hypot(this.x - other.x, this.y - other.y);
  }

  equals(other: TileCoord): boolean {
    return this.x === other.x && this.y === other.y;
  }

  toString(): string {
    return `Tile(${this.x}, ${this.y})`;
  }

  toJson(): { x: number; y: number } {
    return { x: this.x, y: this.y };
  }

  static fromJson(json: { x?: unknown; y?: unknown } | null | undefined): TileCoord {
    const n = (v: unknown): number => {
      const bruto = Number(v);
      return Number.isFinite(bruto) ? Math.trunc(bruto) : 0;
    };
    return new TileCoord(n(json?.x), n(json?.y));
  }
}

export class ChunkCoord {
  constructor(
    readonly x: number,
    readonly y: number,
  ) {}

  get origin(): TileCoord {
    return new TileCoord(this.x * CHUNK_SIZE, this.y * CHUNK_SIZE);
  }

  translate(dx: number, dy: number): ChunkCoord {
    return new ChunkCoord(this.x + dx, this.y + dy);
  }

  equals(other: ChunkCoord): boolean {
    return this.x === other.x && this.y === other.y;
  }

  /** Chave estável para `Map`/`Set`, já que objeto não compara por valor. */
  get key(): string {
    return `${this.x}:${this.y}`;
  }

  toString(): string {
    return `Chunk(${this.x}, ${this.y})`;
  }
}
