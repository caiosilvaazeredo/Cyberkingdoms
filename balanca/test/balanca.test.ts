import { describe, expect, it } from 'vitest';

import { bauDe, type Unidade } from '../src/shared/estado';
import { criarPartida } from '../src/shared/partida';
import {
  AQUECIMENTO,
  PESO_MAXIMO,
  PESO_MINIMO,
  PESO_POR_BOLSA,
  PESO_TOTAL,
  TICKS_POR_SEGUNDO,
  carregadoresPara,
  velocidadeCarregando,
} from '../src/shared/regras';

/**
 * O diferencial do jogo, testado onde ele mora.
 *
 * Se houvesse um teste só neste repositório, seria o da conservação: é a
 * propriedade da qual todo o resto do desenho depende. No dia em que entulhar
 * criar peso do nada, o jogo deixa de ser este jogo e vira o original.
 */

function partidaEmJogo() {
  const partida = criarPartida(7);
  // Passa o aquecimento: antes do apito nada de ação de contexto acontece.
  for (let i = 0; i < Math.ceil(AQUECIMENTO * TICKS_POR_SEGUNDO) + 2; i++) partida.passo();
  expect(partida.estado.fase).toBe('jogando');
  return partida;
}

/** Põe a unidade colada na própria cofre, com uma bolsa na mão. */
function comBolsaNoCofre(partida: ReturnType<typeof criarPartida>, u: Unidade): void {
  const cofre = partida.arena.estrutura('cofre', u.time);
  u.x = cofre.x;
  u.y = cofre.y;
  u.carga = 'bolsa';
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
    expect(bauDe(estado, 'azul').peso).toBe(PESO_TOTAL / 2);
    expect(bauDe(estado, 'vermelho').peso).toBe(PESO_TOTAL / 2);
  });

  it('uma deposito engorda a refém e alivia o próprio baú, na mesma medida', () => {
    const partida = partidaEmJogo();
    const u = partida.entrar({ nome: 'Cozinheiro', bot: false, time: 'azul' });
    comBolsaNoCofre(partida, u);
    apertarUsar(partida, u.id);

    const refem = bauDe(partida.estado, 'vermelho');
    const minha = bauDe(partida.estado, 'azul');
    expect(refem.peso).toBe(PESO_TOTAL / 2 + PESO_POR_BOLSA);
    expect(minha.peso).toBe(PESO_TOTAL / 2 - PESO_POR_BOLSA);
    expect(refem.peso + minha.peso).toBe(PESO_TOTAL);
    expect(u.carga).toBe('nada');
    expect(u.depositos).toBe(1);
  });

  it('o peso total do reino não muda, por mais depositos que se dê', () => {
    const partida = partidaEmJogo();
    const azul = partida.entrar({ nome: 'A', bot: false, time: 'azul' });
    const vermelho = partida.entrar({ nome: 'V', bot: false, time: 'vermelho' });

    for (let rodada = 0; rodada < 30; rodada++) {
      // Os dois times alimentam, em proporções diferentes: o azul três vezes
      // mais que o vermelho, para a balança de fato encostar num dos limites.
      comBolsaNoCofre(partida, azul);
      apertarUsar(partida, azul.id);
      if (rodada % 3 === 0) {
        comBolsaNoCofre(partida, vermelho);
        apertarUsar(partida, vermelho.id);
      }
      const soma =
        bauDe(partida.estado, 'azul').peso + bauDe(partida.estado, 'vermelho').peso;
      expect(soma).toBe(PESO_TOTAL);
    }
  });

  it('para no talo, sem furar o mínimo nem o máximo', () => {
    const partida = partidaEmJogo();
    const u = partida.entrar({ nome: 'A', bot: false, time: 'azul' });
    for (let i = 0; i < 40; i++) {
      comBolsaNoCofre(partida, u);
      apertarUsar(partida, u.id);
    }
    expect(bauDe(partida.estado, 'vermelho').peso).toBe(PESO_MAXIMO);
    expect(bauDe(partida.estado, 'azul').peso).toBe(PESO_MINIMO);
  });

  it('no talo, o bolsa não é consumido — a deposito não teria efeito', () => {
    const partida = partidaEmJogo();
    const u = partida.entrar({ nome: 'A', bot: false, time: 'azul' });
    for (let i = 0; i < 40; i++) {
      comBolsaNoCofre(partida, u);
      apertarUsar(partida, u.id);
    }
    comBolsaNoCofre(partida, u);
    apertarUsar(partida, u.id);
    expect(u.carga).toBe('bolsa');
  });

  it('pesar mais custa carregadores e velocidade', () => {
    expect(carregadoresPara(PESO_MINIMO)).toBe(1);
    expect(carregadoresPara(PESO_TOTAL / 2)).toBe(2);
    expect(carregadoresPara(PESO_MAXIMO)).toBe(3);
    expect(velocidadeCarregando(PESO_MINIMO)).toBeGreaterThan(velocidadeCarregando(PESO_MAXIMO));
    expect(velocidadeCarregando(PESO_MAXIMO)).toBeGreaterThan(0);
  });

  it('entulhar a refém do inimigo não é possível: o cofre é a sua', () => {
    const partida = partidaEmJogo();
    const u = partida.entrar({ nome: 'A', bot: false, time: 'azul' });
    // Colado no cofre **vermelha**, onde dorme o baú azul.
    const cofreInimigo = partida.arena.estrutura('cofre', 'vermelho');
    u.x = cofreInimigo.x;
    u.y = cofreInimigo.y;
    u.carga = 'bolsa';
    u.vida = 1000;
    apertarUsar(partida, u.id);
    expect(bauDe(partida.estado, 'azul').peso).toBe(PESO_TOTAL / 2);
  });
});
