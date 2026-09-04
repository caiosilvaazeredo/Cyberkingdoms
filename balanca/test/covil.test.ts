import { describe, expect, it } from 'vitest';

import { covilDe, criarArena, PONTE } from '../src/shared/arena';
import { IDS_DOS_MAPAS } from '../src/shared/mapas';
import { criarPartida, type Partida } from '../src/shared/partida';
import { tipoDoGuardiaoPara } from '../src/shared/pve';
import {
  AQUECIMENTO,
  GUARDIAO_ATRASO_INICIAL,
  GUARDIAO_BUFF_DURACAO,
  GUARDIAO_BUFF_VELOCIDADE,
  GUARDIAO_CADENCIA_DE_ATAQUE,
  GUARDIAO_INTERVALO,
  GUARDIAO_RAIO_DE_ATAQUE,
  TICKS_POR_SEGUNDO,
  TILE,
  TIMES,
} from '../src/shared/regras';

/**
 * O Guardião do Modo Covil: um chefe neutro que só existe nesse um modo — a
 * alavanca que dá nome a ele. Nasce tarde, dói em quem chega perto (sem
 * nunca derrubar), e cair dá ao time que baixou a vida dele um tempo de
 * velocidade extra.
 */

function passarSegundos(partida: Partida, segundos: number): void {
  for (let i = 0; i < segundos * TICKS_POR_SEGUNDO; i++) partida.passo();
}

describe('o Guardião', () => {
  it('só nasce no Modo Covil — no clássico, nunca', () => {
    const partida = criarPartida(41, 'resgate');
    passarSegundos(partida, AQUECIMENTO + GUARDIAO_ATRASO_INICIAL + 1);
    expect(partida.estado.guardiao).toBeNull();
  });

  it('nasce no Modo Covil depois do atraso inicial, com o visual do mapa', () => {
    const partida = criarPartida(41, 'covil');
    passarSegundos(partida, AQUECIMENTO + GUARDIAO_ATRASO_INICIAL + 0.5);
    expect(partida.estado.guardiao).not.toBeNull();
    expect(partida.estado.guardiao!.tipo).toBe(tipoDoGuardiaoPara(partida.arena.mapa));
    expect(partida.estado.guardiao!.vida).toBe(partida.estado.guardiao!.vidaMaxima);
  });

  it('bate em quem chega perto, dos dois times, e nunca derruba', () => {
    const partida = criarPartida(41, 'covil');
    passarSegundos(partida, AQUECIMENTO + GUARDIAO_ATRASO_INICIAL + 0.5);
    const g = partida.estado.guardiao!;

    const azul = partida.entrar({ nome: 'Azul', bot: false, time: 'azul' });
    const vermelho = partida.entrar({ nome: 'Vermelho', bot: false, time: 'vermelho' });
    azul.x = g.x;
    azul.y = g.y;
    azul.vida = 5; // menos que o dano do Guardião: se ele matasse, morreria aqui.
    vermelho.x = g.x + 10;
    vermelho.y = g.y;
    vermelho.vida = 5;

    passarSegundos(partida, GUARDIAO_CADENCIA_DE_ATAQUE + 0.5);

    expect(azul.vida).toBe(1);
    expect(azul.vivo).toBe(true);
    expect(vermelho.vida).toBe(1);
    expect(vermelho.vivo).toBe(true);
  });

  it('não bate em quem está fora do raio', () => {
    const partida = criarPartida(41, 'covil');
    passarSegundos(partida, AQUECIMENTO + GUARDIAO_ATRASO_INICIAL + 0.5);
    const g = partida.estado.guardiao!;
    const longe = partida.entrar({ nome: 'Longe', bot: false, time: 'azul' });
    longe.x = g.x + GUARDIAO_RAIO_DE_ATAQUE + 200;
    longe.y = g.y;
    const vidaAntes = longe.vida;

    passarSegundos(partida, GUARDIAO_CADENCIA_DE_ATAQUE + 0.5);

    expect(longe.vida).toBe(vidaAntes);
  });

  it('cai para quem baixar a vida dele, dá o buff de velocidade ao time, e some do covil', () => {
    const partida = criarPartida(41, 'covil');
    passarSegundos(partida, AQUECIMENTO + GUARDIAO_ATRASO_INICIAL + 0.5);
    partida.estado.guardiao!.vida = 1; // um golpe qualquer basta.

    const guerreiro = partida.entrar({ nome: 'G', bot: false, time: 'azul' });
    guerreiro.classe = 'guerreiro';
    guerreiro.x = partida.estado.guardiao!.x;
    guerreiro.y = partida.estado.guardiao!.y;

    const eventos = [];
    partida.comandar(guerreiro.id, { seq: 1, mx: 0, my: 0, ax: 1, ay: 0, atacar: true, usar: false });
    for (let i = 0; i < 5; i++) {
      partida.passo();
      eventos.push(...partida.estado.eventos);
    }

    expect(partida.estado.guardiao).toBeNull();
    expect(partida.estado.buffDoGuardiao.azul).toBeGreaterThan(0);
    expect(partida.estado.buffDoGuardiao.vermelho).toBe(0);
    expect(eventos.some((e) => e.tipo === 'guardiaoCaiu' && e.time === 'azul')).toBe(true);
  });

  it('o buff de velocidade acelera de verdade, e expira sozinho', () => {
    const partida = criarPartida(41, 'covil');
    passarSegundos(partida, AQUECIMENTO + 1);
    const u = partida.entrar({ nome: 'U', bot: false, time: 'azul' });
    u.x = 2000;
    u.y = 2000;

    partida.comandar(u.id, { seq: 1, mx: 1, my: 0, ax: 1, ay: 0, atacar: false, usar: false });
    partida.passo();
    const xSemBuff = u.x;
    u.x = 2000; // desfaz o passo, pra medir o próximo do mesmo ponto de partida.

    partida.estado.buffDoGuardiao.azul = GUARDIAO_BUFF_DURACAO;
    partida.passo();
    const xComBuff = u.x;

    expect(xComBuff - 2000).toBeCloseTo((xSemBuff - 2000) * GUARDIAO_BUFF_VELOCIDADE, 1);

    // Expira sozinho: passado o tempo do buff, a velocidade volta ao normal.
    passarSegundos(partida, GUARDIAO_BUFF_DURACAO + 1);
    expect(partida.estado.buffDoGuardiao.azul).toBe(0);
  });

  it('renasce depois do intervalo, uma vez derrubado', () => {
    const partida = criarPartida(41, 'covil');
    passarSegundos(partida, AQUECIMENTO + GUARDIAO_ATRASO_INICIAL + 0.5);
    partida.estado.guardiao = null;
    partida.estado.proximoGuardiaoEm = 0.1;

    passarSegundos(partida, 0.2);
    expect(partida.estado.guardiao).not.toBeNull();

    // Simula a queda de verdade: null e o relógio do intervalo, do jeito que
    // `ferirGuardiao` deixa os dois depois de um abate.
    partida.estado.guardiao = null;
    partida.estado.proximoGuardiaoEm = GUARDIAO_INTERVALO;
    passarSegundos(partida, GUARDIAO_INTERVALO - 1);
    expect(partida.estado.guardiao).toBeNull();
    passarSegundos(partida, 2);
    expect(partida.estado.guardiao).not.toBeNull();
  });

  it('nasce em chão seco e sem ponte, perto do centro, em todo mapa', () => {
    for (const id of IDS_DOS_MAPAS) {
      const arena = criarArena(41, id);
      const local = covilDe(arena);
      const tx = Math.floor(local.x / TILE);
      const ty = Math.floor(local.y / TILE);
      expect(arena.ehChao(tx, ty), id).toBe(true);
      expect(arena.tile(tx, ty), id).not.toBe(PONTE);
    }
  });

  it('todo mapa tem um visual de Guardião definido', () => {
    for (const id of IDS_DOS_MAPAS) {
      expect(tipoDoGuardiaoPara(id), id).toBeTruthy();
    }
  });

  it('o buff começa zerado pros dois times', () => {
    const partida = criarPartida(41, 'covil');
    for (const time of TIMES) expect(partida.estado.buffDoGuardiao[time]).toBe(0);
  });
});
