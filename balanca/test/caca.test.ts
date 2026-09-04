import { describe, expect, it } from 'vitest';

import { criarArena, PONTE, tocaDaPresaDe } from '../src/shared/arena';
import { IDS_DOS_MAPAS } from '../src/shared/mapas';
import { criarPartida, type Partida } from '../src/shared/partida';
import {
  AQUECIMENTO,
  PRESA_ATRASO_INICIAL,
  PRESA_BUFF_DANO,
  PRESA_BUFF_DURACAO,
  PRESA_CADENCIA_DE_ATAQUE,
  PRESA_INTERVALO,
  PRESA_RAIO_DE_ATAQUE,
  TICKS_POR_SEGUNDO,
  TILE,
  TIMES,
} from '../src/shared/regras';

/**
 * A Presa do Modo Caça: um bicho neutro que nasce sem parar, só nesse um
 * modo — a alavanca que dá nome a ele. Dói em quem chega perto (sem nunca
 * derrubar), e cair dá ao time que baixou a vida dela um tempo de dano
 * extra.
 */

function passarSegundos(partida: Partida, segundos: number): void {
  for (let i = 0; i < segundos * TICKS_POR_SEGUNDO; i++) partida.passo();
}

describe('a Presa', () => {
  it('só nasce no Modo Caça — no clássico, nunca', () => {
    const partida = criarPartida(41, 'resgate');
    passarSegundos(partida, AQUECIMENTO + PRESA_ATRASO_INICIAL + 1);
    expect(partida.estado.presa).toBeNull();
  });

  it('nasce no Modo Caça depois do atraso inicial', () => {
    const partida = criarPartida(41, 'caca');
    passarSegundos(partida, AQUECIMENTO + PRESA_ATRASO_INICIAL + 0.5);
    expect(partida.estado.presa).not.toBeNull();
    expect(partida.estado.presa!.vida).toBe(partida.estado.presa!.vidaMaxima);
  });

  it('bate em quem chega perto, dos dois times, e nunca derruba', () => {
    const partida = criarPartida(41, 'caca');
    passarSegundos(partida, AQUECIMENTO + PRESA_ATRASO_INICIAL + 0.5);
    const p = partida.estado.presa!;

    const azul = partida.entrar({ nome: 'Azul', bot: false, time: 'azul' });
    const vermelho = partida.entrar({ nome: 'Vermelho', bot: false, time: 'vermelho' });
    azul.x = p.x;
    azul.y = p.y;
    azul.vida = 3; // menos que o dano da Presa: se ela matasse, morreria aqui.
    vermelho.x = p.x + 10;
    vermelho.y = p.y;
    vermelho.vida = 3;

    passarSegundos(partida, PRESA_CADENCIA_DE_ATAQUE + 0.5);

    expect(azul.vida).toBe(1);
    expect(azul.vivo).toBe(true);
    expect(vermelho.vida).toBe(1);
    expect(vermelho.vivo).toBe(true);
  });

  it('não bate em quem está fora do raio', () => {
    const partida = criarPartida(41, 'caca');
    passarSegundos(partida, AQUECIMENTO + PRESA_ATRASO_INICIAL + 0.5);
    const p = partida.estado.presa!;
    const longe = partida.entrar({ nome: 'Longe', bot: false, time: 'azul' });
    longe.x = p.x + PRESA_RAIO_DE_ATAQUE + 200;
    longe.y = p.y;
    const vidaAntes = longe.vida;

    passarSegundos(partida, PRESA_CADENCIA_DE_ATAQUE + 0.5);

    expect(longe.vida).toBe(vidaAntes);
  });

  it('cai para quem baixar a vida dela, dá o buff de dano ao time, e some da toca', () => {
    const partida = criarPartida(41, 'caca');
    passarSegundos(partida, AQUECIMENTO + PRESA_ATRASO_INICIAL + 0.5);
    partida.estado.presa!.vida = 1; // um golpe qualquer basta.

    const guerreiro = partida.entrar({ nome: 'G', bot: false, time: 'azul' });
    guerreiro.classe = 'guerreiro';
    guerreiro.x = partida.estado.presa!.x;
    guerreiro.y = partida.estado.presa!.y;

    const eventos = [];
    partida.comandar(guerreiro.id, { seq: 1, mx: 0, my: 0, ax: 1, ay: 0, atacar: true, usar: false });
    for (let i = 0; i < 5; i++) {
      partida.passo();
      eventos.push(...partida.estado.eventos);
    }

    expect(partida.estado.presa).toBeNull();
    expect(partida.estado.buffDaPresa.azul).toBeGreaterThan(0);
    expect(partida.estado.buffDaPresa.vermelho).toBe(0);
    expect(eventos.some((e) => e.tipo === 'presaCaiu' && e.time === 'azul')).toBe(true);
  });

  it('o buff de dano multiplica o ataque de verdade, e expira sozinho', () => {
    const partida = criarPartida(41, 'caca');
    passarSegundos(partida, AQUECIMENTO + PRESA_ATRASO_INICIAL + 0.5);
    const p = partida.estado.presa!;
    p.vida = 100000;
    p.vidaMaxima = 100000;

    const guerreiro = partida.entrar({ nome: 'G', bot: false, time: 'azul' });
    guerreiro.classe = 'guerreiro';
    guerreiro.x = p.x;
    guerreiro.y = p.y;

    partida.comandar(guerreiro.id, { seq: 1, mx: 0, my: 0, ax: 1, ay: 0, atacar: true, usar: false });
    partida.passo();
    const danoSemBuff = 100000 - partida.estado.presa!.vida;
    partida.estado.presa!.vida = 100000;
    guerreiro.recarga = 0;

    partida.estado.buffDaPresa.azul = PRESA_BUFF_DURACAO;
    partida.passo();
    const danoComBuff = 100000 - partida.estado.presa!.vida;

    expect(danoComBuff).toBeCloseTo(danoSemBuff * PRESA_BUFF_DANO, 1);

    // Expira sozinho: passado o tempo do buff, o multiplicador volta ao normal.
    passarSegundos(partida, PRESA_BUFF_DURACAO + 1);
    expect(partida.estado.buffDaPresa.azul).toBe(0);
  });

  it('renasce depois do intervalo, uma vez derrubada', () => {
    const partida = criarPartida(41, 'caca');
    passarSegundos(partida, AQUECIMENTO + PRESA_ATRASO_INICIAL + 0.5);
    partida.estado.presa = null;
    partida.estado.proximaPresaEm = 0.1;

    passarSegundos(partida, 0.2);
    expect(partida.estado.presa).not.toBeNull();

    // Simula a queda de verdade: null e o relógio do intervalo, do jeito que
    // `ferirPresa` deixa os dois depois de um abate.
    partida.estado.presa = null;
    partida.estado.proximaPresaEm = PRESA_INTERVALO;
    passarSegundos(partida, PRESA_INTERVALO - 1);
    expect(partida.estado.presa).toBeNull();
    passarSegundos(partida, 2);
    expect(partida.estado.presa).not.toBeNull();
  });

  it('nasce em chão seco e sem ponte, perto do centro, em todo mapa', () => {
    for (const id of IDS_DOS_MAPAS) {
      const arena = criarArena(41, id);
      const local = tocaDaPresaDe(arena);
      const tx = Math.floor(local.x / TILE);
      const ty = Math.floor(local.y / TILE);
      expect(arena.ehChao(tx, ty), id).toBe(true);
      expect(arena.tile(tx, ty), id).not.toBe(PONTE);
    }
  });

  it('o buff começa zerado pros dois times', () => {
    const partida = criarPartida(41, 'caca');
    for (const time of TIMES) expect(partida.estado.buffDaPresa[time]).toBe(0);
  });
});
