import { describe, expect, it } from 'vitest';

import { PERFIS_DE_FERA } from '../src/shared/classes';
import { criarPartida, type Partida } from '../src/shared/partida';
import { AQUECIMENTO, FERA_DURACAO, TICKS_POR_SEGUNDO, TOTEM_INTERVALO } from '../src/shared/regras';

/**
 * O Modo Fera: um totem raro, e quem chegar perto primeiro vira Troll ou
 * Minotauro por um tempo — sem trocar de classe por baixo.
 */

function passarSegundos(partida: Partida, segundos: number): void {
  for (let i = 0; i < segundos * TICKS_POR_SEGUNDO; i++) partida.passo();
}

/** Segundos até o totem nascer, contados do começo da partida. */
const ATE_O_TOTEM = AQUECIMENTO + TOTEM_INTERVALO / 3;

describe('o Modo Fera', () => {
  it('o totem nasce, e quem chega perto vira fera sem trocar de classe', () => {
    const partida = criarPartida(3);
    const u = partida.entrar({ nome: 'Peão', bot: false, time: 'azul' });
    passarSegundos(partida, ATE_O_TOTEM + 0.5);
    expect(partida.estado.totem).not.toBeNull();

    const totem = partida.estado.totem!;
    u.x = totem.x;
    u.y = totem.y;
    passarSegundos(partida, 1);

    expect(u.fera).not.toBeNull();
    expect(u.classe).toBe('aldeao');
    expect(partida.estado.totem).toBeNull();
    expect(u.vida).toBe(PERFIS_DE_FERA[u.fera!].vida);
  });

  it('a transformação acaba sozinha depois de FERA_DURACAO, e a vida volta ao normal', () => {
    const partida = criarPartida(3);
    const u = partida.entrar({ nome: 'Peão', bot: false, time: 'azul' });
    passarSegundos(partida, ATE_O_TOTEM + 0.5);
    const totem = partida.estado.totem!;
    u.x = totem.x;
    u.y = totem.y;
    passarSegundos(partida, 1);
    expect(u.fera).not.toBeNull();

    passarSegundos(partida, FERA_DURACAO + 1);
    expect(u.fera).toBeNull();
    expect(u.vida).toBeLessThanOrEqual(90); // vida do aldeão, não a da fera
  });

  it('morrer transformado também acaba a fera', () => {
    const partida = criarPartida(3);
    const u = partida.entrar({ nome: 'Peão', bot: false, time: 'azul' });
    passarSegundos(partida, ATE_O_TOTEM + 0.5);
    const totem = partida.estado.totem!;
    u.x = totem.x;
    u.y = totem.y;
    passarSegundos(partida, 1);
    expect(u.fera).not.toBeNull();

    u.vida = 1;
    const outro = partida.entrar({ nome: 'Rival', bot: false, time: 'vermelho' });
    outro.x = u.x;
    outro.y = u.y;
    outro.olharX = 1;
    outro.olharY = 0;
    partida.comandar(outro.id, {
      seq: 1,
      mx: 0,
      my: 0,
      ax: 1,
      ay: 0,
      atacar: true,
      usar: false,
    });
    partida.passo();

    expect(u.vivo).toBe(false);
    expect(u.fera).toBeNull();
  });
});
