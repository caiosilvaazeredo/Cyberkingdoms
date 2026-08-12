import { DeterministicRandom, mix } from '../core/rng';
import { itemDef } from '../economy/item';
import {
  EDUCACAO,
  RISCO,
  TRABALHO_PUBLICO,
  VITAIS,
  custoDaAcao,
  cz,
  formatCz,
  ganhoDeAula,
} from '../rules/eb';
import { workById } from '../survival/survival';
import type { Campaign } from './campaign';
import { novaAcao, type CompletedAction, type QueuedActionJson } from './actionQueue';

/**
 * O catálogo de ocupações e o que cada uma faz quando termina.
 *
 * ## Por que catálogo e liquidação moram juntos
 *
 * O GDD exige que a confirmação mostre "custo, duração, risco e
 * irreversibilidade" **antes** de o jogador aceitar. Se a tela calcular o custo
 * de um jeito e a liquidação de outro, a promessa da confirmação é falsa — e
 * essa é a pior classe de defeito num jogo econômico, porque o jogador só
 * descobre depois de gastar as duas horas.
 *
 * Aqui, `descreverAcao` e `liquidar` leem a mesma definição. O que a tela
 * promete é literalmente o que a fila cobra.
 *
 * ## Por que o acaso é derivado, e não sorteado na hora
 *
 * O acidente de uma jornada sai de uma semente que combina a seed do mundo, o
 * id da ação e o instante de término. Duas consequências: liquidar a mesma ação
 * duas vezes dá o mesmo resultado — o que sustenta a garantia de liquidação
 * única mesmo se algo for reprocessado —, e ninguém consegue "rolar de novo"
 * fechando a aba antes do fim.
 */

export interface AcaoDisponivel {
  readonly kind: QueuedActionJson['kind'];
  readonly id: string;
  readonly label: string;
  readonly descricao: string;
  readonly horas: number;
  /** O que o cidadão gasta de Fome, Sede e Energia. */
  readonly custo: { fome: number; sede: number; energia: number };
  /** Pagamento líquido esperado, em Cz. Zero quando não paga. */
  readonly paga: number;
  /** Faixa de risco de acidente, de 0 a 1. */
  readonly risco: { min: number; max: number } | null;
  readonly payload?: Record<string, unknown>;
}

/** O que dá para fazer agora, nesta cidade, com este personagem. */
export function acoesDisponiveis(campaign: Campaign): AcaoDisponivel[] {
  const lista: AcaoDisponivel[] = [];
  const cidade = campaign.currentSettlementId;
  const custo2h = custoDaAcao(TRABALHO_PUBLICO.duracaoHoras);

  if (cidade) {
    const governo = campaign.governmentOf(cidade);
    for (const trabalho of ['dump', 'oil', 'rareEarth', 'publicFarming']) {
      const w = workById(trabalho);
      lista.push({
        kind: 'publicWork',
        id: trabalho,
        label: w.label,
        // O bruto sai do salário que o governador definiu, não de uma tabela
        // fixa: é o que amarra carreira e política. O piso do EB continua
        // valendo como referência do que a vaga rende.
        descricao:
          `Jornada de ${TRABALHO_PUBLICO.duracaoHoras} h. Paga ` +
          `${formatCz(liquidoDoTrabalho(governo.publicWage))} e recolhe ` +
          `${formatCz(cofreDoTrabalho(governo.publicWage))} ao cofre da cidade.`,
        horas: TRABALHO_PUBLICO.duracaoHoras,
        custo: custo2h,
        paga: liquidoDoTrabalho(governo.publicWage),
        risco: RISCO.trabalhoBasico,
        payload: { work: trabalho, settlementId: cidade },
      });
    }
  }

  lista.push({
    kind: 'sleep',
    id: 'sleep',
    label: 'Dormir',
    descricao: `${VITAIS.sono.horas} h de sono devolvem ${VITAIS.sono.energia} de Energia.`,
    horas: VITAIS.sono.horas,
    custo: { fome: 0, sede: 0, energia: 0 },
    paga: 0,
    risco: null,
  });

  if (campaign.character.studyingCertificate) {
    lista.push({
      kind: 'study',
      id: 'study',
      label: `Aula: ${campaign.character.studyingCertificate}`,
      descricao:
        `Aula de 2 h. Rende ${ganhoDeAula(campaign.character.attributes.get('intelligence')).toFixed(1)}% ` +
        'de conhecimento — Inteligência acelera o ganho, não substitui a presença.',
      horas: 2,
      custo: custo2h,
      paga: 0,
      risco: null,
    });
  }

  return lista;
}

/** Pagamento líquido de uma jornada, já descontada a contribuição ao cofre. */
export function liquidoDoTrabalho(salarioPublico: number): number {
  return cz(salarioPublico * (1 - TRABALHO_PUBLICO.contribuicaoCofre));
}

/** O que a mesma jornada recolhe para o cofre da capital. */
export function cofreDoTrabalho(salarioPublico: number): number {
  return cz(salarioPublico) - liquidoDoTrabalho(salarioPublico);
}

/** Transforma uma opção do catálogo numa ação enfileirável. */
export function enfileiravel(acao: AcaoDisponivel): QueuedActionJson {
  return novaAcao({
    kind: acao.kind,
    label: acao.label,
    hours: acao.horas,
    payload: { ...acao.payload, opcao: acao.id, paga: acao.paga },
  });
}

export interface ResultadoDaAcao {
  readonly linhas: readonly string[];
  /** `true` quando o cidadão saiu machucado o bastante para precisar parar. */
  readonly critico: boolean;
}

/**
 * Aplica o resultado de uma ação concluída.
 *
 * Só é chamado pela fila, e só para ação que já terminou — por isso não há
 * verificação de tempo aqui: quem decide "terminou" é `ActionQueue.advanceTo`,
 * que é também quem garante que isto rode uma vez só.
 */
export function liquidar(campaign: Campaign, feita: CompletedAction): ResultadoDaAcao {
  const { action, finishedAt } = feita;
  const character = campaign.character;
  const linhas: string[] = [];

  // Semente derivada: mesma ação, mesmo resultado, quantas vezes reprocessar.
  const rng = new DeterministicRandom(
    mix(mix(campaign.seed, Math.floor(finishedAt / 1000)), hashDoId(action.id)),
  );

  const horas = action.durationMs / 3600000;
  const custo = custoDaAcao(horas);

  switch (action.kind) {
    case 'sleep': {
      character.energy = Math.min(
        VITAIS.max,
        character.energy + Math.round((VITAIS.sono.energia * horas) / VITAIS.sono.horas),
      );
      linhas.push(`Dormiu ${horas} h — Energia em ${character.energy}.`);
      break;
    }

    case 'study': {
      const ganho = ganhoDeAula(character.attributes.get('intelligence'), horas);
      const area = String(action.payload?.['area'] ?? 'geral');
      const total = campaign.addKnowledge(area, ganho);
      cobrarVitais(campaign, custo, linhas);
      linhas.push(
        `Aula concluída: +${ganho.toFixed(1)}% em ${area} (agora ${total.toFixed(0)}%).`,
      );
      if (total >= EDUCACAO.certificacao) {
        linhas.push(`Conhecimento suficiente para certificar em ${area}.`);
      }
      break;
    }

    case 'publicWork': {
      const cidade = String(action.payload?.['settlementId'] ?? '');
      const governo = campaign.governmentOf(cidade || campaign.character.homeSettlementId);
      const liquido = liquidoDoTrabalho(governo.publicWage);
      const paraCofre = cofreDoTrabalho(governo.publicWage);

      character.credits = cz(character.credits + liquido);
      governo.collectTax(paraCofre);
      cobrarVitais(campaign, custo, linhas);

      const trabalho = String(action.payload?.['work'] ?? 'dump');
      const rendeu = renderRecurso(trabalho);
      if (rendeu) {
        const quantidade = 1 + rng.range(0, 2);
        character.inventory.add(rendeu, quantidade);
        campaign.pantry.register(rendeu, quantidade, finishedAt);
        linhas.push(
          `Jornada em ${workById(trabalho).label}: ${formatCz(liquido)} e ` +
            `${quantidade}× ${itemDef(rendeu).name}.`,
        );
      } else {
        linhas.push(`Jornada em ${workById(trabalho).label}: ${formatCz(liquido)}.`);
      }

      // Acidente dentro da faixa informada na confirmação. O jogador aceitou
      // este risco vendo este número.
      const chance =
        RISCO.trabalhoBasico.min +
        rng.nextDouble() * (RISCO.trabalhoBasico.max - RISCO.trabalhoBasico.min);
      if (rng.nextDouble() < chance) {
        const dano = VITAIS.acidenteHp.min +
          rng.range(0, VITAIS.acidenteHp.max - VITAIS.acidenteHp.min);
        character.hp = Math.max(0, character.hp - dano);
        linhas.push(`Acidente de trabalho: −${dano} HP.`);
      }
      break;
    }

    case 'travel': {
      const destino = campaign.world.layout.byId(
        String(action.payload?.['settlementId'] ?? ''),
      );
      if (destino) {
        character.position = destino.center;
        character.travellingTo = null;
        character.travelDaysRemaining = 0;
        campaign.visitedSettlements.add(destino.id);
        linhas.push(`Chegou em ${destino.name}.`);
      }
      cobrarVitais(campaign, custo, linhas);
      break;
    }

    case 'contract': {
      // A entrega acontece quando a jornada termina, e não no toque do
      // aceite: o contrato é executado, não comprado. É a fila que diz que as
      // horas passaram, e é por isso que a liquidação mora aqui e não na tela.
      cobrarVitais(campaign, custo, linhas);
      const contrato = campaign.contracts.emExecucao(character.id);
      if (!contrato) {
        linhas.push('A jornada terminou, mas o contrato não estava mais em execução.');
        break;
      }
      const r = campaign.contracts.entregar({
        contract: contrato,
        worker: character,
        now: finishedAt,
      });
      if (!r.ok) {
        linhas.push(`Entrega recusada: ${r.reason}`);
        break;
      }
      linhas.push(
        `Contrato entregue: ${contrato.title} — ${formatCz(r.pago)}` +
          (r.bonus > 0 ? ` (bônus de ${formatCz(r.bonus)})` : '') +
          `. Credibilidade em ${character.credibility}.`,
      );
      break;
    }

    default:
      cobrarVitais(campaign, custo, linhas);
      break;
  }

  for (const linha of linhas) campaign.log(linha);

  // HP zero **não** apaga o cidadão — Rev 4.1, §10. Ele entra em estado
  // crítico, que a interface trata como bloqueio até se recuperar. A morte por
  // abandono da Rev 3.0 punia quem fechou a aba, e tempo real 1:1 torna isso
  // inaceitável: ficar offline é a regra, não a exceção.
  const critico = character.hp <= 0 || character.energy <= 0;
  if (critico) {
    campaign.log('Estado crítico: descanse ou procure atendimento antes de seguir.');
  }
  return { linhas, critico };
}

function cobrarVitais(
  campaign: Campaign,
  custo: { fome: number; sede: number; energia: number },
  linhas: string[],
): void {
  const c = campaign.character;
  c.hunger = Math.max(VITAIS.min, c.hunger - custo.fome);
  c.thirst = Math.max(VITAIS.min, c.thirst - custo.sede);
  c.energy = Math.max(VITAIS.min, c.energy - custo.energia);
  if (c.hunger === 0 || c.thirst === 0) {
    // Sem comida e sem água o corpo cobra em HP, mas nunca em definitivo.
    c.hp = Math.max(0, c.hp - 5);
    linhas.push('Sem comer ou beber: −5 HP.');
  }
}

/** O recurso que cada frente pública entrega. */
function renderRecurso(trabalho: string): string | null {
  switch (trabalho) {
    case 'dump':
      return 'scrap';
    case 'oil':
      return 'oil';
    case 'rareEarth':
      return 'rareEarth';
    case 'publicFarming':
      return 'biomass';
    default:
      return null;
  }
}

function hashDoId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
