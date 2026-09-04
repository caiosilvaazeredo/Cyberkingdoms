import { describe, expect, it } from 'vitest';

import { Sala, type Cliente } from '../src/server/sala';
import type { DoServidor } from '../src/shared/protocolo';
import type { Time } from '../src/shared/regras';

/**
 * "Olha aqui": o clique no minimapa vira uma marca para o time inteiro.
 *
 * Três promessas, e as três fáceis de quebrar sem um teste: a marca não
 * vaza para o time adversário (seria dar de graça a informação que a
 * votação e o recado do time já escondem), um ponto fora do campo não gera
 * marca nenhuma (só dá para acontecer com um cliente adulterado, mas o
 * servidor não confia nele mesmo assim), e um dedo nervoso não consegue
 * encher a tela de marcas — o cooldown por pessoa é o que garante isso.
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

function jogarPor(sala: Sala, nome: string, time: Time) {
  const cliente = clienteFalso(nome);
  sala.entrar(cliente);
  sala.escolher(cliente.chave, time);
  return cliente;
}

const marcasRecebidas = (cliente: Cliente & { recebidas: DoServidor[] }) =>
  cliente.recebidas.filter((m) => m.t === 'marca');

describe('a marca no minimapa', () => {
  it('chega para o próprio time, e não para o adversário', () => {
    const sala = new Sala({ nome: 'm1', seed: 1, porTime: 2, esperaPorJogadores: 0 });
    const ana = jogarPor(sala, 'Ana', 'azul');
    const bruno = jogarPor(sala, 'Bruno', 'azul');
    const carla = jogarPor(sala, 'Carla', 'vermelho');

    expect(sala.marcar(ana.chave, 100, 100)).toBe(true);

    expect(marcasRecebidas(bruno)).toHaveLength(1);
    expect(marcasRecebidas(bruno)[0]).toMatchObject({ x: 100, y: 100, quem: 'Ana' });
    expect(marcasRecebidas(carla)).toHaveLength(0);
  });

  it('não marca um ponto fora do campo', () => {
    const sala = new Sala({ nome: 'm2', seed: 2, porTime: 2, esperaPorJogadores: 0 });
    const ana = jogarPor(sala, 'Ana', 'azul');
    const bruno = jogarPor(sala, 'Bruno', 'azul');

    expect(sala.marcar(ana.chave, -50, 50)).toBe(false);
    expect(sala.marcar(ana.chave, 50, 999_999)).toBe(false);
    expect(marcasRecebidas(bruno)).toHaveLength(0);
  });

  it('recusa quem ainda não escolheu lado', () => {
    const sala = new Sala({ nome: 'm3', seed: 3, porTime: 2, esperaPorJogadores: 0 });
    const espectador = clienteFalso('Espectador');
    sala.entrar(espectador);

    expect(sala.marcar(espectador.chave, 100, 100)).toBe(false);
  });

  it('freia o dedo nervoso: uma marca por meio segundo, por pessoa', () => {
    const sala = new Sala({ nome: 'm4', seed: 4, porTime: 2, esperaPorJogadores: 0 });
    const ana = jogarPor(sala, 'Ana', 'azul');
    const bruno = jogarPor(sala, 'Bruno', 'azul');

    expect(sala.marcar(ana.chave, 100, 100)).toBe(true);
    expect(sala.marcar(ana.chave, 200, 200)).toBe(false);
    expect(marcasRecebidas(bruno)).toHaveLength(1);
  });
});
