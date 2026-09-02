import { describe, expect, it } from 'vitest';

import { PRAZO_DA_VOTACAO, apurar, classePedivel, type Votacao } from '../src/server/comando';
import { Sala, type Cliente } from '../src/server/sala';
import type { DoServidor, FichaDeJogador, VotacaoAberta } from '../src/shared/protocolo';
import { TICKS_POR_SEGUNDO } from '../src/shared/regras';

/**
 * Quem manda no time, e como o time manda nos npcs.
 *
 * A promessa é curta: **o que o time decidiu é o que acontece**. Ela quebra de
 * três jeitos, e os três são silenciosos — o líder some e ninguém herda o
 * comando; a votação fica aberta para sempre e o npc segue de aldeão; a ordem é
 * dada e o bot troca de chapéu sozinho no minuto seguinte. Cada teste aqui é um
 * desses três.
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

/** Uma sala com npcs fixos, para haver em quem mandar. */
function comNpcs(bots = 2) {
  const sala = new Sala({
    nome: 'mesa',
    seed: 7,
    porTime: 4,
    botsPorTime: bots,
    esperaPorJogadores: 0,
  });
  return sala;
}

function rodar(sala: Sala, segundos: number, chaves: string[]): void {
  for (let i = 0; i < segundos * TICKS_POR_SEGUNDO; i++) {
    for (const c of chaves) sala.tocar(c);
    sala.passo();
  }
}

const ultimaVotacao = (c: { recebidas: DoServidor[] }): VotacaoAberta | null | undefined => {
  const msgs = c.recebidas.filter((m) => m.t === 'votacao');
  const ultima = msgs[msgs.length - 1];
  return ultima?.t === 'votacao' ? ultima.v : undefined;
};

const fichaDe = (c: { recebidas: DoServidor[] }, id: number): FichaDeJogador | undefined => {
  const msgs = c.recebidas.filter((m) => m.t === 'elenco');
  const ultima = msgs[msgs.length - 1];
  return ultima?.t === 'elenco' ? ultima.jogadores.find((f) => f.id === id) : undefined;
};

describe('a apuração', () => {
  const base = (votos: [string, Parameters<typeof apurar>[0]['proposta']][]): Votacao => ({
    alvo: 1,
    proposta: 'guerreiro',
    time: 'azul',
    restante: 0,
    votos: new Map(votos),
  });

  it('vence quem teve mais votos', () => {
    const r = apurar(base([['a', 'arqueiro'], ['b', 'arqueiro'], ['c', 'clerigo']]));
    expect(r.classe).toBe('arqueiro');
    expect(r.votos).toBe(2);
    expect(r.total).toBe(3);
  });

  it('empate fica com a proposta de quem abriu', () => {
    // Quem levantou o assunto desempata. Um sorteio faria a mesma votação dar
    // resultados diferentes, e a primeira reclamação seria de que o jogo roubou.
    const r = apurar(base([['a', 'arqueiro'], ['b', 'guerreiro']]));
    expect(r.classe).toBe('guerreiro');
  });

  it('ninguém votando devolve a proposta', () => {
    expect(apurar(base([])).classe).toBe('guerreiro');
  });

  it('só aceita classe que tem chapéu', () => {
    // A classe chega pela rede. "aldeão" não é pedível porque é a ausência de
    // chapéu, e o resto nem existe.
    expect(classePedivel('arqueiro')).toBe('arqueiro');
    expect(classePedivel('aldeao')).toBeNull();
    expect(classePedivel('rei')).toBeNull();
    expect(classePedivel(42)).toBeNull();
    expect(classePedivel(null)).toBeNull();
  });
});

describe('a liderança', () => {
  it('é de quem escolheu o lado primeiro', () => {
    const sala = comNpcs();
    const ana = clienteFalso('Ana');
    const bia = clienteFalso('Bia');
    sala.entrar(ana);
    sala.entrar(bia);
    sala.escolher('Ana', 'azul');
    sala.escolher('Bia', 'azul');
    expect(sala.lider('azul')).toBe('Ana');
  });

  it('passa para o próximo quando o líder sai', () => {
    // Sem isto, o time perde o comando junto com a pessoa e ninguém mais
    // consegue mandar num npc pelo resto da partida.
    const sala = comNpcs();
    for (const nome of ['Ana', 'Bia', 'Cau']) {
      const c = clienteFalso(nome);
      sala.entrar(c);
      sala.escolher(nome, 'azul');
    }
    expect(sala.lider('azul')).toBe('Ana');
    sala.sair('Ana');
    expect(sala.lider('azul')).toBe('Bia');
  });

  it('cada time tem o seu', () => {
    const sala = comNpcs();
    for (const [nome, time] of [
      ['Ana', 'azul'],
      ['Bia', 'vermelho'],
    ] as const) {
      sala.entrar(clienteFalso(nome));
      sala.escolher(nome, time);
    }
    expect(sala.lider('azul')).toBe('Ana');
    expect(sala.lider('vermelho')).toBe('Bia');
  });

  it('um time sem gente não tem líder', () => {
    expect(comNpcs().lider('azul')).toBeNull();
  });

  it('a coroa viaja no elenco', () => {
    const sala = comNpcs();
    const ana = clienteFalso('Ana');
    sala.entrar(ana);
    sala.escolher('Ana', 'azul');
    rodar(sala, 1, ['Ana']);
    expect(fichaDe(ana, ana.unidade!)?.lider).toBe(true);
  });
});

describe('a ordem do líder', () => {
  it('só o líder manda', () => {
    const sala = comNpcs();
    for (const nome of ['Ana', 'Bia']) {
      sala.entrar(clienteFalso(nome));
      sala.escolher(nome, 'azul');
    }
    rodar(sala, 1, ['Ana', 'Bia']);
    const npc = sala.estado.unidades.find((u) => u.bot && u.time === 'azul')!;
    expect(sala.mandar('Bia', npc.id, 'arqueiro', false)).toBe(false);
    expect(sala.mandar('Ana', npc.id, 'arqueiro', false)).toBe(true);
  });

  it('não se manda em gente, nem em npc do inimigo', () => {
    const sala = comNpcs();
    const ana = clienteFalso('Ana');
    const bia = clienteFalso('Bia');
    sala.entrar(ana);
    sala.entrar(bia);
    sala.escolher('Ana', 'azul');
    sala.escolher('Bia', 'vermelho');
    rodar(sala, 1, ['Ana', 'Bia']);

    expect(sala.mandar('Ana', bia.unidade!, 'arqueiro', false)).toBe(false);
    const inimigo = sala.estado.unidades.find((u) => u.bot && u.time === 'vermelho')!;
    expect(sala.mandar('Ana', inimigo.id, 'arqueiro', false)).toBe(false);
  });

  it('o npc obedece: vai à chapelaria e veste', () => {
    // O teste que importa. Os outros conferem permissão; este confere que a
    // ordem **acontece** — sem ele, o líder mandaria e o painel diria que sim
    // enquanto o boneco continuava de aldeão.
    const sala = comNpcs(1);
    const ana = clienteFalso('Ana');
    sala.entrar(ana);
    sala.escolher('Ana', 'azul');
    rodar(sala, 2, ['Ana']);

    const npc = sala.estado.unidades.find((u) => u.bot && u.time === 'azul')!;
    expect(sala.mandar('Ana', npc.id, 'clerigo', false)).toBe(true);
    rodar(sala, 60, ['Ana']);
    expect(sala.estado.unidades.find((u) => u.id === npc.id)?.classe).toBe('clerigo');
  });

  it('a ordem sobrevive à revisão de ofício do próprio bot', () => {
    // O bot revê a classe dele a cada doze segundos conforme a falta do time.
    // Sem fixar a ordem, o líder veria o arqueiro dele virar minerador sozinho.
    const sala = comNpcs(1);
    const ana = clienteFalso('Ana');
    sala.entrar(ana);
    sala.escolher('Ana', 'azul');
    rodar(sala, 2, ['Ana']);
    const npc = sala.estado.unidades.find((u) => u.bot && u.time === 'azul')!;
    sala.mandar('Ana', npc.id, 'arqueiro', false);
    rodar(sala, 90, ['Ana']);
    expect(sala.estado.unidades.find((u) => u.id === npc.id)?.classe).toBe('arqueiro');
  });
});

describe('a votação', () => {
  /** Uma sala com três humanos no azul e um npc. */
  function comTres() {
    const sala = comNpcs(1);
    const clientes = ['Ana', 'Bia', 'Cau'].map(clienteFalso);
    for (const c of clientes) {
      sala.entrar(c);
      sala.escolher(c.chave, 'azul');
    }
    rodar(sala, 2, ['Ana', 'Bia', 'Cau']);
    const npc = sala.estado.unidades.find((u) => u.bot && u.time === 'azul')!;
    return { sala, clientes, npc };
  }

  it('chega a quem é do time, e não ao inimigo', () => {
    const { sala, clientes, npc } = comTres();
    const inimiga = clienteFalso('Zoe');
    sala.entrar(inimiga);
    sala.escolher('Zoe', 'vermelho');

    sala.mandar('Ana', npc.id, 'arqueiro', true);
    expect(ultimaVotacao(clientes[1]!)?.alvo).toBe(npc.id);
    // Saber que o inimigo está decidindo pôr um clérigo seria informação de
    // graça.
    expect(ultimaVotacao(inimiga)).toBeUndefined();
  });

  it('o voto de cada um conta uma vez, e o último vale', () => {
    const { sala, clientes, npc } = comTres();
    sala.mandar('Ana', npc.id, 'guerreiro', true);
    sala.votar('Bia', 'arqueiro');
    sala.votar('Bia', 'clerigo');
    sala.votar('Cau', 'clerigo');

    const v = ultimaVotacao(clientes[0]!)!;
    const total = v.votos.reduce((s, n) => s + n, 0);
    expect(total).toBe(3);
    expect(v.meuVoto).toBe('guerreiro');
  });

  it('acaba no prazo e o npc obedece à maioria', () => {
    const { sala, clientes, npc } = comTres();
    sala.mandar('Ana', npc.id, 'guerreiro', true);
    sala.votar('Bia', 'clerigo');
    sala.votar('Cau', 'clerigo');

    rodar(sala, PRAZO_DA_VOTACAO + 2, ['Ana', 'Bia', 'Cau']);
    expect(ultimaVotacao(clientes[0]!)).toBeNull();
    rodar(sala, 60, ['Ana', 'Bia', 'Cau']);
    expect(sala.estado.unidades.find((u) => u.id === npc.id)?.classe).toBe('clerigo');
  });

  it('com um humano só, votar é o mesmo que mandar', () => {
    // Abrir urna para uma pessoa é fazê-la esperar vinte segundos pelo voto que
    // ela já deu ao propor.
    const sala = comNpcs(1);
    const ana = clienteFalso('Ana');
    sala.entrar(ana);
    sala.escolher('Ana', 'azul');
    rodar(sala, 2, ['Ana']);
    const npc = sala.estado.unidades.find((u) => u.bot && u.time === 'azul')!;

    sala.mandar('Ana', npc.id, 'lanceiro', true);
    expect(ultimaVotacao(ana)).toBeUndefined();
    rodar(sala, 60, ['Ana']);
    expect(sala.estado.unidades.find((u) => u.id === npc.id)?.classe).toBe('lanceiro');
  });
});
