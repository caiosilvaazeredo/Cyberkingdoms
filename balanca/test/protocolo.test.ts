import { describe, expect, it } from 'vitest';

import { ESTOQUE_INICIAL, type Classe } from '../src/shared/classes';
import { bauDe, type Estado } from '../src/shared/estado';
import { criarPartida } from '../src/shared/partida';
import { desempacotar, empacotar } from '../src/shared/protocolo';
import { AQUECIMENTO, TICKS_POR_SEGUNDO, TIMES, type Time } from '../src/shared/regras';

/**
 * O retrato vai e volta inteiro.
 *
 * As tuplas do protocolo são rápidas e mudas: trocar dois campos de lugar não
 * quebra nenhuma compilação — quebra o jogo, e de um jeito difícil de ler
 * ("por que todo mundo está com a vida do vizinho?"). Este teste é o que dá voz
 * a esse erro.
 */

function estadoVazio(): Estado {
  const estoque = {} as Record<Time, Record<Classe, number>>;
  for (const t of TIMES) estoque[t] = { ...ESTOQUE_INICIAL };
  return {
    tick: 0,
    modo: 'resgate' as const,
    fase: 'aquecimento',
    faseEm: 0,
    relogio: 0,
    placar: { azul: 0, vermelho: 0 },
    abates: { azul: 0, vermelho: 0 },
    unidades: [],
    baus: [],
    projeteis: [],
    itens: [],
    jazidas: [],
    animais: [],
    casasDaMoeda: [],
    oficinas: [],
    estoque,
    eventos: [],
    vencedor: null,
    proximoId: 1,
  };
}

describe('o retrato', () => {
  it('sobrevive à ida e à volta', () => {
    const partida = criarPartida(31);
    for (let i = 0; i < Math.ceil(AQUECIMENTO * TICKS_POR_SEGUNDO) + 2; i++) partida.passo();

    const heroi = partida.entrar({ nome: 'Herói', bot: false, time: 'azul' });
    heroi.classe = 'arqueiro';
    heroi.vida = 42;
    heroi.carga = 'bolsa';
    const rival = partida.entrar({ nome: 'Rival', bot: true, time: 'vermelho' });
    rival.classe = 'lanceiro';

    partida.comandar(heroi.id, { seq: 77, mx: 1, my: 0, ax: 1, ay: 0, atacar: true, usar: false });
    for (let i = 0; i < 3; i++) partida.passo();
    expect(partida.estado.projeteis.length).toBeGreaterThan(0);

    const copia = desempacotar(empacotar(partida.estado), estadoVazio());

    expect(copia.tick).toBe(partida.estado.tick);
    expect(copia.fase).toBe(partida.estado.fase);
    expect(copia.placar).toEqual(partida.estado.placar);
    expect(copia.unidades).toHaveLength(partida.estado.unidades.length);

    const heroiCopia = copia.unidades.find((u) => u.id === heroi.id)!;
    expect(heroiCopia.time).toBe('azul');
    expect(heroiCopia.classe).toBe('arqueiro');
    expect(heroiCopia.carga).toBe('bolsa');
    // O relógio do gesto viaja: sem ele o golpe do vizinho não anima.
    expect(heroiCopia.golpe).toBeCloseTo(heroi.golpe, 1);
    expect(heroiCopia.vida).toBe(42);
    expect(heroiCopia.ultimoComando).toBe(77);
    expect(Math.round(heroiCopia.x)).toBe(Math.round(heroi.x));
    expect(Math.round(heroiCopia.y)).toBe(Math.round(heroi.y));

    expect(copia.projeteis).toHaveLength(partida.estado.projeteis.length);
    expect(copia.baus.map((p) => p.peso)).toEqual(
      partida.estado.baus.map((p) => p.peso),
    );
    expect(copia.estoque.azul).toEqual(partida.estado.estoque.azul);
    expect(copia.jazidas).toHaveLength(partida.estado.jazidas.length);
    expect(copia.animais).toHaveLength(partida.estado.animais.length);
    expect(copia.casasDaMoeda.map((c) => c.time)).toEqual(partida.estado.casasDaMoeda.map((c) => c.time));
    expect(copia.oficinas).toEqual(partida.estado.oficinas);
  });

  it('preserva quem carrega a bau', () => {
    const partida = criarPartida(32);
    for (let i = 0; i < Math.ceil(AQUECIMENTO * TICKS_POR_SEGUNDO) + 2; i++) partida.passo();
    const heroi = partida.entrar({ nome: 'H', bot: false, time: 'azul' });
    const minha = bauDe(partida.estado, 'azul');
    minha.peso = 60;
    heroi.x = minha.x;
    heroi.y = minha.y;
    partida.comandar(heroi.id, { seq: 1, mx: 0, my: 0, ax: 0, ay: 0, atacar: false, usar: true });
    partida.passo();

    const copia = desempacotar(empacotar(partida.estado), estadoVazio());
    const bau = copia.baus.find((p) => p.time === 'azul')!;
    expect(bau.onde).toBe('carregado');
    expect(bau.portador).toBe(heroi.id);
  });

  it('cabe num pacote pequeno o bastante para quinze envios por segundo', () => {
    const partida = criarPartida(33);
    for (let time of TIMES) {
      for (let i = 0; i < 6; i++) partida.entrar({ nome: `bot${i}`, bot: true, time });
    }
    for (let i = 0; i < 60; i++) partida.passo();
    const bytes = JSON.stringify(empacotar(partida.estado)).length;
    // Doze unidades em campo. Três quilobytes por retrato, quinze vezes por
    // segundo, dão 45 kB/s por jogador — o teto do que uma conexão de celular
    // aguenta sem engasgar.
    expect(bytes).toBeLessThan(3000);
  });
});
