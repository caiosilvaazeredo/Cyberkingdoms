import { TileCoord } from './coords';

/**
 * Vocação econômica de uma capital.
 *
 * O GDD pede cinco capitais "cada uma com vocações econômicas diferentes". A
 * vocação decide o que a cidade produz barato e o que precisa importar.
 *
 * **A escassez é intencional.** Nenhuma capital fecha a cadeia sozinha, então o
 * comércio entre regiões deixa de ser opcional — é o que impede o jogo de virar
 * uma fazenda solitária com um mercado de enfeite ao lado.
 */

export type CityVocation =
  | 'petrochemical'
  | 'foundry'
  | 'agroBio'
  | 'techHub'
  | 'freePort';

export interface CityVocationDef {
  readonly id: CityVocation;
  readonly label: string;
  /** Oferta abundante — o preço tende a ficar abaixo do base. */
  readonly produces: readonly string[];
  /** Itens escassos — o preço sobe. É aqui que o comerciante ganha. */
  readonly demands: readonly string[];
}

export const allVocations: readonly CityVocationDef[] = [
  {
    id: 'petrochemical',
    label: 'Poços de Breu',
    produces: ['oil', 'polymer', 'catalyst'],
    demands: ['culturedMeat', 'chip', 'water'],
  },
  {
    id: 'foundry',
    label: 'Ferrarias',
    produces: ['scrap', 'circuitBoard'],
    demands: ['biomass', 'rareEarth', 'rationPack'],
  },
  {
    id: 'agroBio',
    label: 'Celeiro do Reino',
    produces: ['biomass', 'culturedMeat', 'rationPack', 'water'],
    demands: ['polymer', 'chip', 'scrap'],
  },
  {
    id: 'techHub',
    label: 'Prataria',
    produces: ['chip', 'drone', 'metabolicImplant'],
    demands: ['rareEarth', 'oil', 'culturedMeat'],
  },
  {
    id: 'freePort',
    label: 'Porto Franco',
    produces: ['fabric', 'clothing', 'stolenGoods'],
    demands: ['rareEarth', 'chip', 'rifle'],
  },
];

export function vocationDef(id: CityVocation): CityVocationDef {
  const found = allVocations.find((v) => v.id === id);
  if (!found) throw new Error(`vocação desconhecida: "${id}"`);
  return found;
}

export type SettlementKind = 'capital' | 'satellite';

export const settlementKindLabels: Record<SettlementKind, string> = {
  capital: 'Capital',
  satellite: 'Satélite',
};

export interface SettlementJson {
  id: string;
  name: string;
  kind: SettlementKind;
  center: { x: number; y: number };
  vocation: CityVocation;
  radius: number;
  population: number;
  capitalId: string | null;
}

export class Settlement {
  constructor(
    readonly id: string,
    readonly name: string,
    readonly kind: SettlementKind,
    /** Tile central. Toda a malha urbana nasce em volta dele. */
    readonly center: TileCoord,
    readonly vocation: CityVocation,
    /** Raio urbano em tiles. Capitais são maiores que satélites. */
    readonly radius: number,
    readonly population: number,
    /** Para satélites: a capital de que ela orbita. `null` em capitais. */
    readonly capitalId: string | null = null,
  ) {}

  get isCapital(): boolean {
    return this.kind === 'capital';
  }

  get vocationDef(): CityVocationDef {
    return vocationDef(this.vocation);
  }

  /**
   * Vagas em Serviços Públicos.
   *
   * O GDD limita as vagas públicas de propósito — é o teto que empurra parte
   * dos jogadores para as fazendas privadas, que é onde a economia dos
   * jogadores começa.
   */
  get publicJobSlots(): number {
    return this.isCapital ? 20 : 8;
  }

  contains(tile: TileCoord): boolean {
    return tile.euclideanTo(this.center) <= this.radius;
  }

  toJson(): SettlementJson {
    return {
      id: this.id,
      name: this.name,
      kind: this.kind,
      center: this.center.toJson(),
      vocation: this.vocation,
      radius: this.radius,
      population: this.population,
      capitalId: this.capitalId,
    };
  }

  static fromJson(json: SettlementJson): Settlement {
    return new Settlement(
      json.id,
      json.name,
      json.kind,
      TileCoord.fromJson(json.center),
      json.vocation,
      Number(json.radius) || 1,
      Number(json.population) || 0,
      json.capitalId ?? null,
    );
  }
}

export interface RoadJson {
  fromId: string;
  toId: string;
  travelDays: number;
  danger: number;
  /**
   * Tiles atravessados. **Ausente no save**, e de propósito.
   *
   * O caminho é função pura das duas pontas e do terreno, e o terreno vem da
   * seed: `tracePath` reproduz o mesmo traçado sempre. Guardá-lo custava 4 MB
   * por mundo — duzentos mil tiles — contra 4,7 KB sem ele, e estourava a cota
   * do navegador no primeiro mundo salvo.
   *
   * O que **não** dá para derivar fica: `travelDays` sai do comprimento e
   * `danger` sai do sorteio, e os dois precisam sobreviver a uma mudança na
   * fórmula de traçado.
   */
  path?: { x: number; y: number }[];
}

/**
 * Trecho ligando dois assentamentos.
 *
 * **Toda estrada é zona PvP** — é a única parte do mapa onde assalto, emboscada
 * e contrabando acontecem. Fora dela, o jogo é economia; dentro, é risco.
 */
export class Road {
  constructor(
    readonly fromId: string,
    readonly toId: string,
    /** Tiles atravessados, do início ao fim. */
    readonly path: readonly TileCoord[],
    /** Quantos resets a travessia consome. */
    readonly travelDays: number,
    /** 0..1 — chance base de encontro hostil por dia de viagem. */
    readonly danger: number,
  ) {}

  get lengthInTiles(): number {
    return this.path.length;
  }

  get key(): string {
    return roadKey(this.fromId, this.toId);
  }

  toJson(): RoadJson {
    return {
      fromId: this.fromId,
      toId: this.toId,
      travelDays: this.travelDays,
      danger: this.danger,
    };
  }

  static fromJson(json: RoadJson): Road {
    return new Road(
      json.fromId,
      json.toId,
      (json.path ?? []).map(TileCoord.fromJson),
      Number(json.travelDays) || 1,
      Number(json.danger) || 0,
    );
  }
}

/** Chave simétrica: a estrada A→B e a B→A são a mesma. */
export function roadKey(a: string, b: string): string {
  return [a, b].sort().join('::');
}
