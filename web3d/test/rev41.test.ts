import { describe, expect, it } from 'vitest';

import {
  ActionQueue,
  MAX_FILA,
  formatarDuracao,
  novaAcao,
} from '../src/campaign/actionQueue';
import { acoesDisponiveis, enfileiravel, liquidar } from '../src/campaign/actions';
import { Campaign, escolherCidadeInicial } from '../src/campaign/campaign';
import { DeterministicRandom } from '../src/core/rng';
import { Inventory } from '../src/economy/inventory';
import { Despensa, ehPerecivel, validadeHoras } from '../src/economy/perishable';
import {
  EFICIENCIA_MINIMA,
  cabeMaisUma,
  cobrarManutencao,
  custoSemanal,
  eficienciaApos,
} from '../src/economy/upkeepProperty';
import { MAX_TAX_RATE, TERM_LENGTH_IN_DAYS } from '../src/politics/government';
import {
  CESTA,
  EDUCACAO,
  HOUR_MS,
  MERCADO,
  POLITICA,
  PROPRIEDADE,
  TRABALHO_PUBLICO,
  VALIDADE,
  VITAIS,
  WALLET,
  custoDaAcao,
  cz,
  ganhoDeAula,
} from '../src/rules/eb';

/**
 * GDD Rev. 4.1 e EB 1.1.
 *
 * A revisão troca o fundamento do jogo, não os números: sai o reset diário à
 * meia-noite, entra tempo real 1:1 com fila de ocupações. Estes testes prendem
 * as invariantes que a troca traz junto — liquidação única, tempo que corre
 * offline, exclusividade e as faixas do EB.
 */

const campanha = (): Campaign =>
  Campaign.create({
    id: 'rev41',
    seedLabel: 'contrato-dart-ts',
    characterName: 'Cidadão',
    now: 0,
  });

const acao = (horas: number, kind: 'rest' | 'publicWork' = 'rest') =>
  novaAcao({ kind, label: `${horas} h`, hours: horas });

describe('Baseline EB 1.1', () => {
  it('a moeda é inteira e nunca negativa', () => {
    // "Cz é inteiro"; "Saldo negativo: nunca permitido". Sem esta função, um
    // desconto de 0,1 + 0,2 deixaria saldo com resto — e o EB exige que a
    // oferta calculada bata com a razão, sem diferença.
    expect(cz(17.4)).toBe(17);
    expect(cz(17.5)).toBe(18);
    expect(cz(-40)).toBe(0);
  });

  it('a jornada pública paga 18 ao cidadão e 2 ao cofre', () => {
    expect(TRABALHO_PUBLICO.bruto).toBe(20);
    expect(TRABALHO_PUBLICO.liquido).toBe(18);
    expect(TRABALHO_PUBLICO.cofre).toBe(2);
    expect(TRABALHO_PUBLICO.liquido + TRABALHO_PUBLICO.cofre).toBe(
      TRABALHO_PUBLICO.bruto,
    );
  });

  it('a cesta diária custa 30% de uma jornada', () => {
    // Cz 6 sobre Cz 20 é a âncora que liga preço de comida a renda de entrada.
    // Se a cesta passar disso, o trabalho público deixa de sustentar quem
    // começa, e o EB perde a premissa de acesso.
    expect(CESTA.diaria).toBe(6);
    expect(CESTA.agua + CESTA.alimento).toBe(CESTA.diaria);
    expect(CESTA.diaria / TRABALHO_PUBLICO.bruto).toBeCloseTo(0.3, 2);
    expect(CESTA.reservaSegura).toBe(18);
  });

  it('a carteira do tutorial entrega 100 e nada além', () => {
    expect(WALLET.inicial).toBe(30);
    expect(WALLET.total).toBe(100);
  });

  it('o custo de uma ação escala com a duração', () => {
    expect(custoDaAcao(2)).toEqual({ fome: 4, sede: 5, energia: 8 });
    expect(custoDaAcao(4)).toEqual({ fome: 8, sede: 10, energia: 16 });
    expect(custoDaAcao(1)).toEqual({ fome: 2, sede: 3, energia: 4 });
  });

  it('Inteligência acelera a aula sem substituir a presença', () => {
    // 0,75 a 1,25: quem tem o dobro de Inteligência aprende um terço mais
    // rápido, não o dobro. É o que impede o atributo de virar o único caminho.
    expect(ganhoDeAula(0)).toBeCloseTo(1.5, 5);
    expect(ganhoDeAula(50)).toBeCloseTo(2, 5);
    expect(ganhoDeAula(100)).toBeCloseTo(2.5, 5);
    expect(ganhoDeAula(100) / ganhoDeAula(0)).toBeCloseTo(1.25 / 0.75, 5);
    expect(EDUCACAO.certificacao).toBe(100);
  });

  it('os mandatos e o teto de imposto seguem a revisão', () => {
    // A Rev 4.1 revoga explicitamente os 30 dias da anterior, e o EB baixa o
    // teto de imposto de 40% para 5%.
    expect(POLITICA.mandatoGovernador).toBe(60);
    expect(POLITICA.mandatoPresidente).toBe(240);
    expect(POLITICA.mandatoPresidente / POLITICA.mandatoGovernador).toBe(4);
    expect(TERM_LENGTH_IN_DAYS).toBe(POLITICA.mandatoGovernador);
    expect(MAX_TAX_RATE).toBe(MERCADO.taxaMaxima);
  });

  it('a campanha nasce dentro das faixas do EB', () => {
    const c = campanha();
    expect(c.character.credits).toBe(WALLET.inicial);
    for (const [, governo] of c.governments) {
      expect(governo.taxRate).toBeLessThanOrEqual(MERCADO.taxaMaxima);
      expect(governo.publicWage).toBeGreaterThanOrEqual(TRABALHO_PUBLICO.bruto);
    }
  });
});

describe('Propriedade e manutenção', () => {
  it('a manutenção sobe com o nível da instalação', () => {
    // 2%, 3% e 4% por semana: instalação maior custa mais para manter de pé, e
    // é esse custo que impede o patrimônio de só crescer.
    expect(custoSemanal(PROPRIEDADE.fazendaN1, 1)).toBe(1);
    expect(custoSemanal(1000, 1)).toBe(20);
    expect(custoSemanal(1000, 2)).toBe(30);
    expect(custoSemanal(1000, 3)).toBe(40);
    // Nível fora da tabela usa o mais alto em vez de estourar.
    expect(custoSemanal(1000, 9)).toBe(40);
  });

  it('atrasar corta eficiência, mas nunca destrói', () => {
    // "Nunca destrói instantaneamente sem aviso." Num jogo de tempo real, quem
    // passou uma semana fora não pode voltar e achar a oficina demolida.
    expect(eficienciaApos(0)).toBe(1);
    expect(eficienciaApos(1)).toBeCloseTo(0.9, 5);
    expect(eficienciaApos(3)).toBeCloseTo(0.7, 5);
    expect(eficienciaApos(99)).toBe(EFICIENCIA_MINIMA);
  });

  it('saldo curto paga o que dá e o resto vira atraso', () => {
    // Recusar o pagamento parcial deixaria o jogador com dinheiro no bolso e a
    // propriedade em atraso total — o pior dos dois mundos.
    const r = cobrarManutencao({ valor: 1000, nivel: 1, saldo: 12, ciclosAtrasados: 0 });
    expect(r.pago).toBe(12);
    expect(r.devido).toBe(8);
    expect(r.eficiencia).toBeCloseTo(0.9, 5);

    const emDia = cobrarManutencao({ valor: 1000, nivel: 1, saldo: 500, ciclosAtrasados: 3 });
    expect(emDia.pago).toBe(20);
    expect(emDia.devido).toBe(0);
    // Voltar a pagar recupera: o atraso zera, não fica marcado para sempre.
    expect(emDia.eficiencia).toBe(1);
  });

  it('o limite é duas fazendas e uma instalação industrial', () => {
    // Escala vem de contratar gente, não de empilhar instalação: é o que mantém
    // o mercado de trabalho relevante.
    expect(cabeMaisUma('farm', 1)).toBe(true);
    expect(cabeMaisUma('farm', 2)).toBe(false);
    expect(cabeMaisUma('industrial', 0)).toBe(true);
    expect(cabeMaisUma('industrial', 1)).toBe(false);
  });
});

describe('Cidade inicial ponderada', () => {
  it('favorece as capitais menos populosas sem excluir as grandes', () => {
    // Sorteio uniforme mantém a distribuição inicial para sempre: a capital que
    // nasceu grande cresce mais rápido, e o servidor acaba com uma cidade viva
    // e quatro vazias — mercado ilíquido em todas.
    const layout = Campaign.create({
      id: 'peso', seedLabel: 'contrato-dart-ts', characterName: 'X', now: 0,
    }).world.layout;
    const capitais = [...layout.capitals].sort((a, b) => a.population - b.population);

    const contagem = new Map<string, number>();
    for (let i = 0; i < 4000; i++) {
      const escolhida = escolherCidadeInicial(capitais, new DeterministicRandom(i));
      contagem.set(escolhida.id, (contagem.get(escolhida.id) ?? 0) + 1);
    }

    const menor = contagem.get(capitais[0]!.id) ?? 0;
    const maior = contagem.get(capitais[capitais.length - 1]!.id) ?? 0;
    expect(menor).toBeGreaterThan(maior);
    // Mas ninguém fica de fora: "cidade ponderada não reduz acesso".
    for (const c of capitais) expect(contagem.get(c.id) ?? 0).toBeGreaterThan(0);
  });
});

describe('Perecibilidade', () => {
  const agora = 1_000_000;
  const inv = () => new Inventory();

  it('só comida e bebida têm validade', () => {
    // Inventar prazo para sucata e chip criaria contabilidade sem decisão
    // nenhuma associada.
    expect(validadeHoras('streetFood')).toBe(VALIDADE.alimento);
    expect(validadeHoras('water')).toBe(VALIDADE.aguaTratada);
    expect(validadeHoras('scrap')).toBeNull();
    expect(ehPerecivel('chip')).toBe(false);
  });

  it('lotes vencem separados, e não todos juntos', () => {
    // Duas garrafas compradas com um dia de diferença vencem em dias
    // diferentes. Uma validade por tipo obrigaria a escolher entre renovar
    // tudo a cada compra ou vencer estoque bom junto com o velho.
    const d = new Despensa();
    const i = inv();
    i.add('streetFood', 8);
    d.register('streetFood', 5, agora);
    d.register('streetFood', 3, agora + 24 * HOUR_MS);

    const perdido = d.expire(i, agora + (VALIDADE.alimento + 1) * HOUR_MS);
    expect(perdido['streetFood']).toBe(5);
    expect(i.quantityOf('streetFood')).toBe(3);
    expect(d.freshOf('streetFood', agora + 25 * HOUR_MS)).toBe(3);
  });

  it('refrigeração dobra a vida útil', () => {
    const d = new Despensa();
    const i = inv();
    i.add('streetFood', 4);
    d.register('streetFood', 4, agora, true);
    // No prazo normal ainda está bom.
    expect(d.expire(i, agora + (VALIDADE.alimento + 1) * HOUR_MS)).toEqual({});
    expect(i.quantityOf('streetFood')).toBe(4);
    // No dobro, não.
    d.expire(i, agora + (VALIDADE.alimento * 2 + 1) * HOUR_MS);
    expect(i.quantityOf('streetFood')).toBe(0);
  });

  it('consumir tira do lote que vence primeiro', () => {
    const d = new Despensa();
    d.register('water', 2, agora);
    d.register('water', 5, agora + 48 * HOUR_MS);
    d.consume('water', 2, agora);
    expect(d.batches.map((l) => l.quantity)).toEqual([5]);
  });

  it('vencer nunca deixa o inventário negativo', () => {
    // O jogador pode ter vendido o lote sem passar pela despensa; baixar a
    // quantidade cheia deixaria saldo negativo.
    const d = new Despensa();
    const i = inv();
    i.add('streetFood', 1);
    d.register('streetFood', 9, agora);
    const perdido = d.expire(i, agora + 999 * HOUR_MS);
    expect(perdido['streetFood']).toBe(1);
    expect(i.quantityOf('streetFood')).toBe(0);
  });

  it('a despensa sobrevive ao save, e save antigo carrega vazia', () => {
    const c = campanha();
    c.character.inventory.add('water', 3);
    c.pantry.register('water', 3, agora);
    const voltou = Campaign.fromJson(c.toJson());
    expect(voltou.pantry.batches).toHaveLength(1);
    expect(voltou.toJson()).toEqual(c.toJson());
    expect(Despensa.fromJson(undefined).batches).toHaveLength(0);
  });
});

describe('Fila de ações', () => {
  it('a primeira ação começa na hora de entrar', () => {
    const f = new ActionQueue();
    f.enqueue(acao(2), 1000);
    expect(f.progress(1000).current?.startedAt).toBe(1000);
  });

  it('só uma ocupação por vez, e as outras esperam a vez', () => {
    // Exclusividade é o que dá peso à escolha: aceitar duas horas de jornada é
    // abrir mão de outra coisa nessas duas horas.
    const f = new ActionQueue();
    f.enqueue(acao(2), 0);
    f.enqueue(acao(2), 0);
    const p = f.progress(HOUR_MS);
    expect(p.current?.label).toBe('2 h');
    expect(p.pending).toHaveLength(1);
    expect(p.pending[0]!.startedAt).toBeNull();
  });

  it('a fila não passa de dez ocupações', () => {
    const f = new ActionQueue();
    for (let i = 0; i < MAX_FILA; i++) expect(f.enqueue(acao(1), 0)).toBe(true);
    expect(f.isFull).toBe(true);
    expect(f.enqueue(acao(1), 0)).toBe(false);
    expect(f.length).toBe(MAX_FILA);
  });

  it('liquida uma vez só, por mais que se chame', () => {
    // A invariante que o GDD repete em quase todo capítulo. É ela que impede
    // pagar o mesmo salário duas vezes quando a aba é recarregada.
    const f = new ActionQueue();
    f.enqueue(acao(2), 0);
    expect(f.advanceTo(2 * HOUR_MS)).toHaveLength(1);
    expect(f.advanceTo(2 * HOUR_MS)).toHaveLength(0);
    expect(f.advanceTo(9 * HOUR_MS)).toHaveLength(0);
  });

  it('o tempo corre offline: voltar depois liquida tudo que venceu', () => {
    // Guardar "faltam 43 minutos" e descontar por quadro quebra de três formas:
    // aba fechada, aba oculta estrangulada pelo navegador, e relógio do sistema
    // mexido. Instante de início mais duração é imune às três.
    const f = new ActionQueue();
    for (let i = 0; i < 4; i++) f.enqueue(acao(2), 0);

    const feitas = f.advanceTo(8 * HOUR_MS);
    expect(feitas).toHaveLength(4);
    // E cada uma terminou na hora certa, encadeada na anterior.
    expect(feitas.map((f) => f.finishedAt / HOUR_MS)).toEqual([2, 4, 6, 8]);
    expect(f.length).toBe(0);
  });

  it('a ação seguinte começa quando a anterior terminou, não quando o jogador volta', () => {
    // Se a próxima começasse "agora", ficar offline seria perder tempo de
    // mundo — e o GDD diz o contrário: a viagem continua offline.
    const f = new ActionQueue();
    f.enqueue(acao(2), 0);
    f.enqueue(acao(2), 0);
    f.advanceTo(3 * HOUR_MS);
    expect(f.progress(3 * HOUR_MS).current?.startedAt).toBe(2 * HOUR_MS);
    expect(f.progress(3 * HOUR_MS).remainingMs).toBe(HOUR_MS);
  });

  it('não cancela o que já está em execução', () => {
    // Cancelar depois de ver o dado rolando é escolher o resultado.
    const f = new ActionQueue();
    const a = acao(2);
    const b = acao(2);
    f.enqueue(a, 0);
    f.enqueue(b, 0);
    expect(f.cancel(a.id)).toBe(false);
    expect(f.cancel(b.id)).toBe(true);
    expect(f.length).toBe(1);
  });

  it('o progresso vai de 0 a 1 e nunca passa disso', () => {
    const f = new ActionQueue();
    f.enqueue(acao(2), 0);
    expect(f.progress(0).progress).toBe(0);
    expect(f.progress(HOUR_MS).progress).toBeCloseTo(0.5, 5);
    expect(f.progress(99 * HOUR_MS).progress).toBe(1);
    expect(f.progress(99 * HOUR_MS).remainingMs).toBe(0);
  });

  it('sobrevive ao save no meio de uma ação', () => {
    const f = new ActionQueue();
    f.enqueue(acao(2), 0);
    f.enqueue(acao(2), 0);
    f.advanceTo(HOUR_MS);

    const voltou = ActionQueue.fromJson(f.toJson());
    expect(voltou.progress(HOUR_MS).remainingMs).toBe(HOUR_MS);
    // E não paga de novo o que já foi pago antes do save.
    voltou.advanceTo(2 * HOUR_MS);
    expect(voltou.advanceTo(2 * HOUR_MS)).toHaveLength(0);
  });

  it('save sem fila carrega vazio em vez de derrubar a campanha', () => {
    // Todo save anterior à Rev 4.1 não tem a chave.
    expect(ActionQueue.fromJson(undefined).length).toBe(0);
    expect(ActionQueue.fromJson(null).length).toBe(0);
  });

  it('mostra a duração de um jeito que cabe no HUD', () => {
    expect(formatarDuracao(2 * HOUR_MS)).toBe('2 h');
    expect(formatarDuracao(90 * 60000)).toBe('1 h 30');
    expect(formatarDuracao(45 * 60000)).toBe('45 min');
    expect(formatarDuracao(-5)).toBe('0 min');
  });
});

describe('Ocupações e liquidação', () => {
  it('a confirmação promete o que a liquidação cobra', () => {
    // Se a tela calcular o custo de um jeito e a fila de outro, a confirmação
    // mente — e o jogador só descobre depois de gastar as duas horas.
    const c = campanha();
    const opcao = acoesDisponiveis(c).find((a) => a.kind === 'publicWork')!;
    const antes = {
      credits: c.character.credits,
      fome: c.character.hunger,
      sede: c.character.thirst,
      energia: c.character.energy,
    };

    const item = enfileiravel(opcao);
    c.queue.enqueue(item, 0);
    const [feita] = c.queue.advanceTo(2 * HOUR_MS);
    liquidar(c, feita!);

    expect(c.character.credits).toBe(antes.credits + opcao.paga);
    expect(c.character.hunger).toBe(antes.fome - opcao.custo.fome);
    expect(c.character.thirst).toBe(antes.sede - opcao.custo.sede);
    expect(c.character.energy).toBe(antes.energia - opcao.custo.energia);
  });

  it('a jornada recolhe a contribuição ao cofre da cidade', () => {
    const c = campanha();
    const cidade = c.currentSettlementId!;
    const governo = c.governmentOf(cidade);
    const antes = governo.treasury;

    const opcao = acoesDisponiveis(c).find((a) => a.kind === 'publicWork')!;
    c.queue.enqueue(enfileiravel(opcao), 0);
    liquidar(c, c.queue.advanceTo(2 * HOUR_MS)[0]!);

    expect(governo.treasury - antes).toBe(
      Math.round(governo.publicWage * TRABALHO_PUBLICO.contribuicaoCofre),
    );
  });

  it('dormir devolve energia e não cobra nada além do tempo', () => {
    const c = campanha();
    c.character.energy = 20;
    const fome = c.character.hunger;

    const opcao = acoesDisponiveis(c).find((a) => a.kind === 'sleep')!;
    c.queue.enqueue(enfileiravel(opcao), 0);
    liquidar(c, c.queue.advanceTo(VITAIS.sono.horas * HOUR_MS)[0]!);

    expect(c.character.energy).toBe(20 + VITAIS.sono.energia);
    expect(c.character.hunger).toBe(fome);
  });

  it('a energia nunca passa de 100 nem desce de 0', () => {
    const c = campanha();
    c.character.energy = 90;
    const dormir = acoesDisponiveis(c).find((a) => a.kind === 'sleep')!;
    c.queue.enqueue(enfileiravel(dormir), 0);
    liquidar(c, c.queue.advanceTo(VITAIS.sono.horas * HOUR_MS)[0]!);
    expect(c.character.energy).toBe(VITAIS.max);

    c.character.energy = 2;
    const jornada = acoesDisponiveis(c).find((a) => a.kind === 'publicWork')!;
    c.queue.enqueue(enfileiravel(jornada), 0);
    liquidar(c, c.queue.advanceTo(99 * HOUR_MS)[0]!);
    expect(c.character.energy).toBe(VITAIS.min);
  });

  it('HP zero não apaga o cidadão', () => {
    // Rev 4.1, §10: "HP zero não apaga cidadão"; §31: "Offline não produz morte
    // permanente". A morte por abandono da Rev 3.0 punia quem fechou a aba, e
    // com tempo real 1:1 ficar offline é a regra, não a exceção.
    const c = campanha();
    c.character.hp = 1;
    c.character.hunger = 0;
    c.character.thirst = 0;

    const jornada = acoesDisponiveis(c).find((a) => a.kind === 'publicWork')!;
    for (let i = 0; i < 5; i++) {
      c.queue.enqueue(enfileiravel(jornada), i * 2 * HOUR_MS);
      const feitas = c.queue.advanceTo((i + 1) * 2 * HOUR_MS);
      for (const f of feitas) liquidar(c, f);
    }

    expect(c.character.hp).toBe(0);
    expect(c.character.dead).toBe(false);
  });

  it('a mesma ação liquidada de novo dá o mesmo resultado', () => {
    // O acaso é derivado da seed, do id da ação e do instante de término.
    // Ninguém rola de novo fechando a aba antes do fim.
    const a = campanha();
    const b = campanha();
    const opcaoA = acoesDisponiveis(a).find((x) => x.kind === 'publicWork')!;
    const item = enfileiravel(opcaoA);

    a.queue.enqueue({ ...item }, 0);
    b.queue.enqueue({ ...item }, 0);
    liquidar(a, a.queue.advanceTo(2 * HOUR_MS)[0]!);
    liquidar(b, b.queue.advanceTo(2 * HOUR_MS)[0]!);

    expect(b.character.hp).toBe(a.character.hp);
    expect(b.character.credits).toBe(a.character.credits);
    expect(Object.fromEntries(b.character.inventory.stacks)).toEqual(
      Object.fromEntries(a.character.inventory.stacks),
    );
  });

  it('a fila e o conhecimento sobrevivem ao save', () => {
    const c = campanha();
    c.addKnowledge('quimica', 12.5);
    const opcao = acoesDisponiveis(c).find((a) => a.kind === 'sleep')!;
    c.queue.enqueue(enfileiravel(opcao), 0);

    const voltou = Campaign.fromJson(c.toJson());
    expect(voltou.queue.length).toBe(1);
    expect(voltou.knowledgeOf('quimica')).toBeCloseTo(12.5, 5);
    expect(voltou.toJson()).toEqual(c.toJson());
  });

  it('conhecimento não passa de 100 por mais aula que se assista', () => {
    const c = campanha();
    for (let i = 0; i < 200; i++) c.addKnowledge('quimica', 5);
    expect(c.knowledgeOf('quimica')).toBe(EDUCACAO.certificacao);
  });
});
