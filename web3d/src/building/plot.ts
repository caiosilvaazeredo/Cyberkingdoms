import type { Inventory } from '../economy/inventory';
import {
  VillageIdentity,
  type VillageIdentityJson,
} from './villageIdentity';
import {
  buildingDef,
  citizenRank,
  flatMultiplierFor,
  isBuildingId,
  maxBuildingLevel,
  moduleSlotsFor,
  outputMultiplierFor,
  upgradeCreditCost,
  upgradeDays,
  upgradeMaterialCost,
  upkeepMultiplierFor,
  type BuildingDef,
  type CitizenLevel,
} from './buildingType';
import { moduleDef, type ModuleDef } from './buildingModule';

/**
 * O terreno do jogador — o vilarejo.
 *
 * **Regra central:** construção só existe dentro de um terreno, e todo terreno
 * fica dentro de uma metrópole. Não se constrói em campo aberto; o mundo
 * selvagem é para explorar, extrair e viajar.
 *
 * Este módulo é onde a jogabilidade de tycoon acontece: validar um encaixe,
 * cobrar o custo, tocar a obra por N dias, produzir, e cobrar manutenção
 * quando o dia vira.
 */

export interface BuildingStats {
  readonly outputPerDay: number;
  readonly jobSlots: number;
  readonly storageBonus: number;
  readonly defenseBonus: number;
  readonly statusBonus: number;
  readonly populationCapacity: number;
  readonly dailyUpkeep: number;
  readonly hungerUpkeepModifier: number;
  readonly thirstUpkeepModifier: number;
  /** Produz no máximo mesmo sem funcionário. */
  readonly ignoresStaffing: boolean;
}

export interface PlacedBuildingJson {
  instanceId: string;
  type: string;
  x: number;
  y: number;
  daysRemaining: number;
  workers: number;
  idle: boolean;
  level: number;
  upgrading: boolean;
  customName: string | null;
  accentColor: number | null;
  modules: string[];
}

/** Uma construção erguida no terreno. */
export class PlacedBuilding {
  constructor(
    readonly instanceId: string,
    readonly type: string,
    public x: number,
    public y: number,
    public daysRemaining: number,
    public workers = 0,
    public idle = false,
    public level = 1,
    /**
     * `true` quando os dias restantes são de uma evolução, não da obra
     * inicial. A distinção importa: durante a evolução a construção **já
     * existe** e continua ocupando espaço, mas para de produzir.
     */
    public upgrading = false,
    public customName: string | null = null,
    public accentColor: number | null = null,
    private readonly modulesSet = new Set<string>(),
  ) {}

  get def(): BuildingDef {
    return buildingDef(this.type);
  }

  get modules(): ReadonlySet<string> {
    return this.modulesSet;
  }

  get isReady(): boolean {
    return this.daysRemaining <= 0;
  }

  /** Nome que a interface mostra. */
  get displayName(): string {
    return this.customName ?? this.def.name;
  }

  /** Nome com o algarismo do nível, para listas. */
  get labelWithLevel(): string {
    return `${this.displayName} ${'I'.repeat(this.level)}`;
  }

  get moduleSlots(): number {
    return moduleSlotsFor(this.level);
  }

  get canAddModule(): boolean {
    return this.modulesSet.size < this.moduleSlots;
  }

  get canUpgrade(): boolean {
    return this.level < maxBuildingLevel;
  }

  /** Tiles ocupados pela footprint. */
  covers(px: number, py: number): boolean {
    return (
      px >= this.x &&
      px < this.x + this.def.width &&
      py >= this.y &&
      py < this.y + this.def.height
    );
  }

  overlaps(other: { x: number; y: number; def: BuildingDef }): boolean {
    return (
      other.x < this.x + this.def.width &&
      other.x + other.def.width > this.x &&
      other.y < this.y + this.def.height &&
      other.y + other.def.height > this.y
    );
  }

  /**
   * Números efetivos: catálogo × nível × módulos.
   *
   * A manutenção sobe mais rápido que a produção de propósito — é o que
   * impede que evoluir tudo ao nível III seja sempre a jogada certa.
   */
  get stats(): BuildingStats {
    const def = this.def;
    const levelOutput = outputMultiplierFor(this.level);
    const levelFlat = flatMultiplierFor(this.level);
    const levelUpkeep = upkeepMultiplierFor(this.level);

    let outputBonus = 0;
    let storage = 0;
    let defense = 0;
    let status = 0;
    let jobs = 0;
    let population = 0;
    let upkeepDelta = 0;
    let upkeepFactor = 0;
    let hunger = 0;
    let thirst = 0;
    let ignoresStaffing = false;

    for (const id of this.modulesSet) {
      const m: ModuleDef = moduleDef(id);
      outputBonus += m.outputMultiplier;
      storage += m.storageBonus;
      defense += m.defenseBonus;
      status += m.statusBonus;
      jobs += m.jobSlotBonus;
      population += m.populationBonus;
      upkeepDelta += m.upkeepDelta;
      upkeepFactor += m.upkeepMultiplier;
      hunger += m.hungerUpkeepModifier;
      thirst += m.thirstUpkeepModifier;
      ignoresStaffing = ignoresStaffing || m.removesStaffingPenalty;
    }

    const baseUpkeep = Math.round(def.dailyUpkeep * levelUpkeep) + upkeepDelta;
    const upkeep = Math.min(
      999999,
      Math.max(0, Math.round(baseUpkeep * (1 + upkeepFactor))),
    );

    return {
      outputPerDay: Math.round(def.outputPerDay * levelOutput * (1 + outputBonus)),
      jobSlots: Math.round(def.jobSlots * levelOutput) + jobs,
      storageBonus: Math.round(def.storageBonus * levelFlat) + storage,
      defenseBonus: Math.round(def.defenseBonus * levelFlat) + defense,
      statusBonus: Math.round(def.statusBonus * levelFlat) + status,
      populationCapacity:
        Math.round(def.populationCapacity * levelFlat) + population,
      dailyUpkeep: upkeep,
      hungerUpkeepModifier: def.hungerUpkeepModifier + hunger,
      thirstUpkeepModifier: def.thirstUpkeepModifier + thirst,
      ignoresStaffing,
    };
  }

  /** Insumos por dia, escalados pelo nível. */
  get consumesPerDay(): Record<string, number> {
    const factor = outputMultiplierFor(this.level);
    const out: Record<string, number> = {};
    for (const [id, qty] of Object.entries(this.def.consumes)) {
      out[id] = Math.round(qty * factor);
    }
    return out;
  }

  addModule(id: string): boolean {
    if (!this.canAddModule) return false;
    if (this.modulesSet.has(id)) return false;
    if (!moduleDef(id).categories.includes(this.def.category)) return false;
    this.modulesSet.add(id);
    return true;
  }

  removeModule(id: string): boolean {
    return this.modulesSet.delete(id);
  }

  toJson(): PlacedBuildingJson {
    return {
      instanceId: this.instanceId,
      type: this.type,
      x: this.x,
      y: this.y,
      daysRemaining: this.daysRemaining,
      workers: this.workers,
      idle: this.idle,
      level: this.level,
      upgrading: this.upgrading,
      customName: this.customName,
      accentColor: this.accentColor,
      modules: [...this.modulesSet],
    };
  }

  static fromJson(json: PlacedBuildingJson): PlacedBuilding | null {
    // Um save com uma construção que saiu do catálogo perde aquela peça, não a
    // campanha inteira.
    if (!isBuildingId(json.type)) return null;
    return new PlacedBuilding(
      json.instanceId,
      json.type,
      json.x,
      json.y,
      json.daysRemaining,
      json.workers ?? 0,
      json.idle ?? false,
      Math.min(maxBuildingLevel, Math.max(1, json.level ?? 1)),
      json.upgrading ?? false,
      json.customName ?? null,
      json.accentColor ?? null,
      new Set((json.modules ?? []).filter((m) => {
        try {
          moduleDef(m);
          return true;
        } catch {
          return false;
        }
      })),
    );
  }
}

// --------------------------------------------------------- resultado de ação

export type BuildResult =
  | { readonly ok: true; readonly building: PlacedBuilding }
  | { readonly ok: false; readonly reason: string };

export interface PlacementCheck {
  readonly valid: boolean;
  readonly reason: string | null;
}

export interface PlotJson {
  id: string;
  settlementId: string;
  origin: { x: number; y: number };
  width: number;
  height: number;
  buildings: PlacedBuildingJson[];
  identity?: VillageIdentityJson;
}

/** Tamanho do terreno por nível de cidadão. */
export function plotSizeForLevel(level: CitizenLevel): [number, number] {
  switch (level) {
    case 'farmer':
      return [10, 10];
    case 'industrialist':
      return [13, 13];
    case 'elite':
      return [16, 16];
    default:
      return [8, 8];
  }
}

export class Plot {
  private readonly list: PlacedBuilding[] = [];
  private nextId = 1;

  /**
   * Identidade do vilarejo: nome, lema, brasão e cores.
   *
   * Mutável de propósito — o jogador renomeia o terreno em jogo, e o nome entra
   * na conta de Status. É a única parte cosmética que tem efeito de regra.
   */
  identity: VillageIdentity = new VillageIdentity();

  constructor(
    readonly id: string,
    readonly settlementId: string,
    readonly origin: { x: number; y: number },
    readonly width: number,
    readonly height: number,
    buildings: PlacedBuilding[] = [],
  ) {
    this.list.push(...buildings);
    this.nextId = this.list.length + 1;
  }

  get buildings(): readonly PlacedBuilding[] {
    return this.list;
  }

  /** Construções prontas e não paradas. */
  get operational(): PlacedBuilding[] {
    return this.list.filter((b) => b.isReady && !b.upgrading);
  }

  get tileCount(): number {
    return this.width * this.height;
  }

  worldTileFor(px: number, py: number): { x: number; y: number } {
    return { x: this.origin.x + px, y: this.origin.y + py };
  }

  gridCellFor(tile: { x: number; y: number }): { x: number; y: number } | null {
    const px = tile.x - this.origin.x;
    const py = tile.y - this.origin.y;
    if (px < 0 || py < 0 || px >= this.width || py >= this.height) return null;
    return { x: px, y: py };
  }

  containsWorldTile(tile: { x: number; y: number }): boolean {
    return this.gridCellFor(tile) !== null;
  }

  at(px: number, py: number): PlacedBuilding | null {
    return this.list.find((b) => b.covers(px, py)) ?? null;
  }

  /**
   * Valida um encaixe **sem** cobrar nada.
   *
   * É o que a pré-visualização usa: o fantasma fica verde ou vermelho enquanto
   * o dedo arrasta, e a mensagem explica o porquê. Separar a checagem da ação
   * é o que permite mostrar o motivo antes do toque, em vez de recusar depois.
   */
  canPlace(
    type: string,
    px: number,
    py: number,
    options: {
      level: CitizenLevel;
      credits?: number;
      inventory?: Inventory;
    },
  ): PlacementCheck {
    const def = buildingDef(type);

    if (citizenRank[options.level] < citizenRank[def.requiredLevel]) {
      return { valid: false, reason: `${def.name} exige outro nível de cidadão.` };
    }
    if (px < 0 || py < 0 || px + def.width > this.width || py + def.height > this.height) {
      return { valid: false, reason: 'A construção não cabe dentro do terreno.' };
    }
    for (const other of this.list) {
      if (other.overlaps({ x: px, y: py, def })) {
        return { valid: false, reason: `Sobrepõe ${other.displayName}.` };
      }
    }
    if (options.credits !== undefined && options.credits < def.creditCost) {
      return { valid: false, reason: 'Créditos insuficientes.' };
    }
    if (options.inventory) {
      for (const [id, qty] of Object.entries(def.materialCost)) {
        if (!options.inventory.has(id, qty)) {
          return { valid: false, reason: 'Faltam materiais.' };
        }
      }
    }
    return { valid: true, reason: null };
  }

  /**
   * Ergue a construção, cobrando materiais.
   *
   * Os créditos **não** são debitados aqui: quem guarda o caixa é o
   * personagem, e o terreno não deveria conhecê-lo. O chamador desconta
   * `def.creditCost` depois de receber `ok`.
   */
  build(
    type: string,
    px: number,
    py: number,
    options: { level: CitizenLevel; credits: number; inventory: Inventory },
  ): BuildResult {
    const check = this.canPlace(type, px, py, options);
    if (!check.valid) return { ok: false, reason: check.reason! };

    const def = buildingDef(type);
    for (const [id, qty] of Object.entries(def.materialCost)) {
      // Já validado por `canPlace`; se falhar aqui houve corrida e é melhor
      // parar do que erguer de graça.
      if (!options.inventory.remove(id, qty)) {
        return { ok: false, reason: 'Faltam materiais.' };
      }
    }

    const building = new PlacedBuilding(
      `b${this.nextId++}`,
      type,
      px,
      py,
      def.buildDays,
    );
    this.list.push(building);
    return { ok: true, building };
  }

  /**
   * Demole. Devolve metade dos materiais, arredondando para baixo.
   *
   * Meia devolução, e não total: demolir e reconstruir de graça tornaria o
   * planejamento irrelevante, que é justamente a decisão que um tycoon pede.
   */
  demolish(instanceId: string, inventory: Inventory): boolean {
    const index = this.list.findIndex((b) => b.instanceId === instanceId);
    if (index < 0) return false;
    const building = this.list[index]!;

    for (const [id, qty] of Object.entries(building.def.materialCost)) {
      const back = Math.floor(qty * 0.5);
      if (back > 0) inventory.add(id, back);
    }
    this.list.splice(index, 1);
    return true;
  }

  /** Inicia a evolução de nível. Cobra materiais; créditos ficam com quem chama. */
  upgrade(
    instanceId: string,
    options: { credits: number; inventory: Inventory },
  ): BuildResult {
    const building = this.list.find((b) => b.instanceId === instanceId);
    if (!building) return { ok: false, reason: 'Construção não encontrada.' };
    if (!building.isReady) return { ok: false, reason: 'A obra ainda não terminou.' };
    if (!building.canUpgrade) return { ok: false, reason: 'Já está no nível máximo.' };

    const def = building.def;
    const cost = upgradeCreditCost(def, building.level);
    if (options.credits < cost) return { ok: false, reason: 'Créditos insuficientes.' };

    const materials = upgradeMaterialCost(def, building.level);
    for (const [id, qty] of Object.entries(materials)) {
      if (!options.inventory.has(id, qty)) {
        return { ok: false, reason: 'Faltam materiais.' };
      }
    }
    for (const [id, qty] of Object.entries(materials)) {
      options.inventory.remove(id, qty);
    }

    building.level++;
    building.daysRemaining = upgradeDays(def, building.level - 1);
    building.upgrading = true;
    return { ok: true, building };
  }

  /** Instala um módulo. Cobra materiais; créditos ficam com quem chama. */
  installModule(
    instanceId: string,
    moduleId: string,
    options: { credits: number; inventory: Inventory },
  ): BuildResult {
    const building = this.list.find((b) => b.instanceId === instanceId);
    if (!building) return { ok: false, reason: 'Construção não encontrada.' };
    if (!building.isReady) return { ok: false, reason: 'A obra ainda não terminou.' };
    if (!building.canAddModule) return { ok: false, reason: 'Sem espaço para módulo.' };

    const mod = moduleDef(moduleId);
    if (!mod.categories.includes(building.def.category)) {
      return { ok: false, reason: `${mod.label} não serve nesta construção.` };
    }
    if (options.credits < mod.creditCost) {
      return { ok: false, reason: 'Créditos insuficientes.' };
    }
    for (const [id, qty] of Object.entries(mod.materialCost)) {
      if (!options.inventory.has(id, qty)) {
        return { ok: false, reason: 'Faltam materiais.' };
      }
    }
    for (const [id, qty] of Object.entries(mod.materialCost)) {
      options.inventory.remove(id, qty);
    }

    building.addModule(moduleId);
    return { ok: true, building };
  }

  /** Soma dos bônus das construções operantes. */
  get totals(): Omit<BuildingStats, 'ignoresStaffing' | 'outputPerDay'> {
    let jobSlots = 0;
    let storageBonus = 0;
    let defenseBonus = 0;
    let statusBonus = 0;
    let populationCapacity = 0;
    let dailyUpkeep = 0;
    let hungerUpkeepModifier = 0;
    let thirstUpkeepModifier = 0;

    for (const b of this.operational) {
      const s = b.stats;
      jobSlots += s.jobSlots;
      storageBonus += s.storageBonus;
      defenseBonus += s.defenseBonus;
      statusBonus += s.statusBonus;
      populationCapacity += s.populationCapacity;
      dailyUpkeep += s.dailyUpkeep;
      hungerUpkeepModifier += s.hungerUpkeepModifier;
      thirstUpkeepModifier += s.thirstUpkeepModifier;
    }

    return {
      jobSlots,
      storageBonus,
      defenseBonus,
      statusBonus,
      populationCapacity,
      dailyUpkeep,
      hungerUpkeepModifier,
      thirstUpkeepModifier,
    };
  }

  get name(): string {
    return this.identity.name;
  }

  get totalJobSlots(): number {
    return this.totals.jobSlots;
  }

  get employedWorkers(): number {
    return this.operational.reduce((soma, b) => soma + b.workers, 0);
  }

  get populationCapacity(): number {
    return this.totals.populationCapacity;
  }

  /** 200 de base mais o que as construções somam. */
  get storageCapacity(): number {
    return 200 + this.totals.storageBonus;
  }

  get defense(): number {
    return this.totals.defenseBonus;
  }

  /** Status do terreno: o das construções mais o da identidade escolhida. */
  get statusBonus(): number {
    return this.identity.statusBonus + this.totals.statusBonus;
  }

  get dailyUpkeep(): number {
    return this.totals.dailyUpkeep;
  }

  /** Estações de fabricação destravadas pelo que está construído. */
  get unlockedStations(): ReadonlySet<string> {
    const set = new Set<string>();
    for (const b of this.operational) {
      if (b.def.unlocksStation) set.add(b.def.unlocksStation);
    }
    return set;
  }

  /**
   * Modificadores de consumo concedidos pelas construções.
   *
   * Travados em -60%: sem o teto, empilhar construção zeraria a sobrevivência,
   * que é o sistema central do GDD. É o mesmo teto que o inventário aplica ao
   * equipamento, e pelo mesmo motivo.
   */
  get upkeepModifiers(): { hunger: number; thirst: number } {
    const t = this.totals;
    return {
      hunger: Math.min(0, Math.max(-0.6, t.hungerUpkeepModifier)),
      thirst: Math.min(0, Math.max(-0.6, t.thirstUpkeepModifier)),
    };
  }

  /** Construções ilegais presentes. Dá base para confisco pelo governo. */
  get illegalBuildings(): readonly PlacedBuilding[] {
    return this.list.filter((b) => !b.def.legal);
  }

  toJson(): PlotJson {
    return {
      id: this.id,
      settlementId: this.settlementId,
      origin: { ...this.origin },
      width: this.width,
      height: this.height,
      buildings: this.list.map((b) => b.toJson()),
      identity: this.identity.toJson(),
    };
  }

  static fromJson(json: PlotJson): Plot {
    const buildings = (json.buildings ?? [])
      .map(PlacedBuilding.fromJson)
      .filter((b): b is PlacedBuilding => b !== null);
    const plot = new Plot(
      json.id,
      json.settlementId,
      json.origin,
      json.width,
      json.height,
      buildings,
    );
    // Saves anteriores à identidade não têm a chave; o padrão entra no lugar
    // em vez de o save ser recusado.
    plot.identity = VillageIdentity.fromJson(json.identity ?? null);
    return plot;
  }
}

// ------------------------------------------------------------ reset diário

export interface PlotTickResult {
  readonly produced: Record<string, number>;
  readonly consumed: Record<string, number>;
  readonly upkeepPaid: number;
  readonly completed: PlacedBuilding[];
  readonly idled: PlacedBuilding[];
}

/**
 * Um dia no terreno.
 *
 * A ordem importa e é a mesma do original:
 *
 * 1. Obras avançam um dia. Quem fica pronto **entra na produção deste mesmo
 *    tick**, porque a lista de operantes é montada depois do desconto: o dia
 *    em que a obra acaba é um dia de trabalho, não de espera.
 * 2. Manutenção é cobrada da mais cara para a mais barata. Com caixa curto, é
 *    melhor manter três oficinas pequenas rodando do que uma fábrica grande.
 *    A ordenação é o que garante isso.
 * 3. Só quem foi pago produz, e só se tiver insumo.
 */
export function runPlotTick(
  plot: Plot,
  options: { inventory: Inventory; availableCredits: number },
): PlotTickResult {
  const produced: Record<string, number> = {};
  const consumed: Record<string, number> = {};
  const completed: PlacedBuilding[] = [];
  const idled: PlacedBuilding[] = [];

  for (const building of plot.buildings) {
    if (building.isReady) continue;
    building.daysRemaining--;
    if (building.isReady) {
      building.upgrading = false;
      completed.push(building);
    }
  }

  const operational = [...plot.operational].sort(
    (a, b) => b.stats.dailyUpkeep - a.stats.dailyUpkeep,
  );

  let remaining = options.availableCredits;
  let upkeepPaid = 0;
  const funded: PlacedBuilding[] = [];

  for (const building of operational) {
    const cost = building.stats.dailyUpkeep;
    if (cost <= remaining) {
      remaining -= cost;
      upkeepPaid += cost;
      funded.push(building);
      building.idle = false;
    } else {
      building.idle = true;
      idled.push(building);
    }
  }

  for (const building of funded) {
    const def = building.def;
    const stats = building.stats;
    if (stats.outputPerDay <= 0 || !def.produces) continue;

    // Sem funcionário a produção cai a 35%, não a zero: uma fábrica vazia
    // ainda rende alguma coisa, senão o jogador solo não sai do lugar.
    const staffing =
      stats.ignoresStaffing || stats.jobSlots === 0
        ? 1
        : Math.min(1, Math.max(0.35, 0.35 + 0.65 * (building.workers / stats.jobSlots)));

    const needs = building.consumesPerDay;
    let hasInputs = true;
    for (const [id, qty] of Object.entries(needs)) {
      if (!options.inventory.has(id, qty)) {
        hasInputs = false;
        break;
      }
    }
    if (!hasInputs) {
      building.idle = true;
      idled.push(building);
      continue;
    }

    for (const [id, qty] of Object.entries(needs)) {
      options.inventory.remove(id, qty);
      consumed[id] = (consumed[id] ?? 0) + qty;
    }

    const output = Math.floor(stats.outputPerDay * staffing);
    if (output > 0) {
      options.inventory.add(def.produces, output);
      produced[def.produces] = (produced[def.produces] ?? 0) + output;
    }
  }

  return { produced, consumed, upkeepPaid, completed, idled };
}
