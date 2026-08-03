import { Plot, plotSizeForLevel, type PlotJson } from '../building/plot';
import { VillageIdentity } from '../building/villageIdentity';
import { AttributeSet, type CitizenLevel } from '../character/attributes';
import { Character } from '../character/character';
import { DeterministicRandom, hashLabel } from '../core/rng';
import { Market, seedMarket, type MarketJson, type MarketKind } from '../economy/market';
import { Government, type GovernmentJson } from '../politics/government';
import { TileCoord } from '../world/coords';
import { WorldLayout, type WorldLayoutJson } from '../world/layout';
import type { Settlement } from '../world/settlement';
import { World } from '../world/world';

/**
 * Uma campanha: um mundo gerado, um personagem e o estado do servidor.
 *
 * "Cada nova campanha gera um mundo novo" — a seed é o único input. Tudo que
 * **não** é derivável da seed vive aqui e é persistido: personagem, terreno,
 * mercados, governos, dia atual.
 *
 * ## O que o save guarda, e o que ele não guarda
 *
 * O terreno do mundo não vai para o save: ele é função pura da seed e se
 * regenera igual. O **layout** vai, porque depende de uma visão global do mapa
 * e precisa sobreviver a uma mudança na fórmula de geração — senão a cidade
 * onde o jogador comprou a fazenda muda de lugar num update.
 */

const MAX_JOURNAL = 200;

export interface CampaignJson {
  id: string;
  seedLabel: string;
  seed: number;
  day: number;
  createdAt: number | null;
  layout: WorldLayoutJson;
  character: Record<string, unknown>;
  plot: PlotJson;
  governments: Record<string, GovernmentJson>;
  markets: Record<string, MarketJson>;
  journal: string[];
  completedQuests: string[];
  visitedSettlements: string[];
}

export interface CampaignSummary {
  readonly id: string;
  readonly seedLabel: string;
  readonly characterName: string;
  readonly day: number;
  readonly level: CitizenLevel;
  readonly credits: number;
  readonly dead: boolean;
  readonly createdAt: number | null;
}

export class Campaign {
  /** Dia do servidor. Avança um por reset da meia-noite. */
  day: number;

  private readonly journalList: string[];

  /**
   * Ids das quests já pagas.
   *
   * Guardar o id — em vez de recalcular a recompensa — é o que garante que uma
   * quest pague exatamente uma vez, mesmo que o jogador gaste os créditos e a
   * condição volte a não valer.
   */
  readonly completedQuests: Set<string>;

  /**
   * Cidades onde o jogador já esteve.
   *
   * Alimenta o objetivo de explorar as estradas. Sem ele, o jogo inteiro
   * caberia numa capital só.
   */
  readonly visitedSettlements: Set<string>;

  constructor(
    readonly id: string,
    /** O texto que o jogador digitou — dá para recriar e compartilhar. */
    readonly seedLabel: string,
    readonly seed: number,
    readonly world: World,
    readonly character: Character,
    /** O terreno do jogador, sempre dentro de uma metrópole. */
    readonly plot: Plot,
    private readonly governmentMap: Map<string, Government>,
    private readonly marketMap: Map<string, Market>,
    options: {
      day?: number;
      createdAt?: number | null;
      journal?: readonly string[];
      completedQuests?: Iterable<string>;
      visitedSettlements?: Iterable<string>;
    } = {},
  ) {
    this.day = options.day ?? 1;
    this.createdAt = options.createdAt ?? null;
    this.journalList = [...(options.journal ?? [])];
    this.completedQuests = new Set(options.completedQuests ?? []);
    this.visitedSettlements = new Set(options.visitedSettlements ?? []);
  }

  readonly createdAt: number | null;

  /** Cria uma campanha nova a partir de um rótulo de seed. */
  static create(options: {
    id: string;
    seedLabel: string;
    characterName: string;
    now?: number;
  }): Campaign {
    const seed = hashLabel(options.seedLabel);
    const world = World.fromSeed(seed);
    const rng = new DeterministicRandom(seed).fork('campaign');

    // O jogador começa numa capital sorteada.
    const startCapital = rng.pick(world.layout.capitals);

    const character = new Character({
      id: 'player',
      name: options.characterName,
      attributes: AttributeSet.roll(rng.fork('attributes')),
      position: startCapital.center,
      homeSettlementId: startCapital.id,
    });

    const governments = new Map<string, Government>();
    const markets = new Map<string, Market>();

    for (const settlement of world.layout.settlements) {
      governments.set(
        settlement.id,
        new Government(settlement.id, {
          // Capitais começam sem governador eleito — a primeira eleição é um
          // gancho de conteúdo logo no início da campanha.
          taxRate: rng.rangeDouble(0.04, 0.14),
          publicWage: rng.range(28, 62),
          treasury: settlement.isCapital
            ? rng.range(40000, 180000)
            : rng.range(4000, 22000),
        }),
      );

      const marketRng = rng.fork(`market_${settlement.id}`);
      // O mercado pede a **vocação resolvida**, não o id dela: `Settlement`
      // guarda a etiqueta e o catálogo guarda o que ela produz e demanda.
      const perfil = {
        isCapital: settlement.isCapital,
        vocation: settlement.vocationDef,
      };

      const central = new Market(settlement.id, 'central');
      seedMarket(central, perfil, marketRng);
      markets.set(marketKey(settlement.id, 'central'), central);

      // Só capitais e satélites grandes têm clandestino organizado.
      if (settlement.isCapital || marketRng.chance(0.45)) {
        const black = new Market(settlement.id, 'clandestine');
        seedMarket(black, perfil, marketRng.fork('black'));
        markets.set(marketKey(settlement.id, 'clandestine'), black);
      }
    }

    return new Campaign(
      options.id,
      options.seedLabel,
      seed,
      world,
      character,
      buildStartingPlot(startCapital, 'survivor'),
      governments,
      markets,
      {
        createdAt: options.now ?? Date.now(),
        visitedSettlements: [startCapital.id],
      },
    );
  }

  get journal(): readonly string[] {
    return this.journalList;
  }

  get governments(): ReadonlyMap<string, Government> {
    return this.governmentMap;
  }

  governmentOf(settlementId: string): Government {
    let g = this.governmentMap.get(settlementId);
    if (!g) {
      g = new Government(settlementId);
      this.governmentMap.set(settlementId, g);
    }
    return g;
  }

  marketOf(settlementId: string, kind: MarketKind): Market | null {
    return this.marketMap.get(marketKey(settlementId, kind)) ?? null;
  }

  marketsAt(settlementId: string): readonly Market[] {
    const kinds: MarketKind[] = ['central', 'clandestine'];
    return kinds
      .map((k) => this.marketOf(settlementId, k))
      .filter((m): m is Market => m !== null);
  }

  /** A cidade onde o personagem está agora, se estiver em alguma. */
  get currentSettlementId(): string | null {
    return this.world.settlementAt(this.character.position)?.id ?? null;
  }

  /** Registra a cidade atual como visitada. */
  markCurrentSettlementVisited(): void {
    const id = this.currentSettlementId;
    if (id) this.visitedSettlements.add(id);
  }

  log(entry: string): void {
    this.journalList.push(`Dia ${this.day} · ${entry}`);
    // O diário é interface, não histórico oficial: manter os últimos 200 evita
    // que o save cresça sem limite numa campanha longa.
    if (this.journalList.length > MAX_JOURNAL) this.journalList.shift();
  }

  get summary(): CampaignSummary {
    return {
      id: this.id,
      seedLabel: this.seedLabel,
      characterName: this.character.name,
      day: this.day,
      level: this.character.level,
      credits: this.character.credits,
      dead: this.character.dead,
      createdAt: this.createdAt,
    };
  }

  /** Ponto de partida da câmera. */
  get spawnPoint(): TileCoord {
    return (
      this.world.layout.byId(this.character.homeSettlementId)?.center ??
      this.character.position
    );
  }

  toJson(): CampaignJson {
    return {
      id: this.id,
      seedLabel: this.seedLabel,
      seed: this.seed,
      day: this.day,
      createdAt: this.createdAt,
      layout: this.world.layout.toJson(),
      character: this.character.toJson(),
      plot: this.plot.toJson(),
      governments: Object.fromEntries(
        [...this.governmentMap].map(([k, v]) => [k, v.toJson()]),
      ),
      markets: Object.fromEntries(
        [...this.marketMap].map(([k, v]) => [k, v.toJson()]),
      ),
      journal: [...this.journalList],
      completedQuests: [...this.completedQuests],
      visitedSettlements: [...this.visitedSettlements],
    };
  }

  static fromJson(json: CampaignJson): Campaign {
    const seed = Number(json.seed);
    const layout = WorldLayout.fromJson(json.layout);
    const character = Character.fromJson(json.character);

    // Save anterior ao sistema de terrenos não tem a chave; o terreno vazio é
    // recriado na cidade natal em vez de o save ser recusado.
    const plot = json.plot
      ? Plot.fromJson(json.plot)
      : buildStartingPlot(
          layout.byId(character.homeSettlementId) ?? layout.capitals[0]!,
          character.level,
        );

    const governments = new Map<string, Government>();
    for (const [k, v] of Object.entries(json.governments ?? {})) {
      governments.set(k, Government.fromJson(v));
    }
    const markets = new Map<string, Market>();
    for (const [k, v] of Object.entries(json.markets ?? {})) {
      markets.set(k, Market.fromJson(v));
    }

    return new Campaign(
      json.id,
      json.seedLabel,
      seed,
      World.restore(seed, layout),
      character,
      plot,
      governments,
      markets,
      {
        day: Number(json.day) || 1,
        createdAt: json.createdAt ?? null,
        journal: json.journal ?? [],
        completedQuests: json.completedQuests ?? [],
        visitedSettlements: json.visitedSettlements ?? [],
      },
    );
  }
}

/**
 * Reserva o terreno inicial **dentro** da metrópole.
 *
 * O terreno nunca fica em campo aberto: o mundo selvagem é para explorar,
 * extrair e viajar, e toda construção acontece na base urbana. O deslocamento
 * de 5 tiles tira o terreno de cima do centro — onde ficam mercado e governo —
 * sem sair do raio urbano.
 */
export function buildStartingPlot(
  settlement: Settlement,
  level: CitizenLevel,
): Plot {
  const [width, height] = plotSizeForLevel(level);
  const plot = new Plot(
    `plot_${settlement.id}`,
    settlement.id,
    { x: settlement.center.x + 5, y: settlement.center.y + 5 },
    width,
    height,
  );
  plot.identity = new VillageIdentity(`Terreno em ${settlement.name}`);
  return plot;
}

function marketKey(settlementId: string, kind: MarketKind): string {
  return `${settlementId}::${kind}`;
}
