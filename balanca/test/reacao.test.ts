import { describe, expect, it } from 'vitest';

import { reacaoAoGolpe } from '../src/client/desenho';
import { criarPartida } from '../src/shared/partida';

describe('a reação ao golpe', () => {
  it('quem perde vida clareia, achata e recua para longe de quem bateu, e volta ao normal', () => {
    const partida = criarPartida(3);
    const alvo = partida.entrar({ nome: 'Alvo', bot: false, time: 'azul' });
    const algoz = partida.entrar({ nome: 'Algoz', bot: false, time: 'vermelho' });
    alvo.x = 1000;
    alvo.y = 1000;
    algoz.x = 1060;
    algoz.y = 1000;

    const antes = reacaoAoGolpe(partida.estado, alvo, 0);
    expect(antes).toEqual({ dx: 0, dy: 0, sx: 1, sy: 1, brilho: 1 });

    alvo.vida -= 10;
    const golpe = reacaoAoGolpe(partida.estado, alvo, 10);
    expect(golpe.brilho).toBeGreaterThan(1);
    expect(golpe.sy).toBeLessThan(1);
    // O algoz está a leste: o recuo é para oeste.
    expect(golpe.dx).toBeLessThan(0);

    const depois = reacaoAoGolpe(partida.estado, alvo, 2000);
    expect(depois).toEqual({ dx: 0, dy: 0, sx: 1, sy: 1, brilho: 1 });
  });

  it('o golpe dado avança na direção do olhar', () => {
    const partida = criarPartida(3);
    const u = partida.entrar({ nome: 'Guerreiro', bot: false, time: 'azul' });
    u.olharX = 0;
    u.olharY = 1;
    u.golpe = 0.15;
    const r = reacaoAoGolpe(partida.estado, u, 0);
    expect(r.dy).toBeGreaterThan(0);
    expect(Math.abs(r.dx)).toBeLessThan(1e-9);
  });
});
