import { describe, expect, it } from 'vitest';

import { Sala, type Cliente } from '../src/server/sala';
import type { DoServidor } from '../src/shared/protocolo';
import { TICKS_POR_SEGUNDO } from '../src/shared/regras';

/**
 * O lobby de uma sala montada: travado até todo humano marcar `pronto`.
 *
 * Diferente do resto de `sala.ts` — onde bot e relógio andam desde o primeiro
 * tick —, uma sala nascida com `lobby: true` é a exceção: ela existe
 * exatamente para segurar o jogo até quem está montando terminar de decidir.
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

function rodar(sala: Sala, segundos: number, chaves: string[]): void {
  for (let i = 0; i < segundos * TICKS_POR_SEGUNDO; i++) {
    for (const c of chaves) sala.tocar(c);
    sala.passo();
  }
}

const ultimoLobby = (c: Cliente & { recebidas: DoServidor[] }) =>
  [...c.recebidas].reverse().find((m): m is Extract<DoServidor, { t: 'lobby' }> => m.t === 'lobby');

describe('o lobby de uma sala montada', () => {
  it('não chama bot nem corre o relógio enquanto está aberto', () => {
    const sala = new Sala({
      nome: 'mesa-1',
      seed: 1,
      porTime: 2,
      esperaPorJogadores: 0,
      lobby: true,
    });
    const a = clienteFalso('a');
    sala.entrar(a);
    sala.escolher('a', 'azul');
    rodar(sala, 5, ['a']);
    // Sem o lobby, cinco segundos bastam de sobra para o backfill completar
    // os dois times inteiros (`esperaPorJogadores: 0`).
    expect(sala.estado.unidades.filter((u) => u.bot).length).toBe(0);
    const relogioInicial = sala.estado.relogio;
    rodar(sala, 5, ['a']);
    expect(sala.estado.relogio).toBe(relogioInicial);
  });

  it('abre sozinho quando todo humano conectado marca pronto', () => {
    const sala = new Sala({
      nome: 'mesa-2',
      seed: 1,
      porTime: 2,
      esperaPorJogadores: 0,
      lobby: true,
    });
    const a = clienteFalso('a');
    const b = clienteFalso('b');
    sala.entrar(a);
    sala.entrar(b);
    sala.escolher('a', 'azul');
    sala.escolher('b', 'vermelho');
    rodar(sala, 2, ['a', 'b']);
    expect(sala.estado.unidades.filter((u) => u.bot).length).toBe(0);

    sala.marcarPronto('a', true);
    rodar(sala, 1, ['a', 'b']);
    // Só a confirmou: continua travada.
    expect(sala.estado.unidades.filter((u) => u.bot).length).toBe(0);

    sala.marcarPronto('b', true);
    rodar(sala, 3, ['a', 'b']);
    // Os dois confirmaram: o backfill de bot, que a espera zerada libera na
    // hora, é a prova mais direta de que o jogo destravou.
    expect(sala.estado.unidades.filter((u) => u.bot).length).toBeGreaterThan(0);
  });

  it('espectador não entra na conta de quem precisa confirmar', () => {
    const sala = new Sala({
      nome: 'mesa-3',
      seed: 1,
      porTime: 2,
      esperaPorJogadores: 0,
      lobby: true,
    });
    const a = clienteFalso('a');
    const plateia = clienteFalso('p');
    sala.entrar(a);
    sala.entrar(plateia, true);
    sala.escolher('a', 'azul');
    sala.marcarPronto('a', true);
    rodar(sala, 3, ['a', 'p']);
    expect(sala.estado.unidades.filter((u) => u.bot).length).toBeGreaterThan(0);
  });

  it('o anfitrião é quem entrou primeiro, e só ele pode mudar a configuração', () => {
    const sala = new Sala({ nome: 'mesa-4', seed: 1, porTime: 2, lobby: true });
    const a = clienteFalso('a');
    const b = clienteFalso('b');
    sala.entrar(a);
    sala.entrar(b);
    expect(ultimoLobby(a)?.souAnfitriao).toBe(true);
    expect(ultimoLobby(b)?.souAnfitriao).toBe(false);

    expect(sala.configurarLobby('b', { mapa: 'planicie' })).toBe(false);
    expect(sala.configurarLobby('a', { mapa: 'planicie' })).toBe(true);
    expect(sala.escolhaDeMapa).toBe('planicie');
  });

  it('mudar a configuração desmarca quem já tinha confirmado', () => {
    const sala = new Sala({ nome: 'mesa-5', seed: 1, porTime: 2, lobby: true });
    const a = clienteFalso('a');
    const b = clienteFalso('b');
    sala.entrar(a);
    sala.entrar(b);
    sala.marcarPronto('a', true);
    expect(ultimoLobby(a)?.nomesProntos).toEqual(['a']);
    sala.configurarLobby('a', { mapa: 'vau' });
    expect(ultimoLobby(a)?.nomesProntos).toEqual([]);
  });

  it('quando o anfitrião sai, o próximo da fila assume', () => {
    const sala = new Sala({ nome: 'mesa-6', seed: 1, porTime: 2, lobby: true });
    const a = clienteFalso('a');
    const b = clienteFalso('b');
    sala.entrar(a);
    sala.entrar(b);
    sala.sair('a');
    expect(ultimoLobby(b)?.souAnfitriao).toBe(true);
    expect(sala.configurarLobby('b', { mapa: 'vau' })).toBe(true);
  });

  it('quem escolhe um lado sai da plateia e o total do lobby reflete isso na hora', () => {
    // Quem acaba de conectar entra assistindo — é assim que a cabine e a
    // escolha de lado sempre funcionaram — e só passa a contar para o lobby
    // depois de `escolher`. Sem avisar nesse instante, o painel de "pronto"
    // mostraria "0 de 0" até o próximo evento qualquer atualizar o número.
    const sala = new Sala({ nome: 'mesa-8', seed: 1, porTime: 2, lobby: true });
    const a = clienteFalso('a');
    sala.entrar(a, true);
    expect(ultimoLobby(a)?.total).toBe(0);
    sala.escolher('a', 'azul');
    expect(ultimoLobby(a)?.total).toBe(1);
  });

  it('uma sala sem `lobby: true` nunca trava — o comportamento de sempre', () => {
    const sala = new Sala({ nome: 'mesa-7', seed: 1, porTime: 1, esperaPorJogadores: 0 });
    const a = clienteFalso('a');
    sala.entrar(a);
    sala.escolher('a', 'azul');
    rodar(sala, 3, ['a']);
    expect(sala.estado.unidades.filter((u) => u.bot).length).toBeGreaterThan(0);
  });
});
