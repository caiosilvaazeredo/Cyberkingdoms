import {
  buildingDef,
  flatMultiplierFor,
  maxBuildingLevel,
  moduleSlotsFor,
  outputMultiplierFor,
  upgradeCreditCost,
  upgradeDays,
  upkeepMultiplierFor,
  type BuildingDef,
} from './buildingType';
import { itemDef } from '../economy/item';
import { citizenLevelDef } from '../character/attributes';

/**
 * O que uma construção faz, em texto.
 *
 * O catálogo mostrava nome, tamanho, preço e prazo. Isso responde "quanto
 * custa" e não responde "para quê" — e num jogo com 41 construções, escolher
 * sem saber o que a peça faz é escolher pelo preço. As informações já estavam
 * todas em `buildings.json`; o que faltava era mostrá-las.
 */

export interface BuildingFacts {
  readonly def: BuildingDef;
  /** Uma linha: o que a construção é. */
  readonly summary: string;
  /** Linhas de "o que ela faz": produção, emprego, defesa, armazenamento. */
  readonly effects: readonly string[];
  /** Linhas de "o que ela custa": crédito, material, prazo, manutenção. */
  readonly costs: readonly string[];
  /** Como ela evolui de nível a nível. */
  readonly progression: readonly string[];
  /** Exigências para poder construir. */
  readonly requirements: readonly string[];
}

const CATEGORIA: Record<string, string> = {
  housing: 'Moradia',
  extraction: 'Extração',
  refining: 'Refino',
  manufacturing: 'Manufatura',
  commerce: 'Comércio',
  infrastructure: 'Infraestrutura',
  defense: 'Defesa',
  civic: 'Cívico',
};

export function categoryLabel(id: string): string {
  return CATEGORIA[id] ?? id;
}

const quantidades = (mapa: Readonly<Record<string, number>>): string =>
  Object.entries(mapa)
    .map(([id, qtd]) => `${qtd}x ${itemDef(id).name}`)
    .join(', ');

export function describeBuilding(type: string): BuildingFacts {
  const def = buildingDef(type);

  const effects: string[] = [];
  if (def.produces && def.outputPerDay > 0) {
    effects.push(`Produz ${def.outputPerDay}x ${itemDef(def.produces).name} por dia.`);
  }
  if (def.consumes && Object.keys(def.consumes).length > 0) {
    effects.push(`Consome por dia: ${quantidades(def.consumes)}.`);
  }
  if (def.jobSlots > 0) effects.push(`Emprega ${def.jobSlots} trabalhador(es).`);
  if (def.populationCapacity > 0) {
    effects.push(`Abriga ${def.populationCapacity} morador(es).`);
  }
  if (def.storageBonus > 0) effects.push(`+${def.storageBonus} de armazenamento.`);
  if (def.defenseBonus > 0) effects.push(`+${def.defenseBonus} de defesa.`);
  if (def.statusBonus > 0) effects.push(`+${def.statusBonus} de Status.`);
  if (def.unlocksStation) effects.push(`Destrava a estação: ${def.unlocksStation}.`);
  if (def.hungerUpkeepModifier < 0 || def.thirstUpkeepModifier < 0) {
    const partes: string[] = [];
    if (def.hungerUpkeepModifier < 0) {
      partes.push(`${Math.round(def.hungerUpkeepModifier * 100)}% de fome`);
    }
    if (def.thirstUpkeepModifier < 0) {
      partes.push(`${Math.round(def.thirstUpkeepModifier * 100)}% de sede`);
    }
    // Só vale estando no terreno — o tick confere isso, e omitir aqui faria a
    // construção parecer um bônus que o jogador carrega pelo mapa.
    effects.push(`Enquanto você estiver no terreno: ${partes.join(' e ')}.`);
  }
  if (effects.length === 0) effects.push('Sem efeito direto — vale pela silhueta e pelo espaço.');

  const costs: string[] = [
    `${def.creditCost.toLocaleString('pt-BR')} créditos.`,
    `${def.buildDays} dia(s) de obra.`,
  ];
  if (Object.keys(def.materialCost).length > 0) {
    costs.push(`Materiais: ${quantidades(def.materialCost)}.`);
  }
  if (def.dailyUpkeep > 0) {
    costs.push(`Manutenção: ${def.dailyUpkeep} créditos por dia.`);
  }
  costs.push(`Ocupa ${def.width}x${def.height} células do terreno.`);

  const requirements: string[] = [
    `Exige ${citizenLevelDef(def.requiredLevel).label}.`,
  ];
  if (!def.legal) {
    requirements.push('Ilegal: dá base para confisco pelo governo da cidade.');
  }

  const progression: string[] = [];
  for (let nivel = 1; nivel < maxBuildingLevel; nivel++) {
    const proximo = nivel + 1;
    progression.push(
      `Nível ${nivel} → ${proximo}: ` +
        `${upgradeCreditCost(def, nivel).toLocaleString('pt-BR')} créditos, ` +
        `${upgradeDays(def, nivel)} dia(s). ` +
        `Produção ×${outputMultiplierFor(proximo).toFixed(2)}, ` +
        `manutenção ×${upkeepMultiplierFor(proximo).toFixed(2)}, ` +
        `bônus ×${flatMultiplierFor(proximo).toFixed(2)}, ` +
        `${moduleSlotsFor(proximo)} encaixe(s) de módulo.`,
    );
  }

  return {
    def,
    summary: `${categoryLabel(def.category)} · ${def.description}`,
    effects,
    costs,
    progression,
    requirements,
  };
}

/** Uma linha curta para a lista do catálogo. */
export function shortFacts(type: string): string {
  const def = buildingDef(type);
  const partes = [`${def.width}x${def.height}`, `${def.creditCost} cr`, `${def.buildDays}d`];
  if (def.produces && def.outputPerDay > 0) {
    partes.push(`${def.outputPerDay}x ${itemDef(def.produces).name}/dia`);
  } else if (def.jobSlots > 0) {
    partes.push(`${def.jobSlots} vaga(s)`);
  } else if (def.defenseBonus > 0) {
    partes.push(`+${def.defenseBonus} defesa`);
  }
  return partes.join(' · ');
}
