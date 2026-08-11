/**
 * Biomas do mundo, espelhando `lib/domain/world/biome.dart`.
 *
 * **As cores aqui não são as do app.** Lá elas são um *tint* de 22% a 42% sobre
 * um sprite já iluminado, e por isso foram escolhidas quase pretas. Usadas como
 * cor própria de uma folha de grama, produziram um campo noturno — a primeira
 * captura desta cena saiu quase toda preta. Estas são as mesmas famílias de
 * matiz, na luminância de um dia nublado.
 *
 * Além do rótulo e do custo de travessia, cada bioma carrega a paleta que o
 * renderizador usa. No cliente Flutter a cor era um *tint* sobre sprites
 * prontos; aqui ela pinta a grama e o terreno diretamente, então cada bioma
 * ganhou também as duas cores da lâmina — base e ponta. É o gradiente ao longo
 * da folha que dá o aspecto *painterly*: pintar a grama de uma cor só produz
 * um tapete de feltro.
 */
export const enum Biome {
  neonCore = 'neonCore',
  sprawl = 'sprawl',
  scrapyard = 'scrapyard',
  oilFields = 'oilFields',
  rareEarthMine = 'rareEarthMine',
  bioFarm = 'bioFarm',
  reclaimedForest = 'reclaimedForest',
  toxicMarsh = 'toxicMarsh',
  wasteland = 'wasteland',
  ruins = 'ruins',
  deadWater = 'deadWater',
}

export interface BiomeDef {
  readonly id: Biome;
  readonly label: string;
  readonly travelCost: number;
  /** Cor do solo exposto, sob a grama. */
  readonly soil: number;
  /** Base da lâmina, na sombra. */
  readonly grassBase: number;
  /** Ponta da lâmina, onde bate a luz. */
  readonly grassTip: number;
  /** Cor de destaque do bioma — jazidas, névoa, interface. */
  readonly accent: number;
  /**
   * Quanta grama nasce aqui, de 0 a 1. É o que separa a Mata Reflorestada
   * fechada do Descampado ralo sem precisar de outro sistema.
   */
  readonly grassDensity: number;
  /** Altura média da lâmina, em metros. */
  readonly grassHeight: number;
  readonly walkable: boolean;
  /** Recursos de Camada 1 extraíveis aqui. */
  readonly resources: readonly string[];
}

const defs: Record<Biome, BiomeDef> = {
  [Biome.neonCore]: {
    id: Biome.neonCore,
    label: 'Cidadela',
    travelCost: 1.0,
    soil: 0x3a4055,
    grassBase: 0x2f5c4a,
    grassTip: 0x74c79a,
    accent: 0x00e5ff,
    grassDensity: 0.35,
    grassHeight: 0.28,
    walkable: true,
    resources: [],
  },
  [Biome.sprawl]: {
    id: Biome.sprawl,
    label: 'Arrabalde',
    travelCost: 1.1,
    soil: 0x4b4152,
    grassBase: 0x3c6b48,
    grassTip: 0x8fd07e,
    accent: 0xff2d95,
    grassDensity: 0.45,
    grassHeight: 0.34,
    walkable: true,
    resources: ['scrap'],
  },
  [Biome.scrapyard]: {
    id: Biome.scrapyard,
    label: 'Pedreira',
    travelCost: 1.4,
    soil: 0x5f5340,
    grassBase: 0x5a5f33,
    grassTip: 0xc2cf72,
    accent: 0xffb300,
    grassDensity: 0.4,
    grassHeight: 0.3,
    walkable: true,
    resources: ['scrap', 'rareEarth'],
  },
  [Biome.oilFields]: {
    id: Biome.oilFields,
    label: 'Veio de Breu',
    travelCost: 1.3,
    soil: 0x3d332b,
    grassBase: 0x4c4728,
    grassTip: 0xb0a355,
    accent: 0xff6d00,
    grassDensity: 0.3,
    grassHeight: 0.26,
    walkable: true,
    resources: ['oil'],
  },
  [Biome.rareEarthMine]: {
    id: Biome.rareEarthMine,
    label: 'Veio de Prata',
    travelCost: 1.6,
    soil: 0x51455e,
    grassBase: 0x445356,
    grassTip: 0x9fc0c6,
    accent: 0xb388ff,
    grassDensity: 0.22,
    grassHeight: 0.22,
    walkable: true,
    resources: ['rareEarth'],
  },
  [Biome.bioFarm]: {
    id: Biome.bioFarm,
    label: 'Lavoura',
    travelCost: 1.0,
    soil: 0x54462f,
    grassBase: 0x3f7f45,
    grassTip: 0xc0f28d,
    accent: 0x00e676,
    grassDensity: 0.92,
    grassHeight: 0.52,
    walkable: true,
    resources: ['biomass', 'culturedMeat'],
  },
  [Biome.reclaimedForest]: {
    id: Biome.reclaimedForest,
    label: 'Floresta',
    travelCost: 1.5,
    soil: 0x453f2a,
    grassBase: 0x2c6f4c,
    grassTip: 0x9df0bd,
    accent: 0x69f0ae,
    grassDensity: 1.0,
    grassHeight: 0.62,
    walkable: true,
    resources: ['biomass'],
  },
  [Biome.toxicMarsh]: {
    id: Biome.toxicMarsh,
    label: 'Charco',
    travelCost: 2.0,
    soil: 0x3a4c46,
    grassBase: 0x2e6f66,
    grassTip: 0x8ff0d2,
    accent: 0x00bfa5,
    grassDensity: 0.75,
    grassHeight: 0.7,
    walkable: true,
    resources: ['biomass', 'oil'],
  },
  [Biome.wasteland]: {
    id: Biome.wasteland,
    label: 'Ermo',
    travelCost: 1.7,
    soil: 0x6a5c4e,
    grassBase: 0x6b6244,
    grassTip: 0xd9c98a,
    accent: 0x8d6e63,
    grassDensity: 0.18,
    grassHeight: 0.24,
    walkable: true,
    resources: ['scrap'],
  },
  [Biome.ruins]: {
    id: Biome.ruins,
    label: 'Ruínas',
    travelCost: 1.8,
    soil: 0x5b5262,
    grassBase: 0x44604a,
    grassTip: 0xa8cf9f,
    accent: 0xce93d8,
    grassDensity: 0.5,
    grassHeight: 0.4,
    walkable: true,
    resources: ['scrap', 'rareEarth'],
  },
  [Biome.deadWater]: {
    id: Biome.deadWater,
    label: 'Água Parada',
    travelCost: 999,
    soil: 0x1b3a56,
    grassBase: 0x1e4c62,
    grassTip: 0x4a97a8,
    accent: 0x2979ff,
    // Água não tem grama. O renderizador ainda consulta a densidade, então
    // deixar zero aqui é mais barato que abrir uma exceção no laço.
    grassDensity: 0,
    grassHeight: 0,
    walkable: false,
    resources: [],
  },
};

export function biomeDef(biome: Biome): BiomeDef {
  return defs[biome];
}

export const allBiomes: readonly BiomeDef[] = Object.values(defs);

/**
 * Biomas onde faz sentido plantar uma cidade.
 *
 * O charco e as ruínas ficam de fora mesmo sendo atravessáveis: uma capital
 * nascida em cima de água tóxica ou de escombros contradiz o próprio mapa, e é
 * o tipo de detalhe que denuncia geração automática.
 */
export function supportsSettlement(biome: Biome): boolean {
  const def = biomeDef(biome);
  return def.walkable && biome !== Biome.toxicMarsh && biome !== Biome.ruins;
}
