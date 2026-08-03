import { ChunkCoord, CHUNK_SIZE, TileCoord } from './coords';
import { WorldLayout, ensureRoadPaths, generateLayout, tileAt } from './layout';
import type { Settlement } from './settlement';
import { hasResource, type WorldTile } from './tile';
import { WorldGenerator } from './worldGen';

/**
 * Fachada sobre o gerador: resolve tiles sob demanda e mantém um cache de
 * chunks para o pan da câmera não regenerar ruído a cada quadro.
 */

/** Um bloco de tiles já resolvidos, pronto para o renderizador consumir. */
export class WorldChunk {
  constructor(
    readonly coord: ChunkCoord,
    private readonly tiles: readonly WorldTile[],
  ) {
    if (tiles.length !== CHUNK_SIZE * CHUNK_SIZE) {
      throw new Error(`chunk deve ter ${CHUNK_SIZE}² tiles`);
    }
  }

  tileAt(localX: number, localY: number): WorldTile {
    return this.tiles[localY * CHUNK_SIZE + localX]!;
  }

  /**
   * Itera em ordem de profundidade isométrica, do fundo para a frente.
   *
   * O renderizador 3D não precisa disso — ele tem z-buffer —, mas o cliente
   * isométrico precisava, e a ordem continua sendo a definição de "fundo" para
   * qualquer coisa que empilhe sprites. Sai de graça: é a mesma varredura por
   * diagonal.
   */
  *tilesInDepthOrder(): Generator<[TileCoord, WorldTile]> {
    const origin = this.coord.origin;
    for (let sum = 0; sum <= (CHUNK_SIZE - 1) * 2; sum++) {
      for (let ly = 0; ly < CHUNK_SIZE; ly++) {
        const lx = sum - ly;
        if (lx < 0 || lx >= CHUNK_SIZE) continue;
        yield [
          new TileCoord(origin.x + lx, origin.y + ly),
          this.tiles[ly * CHUNK_SIZE + lx]!,
        ];
      }
    }
  }
}

/** 256 chunks ≈ 65 mil tiles: várias telas de pan sem pressionar a memória. */
const MAX_CACHED_CHUNKS = 256;

export class World {
  private readonly cache = new Map<string, WorldChunk>();
  /**
   * Ordem de uso, do mais antigo para o mais recente.
   *
   * Lista e não `Map` com ordem de inserção porque "tocar" um item exige
   * removê-lo do meio, e um `Map` não sabe fazer isso sem `delete` + `set` —
   * que é exatamente o mesmo custo com mais chance de erro.
   */
  private readonly lru: string[] = [];

  constructor(
    readonly generator: WorldGenerator,
    readonly layout: WorldLayout,
  ) {}

  /** Cria o mundo de uma campanha nova a partir da seed. */
  static fromSeed(seed: number): World {
    const generator = new WorldGenerator(seed);
    return new World(generator, generateLayout(generator));
  }

  /**
   * Recria o mundo de uma campanha salva.
   *
   * O terreno é regenerado da seed; só o layout vem do save. Guardar tiles seria
   * salvar o que já se sabe calcular, e o arquivo cresceria sem limite.
   */
  static restore(seed: number, layout: WorldLayout): World {
    const generator = new WorldGenerator(seed);
    // O save não guarda o traçado das estradas — ele é função pura da seed, e
    // guardá-lo custava 4 MB por mundo. Reconstruir aqui é o que faz o mapa
    // continuar desenhando as rotas depois de recarregar.
    return new World(generator, ensureRoadPaths(layout, generator));
  }

  get seed(): number {
    return this.generator.seed;
  }

  tileAt(x: number, y: number): WorldTile {
    const coord = new TileCoord(x, y);
    return this.chunkAt(coord.chunk).tileAt(coord.localX, coord.localY);
  }

  chunkAt(coord: ChunkCoord): WorldChunk {
    const chave = coord.key;
    const cached = this.cache.get(chave);
    if (cached) {
      this.touch(chave);
      return cached;
    }

    const chunk = this.generateChunk(coord);
    this.cache.set(chave, chunk);
    this.lru.push(chave);
    this.evictIfNeeded();
    return chunk;
  }

  private touch(chave: string): void {
    const i = this.lru.indexOf(chave);
    if (i >= 0) this.lru.splice(i, 1);
    this.lru.push(chave);
  }

  private evictIfNeeded(): void {
    while (this.lru.length > MAX_CACHED_CHUNKS) {
      this.cache.delete(this.lru.shift()!);
    }
  }

  private generateChunk(coord: ChunkCoord): WorldChunk {
    const origin = coord.origin;
    const tiles: WorldTile[] = [];
    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        tiles.push(tileAt(this.generator, origin.x + lx, origin.y + ly, this.layout));
      }
    }
    return new WorldChunk(coord, tiles);
  }

  /** Descarta o cache. Útil ao trocar de campanha. */
  clearCache(): void {
    this.cache.clear();
    this.lru.length = 0;
  }

  get cachedChunkCount(): number {
    return this.cache.size;
  }

  // ------------------------------------------------------ consultas de jogo

  settlementAt(tile: TileCoord): Settlement | null {
    return this.layout.settlementAt(tile);
  }

  /** Assentamento mais próximo, em linha reta. */
  nearestSettlement(tile: TileCoord): Settlement {
    let melhor = this.layout.settlements[0]!;
    let menor = Infinity;
    for (const s of this.layout.settlements) {
      const d = tile.euclideanTo(s.center);
      if (d < menor) {
        menor = d;
        melhor = s;
      }
    }
    return melhor;
  }

  /**
   * Recursos extraíveis num raio, agregados por item.
   *
   * Alimenta a tela de "o que dá para trabalhar por aqui". O raio padrão de 12
   * cobre um dia de caminhada — perguntar por um raio maior descreve um lugar
   * onde o jogador não vai conseguir chegar e voltar no mesmo reset.
   */
  surveyResources(center: TileCoord, radius = 12): Record<string, number> {
    const totais: Record<string, number> = {};
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const tile = this.tileAt(center.x + dx, center.y + dy);
        if (!hasResource(tile)) continue;
        const chave = tile.resource!;
        totais[chave] = (totais[chave] ?? 0) + tile.resourceRichness;
      }
    }
    return totais;
  }
}
