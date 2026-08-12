import { describe, expect, it } from 'vitest';

import { princesaDe, type Unidade } from '../src/shared/estado';
import { criarPartida } from '../src/shared/partida';
import {
  AQUECIMENTO,
  PESO_MAXIMO,
  PESO_MINIMO,
  PESO_POR_BOLO,
  PESO_TOTAL,
  TICKS_POR_SEGUNDO,
  carregadoresPara,
  velocidadeCarregando,
} from '../src/shared/regras';

/**
 * O diferencial do jogo, testado onde ele mora.
 *
 * Se houvesse um teste só neste repositório, seria o da conservação: é a
 * propriedade da qual todo o resto do desenho depende. No dia em que alimentar
 * criar peso do nada, o jogo deixa de ser este jogo e vira o original.
 */

function partidaEmJogo() {
  const partida = criarPartida(7);
  // Passa o aquecimento: antes do apito nada de ação de contexto acontece.
  for (let i = 0; i < Math.ceil(AQUECIMENTO * TICKS_POR_SEGUNDO) + 2; i++) partida.passo();
  expect(partida.estado.fase).toBe('jogando');
  return partida;
}

/** Põe a unidade colada na própria masmorra, com um bolo na mão. */
function comBoloNaMasmorra(partida: ReturnType<typeof criarPartida>, u: Unidade): void {
  const jaula = partida.arena.estrutura('jaula', u.time);
  u.x = jaula.x;
  u.y = jaula.y;
  u.carga = 'bolo';
}

function apertarUsar(partida: ReturnType<typeof criarPartida>, id: number): void {
  partida.comandar(id, { seq: 1, mx: 0, my: 0, ax: 0, ay: 0, atacar: false, usar: true });
  partida.passo();
  partida.comandar(id, { seq: 2, mx: 0, my: 0, ax: 0, ay: 0, atacar: false, usar: false });
  partida.passo();
}

describe('a balança', () => {
  it('começa em equilíbrio, com o peso do reino repartido', () => {
    const { estado } = criarPartida(1);
    expect(princesaDe(estado, 'azul').peso).toBe(PESO_TOTAL / 2);
    expect(princesaDe(estado, 'vermelho').peso).toBe(PESO_TOTAL / 2);
  });

  it('uma fatia engorda a refém e alivia a própria princesa, na mesma medida', () => {
    const partida = partidaEmJogo();
    const u = partida.entrar({ nome: 'Cozinheiro', bot: false, time: 'azul' });
    comBoloNaMasmorra(partida, u);
    apertarUsar(partida, u.id);

    const refem = princesaDe(partida.estado, 'vermelho');
    const minha = princesaDe(partida.estado, 'azul');
    expect(refem.peso).toBe(PESO_TOTAL / 2 + PESO_POR_BOLO);
    expect(minha.peso).toBe(PESO_TOTAL / 2 - PESO_POR_BOLO);
    expect(refem.peso + minha.peso).toBe(PESO_TOTAL);
    expect(u.carga).toBe('nada');
    expect(u.fatias).toBe(1);
  });

  it('o peso total do reino não muda, por mais fatias que se dê', () => {
    const partida = partidaEmJogo();
    const azul = partida.entrar({ nome: 'A', bot: false, time: 'azul' });
    const vermelho = partida.entrar({ nome: 'V', bot: false, time: 'vermelho' });

    for (let rodada = 0; rodada < 30; rodada++) {
      // Os dois times alimentam, em proporções diferentes: o azul três vezes
      // mais que o vermelho, para a balança de fato encostar num dos limites.
      comBoloNaMasmorra(partida, azul);
      apertarUsar(partida, azul.id);
      if (rodada % 3 === 0) {
        comBoloNaMasmorra(partida, vermelho);
        apertarUsar(partida, vermelho.id);
      }
      const soma =
        princesaDe(partida.estado, 'azul').peso + princesaDe(partida.estado, 'vermelho').peso;
      expect(soma).toBe(PESO_TOTAL);
    }
  });

  it('para no talo, sem furar o mínimo nem o máximo', () => {
    const partida = partidaEmJogo();
    const u = partida.entrar({ nome: 'A', bot: false, time: 'azul' });
    for (let i = 0; i < 40; i++) {
      comBoloNaMasmorra(partida, u);
      apertarUsar(partida, u.id);
    }
    expect(princesaDe(partida.estado, 'vermelho').peso).toBe(PESO_MAXIMO);
    expect(princesaDe(partida.estado, 'azul').peso).toBe(PESO_MINIMO);
  });

  it('no talo, o bolo não é consumido — a fatia não teria efeito', () => {
    const partida = partidaEmJogo();
    const u = partida.entrar({ nome: 'A', bot: false, time: 'azul' });
    for (let i = 0; i < 40; i++) {
      comBoloNaMasmorra(partida, u);
      apertarUsar(partida, u.id);
    }
    comBoloNaMasmorra(partida, u);
    apertarUsar(partida, u.id);
    expect(u.carga).toBe('bolo');
  });

  it('pesar mais custa carregadores e velocidade', () => {
    expect(carregadoresPara(PESO_MINIMO)).toBe(1);
    expect(carregadoresPara(PESO_TOTAL / 2)).toBe(2);
    expect(carregadoresPara(PESO_MAXIMO)).toBe(3);
    expect(velocidadeCarregando(PESO_MINIMO)).toBeGreaterThan(velocidadeCarregando(PESO_MAXIMO));
    expect(velocidadeCarregando(PESO_MAXIMO)).toBeGreaterThan(0);
  });

  it('alimentar a refém do inimigo não é possível: a masmorra é a sua', () => {
    const partida = partidaEmJogo();
    const u = partida.entrar({ nome: 'A', bot: false, time: 'azul' });
    // Colado na masmorra **vermelha**, onde dorme a princesa azul.
    const jaulaInimiga = partida.arena.estrutura('jaula', 'vermelho');
    u.x = jaulaInimiga.x;
    u.y = jaulaInimiga.y;
    u.carga = 'bolo';
    u.vida = 1000;
    apertarUsar(partida, u.id);
    expect(princesaDe(partida.estado, 'azul').peso).toBe(PESO_TOTAL / 2);
  });
});
