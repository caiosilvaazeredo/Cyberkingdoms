import { describe, expect, it } from 'vitest';

import { aplicarGatilhos, type Gatilho } from '../src/shared/gatilhos';
import { criarPartida } from '../src/shared/partida';
import { DT } from '../src/shared/regras';

/**
 * A fase 5 da engine: o vocabulário mínimo de gatilhos.
 *
 * Testado isolado de `modoDe` de propósito — os treze modos do jogo não
 * declaram gatilho nenhum, e a garantia que importa aqui é só "o intérprete
 * faz o que o dado pede", não "existe um modo de verdade que usa isto".
 */

describe('os gatilhos de modo', () => {
  it('o temporizador dispara exatamente a cada N segundos, e não a cada tick', () => {
    const { estado } = criarPartida(1);
    const gatilhos: Gatilho[] = [
      { quando: { tipo: 'temporizador', intervaloSegundos: 2 }, entao: [{ tipo: 'mensagem', texto: 'oi' }] },
    ];
    const ticksPorDisparo = Math.round(2 / DT);

    let disparos = 0;
    for (let i = 0; i <= ticksPorDisparo * 3; i++) {
      estado.tick = i;
      const antes = estado.eventos.length;
      aplicarGatilhos(gatilhos, estado);
      if (estado.eventos.length > antes) disparos++;
    }
    expect(disparos).toBe(3);
  });

  it('a mensagem vira um evento "gatilho" com o texto exato do dado', () => {
    const { estado } = criarPartida(1);
    estado.tick = Math.round(5 / DT);
    aplicarGatilhos(
      [{ quando: { tipo: 'temporizador', intervaloSegundos: 5 }, entao: [{ tipo: 'mensagem', texto: 'o campo treme' }] }],
      estado,
    );
    expect(estado.eventos).toContainEqual({ tipo: 'gatilho', texto: 'o campo treme' });
  });

  it('sem gatilho nenhum (undefined), não faz nada — o caso de todo modo hoje', () => {
    const { estado } = criarPartida(1);
    estado.tick = 1000;
    aplicarGatilhos(undefined, estado);
    expect(estado.eventos).toEqual([]);
  });

  it('um gatilho pode disparar mais de uma ação', () => {
    const { estado } = criarPartida(1);
    estado.tick = Math.round(1 / DT);
    aplicarGatilhos(
      [
        {
          quando: { tipo: 'temporizador', intervaloSegundos: 1 },
          entao: [
            { tipo: 'mensagem', texto: 'primeira' },
            { tipo: 'mensagem', texto: 'segunda' },
          ],
        },
      ],
      estado,
    );
    expect(estado.eventos.map((e) => (e.tipo === 'gatilho' ? e.texto : null))).toEqual([
      'primeira',
      'segunda',
    ]);
  });
});
