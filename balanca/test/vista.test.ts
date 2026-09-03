import { describe, expect, it } from 'vitest';

import { CASTELO, criarArena } from '../src/shared/arena';
import { bauDe } from '../src/shared/estado';
import { criarPartida } from '../src/shared/partida';
import { ALCANCE_DE_VISTA, AQUECIMENTO, TICKS_POR_SEGUNDO, TILE } from '../src/shared/regras';
import { avistados, pontoAvistado } from '../src/shared/vista';

/**
 * A visão do time — a regra por trás do minimapa.
 *
 * A promessa é uma só: **o inimigo aparece no mapa quando alguém do seu time
 * está vendo, e não antes**. Ela quebra de dois jeitos opostos, e os dois
 * estragam o jogo de maneiras diferentes.
 *
 * Frouxa demais, o minimapa vira um radar: o cerco deixa de ser uma coisa que
 * se descobre e a emboscada some do jogo. Apertada demais, o mapa fica vazio e
 * não serve para nada — e aí a pessoa desliga e o trabalho foi perdido.
 *
 * Por isso os testes vêm em pares: um que confirma que se vê, e o irmão dele
 * que confirma que **não** se vê pelo motivo certo.
 */

function emJogo() {
  const partida = criarPartida(31);
  for (let i = 0; i < Math.ceil(AQUECIMENTO * TICKS_POR_SEGUNDO) + 2; i++) partida.passo();
  return partida;
}

/** Põe uma unidade exatamente onde se quer, viva. */
function por(u: { x: number; y: number; vivo: boolean }, tx: number, ty: number): void {
  u.x = (tx + 0.5) * TILE;
  u.y = (ty + 0.5) * TILE;
  u.vivo = true;
}

describe('a visão do time', () => {
  it('enxerga o inimigo perto e em campo aberto', () => {
    const partida = emJogo();
    const meu = partida.entrar({ nome: 'eu', bot: false, time: 'azul' });
    const dele = partida.entrar({ nome: 'ele', bot: false, time: 'vermelho' });
    // Dois tiles de distância, no descampado do meio.
    por(meu, 28, 4);
    por(dele, 30, 4);

    expect(avistados(partida.arena, partida.estado, 'azul').has(dele.id)).toBe(true);
  });

  it('não enxerga o inimigo longe, mesmo sem nada no caminho', () => {
    const partida = emJogo();
    const meu = partida.entrar({ nome: 'eu', bot: false, time: 'azul' });
    const dele = partida.entrar({ nome: 'ele', bot: false, time: 'vermelho' });
    por(meu, 22, 4);
    // Bem além do alcance, na mesma linha limpa.
    por(dele, 22 + Math.ceil(ALCANCE_DE_VISTA / TILE) + 3, 4);

    expect(avistados(partida.arena, partida.estado, 'azul').has(dele.id)).toBe(false);
  });

  it('não enxerga através da parede, mesmo colado', () => {
    // O par do primeiro teste. Sem ele, bastaria alguém trocar a linha livre
    // por uma conta de distância para o minimapa passar a mostrar quem está do
    // outro lado do fosso — e nada acusaria.
    const partida = emJogo();
    const meu = partida.entrar({ nome: 'eu', bot: false, time: 'azul' });
    const dele = partida.entrar({ nome: 'ele', bot: false, time: 'vermelho' });
    // Um de cada lado da coluna de água do castelo, longe das pontes.
    por(meu, CASTELO.x1 - 1, CASTELO.y0 + 3);
    por(dele, CASTELO.x1 + 1, CASTELO.y0 + 3);

    const d = Math.hypot(dele.x - meu.x, dele.y - meu.y);
    expect(d).toBeLessThan(ALCANCE_DE_VISTA);
    expect(avistados(partida.arena, partida.estado, 'azul').has(dele.id)).toBe(false);
  });

  it('basta um companheiro estar vendo', () => {
    // É o ponto do recurso: o minimapa é a soma dos olhos do time, e não os
    // seus. Sem isto, cada um veria só o que já está na própria tela e o mapa
    // não acrescentaria nada.
    const partida = emJogo();
    const eu = partida.entrar({ nome: 'eu', bot: false, time: 'azul' });
    const colega = partida.entrar({ nome: 'colega', bot: false, time: 'azul' });
    const dele = partida.entrar({ nome: 'ele', bot: false, time: 'vermelho' });

    por(eu, 6, 15);
    por(colega, 28, 4);
    por(dele, 30, 4);

    expect(Math.hypot(dele.x - eu.x, dele.y - eu.y)).toBeGreaterThan(ALCANCE_DE_VISTA);
    expect(avistados(partida.arena, partida.estado, 'azul').has(dele.id)).toBe(true);
  });

  it('o morto não vê nada', () => {
    const partida = emJogo();
    const meu = partida.entrar({ nome: 'eu', bot: false, time: 'azul' });
    const dele = partida.entrar({ nome: 'ele', bot: false, time: 'vermelho' });
    por(meu, 28, 4);
    por(dele, 30, 4);
    meu.vivo = false;

    expect(avistados(partida.arena, partida.estado, 'azul').has(dele.id)).toBe(false);
  });

  it('o inimigo morto não aparece', () => {
    // Ele vai renascer no castelo dele; deixar o ponto no mapa mandaria o time
    // atacar um lugar onde não há mais ninguém.
    const partida = emJogo();
    const meu = partida.entrar({ nome: 'eu', bot: false, time: 'azul' });
    const dele = partida.entrar({ nome: 'ele', bot: false, time: 'vermelho' });
    por(meu, 28, 4);
    por(dele, 30, 4);
    dele.vivo = false;

    expect(avistados(partida.arena, partida.estado, 'azul').has(dele.id)).toBe(false);
  });

  it('nunca lista o próprio time', () => {
    const partida = emJogo();
    const eu = partida.entrar({ nome: 'eu', bot: false, time: 'azul' });
    const colega = partida.entrar({ nome: 'colega', bot: false, time: 'azul' });
    por(eu, 28, 4);
    por(colega, 29, 4);

    const vistos = avistados(partida.arena, partida.estado, 'azul');
    expect(vistos.has(colega.id)).toBe(false);
    expect(vistos.has(eu.id)).toBe(false);
  });

  it('um time sem ninguém vivo não avista nada', () => {
    const partida = emJogo();
    const dele = partida.entrar({ nome: 'ele', bot: false, time: 'vermelho' });
    por(dele, 30, 4);
    expect(avistados(partida.arena, partida.estado, 'azul').size).toBe(0);
  });

  it('vale para um ponto solto, como a bau caída', () => {
    const partida = emJogo();
    const meu = partida.entrar({ nome: 'eu', bot: false, time: 'azul' });
    por(meu, 28, 4);

    const perto = { x: 30 * TILE, y: 4 * TILE };
    const longe = { x: 50 * TILE, y: 30 * TILE };
    expect(pontoAvistado(partida.arena, partida.estado, 'azul', perto)).toBe(true);
    expect(pontoAvistado(partida.arena, partida.estado, 'azul', longe)).toBe(false);
  });

  it('o baú do inimigo na sua cofre é vista por quem a guarda', () => {
    // Caso concreto e o mais comum de todos: a refém dorme na seu cofre, e o
    // seu time está em volta dela. Se a regra a escondesse, o minimapa mentiria
    // sobre a própria casa.
    const partida = emJogo();
    const guarda = partida.entrar({ nome: 'guarda', bot: false, time: 'azul' });
    const refem = bauDe(partida.estado, 'vermelho');
    guarda.x = refem.x;
    guarda.y = refem.y;
    guarda.vivo = true;

    expect(pontoAvistado(partida.arena, partida.estado, 'azul', refem)).toBe(true);
  });
});

describe('o alcance da vista', () => {
  it('é um pouco maior que a meia-altura da tela no zoom padrão', () => {
    // A câmera enquadra treze tiles de altura, então o que cabe acima e abaixo
    // do boneco é seis e meio. O alcance precisa cobrir isso com folga: menor,
    // o minimapa esconderia gente que a pessoa está literalmente vendo.
    const arena = criarArena(1);
    expect(ALCANCE_DE_VISTA / TILE).toBeGreaterThan(6.5);
    // E não pode ser tão grande a ponto de varrer o mapa inteiro de uma vez.
    expect(ALCANCE_DE_VISTA).toBeLessThan((arena.largura * TILE) / 3);
  });
});
