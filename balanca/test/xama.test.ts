import { describe, expect, it } from 'vitest';

import { cajadoDe, criarArena, PONTE } from '../src/shared/arena';
import { IDS_DOS_MAPAS } from '../src/shared/mapas';
import { criarPartida, type Partida } from '../src/shared/partida';
import {
  AQUECIMENTO,
  CAJADO_INTERVALO,
  PORCO_DURACAO,
  PORCO_VELOCIDADE_MULT,
  TICKS_POR_SEGUNDO,
  TILE,
  XAMA_ALCANCE,
  XAMA_CARGA_DURACAO,
} from '../src/shared/regras';

/**
 * O cajado do Modo Xamã: um pingente neutro no chão, só nesse um modo — a
 * alavanca que dá nome a ele. Tocar já basta; a carga que dá tem prazo, e o
 * feitiço vira o alvo porco por um tempo — sem atacar, sem colher, sem usar,
 * e mais devagar.
 */

function passarSegundos(partida: Partida, segundos: number): void {
  for (let i = 0; i < segundos * TICKS_POR_SEGUNDO; i++) partida.passo();
}

describe('o cajado', () => {
  it('só nasce no Modo Xamã — no clássico, nunca', () => {
    const partida = criarPartida(41, 'resgate');
    passarSegundos(partida, AQUECIMENTO + CAJADO_INTERVALO + 1);
    expect(partida.estado.cajado).toBeNull();
  });

  it('nasce no Modo Xamã, e tocar dá o feitiço, dos dois times', () => {
    const partida = criarPartida(41, 'xama');
    passarSegundos(partida, AQUECIMENTO + CAJADO_INTERVALO / 3 + 0.5);
    expect(partida.estado.cajado).not.toBeNull();
    const c = partida.estado.cajado!;

    const u = partida.entrar({ nome: 'U', bot: false, time: 'azul' });
    u.x = c.x;
    u.y = c.y;
    passarSegundos(partida, 0.2);

    expect(partida.estado.cajado).toBeNull();
    expect(u.xamaAte).toBeGreaterThan(0);
  });

  it('some sozinho depois do próprio intervalo, sem ser pego', () => {
    const partida = criarPartida(41, 'xama');
    passarSegundos(partida, AQUECIMENTO + CAJADO_INTERVALO / 3 + 0.5);
    expect(partida.estado.cajado).not.toBeNull();
  });

  it('nasce em chão seco e sem ponte, perto do centro, em todo mapa', () => {
    for (const id of IDS_DOS_MAPAS) {
      const arena = criarArena(41, id);
      const local = cajadoDe(arena);
      const tx = Math.floor(local.x / TILE);
      const ty = Math.floor(local.y / TILE);
      expect(arena.ehChao(tx, ty), id).toBe(true);
      expect(arena.tile(tx, ty), id).not.toBe(PONTE);
    }
  });
});

describe('o feitiço de transformação', () => {
  it('transforma o inimigo mais perto ao alcance, gasta a carga, e larga o que ele carregava', () => {
    const partida = criarPartida(41, 'xama');
    passarSegundos(partida, AQUECIMENTO + 0.5);

    const xama = partida.entrar({ nome: 'X', bot: false, time: 'azul' });
    xama.xamaAte = XAMA_CARGA_DURACAO;
    const alvo = partida.entrar({ nome: 'V', bot: false, time: 'vermelho' });
    alvo.x = xama.x + XAMA_ALCANCE - 10;
    alvo.y = xama.y;
    alvo.carga = 'madeira';

    partida.comandar(xama.id, { seq: 1, mx: 0, my: 0, ax: 1, ay: 0, atacar: false, usar: true });
    partida.passo();

    expect(xama.xamaAte).toBe(0);
    expect(alvo.porco).toBeGreaterThan(0);
    expect(alvo.carga).toBe('nada');
  });

  it('não alcança quem está fora do alcance', () => {
    const partida = criarPartida(41, 'xama');
    passarSegundos(partida, AQUECIMENTO + 0.5);

    const xama = partida.entrar({ nome: 'X', bot: false, time: 'azul' });
    xama.xamaAte = XAMA_CARGA_DURACAO;
    const alvo = partida.entrar({ nome: 'V', bot: false, time: 'vermelho' });
    alvo.x = xama.x + XAMA_ALCANCE + 200;
    alvo.y = xama.y;

    partida.comandar(xama.id, { seq: 1, mx: 0, my: 0, ax: 1, ay: 0, atacar: false, usar: true });
    partida.passo();

    expect(xama.xamaAte).toBeGreaterThan(0);
    expect(alvo.porco).toBe(0);
  });

  it('não transforma o próprio time', () => {
    const partida = criarPartida(41, 'xama');
    passarSegundos(partida, AQUECIMENTO + 0.5);

    const xama = partida.entrar({ nome: 'X', bot: false, time: 'azul' });
    xama.xamaAte = XAMA_CARGA_DURACAO;
    const aliado = partida.entrar({ nome: 'A', bot: false, time: 'azul' });
    aliado.x = xama.x + 10;
    aliado.y = xama.y;

    partida.comandar(xama.id, { seq: 1, mx: 0, my: 0, ax: 1, ay: 0, atacar: false, usar: true });
    partida.passo();

    expect(aliado.porco).toBe(0);
  });

  it('a carga não gasta a tempo some sozinha', () => {
    const partida = criarPartida(41, 'xama');
    passarSegundos(partida, AQUECIMENTO + 0.5);

    const xama = partida.entrar({ nome: 'X', bot: false, time: 'azul' });
    xama.xamaAte = XAMA_CARGA_DURACAO;

    passarSegundos(partida, XAMA_CARGA_DURACAO + 1);
    expect(xama.xamaAte).toBe(0);
  });
});

describe('o porco', () => {
  it('não ataca — mas continua andando', () => {
    const partida = criarPartida(41, 'xama');
    passarSegundos(partida, AQUECIMENTO + 0.5);

    const p = partida.entrar({ nome: 'P', bot: false, time: 'azul' });
    p.classe = 'guerreiro';
    p.porco = PORCO_DURACAO;
    const xAntes = p.x;
    const alvo = partida.entrar({ nome: 'V', bot: false, time: 'vermelho' });
    alvo.x = p.x + 10;
    alvo.y = p.y;
    const vidaDoAlvo = alvo.vida;

    partida.comandar(p.id, { seq: 1, mx: 1, my: 0, ax: 1, ay: 0, atacar: true, usar: false });
    passarSegundos(partida, 0.5);

    expect(alvo.vida).toBe(vidaDoAlvo);
    expect(p.x).not.toBe(xAntes);
  });

  it('anda mais devagar que a própria classe por baixo', () => {
    const partida = criarPartida(41, 'xama');
    passarSegundos(partida, AQUECIMENTO + 0.5);
    const u = partida.entrar({ nome: 'U', bot: false, time: 'azul' });
    u.x = 2000;
    u.y = 2000;

    partida.comandar(u.id, { seq: 1, mx: 1, my: 0, ax: 1, ay: 0, atacar: false, usar: false });
    partida.passo();
    const xSemPorco = u.x;
    u.x = 2000;

    u.porco = PORCO_DURACAO;
    partida.passo();
    const xComPorco = u.x;

    expect(xComPorco - 2000).toBeCloseTo((xSemPorco - 2000) * PORCO_VELOCIDADE_MULT, 1);
  });

  it('volta ao normal sozinho, e o evento é o mesmo da fera', () => {
    const partida = criarPartida(41, 'xama');
    passarSegundos(partida, AQUECIMENTO + 0.5);
    const u = partida.entrar({ nome: 'U', bot: false, time: 'azul' });
    u.porco = 0.05;

    let voltou = false;
    for (let i = 0; i < 5; i++) {
      partida.passo();
      if (partida.estado.eventos.some((e) => e.tipo === 'voltouAoNormal' && e.unidade === u.id)) {
        voltou = true;
      }
    }

    expect(u.porco).toBe(0);
    expect(voltou).toBe(true);
  });

  it('cair também acaba o porco e perde a carga não gasta', () => {
    const partida = criarPartida(41, 'xama');
    passarSegundos(partida, AQUECIMENTO + 0.5);
    const u = partida.entrar({ nome: 'U', bot: false, time: 'azul' });
    u.porco = PORCO_DURACAO;
    u.xamaAte = XAMA_CARGA_DURACAO;
    u.vida = 1;

    const algoz = partida.entrar({ nome: 'A', bot: false, time: 'vermelho' });
    algoz.classe = 'guerreiro';
    algoz.x = u.x;
    algoz.y = u.y;
    partida.comandar(algoz.id, { seq: 1, mx: 0, my: 0, ax: 1, ay: 0, atacar: true, usar: false });
    partida.passo();

    expect(u.vivo).toBe(false);
    expect(u.porco).toBe(0);
    expect(u.xamaAte).toBe(0);
  });
});
