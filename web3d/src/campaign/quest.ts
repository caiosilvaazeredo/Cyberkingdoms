import questsJson from '../data/quests.json';

import {
  buildingDef,
  citizenRank,
  type BuildingCategory,
  type CitizenLevel,
} from '../building/buildingType';
import { citizenLevelDef } from '../character/attributes';
import { itemDef } from '../economy/item';
import type { Campaign } from './campaign';

/**
 * A campanha principal: quatro atos seguindo os estágios do GDD.
 *
 * A progressão do GDD é econômica, não narrativa — "comprar a primeira
 * fazenda", "abrir indústria", "entrar na política". As quests dão nome e ordem
 * a isso: tutorial no começo, lista de metas depois. **Nenhuma bloqueia o
 * jogador**; quem quiser ignorar tudo e virar comerciante pode.
 *
 * ## Objetivos são funções puras do estado
 *
 * Não são bandeiras que alguém precisa lembrar de marcar. Uma quest fica
 * completa no instante em que a condição passa a valer — inclusive se o jogador
 * cumpriu por acidente, antes de a quest ser oferecida — e carregar um save
 * antigo recalcula tudo sem migração.
 *
 * ## Por que os dados vêm de JSON
 *
 * As 17 quests, com briefing e recompensa, são exportadas do Dart por
 * `test/catalog_export_test.dart`. Transcrever à mão criaria uma segunda
 * verdade sobre o texto e sobre os números, e o exportador recusa gravar um
 * objetivo que ele não saiba etiquetar — um tipo novo esquecido vira quest que
 * nunca fecha, e isso falha lá, não aqui.
 */

export type QuestObjective =
  | { readonly kind: 'haveCredits'; readonly amount: number }
  | { readonly kind: 'haveItem'; readonly item: string; readonly quantity: number }
  | { readonly kind: 'haveBuilding'; readonly type: string; readonly count: number }
  | {
      readonly kind: 'haveBuildingCategory';
      readonly category: BuildingCategory;
      readonly count: number;
    }
  | { readonly kind: 'employWorkers'; readonly count: number }
  | { readonly kind: 'surviveUntilDay'; readonly day: number }
  | { readonly kind: 'visitSettlements'; readonly count: number }
  | { readonly kind: 'reachLevel'; readonly level: CitizenLevel }
  | { readonly kind: 'reachStatus'; readonly value: number }
  | { readonly kind: 'becomeGovernor' }
  | { readonly kind: 'reachPlotDefense'; readonly value: number };

export interface QuestReward {
  readonly credits: number;
  readonly statusBonus: number;
  readonly items: Readonly<Record<string, number>>;
}

export interface Quest {
  readonly id: string;
  /** Estágio do GDD a que a quest pertence. */
  readonly stage: CitizenLevel;
  readonly title: string;
  /** Texto narrativo. É onde o lore entra sem virar parede de texto. */
  readonly briefing: string;
  readonly objectives: readonly QuestObjective[];
  readonly reward: QuestReward;
  /** Quests que precisam estar completas antes desta aparecer. */
  readonly requires: readonly string[];
}

export const allQuests = questsJson as unknown as readonly Quest[];

export function questById(id: string): Quest | null {
  return allQuests.find((q) => q.id === id) ?? null;
}

const categoryLabels: Record<string, string> = {
  housing: 'Moradia',
  extraction: 'Extração',
  refining: 'Refino',
  manufacturing: 'Manufatura',
  commerce: 'Comércio',
  infrastructure: 'Infraestrutura',
  defense: 'Defesa',
  civic: 'Cívico',
};

/** Texto do objetivo, do jeito que o jogador lê. */
export function objectiveLabel(o: QuestObjective): string {
  switch (o.kind) {
    case 'haveCredits':
      return `Acumular ${o.amount} coroas`;
    case 'haveItem':
      return `Ter ${o.quantity} ${itemDef(o.item).name}`;
    case 'haveBuilding':
      return o.count === 1
        ? `Construir: ${buildingDef(o.type).name}`
        : `Construir ${o.count} x ${buildingDef(o.type).name}`;
    case 'haveBuildingCategory':
      return `Ter ${o.count} construção(ões) de ${categoryLabels[o.category] ?? o.category} no terreno`;
    case 'employWorkers':
      return `Empregar ${o.count} trabalhador(es) no terreno`;
    case 'surviveUntilDay':
      return `Sobreviver até o dia ${o.day}`;
    case 'visitSettlements':
      return `Visitar ${o.count} cidades diferentes`;
    case 'reachLevel':
      return `Chegar a ${citizenLevelDef(o.level).label}`;
    case 'reachStatus':
      return `Chegar a Status ${o.value}`;
    case 'becomeGovernor':
      return 'Assumir o governo de uma cidade';
    case 'reachPlotDefense':
      return `Levar a defesa do terreno a ${o.value}`;
  }
}

const prende = (valor: number, teto: number): number =>
  Math.min(teto, Math.max(0, valor));

/** Progresso atual e alvo, para a barra. */
export function objectiveProgress(
  o: QuestObjective,
  campaign: Campaign,
): { current: number; target: number } {
  switch (o.kind) {
    case 'haveCredits':
      return { current: prende(campaign.character.credits, o.amount), target: o.amount };

    case 'haveItem':
      return {
        current: prende(campaign.character.inventory.quantityOf(o.item), o.quantity),
        target: o.quantity,
      };

    case 'haveBuilding': {
      const feitas = campaign.plot.operational.filter((b) => b.type === o.type).length;
      return { current: prende(feitas, o.count), target: o.count };
    }

    case 'haveBuildingCategory': {
      const feitas = campaign.plot.operational.filter(
        (b) => b.def.category === o.category,
      ).length;
      return { current: prende(feitas, o.count), target: o.count };
    }

    case 'employWorkers':
      return {
        current: prende(campaign.plot.employedWorkers, o.count),
        target: o.count,
      };

    case 'surviveUntilDay':
      return { current: prende(campaign.day, o.day), target: o.day };

    case 'visitSettlements':
      return {
        current: prende(campaign.visitedSettlements.size, o.count),
        target: o.count,
      };

    case 'reachLevel': {
      const alvo = citizenRank[o.level];
      return {
        current: prende(citizenRank[campaign.character.level], alvo),
        target: alvo,
      };
    }

    case 'reachStatus':
      return {
        current: prende(campaign.character.effectiveStatus, o.value),
        target: o.value,
      };

    case 'becomeGovernor': {
      const governa = [...campaign.governments.values()].some(
        (g) => g.governorId === campaign.character.id,
      );
      return { current: governa ? 1 : 0, target: 1 };
    }

    case 'reachPlotDefense':
      return { current: prende(campaign.plot.defense, o.value), target: o.value };
  }
}

export function objectiveIsMet(o: QuestObjective, campaign: Campaign): boolean {
  const { current, target } = objectiveProgress(o, campaign);
  return current >= target;
}

export function questIsComplete(quest: Quest, campaign: Campaign): boolean {
  return quest.objectives.every((o) => objectiveIsMet(o, campaign));
}

/** Progresso agregado em `[0, 1]`, para a barra da lista. */
export function questCompletion(quest: Quest, campaign: Campaign): number {
  if (quest.objectives.length === 0) return 1;
  let soma = 0;
  for (const o of quest.objectives) {
    const { current, target } = objectiveProgress(o, campaign);
    soma += target === 0 ? 1 : Math.min(1, Math.max(0, current / target));
  }
  return soma / quest.objectives.length;
}

/** `450¢ · 5x Água · +1 Status` */
export function rewardSummary(reward: QuestReward): string {
  const partes: string[] = [];
  if (reward.credits > 0) partes.push(`${reward.credits}¢`);
  for (const [id, qtd] of Object.entries(reward.items)) {
    partes.push(`${qtd}x ${itemDef(id).name}`);
  }
  if (reward.statusBonus > 0) partes.push(`+${reward.statusBonus} Status`);
  return partes.length === 0 ? '—' : partes.join(' · ');
}

export function rewardIsEmpty(reward: QuestReward): boolean {
  return (
    reward.credits === 0 &&
    reward.statusBonus === 0 &&
    Object.keys(reward.items).length === 0
  );
}

/**
 * O registro de quests de uma campanha.
 *
 * ## Concluída é "paga **ou** já cumprida"
 *
 * A segunda metade importa: sem ela, um jogador que cumpriu a condição **antes**
 * de a quest destravar ficaria preso para sempre — a quest anterior nunca
 * apareceria para ser paga, e a corrente inteira travaria atrás dela.
 */
export class QuestLog {
  constructor(private readonly campaign: Campaign) {}

  isComplete(quest: Quest): boolean {
    return (
      this.campaign.completedQuests.has(quest.id) ||
      questIsComplete(quest, this.campaign)
    );
  }

  isUnlocked(quest: Quest): boolean {
    for (const requisito of quest.requires) {
      const anterior = questById(requisito);
      // Requisito que não existe mais (renomeado, removido) é ignorado em vez
      // de travar a corrente: um save antigo não pode virar campanha morta.
      if (!anterior) continue;
      if (!this.isComplete(anterior)) return false;
    }
    return true;
  }

  get active(): readonly Quest[] {
    return allQuests.filter((q) => this.isUnlocked(q) && !this.isComplete(q));
  }

  get completed(): readonly Quest[] {
    return allQuests.filter((q) => this.isComplete(q));
  }

  get locked(): readonly Quest[] {
    return allQuests.filter((q) => !this.isUnlocked(q) && !this.isComplete(q));
  }

  /** A próxima quest a perseguir. */
  get current(): Quest | null {
    return this.active[0] ?? null;
  }

  get overallProgress(): number {
    return allQuests.length === 0 ? 0 : this.completed.length / allQuests.length;
  }

  /**
   * Paga as quests recém-concluídas e devolve quais foram.
   *
   * Idempotente: o id entra em `completedQuests` **antes** de a recompensa ser
   * aplicada, então uma segunda chamada no mesmo estado não paga de novo.
   */
  claimNewlyCompleted(): readonly Quest[] {
    const pagas: Quest[] = [];

    for (const quest of allQuests) {
      if (this.campaign.completedQuests.has(quest.id)) continue;
      if (!this.isUnlocked(quest)) continue;
      if (!questIsComplete(quest, this.campaign)) continue;

      this.campaign.completedQuests.add(quest.id);

      const r = quest.reward;
      this.campaign.character.credits += r.credits;
      this.campaign.character.statusOffset += r.statusBonus;
      for (const [id, qtd] of Object.entries(r.items)) {
        this.campaign.character.inventory.add(id, qtd);
      }
      pagas.push(quest);
    }

    return pagas;
  }
}
