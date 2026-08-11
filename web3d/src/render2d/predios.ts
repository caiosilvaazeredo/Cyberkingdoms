import type { Plot, PlacedBuilding } from '../building/plot';
import { estiloDe, type Cor, type Enfeite, type Forma, type Fx } from './estilos';

/**
 * O terreno do jogador, traduzido para o que a tela desenha.
 *
 * A identidade de cada construção — forma, cor de telhado e enfeites — mora em
 * `estilos.ts`. Aqui fica só a conversão: célula do terreno vira tile do mundo,
 * estado da regra vira estado de desenho.
 */

/** Uma construção posicionada, em coordenadas de tile do mundo. */
export interface Predio {
  readonly forma: Forma;
  readonly cor: Cor;
  /** Segunda construção, menor, encostada na principal. Ver `estilos.ts`. */
  readonly anexo?: Forma;
  readonly enfeites: readonly Enfeite[];
  /** Fogo ou fumaça. Só sai da chaminé quando a construção está produzindo. */
  readonly fx?: Fx;
  readonly x: number;
  readonly y: number;
  /** Quantos tiles de largura o prédio ocupa. */
  readonly tiles: number;
  /** Quantos tiles de profundidade ocupa. Serve para o recorte da decoração. */
  readonly tilesAltura: number;
  readonly rotulo?: string;
  /**
   * Dias que faltam para a obra terminar. `0` é construção pronta.
   *
   * A obra é desenhada semitransparente: o prédio já ocupa o espaço — e a
   * regra do jogo diz que ocupa mesmo — mas ainda não produz, e a tela precisa
   * dizer isso sem abrir ficha nenhuma.
   */
  readonly obraDias?: number;
  /** Construção pronta e parada por falta de gente ou de insumo. */
  readonly parada?: boolean;
  /**
   * Multiplicador de tamanho pelo nível.
   *
   * A identidade do prédio é forma + cor, e ela **não** muda ao evoluir: um
   * armazém melhorado continua sendo aquele armazém. O que muda é o porte, e
   * um pouco basta — 12 % por nível se nota lado a lado e não atropela o
   * vizinho de terreno.
   */
  readonly escala: number;
}

/** O retângulo do terreno, em tiles do mundo. */
export interface RetanguloTerreno {
  readonly minX: number;
  readonly minY: number;
  /** Inclusivo: o último tile que ainda é do terreno. */
  readonly maxX: number;
  readonly maxY: number;
}

export function retanguloDoTerreno(plot: {
  origin: { x: number; y: number };
  width: number;
  height: number;
}): RetanguloTerreno {
  return {
    minX: plot.origin.x,
    minY: plot.origin.y,
    maxX: plot.origin.x + plot.width - 1,
    maxY: plot.origin.y + plot.height - 1,
  };
}

export function dentroDoTerreno(r: RetanguloTerreno, x: number, y: number): boolean {
  return x >= r.minX && x <= r.maxX && y >= r.minY && y <= r.maxY;
}

/** O centro do terreno, em tiles do mundo. É onde o peão nasce. */
export function centroDoTerreno(plot: {
  origin: { x: number; y: number };
  width: number;
  height: number;
}): { x: number; y: number } {
  return {
    x: plot.origin.x + Math.floor(plot.width / 2),
    y: plot.origin.y + Math.floor(plot.height / 2),
  };
}

/**
 * As construções que o jogador realmente tem, prontas para desenhar.
 *
 * As coordenadas do `Plot` são **células do terreno**, e o desenho trabalha em
 * tiles do mundo. `worldTileFor` já faz essa conversão e é dele que sai o
 * deslocamento — repetir a soma aqui seria uma segunda verdade sobre onde o
 * terreno fica.
 */
export function prediosDoTerreno(plot: Plot): Predio[] {
  return plot.buildings.map((b: PlacedBuilding) => {
    const def = b.def;
    const tile = plot.worldTileFor(b.x, b.y);
    const estilo = estiloDe(b.type, def.category);
    const emObra = !b.isReady;
    const parada = b.isReady && b.idle;
    return {
      forma: estilo.forma,
      cor: estilo.cor,
      anexo: estilo.anexo,
      enfeites: estilo.enfeites,
      // Chaminé apagada é a forma mais barata de dizer "esta oficina está
      // parada" — e obra nenhuma solta fumaça antes de existir.
      fx: emObra || parada ? undefined : estilo.fx,
      x: tile.x,
      y: tile.y,
      tiles: def.width,
      tilesAltura: def.height,
      rotulo: b.level > 1 ? b.labelWithLevel : b.displayName,
      obraDias: emObra ? b.daysRemaining : 0,
      parada,
      escala: 1 + (b.level - 1) * 0.12,
    };
  });
}
