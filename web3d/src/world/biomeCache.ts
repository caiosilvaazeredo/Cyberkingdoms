import { Biome } from './biome';
import type { WorldGenerator } from './worldGen';

/**
 * Memoriza o bioma por tile inteiro.
 *
 * `biomeAt` é caro: são três campos de fBm de 3 a 5 oitavas mais um ruído
 * celular, umas quatro dezenas de amostras de gradiente por chamada. Isso é
 * barato quando se resolve um tile por vez para desenhar um sprite, e ruinoso
 * no laço de semeadura da grama, que testa centenas de milhares de posições
 * candidatas por trecho — e consultava o bioma **duas** vezes em cada uma, uma
 * pela densidade e outra pela cor.
 *
 * A primeira versão sem este cache travava a aba por dezenas de segundos ao
 * gerar um mundo; no celular seria um congelamento.
 *
 * O bioma é constante dentro de um tile de 1 m, então memorizar por coordenada
 * inteira não perde nada — é exatamente a mesma resposta, calculada uma vez.
 */
export class BiomeCache {
  private readonly cache = new Map<number, Biome>();

  constructor(private readonly world: WorldGenerator) {}

  at(x: number, z: number): Biome {
    const ix = Math.round(x);
    const iz = Math.round(z);
    // Chave num inteiro só. Um `Map` de string alocaria uma string por
    // consulta, que é justamente o que não pode acontecer aqui.
    const key = ((ix & 0xffff) << 16) | (iz & 0xffff);

    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;

    const biome = this.world.biomeAt(ix, iz);
    this.cache.set(key, biome);
    return biome;
  }

  /**
   * Descarta o que foi memorizado.
   *
   * A chave usa 16 bits por eixo, então dois tiles a 65.536 m de distância
   * colidem. O mundo é bem menor que isso em uso normal, mas limpar ao trocar
   * de trecho mantém o cache pequeno e fecha a porta de vez.
   */
  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}
