import { runPlotTick, type PlotTickResult } from '../building/plot';
import { AttributeSet, citizenLevelDef } from '../character/attributes';
import type { DayEndOutcome } from '../character/character';
import {
  Combatant,
  maxHpFor,
  resolveCombat,
  rollLoot,
  type CombatReport,
} from '../combat/combat';
import { DeterministicRandom, mix } from '../core/rng';
import { itemDef } from '../economy/item';
import { TERM_LENGTH_IN_DAYS } from '../politics/government';
import { workById } from '../survival/survival';
import {
  STUDY_UPKEEP,
  certificateDef,
  dailyWage,
  professionForWork,
} from '../career/profession';
import {
  resolveUpkeep,
  type CombatOutcome,
  type DailyActivity,
  type UpkeepBreakdown,
} from '../survival/dailyActivity';
import type { Campaign } from './campaign';
import { QuestLog, rewardIsEmpty, rewardSummary, type Quest } from './quest';

/**
 * O reset da meia-noite — o coração do jogo.
 *
 * O GDD concentra quase tudo aqui: consumo de Fome e Sede, resolução de
 * combate, chegada de viagens, pagamento de salários, apuração de eleições.
 *
 * **Um motor determinístico só.** É o que vai permitir, quando o backend
 * existir, que uma tarefa de 24 h recalcule o dia no servidor e compare com o
 * que o cliente reportou. Dois caminhos de código para o mesmo reset — um no
 * cliente, outro no servidor — seria abrir a porta para a divergência que o
 * jogador consegue explorar.
 *
 * A ordem das etapas é a regra, e está numerada abaixo justamente por isso.
 */

export interface TickReport {
  /** O dia que acabou de ser fechado. */
  readonly day: number;
  readonly events: readonly string[];
  readonly upkeep: UpkeepBreakdown;
  readonly outcome: DayEndOutcome | null;
  readonly combat: CombatReport | null;
  readonly produced: Readonly<Record<string, number>>;
  /** Quests que fecharam neste reset, com a recompensa já paga. */
  readonly completedQuests: readonly Quest[];
}

export function runDailyTick(
  campaign: Campaign,
  activity: DailyActivity = {},
): TickReport {
  const events: string[] = [];
  const character = campaign.character;
  let estudando = false;

  if (character.dead) {
    return {
      day: campaign.day,
      events: ['O personagem está morto. A campanha acabou.'],
      upkeep: { lines: [], total: { hunger: 0, thirst: 0 } },
      outcome: null,
      combat: null,
      produced: {},
      completedQuests: [],
    };
  }

  // Cada dia tem a própria seed derivada: reprodutível e independente dos
  // outros, então recalcular o dia 40 não exige ter rodado os 39 anteriores.
  const dayRng = new DeterministicRandom(mix(campaign.seed, campaign.day));

  // --- 1. Viagem em curso ---------------------------------------------------
  let atividade: DailyActivity = activity;
  if (character.isTravelling) {
    character.travelDaysRemaining--;
    // Viajando o jogador não trabalha: o trânsito bloqueia ações, e a viagem já
    // é cobrada como atividade própria.
    atividade = {
      ...activity,
      publicWork: null,
      farmWork: null,
      workshopWork: null,
      roadsTravelled: 1,
      sleptOnRoad: character.travelDaysRemaining > 0,
    };

    if (character.travelDaysRemaining <= 0) {
      const destino = character.travellingTo
        ? campaign.world.layout.byId(character.travellingTo)
        : null;
      if (destino) {
        character.position = destino.center;
        events.push(`Você chegou em ${destino.name}.`);
      }
      character.travellingTo = null;
    } else {
      events.push(
        `Em trânsito — faltam ${character.travelDaysRemaining} dia(s).`,
      );
    }
  }

  // --- 1b. Curso em andamento ----------------------------------------------
  //
  // O curso consome o **dia de trabalho**, não o dia inteiro: quem estuda ainda
  // constrói e negocia. Por isso ele zera o trabalho da atividade e cobra o
  // próprio custo, em vez de bloquear o personagem como a viagem faz.
  if (character.isStudying) {
    character.studyDaysRemaining--;
    atividade = {
      ...atividade,
      publicWork: null,
      farmWork: null,
      workshopWork: null,
    };
    estudando = true;

    if (character.studyDaysRemaining <= 0 && character.studyingCertificate) {
      const certificado = certificateDef(character.studyingCertificate);
      character.certificates.add(certificado.id);
      character.studyingCertificate = null;
      events.push(`CERTIFICADO: ${certificado.label}.`);
    } else {
      events.push(
        `Estudando — faltam ${character.studyDaysRemaining} dia(s) de curso.`,
      );
    }
  }

  // --- 2. Combate -----------------------------------------------------------
  const combates: CombatOutcome[] = [...(atividade.combats ?? [])];
  let roadCombat: CombatReport | null = null;

  if (character.isTravelling || (atividade.roadsTravelled ?? 0) > 0) {
    roadCombat = rollRoadEncounter(campaign, dayRng, events);
    if (roadCombat) {
      combates.push({
        won: roadCombat.winnerId === character.id,
        rounds: roadCombat.rounds,
      });
    }
  }
  atividade = { ...atividade, combats: combates };

  // --- 3. Produção do trabalho do dia --------------------------------------
  const produced: Record<string, number> = { ...resolveWork(campaign, atividade, events) };

  // --- 3b. O terreno trabalha sozinho --------------------------------------
  // Acontece mesmo com o jogador viajando: a base opera sem ele, que é o ponto
  // de ter funcionários.
  const plotResult = runPlot(campaign, events);
  for (const [id, qtd] of Object.entries(plotResult.produced)) {
    produced[id] = (produced[id] ?? 0) + qtd;
  }

  // --- 4. Consumo de Fome e Sede -------------------------------------------
  const gear = character.inventory.upkeepModifiers;
  const doTerreno = campaign.plot.upkeepModifiers;
  // O bônus do terreno só vale quando o jogador está nele. Uma construção que
  // reduz consumo do outro lado do mapa seria mágica, e tiraria o custo de
  // viajar — que é a decisão central do jogo comerciante.
  const emCasa = campaign.currentSettlementId === campaign.plot.settlementId;

  const breakdown = resolveUpkeep(atividade, {
    hungerModifier: gear.hunger + (emCasa ? doTerreno.hunger : 0),
    thirstModifier: gear.thirst + (emCasa ? doTerreno.thirst : 0),
    // Estudar custa menos que trabalhar e mais que descansar. Custar zero
    // faria o curso ser sempre melhor que folgar, e a decisão sumiria.
    extra: estudando
      ? [{ label: 'Curso', upkeep: STUDY_UPKEEP }]
      : [],
  });
  const outcome = character.applyUpkeep(breakdown.total);

  if (outcome.starving) events.push('Você passou o dia com fome. -25 HP.');
  if (outcome.dehydrated) events.push('Você passou o dia com sede. -25 HP.');
  if (outcome.died) events.push('MORTE PERMANENTE: abandono por fome e sede.');

  // --- 5. Economia e política ----------------------------------------------
  if (!character.dead) {
    payWages(campaign, atividade, events);
    expireMarketOrders(campaign);
    tickElections(campaign, events);

    if (character.promote()) {
      events.push(`PROMOÇÃO: agora você é ${citizenLevelDef(character.level).label}.`);
    }
  }

  // --- 5b. Quests -----------------------------------------------------------
  // Por último de propósito: a promoção e a produção deste dia contam para os
  // objetivos. Avaliar antes faria o jogador esperar um reset a mais por uma
  // meta que ele já tinha cumprido.
  campaign.markCurrentSettlementVisited();
  const claimedQuests = new QuestLog(campaign).claimNewlyCompleted();
  for (const quest of claimedQuests) {
    events.push(
      `QUEST CONCLUÍDA: ${quest.title}` +
        (rewardIsEmpty(quest.reward)
          ? ''
          : ` — recompensa: ${rewardSummary(quest.reward)}`) +
        '.',
    );
  }

  // --- 6. Avança o calendário ----------------------------------------------
  campaign.day++;
  // Energia volta ao base todo reset; energéticos somam por cima durante o dia.
  character.energy = 10;

  for (const evento of events) campaign.log(evento);

  return {
    day: campaign.day - 1,
    events,
    upkeep: breakdown,
    outcome,
    combat: roadCombat,
    produced,
    completedQuests: claimedQuests,
  };
}

/** Avança obras, cobra manutenção e roda a produção das construções. */
function runPlot(campaign: Campaign, events: string[]): PlotTickResult {
  const character = campaign.character;
  const result = runPlotTick(campaign.plot, {
    inventory: character.inventory,
    availableCredits: character.credits,
  });

  character.credits -= result.upkeepPaid;

  if (result.upkeepPaid > 0) {
    events.push(`Manutenção do terreno: -${result.upkeepPaid} coroas.`);
  }
  for (const building of result.completed) {
    events.push(`Obra concluída: ${building.def.name}.`);
  }
  const produzido = Object.entries(result.produced);
  if (produzido.length > 0) {
    events.push(
      `Terreno produziu: ${produzido
        .map(([id, qtd]) => `${qtd}x ${itemDef(id).name}`)
        .join(', ')}.`,
    );
  }
  if (result.idled.length > 0) {
    events.push(
      `${result.idled.length} construção(ões) pararam por falta de caixa ou insumo.`,
    );
  }

  return result;
}

const PUBLIC_WORK_ITEM: Record<string, string> = {
  publicFarming: 'biomass',
  dump: 'scrap',
  oil: 'oil',
  rareEarth: 'rareEarth',
};
const FARM_WORK_ITEM: Record<string, string> = {
  hydroponics: 'biomass',
  biomass: 'biomass',
  bioreactors: 'culturedMeat',
};
const WORKSHOP_WORK_ITEM: Record<string, string> = {
  textiles: 'fabric',
  hardware: 'circuitBoard',
  laboratory: 'catalyst',
  gunsmith: 'pistol',
};

/** O que o trabalho do dia produziu. */
function resolveWork(
  campaign: Campaign,
  activity: DailyActivity,
  events: string[],
): Record<string, number> {
  const character = campaign.character;
  const inteligencia = character.attributes.get('intelligence');
  const forca = character.attributes.get('strength');
  const produced: Record<string, number> = {};

  const somar = (id: string, quantidade: number, rotulo: string): void => {
    produced[id] = (produced[id] ?? 0) + quantidade;
    character.inventory.add(id, quantidade);
    events.push(`${rotulo}: +${quantidade} ${itemDef(id).name}.`);
  };

  // O rótulo do trabalho sai da tabela, e não do id: o jogador lê "Lixão", não
  // "dump". O id é chave de dados; mostrá-lo na tela é vazar o banco.
  if (activity.publicWork) {
    const item = PUBLIC_WORK_ITEM[activity.publicWork]!;
    // Trabalho público paga **salário**, não entrega o produto ao trabalhador:
    // a produção é do governo. O que o jogador leva é a sobra.
    somar(
      item,
      Math.round(2 + forca * 0.25),
      `Serviço público (${workById(activity.publicWork).label})`,
    );
  }

  if (activity.farmWork) {
    const item = FARM_WORK_ITEM[activity.farmWork]!;
    somar(
      item,
      Math.round(4 + inteligencia * 0.4),
      `Fazenda (${workById(activity.farmWork).label})`,
    );
  }

  if (activity.workshopWork) {
    const item = WORKSHOP_WORK_ITEM[activity.workshopWork]!;
    somar(
      item,
      Math.min(99, Math.max(1, Math.round(1 + inteligencia * 0.3))),
      `Oficina (${workById(activity.workshopWork).label})`,
    );
  }

  return produced;
}

/** Salário de Serviços Públicos, pago pelo governo local. */
function payWages(
  campaign: Campaign,
  activity: DailyActivity,
  events: string[],
): void {
  if (!activity.publicWork) return;
  const settlementId = campaign.currentSettlementId;
  if (!settlementId) return;

  const government = campaign.governmentOf(settlementId);
  const profissao = professionForWork(activity.publicWork);

  // O piso é o que o governador definiu; a profissão multiplica. É o que amarra
  // carreira e política: quem estudou tem mais a ganhar com um salário público
  // alto, e passa a ser eleitorado que o candidato precisa convencer.
  const devido = profissao ? dailyWage(profissao, government.publicWage) : government.publicWage;
  const anterior = government.publicWage;
  government.publicWage = devido;
  const pago = government.payWages(1);
  government.publicWage = anterior;

  if (pago > 0) {
    campaign.character.credits += pago;
    const nome = profissao ? profissao.label : 'Serviço público';
    events.push(`${nome}: +${pago} coroas de salário.`);
  } else {
    events.push('O governo não tinha caixa para pagar o salário.');
  }
}

function expireMarketOrders(campaign: Campaign): void {
  for (const settlement of campaign.world.layout.settlements) {
    for (const market of campaign.marketsAt(settlement.id)) {
      market.expireOrders(campaign.day);
    }
  }
}

/** Marca e apura eleições. Cada capital elege a cada mandato. */
function tickElections(campaign: Campaign, events: string[]): void {
  if (campaign.day % TERM_LENGTH_IN_DAYS !== 0) return;

  for (const capital of campaign.world.layout.capitals) {
    const government = campaign.governmentOf(capital.id);
    // Sem disputa do jogador, um administrador local assume por inércia — uma
    // cidade sem governo nenhum não teria imposto nem salário, e o mercado
    // pararia de fazer sentido.
    if (!government.hasGovernor) {
      government.governorId = `npc_${capital.id}`;
      government.governorName = 'Administração Provisória';
      government.interim = true;
      events.push(
        `${capital.name}: sem candidatos, a Administração Provisória assumiu.`,
      );
    } else if (government.interim) {
      government.interim = false;
      events.push(`${capital.name}: mandato de ${government.governorName} confirmado.`);
    }
    // Um décimo do tesouro vira orçamento de segurança a cada mandato.
    const alocado = Math.round(government.treasury * 0.1);
    government.treasury -= alocado;
    government.securityBudget += alocado;
  }
}

/**
 * Encontro hostil na estrada.
 *
 * Estradas são zonas PvP. Enquanto não há outros jogadores online, o oponente é
 * um assaltante gerado — mas ele passa pelo **mesmo** resolvedor de combate que
 * um jogador passaria, então trocar o oponente por gente de verdade não muda
 * uma linha daqui.
 */
function rollRoadEncounter(
  campaign: Campaign,
  rng: DeterministicRandom,
  events: string[],
): CombatReport | null {
  const character = campaign.character;
  const destinoId = character.travellingTo;
  if (!destinoId) return null;

  const estradas = campaign.world.layout.roadsFrom(character.homeSettlementId);
  const rota = estradas.find((r) => r.fromId === destinoId || r.toId === destinoId);
  const danger = rota?.danger ?? 0.25;

  // Percepção alta evita a emboscada antes de ela acontecer.
  const evade = character.attributes.get('perception') * 0.015;
  if (!rng.chance(Math.min(0.9, Math.max(0.02, danger - evade)))) return null;

  const raiderRng = rng.fork(`raider_${campaign.day}`);
  const raiderAttributes = AttributeSet.roll(raiderRng);
  const raider = new Combatant({
    id: 'raider',
    name: 'Assaltante de Estrada',
    attributes: raiderAttributes,
    attackPower: raiderRng.range(4, 16),
    defensePower: raiderRng.range(0, 8),
    hp: maxHpFor(raiderAttributes),
  });

  const player = Combatant.fromCharacter({
    id: character.id,
    name: character.name,
    attributes: character.attributes,
    inventory: character.inventory,
    hp: character.hp,
  });

  const report = resolveCombat(player, raider, mix(campaign.seed, campaign.day * 31));

  // O combate mexeu no HP do combatente; devolve ao personagem. O piso de 1 é
  // o que separa perder uma briga de morrer: no GDD, derrota não elimina.
  character.hp = Math.min(character.maxHp, Math.max(1, player.hp));

  if (report.winnerId === character.id) {
    const premio = raiderRng.range(60, 320);
    character.credits += premio;
    events.push(
      `Emboscada na estrada: você venceu em ${report.rounds} rodadas. +${premio} coroas.`,
    );
  } else {
    const loot = rollLoot(character.inventory, mix(campaign.seed, campaign.day * 17));
    for (const [id, qtd] of Object.entries(loot)) {
      character.inventory.remove(id, qtd);
    }
    const perdidos = Math.round(character.credits * 0.15);
    character.credits -= perdidos;
    character.statusOffset -= report.statusLost;
    const tipos = Object.keys(loot).length;
    events.push(
      `Emboscada na estrada: você perdeu em ${report.rounds} rodadas. ` +
        `-${perdidos} coroas, -${report.statusLost} Status` +
        (tipos === 0 ? '' : `, ${tipos} tipo(s) de item saqueado(s)`) +
        '.',
    );
  }

  return report;
}
