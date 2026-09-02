import { describe, expect, it } from 'vitest';

import { Lobby } from '../src/server/lobby';
import { Sala, type Cliente } from '../src/server/sala';
import {
  MAX_BOTS,
  MAX_POR_TIME,
  MAX_POR_TIME_TOTAL,
  salaConfiguravel,
  type DoServidor,
} from '../src/shared/protocolo';
import { POR_TIME, TICKS_POR_SEGUNDO, TIMES } from '../src/shared/regras';

/**
 * As salas que alguém monta.
 *
 * A promessa desta tela é curta e fácil de quebrar: **o que o anfitrião pediu é
 * o que a partida tem**. Três contra três com dois npcs de cada lado é isso, e
 * continua sendo isso quando o terceiro amigo chegar — e não vira outra coisa
 * porque a política de backfill do lobby, que existe para outro propósito,
 * resolveu ajudar.
 *
 * É por isso que quase todo teste aqui roda a sala por alguns segundos antes de
 * contar: o backfill mora no tick, e um número certo no instante zero não prova
 * nada sobre o número no segundo cinco.
 */

function clienteFalso(nome: string): Cliente & { recebidas: DoServidor[] } {
  const recebidas: DoServidor[] = [];
  return {
    chave: nome,
    nome,
    unidade: null,
    time: null,
    assistindo: false,
    silencio: 0,
    recebidas,
    enviar(msg) {
      recebidas.push(msg);
    },
    fechar() {},
  };
}

/** Roda a sala mantendo os clientes vivos, como um cliente de verdade faz. */
function rodar(sala: Sala, segundos: number, chaves: string[]): void {
  for (let i = 0; i < segundos * TICKS_POR_SEGUNDO; i++) {
    for (const c of chaves) sala.tocar(c);
    sala.passo();
  }
}

const bots = (sala: Sala, time: 'azul' | 'vermelho'): number =>
  sala.estado.unidades.filter((u) => u.time === time && u.bot).length;
const gente = (sala: Sala, time: 'azul' | 'vermelho'): number =>
  sala.estado.unidades.filter((u) => u.time === time && !u.bot).length;

describe('o saneamento da configuração', () => {
  it('não confia em número nenhum que veio de fora', () => {
    // Tudo isto chega pela rede. Um `porTime` de `1e9` não pode virar um laço
    // de mil milhões de bots; um negativo não pode virar uma sala sem vaga.
    const absurdo = salaConfiguravel({ porTime: 1e9, bots: -40, modo: 'batalha-naval' });
    expect(absurdo.porTime).toBe(MAX_POR_TIME);
    expect(absurdo.bots).toBeGreaterThanOrEqual(0);
    expect(absurdo.modo).toBe('resgate');

    expect(salaConfiguravel({ porTime: 0 }).porTime).toBe(1);
    expect(salaConfiguravel({ porTime: 2.9 }).porTime).toBe(2);
    expect(salaConfiguravel(null).porTime).toBe(POR_TIME);
    expect(salaConfiguravel(undefined).bots).toBe(0);
    expect(salaConfiguravel({ bots: 'muitos' }).bots).toBe(0);
  });

  it('respeita o teto de unidades por time cortando os npcs, nunca as pessoas', () => {
    // Quem pediu seis amigos e seis bots quis, acima de tudo, jogar com os seis
    // amigos. Cortar as vagas de gente seria desmarcar o convite.
    const c = salaConfiguravel({ porTime: MAX_POR_TIME, bots: MAX_BOTS });
    expect(c.porTime).toBe(MAX_POR_TIME);
    expect(c.porTime + c.bots).toBeLessThanOrEqual(MAX_POR_TIME_TOTAL);
    expect(c.bots).toBe(MAX_POR_TIME_TOTAL - MAX_POR_TIME);
  });
});

describe('uma sala montada', () => {
  it('põe exatamente os npcs que o anfitrião pediu, em cada time', () => {
    const sala = new Sala({ nome: 'mesa', seed: 7, porTime: 3, botsPorTime: 2 });
    const ana = clienteFalso('Ana');
    sala.entrar(ana);
    sala.escolher('Ana', 'azul');
    rodar(sala, 3, ['Ana']);

    for (const time of TIMES) expect(bots(sala, time)).toBe(2);
    expect(gente(sala, 'azul')).toBe(1);
    // E a vaga de gente que sobrou continua **aberta**: ninguém a preencheu.
    expect(gente(sala, 'vermelho')).toBe(0);
  });

  it('não enche o time de bot quando falta gente', () => {
    // É a diferença que faz o campo existir. Na sala do lobby, três vagas
    // vazias viram três bots; aqui elas esperam.
    const sala = new Sala({ nome: 'mesa', seed: 8, porTime: 4, botsPorTime: 1 });
    const ana = clienteFalso('Ana');
    sala.entrar(ana);
    sala.escolher('Ana', 'azul');
    rodar(sala, 20, ['Ana']);
    expect(bots(sala, 'azul')).toBe(1);
    expect(sala.estado.unidades.filter((u) => u.time === 'azul').length).toBe(2);
  });

  it('o amigo que chega soma, e não expulsa o npc', () => {
    const sala = new Sala({ nome: 'mesa', seed: 9, porTime: 3, botsPorTime: 2 });
    const ana = clienteFalso('Ana');
    sala.entrar(ana);
    sala.escolher('Ana', 'azul');
    rodar(sala, 2, ['Ana']);
    const antes = bots(sala, 'azul');

    const bia = clienteFalso('Bia');
    sala.entrar(bia);
    sala.escolher('Bia', 'azul');
    rodar(sala, 2, ['Ana', 'Bia']);

    expect(gente(sala, 'azul')).toBe(2);
    expect(bots(sala, 'azul')).toBe(antes);
  });

  it('com zero npcs, é partida só de gente — e o campo não se enche sozinho', () => {
    const sala = new Sala({ nome: 'mesa', seed: 10, porTime: 2, botsPorTime: 0 });
    const ana = clienteFalso('Ana');
    sala.entrar(ana);
    sala.escolher('Ana', 'azul');
    rodar(sala, 25, ['Ana']);
    expect(sala.estado.unidades.filter((u) => u.bot)).toHaveLength(0);
  });

  it('recusa a terceira pessoa num time de duas vagas', () => {
    const sala = new Sala({ nome: 'mesa', seed: 11, porTime: 2, botsPorTime: 1 });
    const nomes = ['Ana', 'Bia', 'Cau'];
    const clientes = nomes.map(clienteFalso);
    for (const c of clientes) sala.entrar(c);
    for (const c of clientes) sala.escolher(c.chave, 'azul');
    expect(gente(sala, 'azul')).toBe(2);
    expect(clientes[2]!.recebidas.some((m) => m.t === 'recusado')).toBe(true);
  });

  it('conta o modo e os npcs no cartão de boas-vindas', () => {
    // O cliente prevê o movimento com o modo, e precisa dele antes do primeiro
    // retrato.
    const sala = new Sala({ nome: 'mesa', seed: 12, porTime: 2, botsPorTime: 3, modo: 'cofrecheio' });
    const ana = clienteFalso('Ana');
    sala.entrar(ana);
    const bemvindo = ana.recebidas.find((m) => m.t === 'bemvindo');
    expect(bemvindo).toMatchObject({ modo: 'cofrecheio', porTime: 2, botsPorTime: 3 });
  });

  it('a partida seguinte mantém o modo da sala', () => {
    // A sala não morre no fim do jogo: monta a próxima. Se o modo se perdesse
    // aí, uma sala de Assalto viraria Resgate no segundo jogo e ninguém
    // entenderia por quê.
    const sala = new Sala({ nome: 'mesa', seed: 13, porTime: 1, botsPorTime: 1, modo: 'assalto' });
    const ana = clienteFalso('Ana');
    sala.entrar(ana);
    sala.escolher('Ana', 'azul');
    expect(sala.estado.modo).toBe('assalto');

    sala.estado.fase = 'fim';
    sala.estado.faseEm = 0;
    rodar(sala, 10, ['Ana']);
    expect(sala.estado.fase).not.toBe('fim');
    expect(sala.estado.modo).toBe('assalto');
  });
});

describe('o lobby e as salas montadas', () => {
  it('abre uma sala nova em vez de mandar o anfitrião para a mais cheia', () => {
    const lobby = new Lobby({ seed: () => 5 });
    // Alguém já está numa sala pública, que é para onde o lobby normalmente
    // manda todo mundo.
    lobby.acolher(clienteFalso('Velho'), {});

    const anfitriao = clienteFalso('Anfitriã');
    const sala = lobby.acolher(anfitriao, {
      criar: salaConfiguravel({ modo: 'assalto', porTime: 2, bots: 1 }),
    });
    expect(sala).not.toBeNull();
    expect(sala!.modo).toBe('assalto');
    expect(sala!.porTime).toBe(2);
    expect(sala!.botsFixos).toBe(1);
    expect(lobby.quantidade).toBe(2);
  });

  it('a sala montada aparece na lista com o formato dela, e a privada não', () => {
    const lobby = new Lobby({ seed: () => 5 });
    lobby.acolher(clienteFalso('A'), {
      criar: salaConfiguravel({ modo: 'cofrecheio', porTime: 3, bots: 2 }),
    });
    lobby.acolher(clienteFalso('B'), {
      criar: salaConfiguravel({ modo: 'resgate', porTime: 2, bots: 0, privada: true }),
    });

    const lista = lobby.lista;
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ modo: 'cofrecheio', porTime: 3, bots: 2 });
  });

  it('quem pede a sala pelo nome cai nela, com as regras dela', () => {
    // É o caminho do amigo que recebeu o convite — e do resto do sofá.
    const lobby = new Lobby({ seed: () => 5 });
    const anfitriao = clienteFalso('Anfitriã');
    const criada = lobby.acolher(anfitriao, {
      criar: salaConfiguravel({ modo: 'chapelaria', porTime: 3, bots: 1 }),
    })!;

    const convidado = clienteFalso('Convidado');
    const mesma = lobby.acolher(convidado, { sala: criada.nome });
    expect(mesma).toBe(criada);
    expect(mesma!.estado.modo).toBe('chapelaria');
  });
});
