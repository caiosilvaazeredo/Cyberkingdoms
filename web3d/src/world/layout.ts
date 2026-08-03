import { DeterministicRandom, mix, whiteNoise2D } from '../core/rng';
import { Biome, biomeDef, supportsSettlement } from './biome';
import { CHUNK_SIZE, TileCoord } from './coords';
import {
  Road,
  Settlement,
  allVocations,
  roadKey,
  type CityVocation,
  type RoadJson,
  type SettlementJson,
} from './settlement';
import { TileFeature, type WorldTile } from './tile';
import type { WorldGenerator } from './worldGen';

/**
 * A macroestrutura do mundo — a única parte que a campanha persiste.
 *
 * O terreno não é salvo porque é função pura da seed: regenerar custa menos que
 * ler, e um save que guardasse tiles cresceria sem limite. O layout é diferente
 * — ele é sorteado uma vez e precisa continuar o mesmo mesmo que a fórmula de
 * geração mude entre versões, senão a cidade onde o jogador comprou a fazenda
 * muda de lugar num update.
 */

/** Raio, em tiles, dentro do qual existem cidades. */
export const SETTLED_RADIUS = 900;

export interface WorldLayoutJson {
  seed: number;
  settlements: SettlementJson[];
  roads: RoadJson[];
}

export class WorldLayout {
  private readonly byIdMap: Map<string, Settlement>;
  /** Tiles ocupados por estrada, para teste O(1) durante a geração. */
  private readonly roadTiles: Set<number>;

  constructor(
    readonly seed: number,
    readonly settlements: readonly Settlement[],
    readonly roads: readonly Road[],
  ) {
    this.byIdMap = new Map(settlements.map((s) => [s.id, s]));
    this.roadTiles = indexRoadTiles(roads);
  }

  get capitals(): readonly Settlement[] {
    return this.settlements.filter((s) => s.isCapital);
  }

  get satellites(): readonly Settlement[] {
    return this.settlements.filter((s) => !s.isCapital);
  }

  byId(id: string): Settlement | null {
    return this.byIdMap.get(id) ?? null;
  }

  /** Assentamento que cobre este tile, se algum. */
  settlementAt(tile: TileCoord): Settlement | null {
    for (const s of this.settlements) {
      if (s.contains(tile)) return s;
    }
    return null;
  }

  isRoadTile(x: number, y: number): boolean {
    return this.roadTiles.has(packTile(x, y));
  }

  roadsFrom(settlementId: string): readonly Road[] {
    return this.roads.filter(
      (r) => r.fromId === settlementId || r.toId === settlementId,
    );
  }

  otherEnd(road: Road, fromId: string): string {
    return road.fromId === fromId ? road.toId : road.fromId;
  }

  toJson(): WorldLayoutJson {
    return {
      seed: this.seed,
      settlements: this.settlements.map((s) => s.toJson()),
      roads: this.roads.map((r) => r.toJson()),
    };
  }

  static fromJson(json: WorldLayoutJson): WorldLayout {
    return new WorldLayout(
      json.seed,
      (json.settlements ?? []).map(Settlement.fromJson),
      (json.roads ?? []).map(Road.fromJson),
    );
  }
}

/**
 * Empacota (x, y) num inteiro só.
 *
 * O deslocamento de 2^20 cobre o mundo assentado com folga e mantém o
 * resultado dentro do inteiro seguro do JavaScript — o mesmo valor do lado
 * Dart, de propósito: os dois lados precisam concordar sobre o que é tile de
 * estrada.
 */
function packTile(x: number, y: number): number {
  return (x + 0x100000) * 0x400000 + (y + 0x100000);
}

function indexRoadTiles(roads: readonly Road[]): Set<number> {
  const set = new Set<number>();
  for (const road of roads) {
    for (const tile of road.path) {
      // Espessura 3 para a estrada ficar visível no zoom isométrico.
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          set.add(packTile(tile.x + dx, tile.y + dy));
        }
      }
    }
  }
  return set;
}

// ============================================================ geração

const CITY_PREFIX = [
  'Neo', 'Novo', 'Alto', 'Porto', 'Vale', 'Setor', 'Distrito',
  'Cidade', 'Colônia', 'Zona',
];
const CITY_ROOT = [
  'Kaji', 'Ventra', 'Solaris', 'Mirim', 'Orixá', 'Tanaka', 'Corvo',
  'Ferrolho', 'Aurora', 'Kobalt', 'Ipê', 'Ronin', 'Serpente', 'Vidro',
  'Cinza', 'Âmbar', 'Nagai', 'Pantanal', 'Krom', 'Sabiá',
];
const CITY_SUFFIX = [
  '', '', '', ' Prime', ' Norte', ' Sul', '-9', '-Alfa', ' Baixa', ' Velha',
];

function cityName(rng: DeterministicRandom, isCapital: boolean): string {
  const root = rng.pick(CITY_ROOT);
  if (isCapital) {
    return `${rng.pick(CITY_PREFIX)} ${root}${rng.pick(CITY_SUFFIX)}`;
  }
  return rng.chance(0.5)
    ? `${root}${rng.pick(CITY_SUFFIX)}`
    : `${rng.pick(CITY_PREFIX)} ${root}`;
}

/**
 * Empurra um ponto candidato até cair num bioma que aceita cidade.
 *
 * Espiral crescente e não salto aleatório: mantém a cidade perto do ponto
 * pretendido, preservando a distribuição em anel. Sem isso, uma capital pode
 * nascer no meio da água morta.
 */
function findHospitableTile(
  generator: WorldGenerator,
  candidate: TileCoord,
  rng: DeterministicRandom,
): TileCoord {
  let current = candidate;
  for (let attempt = 0; attempt < 64; attempt++) {
    if (supportsSettlement(generator.biomeAt(current.x, current.y))) return current;
    const step = 8 + attempt * 3;
    const angle = rng.rangeDouble(0, 2 * Math.PI);
    current = new TileCoord(
      candidate.x + Math.round(Math.cos(angle) * step),
      candidate.y + Math.round(Math.sin(angle) * step),
    );
  }
  return current;
}

/**
 * Traça uma estrada com Bresenham e desvio suave, evitando água quando dá.
 *
 * Não é A*, e é de propósito: estradas devem parecer construídas, não
 * otimizadas ao milímetro. Um caminho perfeito denuncia o algoritmo.
 */
function tracePath(
  generator: WorldGenerator,
  from: TileCoord,
  to: TileCoord,
): TileCoord[] {
  const path: TileCoord[] = [];
  let x = from.x;
  let y = from.y;
  const dx = Math.abs(to.x - x);
  const dy = Math.abs(to.y - y);
  const sx = x < to.x ? 1 : -1;
  const sy = y < to.y ? 1 : -1;
  let err = dx - dy;

  // Teto de segurança: impede laço infinito se a geometria degenerar.
  let guard = 0;
  const maxSteps = 20000;

  while (guard++ < maxSteps) {
    path.push(new TileCoord(x, y));
    if (x === to.x && y === to.y) break;

    const e2 = 2 * err;
    let movedX = false;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
      movedX = true;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }

    if (!biomeDef(generator.biomeAt(x, y)).walkable) {
      if (movedX) y += sy;
      else x += sx;
    }
  }
  return path;
}

/**
 * Malha viária: cada satélite liga à sua capital, e as capitais formam um anel.
 * Toda estrada é zona PvP.
 */
function generateRoads(
  generator: WorldGenerator,
  capitals: readonly Settlement[],
  satellites: readonly Settlement[],
  rng: DeterministicRandom,
): Road[] {
  const roads = new Map<string, Road>();

  const connect = (a: Settlement, b: Settlement, dangerBase: number): void => {
    const key = roadKey(a.id, b.id);
    if (roads.has(key)) return;
    const path = tracePath(generator, a.center, b.center);
    // ~90 tiles por dia de viagem: torna as rotas capital-capital caras o
    // bastante para justificar escolta e contrabando.
    const days = Math.max(1, Math.round(path.length / 90));
    const danger = Math.min(
      0.85,
      Math.max(0.05, dangerBase + rng.rangeDouble(-0.05, 0.1)),
    );
    roads.set(key, new Road(a.id, b.id, path, days, danger));
  };

  // Anel entre capitais, ordenado por ângulo para não cruzar o mapa inteiro.
  const ordered = [...capitals].sort(
    (a, b) =>
      Math.atan2(a.center.y, a.center.x) - Math.atan2(b.center.y, b.center.x),
  );
  for (let i = 0; i < ordered.length; i++) {
    connect(ordered[i]!, ordered[(i + 1) % ordered.length]!, 0.35);
  }

  // Uma diagonal atravessando o anel dá uma rota curta e perigosa — o tipo de
  // decisão de risco que o GDD quer.
  if (ordered.length >= 4) connect(ordered[0]!, ordered[2]!, 0.55);

  for (const satellite of satellites) {
    const capital = capitals.find((c) => c.id === satellite.capitalId);
    if (capital) connect(satellite, capital, 0.18);
  }

  return [...roads.values()];
}

/**
 * Sorteia cinco capitais em anel e quinze satélites em volta delas.
 *
 * A **ordem** das chamadas ao RNG é o resultado: mudar qualquer sorteio de
 * lugar reescreve o mapa de toda campanha já criada. É por isso que este
 * arquivo espelha a versão Dart chamada a chamada, e por isso o contrato em
 * `test/rules-fixture.json` compara cidade por cidade.
 */
export function generateLayout(generator: WorldGenerator): WorldLayout {
  const rng = new DeterministicRandom(generator.seed).fork('layout');

  const vocations = allVocations.map((v) => v.id);
  rng.shuffle(vocations);

  const capitals: Settlement[] = [];
  const capitalCount = 5;
  const ringRadius = SETTLED_RADIUS * 0.62;

  for (let i = 0; i < capitalCount; i++) {
    const baseAngle = (i / capitalCount) * 2 * Math.PI;
    // Jitter limitado a ±25% do setor evita colisão entre vizinhas.
    const angle =
      baseAngle + rng.rangeDouble(-0.25, 0.25) * ((2 * Math.PI) / capitalCount);
    const distance = ringRadius * rng.rangeDouble(0.78, 1.18);

    const center = findHospitableTile(
      generator,
      new TileCoord(
        Math.round(Math.cos(angle) * distance),
        Math.round(Math.sin(angle) * distance),
      ),
      rng,
    );

    capitals.push(
      new Settlement(
        `cap_${i}`,
        cityName(rng, true),
        'capital',
        center,
        vocations[i % vocations.length]!,
        rng.range(26, 34),
        rng.range(180000, 640000),
      ),
    );
  }

  // 15 satélites: 3 por capital, a uma distância que exige viagem mas não
  // inviabiliza a rota diária.
  const satellites: Settlement[] = [];
  let satelliteIndex = 0;
  for (const capital of capitals) {
    for (let s = 0; s < 3; s++) {
      const angle = rng.rangeDouble(0, 2 * Math.PI);
      const distance = rng.rangeDouble(120, 260);
      const center = findHospitableTile(
        generator,
        new TileCoord(
          capital.center.x + Math.round(Math.cos(angle) * distance),
          capital.center.y + Math.round(Math.sin(angle) * distance),
        ),
        rng,
      );

      satellites.push(
        new Settlement(
          `sat_${satelliteIndex}`,
          cityName(rng, false),
          'satellite',
          center,
          // Satélites herdam a vocação da capital, com desvio ocasional que
          // cria oportunidade de arbitragem local.
          rng.chance(0.3)
            ? rng.pick(allVocations.map((v) => v.id))
            : capital.vocation,
          rng.range(10, 16),
          rng.range(8000, 45000),
          capital.id,
        ),
      );
      satelliteIndex++;
    }
  }

  const roads = generateRoads(generator, capitals, satellites, rng);
  return new WorldLayout(
    generator.seed,
    [...capitals, ...satellites],
    roads,
  );
}

// ============================================================ tiles

/** Mesma escala do lado Dart (`_detailScale`). Um valor diferente aqui daria
  * bosques e clareiras noutros lugares, com a mesma seed. */
const DETAIL_SCALE = 0.07;

/** Resolve um tile completo. Caminho quente: uma vez por tile visível. */
export function tileAt(
  generator: WorldGenerator,
  x: number,
  y: number,
  layout: WorldLayout,
): WorldTile {
  const biome = generator.biomeAt(x, y);
  const elevation = generator.elevationAt(x, y);

  if (biome === Biome.deadWater) {
    // Água parada: só vitória-régia mutante, e mesmo assim rala.
    const roll = whiteNoise2D(mix(generator.seed, 0x63), x, y);
    return {
      biome,
      elevation,
      feature: roll < 0.16 ? TileFeature.lily : TileFeature.none,
      settlementId: null,
      resource: null,
      resourceRichness: 0,
    };
  }

  const settlement = layout.settlementAt(new TileCoord(x, y));
  if (settlement) return urbanTile(generator, x, y, elevation, settlement);
  return wildTile(generator, x, y, biome, elevation);
}

/**
 * Tile dentro de uma cidade: quarteirões separados por vielas de mato.
 *
 * A cidade **não é pavimentada**. A grade a cada 4 tiles continua existindo,
 * porque é ela que dá leitura de "cidade" em vez de "amontoado", mas as faixas
 * entre os quarteirões são chão limpo com mato nascendo. Numa distopia onde a
 * manutenção pública é a primeira coisa a falir, rua conservada seria a mentira
 * mais cara da tela.
 */
function urbanTile(
  generator: WorldGenerator,
  x: number,
  y: number,
  elevation: number,
  settlement: Settlement,
): WorldTile {
  const lx = x - settlement.center.x;
  const ly = y - settlement.center.y;
  const roll = whiteNoise2D(mix(generator.seed, 0x51), x, y);

  const block = 4;
  const onLaneX = lx % block === 0;
  const onLaneY = ly % block === 0;

  if (onLaneX || onLaneY) {
    const atCrossing = onLaneX && onLaneY;
    let feature: TileFeature;
    if (atCrossing && roll < 0.16) feature = TileFeature.marketStall;
    else if (roll < 0.14) feature = TileFeature.grassTuft;
    else if (roll < 0.18) feature = TileFeature.crate;
    else if (roll < 0.2) feature = TileFeature.wreck;
    else feature = TileFeature.none;

    return {
      biome: Biome.neonCore,
      elevation,
      feature,
      settlementId: settlement.id,
      resource: null,
      resourceRichness: 0,
    };
  }

  // A praça central fica aberta: é onde a tela de cidade situa mercado e
  // governo, e um prédio em cima do centro esconde o marcador do jogador.
  if (Math.abs(lx) <= 1 && Math.abs(ly) <= 1) {
    return {
      biome: Biome.neonCore,
      elevation,
      feature: roll < 0.34 ? TileFeature.grassTuft : TileFeature.none,
      settlementId: settlement.id,
      resource: null,
      resourceRichness: 0,
    };
  }

  // Densidade cai do centro para a periferia. Os números caíram junto com a
  // troca do asfalto por mato: com 86% de ocupação no centro de uma capital não
  // sobrava um palmo de chão visível, e o mundo virou mato justamente para o
  // chão aparecer.
  const distanceRatio = Math.min(
    1,
    Math.max(0, Math.sqrt(lx * lx + ly * ly) / settlement.radius),
  );
  const buildChance = settlement.isCapital
    ? 0.66 - distanceRatio * 0.38
    : 0.52 - distanceRatio * 0.32;

  let feature: TileFeature;
  if (roll < buildChance * 0.12) feature = TileFeature.tower;
  else if (roll < buildChance) feature = TileFeature.building;
  else if (roll < buildChance + 0.05) feature = TileFeature.camp;
  else if (roll < buildChance + 0.09) feature = TileFeature.crate;
  else if (roll < buildChance + 0.13) {
    // A periferia é onde o mato volta primeiro.
    feature = distanceRatio > 0.6 ? TileFeature.bush : TileFeature.grassTuft;
  } else feature = TileFeature.none;

  return {
    biome: Biome.neonCore,
    elevation,
    feature,
    settlementId: settlement.id,
    resource: null,
    resourceRichness: 0,
  };
}

function wildTile(
  generator: WorldGenerator,
  x: number,
  y: number,
  biome: Biome,
  elevation: number,
): WorldTile {
  const scatter = whiteNoise2D(mix(generator.seed, 0x57), x, y);
  const detail = generator.detail.fbmUnit(x * DETAIL_SCALE, y * DETAIL_SCALE, {
    octaves: 2,
  });

  const feature = scatterFeature(biome, scatter, detail);

  // Jazidas agrupadas — o ruído de detalhe cria bolsões — em vez de
  // pulverizadas, para que valha a pena viajar até elas.
  let resource: string | null = null;
  let richness = 0;
  const recursos = biomeDef(biome).resources;
  if (recursos.length > 0 && detail > 0.58) {
    const pickRoll = whiteNoise2D(mix(generator.seed, 0x5d), x, y);
    const indice = Math.min(
      recursos.length - 1,
      Math.max(0, Math.floor(pickRoll * recursos.length)),
    );
    resource = recursos[indice]!;
    richness = Math.min(1, Math.max(0, (detail - 0.58) / 0.42));
  }

  return {
    biome,
    elevation,
    feature,
    settlementId: null,
    resource,
    resourceRichness: richness,
  };
}

/**
 * Escolhe o que nasce num tile selvagem.
 *
 * Duas entradas com papéis diferentes. `roll` é ruído branco: decide a espécie
 * e quebra a repetição tile a tile. `detail` é ruído coerente: decide a
 * *densidade*, e é o que faz a mata fechar em bosques e abrir em clareiras em
 * vez de virar um chuvisco uniforme. Com só o ruído branco decidindo, todo
 * bioma parecia o mesmo confete espalhado.
 */
function scatterFeature(biome: Biome, roll: number, detail: number): TileFeature {
  // Compacta a escala: `detail` fica quase todo entre 0,3 e 0,7, então usá-lo
  // cru como probabilidade quase nunca chega nos extremos.
  const density = Math.min(1, Math.max(0, (detail - 0.35) / 0.3));

  switch (biome) {
    case Biome.reclaimedForest:
      if (roll < 0.3 * density + 0.06) return TileFeature.denseTree;
      if (roll < 0.58 * density + 0.14) return TileFeature.tree;
      if (roll < 0.68) return TileFeature.bush;
      if (roll < 0.74) return TileFeature.mushroom;
      if (roll < 0.79) return TileFeature.fallenLog;
      if (roll < 0.83) return TileFeature.stump;
      if (roll < 0.88) return TileFeature.grassTuft;
      if (roll < 0.9) return TileFeature.boulder;
      return TileFeature.none;

    case Biome.bioFarm:
      if (roll < 0.34 * density + 0.1) return TileFeature.crops;
      if (roll < 0.52) return TileFeature.grassTuft;
      if (roll < 0.58) return TileFeature.fence;
      if (roll < 0.63) return TileFeature.flowers;
      if (roll < 0.67) return TileFeature.tree;
      if (roll < 0.7) return TileFeature.crate;
      return TileFeature.none;

    case Biome.scrapyard:
      if (roll < 0.28 * density + 0.1) return TileFeature.scrapPile;
      if (roll < 0.46) return TileFeature.wreck;
      if (roll < 0.53) return TileFeature.rubble;
      if (roll < 0.59) return TileFeature.crate;
      if (roll < 0.63) return TileFeature.camp;
      if (roll < 0.7) return TileFeature.grassTuft;
      return TileFeature.none;

    case Biome.oilFields:
      if (roll < 0.1 * density + 0.03) return TileFeature.oilPump;
      if (roll < 0.2) return TileFeature.deadTree;
      if (roll < 0.27) return TileFeature.rock;
      if (roll < 0.32) return TileFeature.crate;
      if (roll < 0.36) return TileFeature.wreck;
      if (roll < 0.44) return TileFeature.grassTuft;
      return TileFeature.none;

    case Biome.rareEarthMine:
      if (roll < 0.18 * density + 0.08) return TileFeature.boulder;
      if (roll < 0.34) return TileFeature.rock;
      if (roll < 0.41) return TileFeature.extractionRig;
      if (roll < 0.47) return TileFeature.cliff;
      if (roll < 0.52) return TileFeature.rubble;
      if (roll < 0.58) return TileFeature.grassTuft;
      return TileFeature.none;

    case Biome.ruins:
      if (roll < 0.2 * density + 0.06) return TileFeature.rubble;
      if (roll < 0.36) return TileFeature.wall;
      if (roll < 0.44) return TileFeature.tower;
      if (roll < 0.5) return TileFeature.wreck;
      if (roll < 0.58) return TileFeature.bush;
      if (roll < 0.66) return TileFeature.grassTuft;
      if (roll < 0.7) return TileFeature.tree;
      return TileFeature.none;

    case Biome.sprawl:
      if (roll < 0.2 * density + 0.08) return TileFeature.building;
      if (roll < 0.36) return TileFeature.camp;
      if (roll < 0.44) return TileFeature.fence;
      if (roll < 0.5) return TileFeature.crate;
      if (roll < 0.55) return TileFeature.crops;
      if (roll < 0.63) return TileFeature.grassTuft;
      return TileFeature.none;

    case Biome.toxicMarsh:
      if (roll < 0.2 * density + 0.06) return TileFeature.mushroom;
      if (roll < 0.34) return TileFeature.deadTree;
      if (roll < 0.42) return TileFeature.lily;
      if (roll < 0.5) return TileFeature.bush;
      if (roll < 0.56) return TileFeature.rubble;
      if (roll < 0.64) return TileFeature.grassTuft;
      return TileFeature.none;

    case Biome.wasteland:
      if (roll < 0.1 * density + 0.02) return TileFeature.cactus;
      if (roll < 0.18) return TileFeature.rock;
      if (roll < 0.23) return TileFeature.deadTree;
      if (roll < 0.27) return TileFeature.stump;
      if (roll < 0.31) return TileFeature.rubble;
      if (roll < 0.42) return TileFeature.grassTuft;
      return TileFeature.none;

    case Biome.neonCore:
      if (roll < 0.3 * density + 0.12) return TileFeature.building;
      if (roll < 0.5) return TileFeature.tower;
      if (roll < 0.58) return TileFeature.crate;
      if (roll < 0.66) return TileFeature.grassTuft;
      return TileFeature.none;

    case Biome.deadWater:
      return TileFeature.none;
  }
}

export { CHUNK_SIZE, type CityVocation };
