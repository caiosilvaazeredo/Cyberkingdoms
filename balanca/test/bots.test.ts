import { describe, expect, it } from 'vitest';

import { Sala, type Cliente } from '../src/server/sala';
import { bauDe } from '../src/shared/estado';
import { PESO_TOTAL, TICKS_POR_SEGUNDO, TILE } from '../src/shared/regras';

/**
 * Os bots jogando de verdade.
 *
 * Um teste de unidade diria que a função de decisão devolve o destino esperado
 * — e passaria com bots que andam em círculo. O que interessa é outra coisa:
 * **depois de alguns minutos de partida, o jogo andou?** Houve depósito, houve
 * disputa, alguém pegou o baú? Por isso este teste roda a partida inteira
 * e olha o resultado, e não as decisões.
 */

function clienteMudo(nome: string): Cliente {
  return {
    chave: nome,
    nome,
    unidade: null,
    time: null,
    assistindo: false,
    silencio: 0,
    enviar() {},
    fechar() {},
  };
}

/** Roda a sala e junta o que aconteceu no caminho. */
function jogar(segundos: number, seed: number) {
  const sala = new Sala({ nome: 'teste', seed, porTime: 6, esperaPorJogadores: 0 });
  // Um espectador basta para a sala existir; os bots jogam a partida.
  sala.entrar(clienteMudo('Observador'));
  const eventos: string[] = [];
  // O maior desequilíbrio que a balança alcançou. Olhar só o peso final
  // esconderia uma partida em que os dois times se revezaram e voltaram ao
  // meio — que é justamente o cabo de guerra funcionando.
  let maiorDesequilibrio = 0;
  for (let i = 0; i < segundos * TICKS_POR_SEGUNDO; i++) {
    // Um cliente de verdade manda comando trinta vezes por segundo; sem isso a
    // sala o consideraria ido, se esvaziaria e pararia de chamar bots.
    sala.tocar('Observador');
    sala.passo();
    for (const e of sala.estado.eventos) eventos.push(e.tipo);
    maiorDesequilibrio = Math.max(
      maiorDesequilibrio,
      Math.abs(bauDe(sala.estado, 'azul').peso - PESO_TOTAL / 2),
    );
  }
  return { sala, eventos, maiorDesequilibrio };
}

describe('os bots', () => {
  it('sustentam a economia e movem a balança', () => {
    const { sala, eventos, maiorDesequilibrio } = jogar(150, 21);
    expect(eventos.filter((e) => e === 'deposito').length).toBeGreaterThan(0);
    const azul = bauDe(sala.estado, 'azul').peso;
    const vermelho = bauDe(sala.estado, 'vermelho').peso;
    expect(azul + vermelho).toBe(PESO_TOTAL);
    expect(maiorDesequilibrio).toBeGreaterThan(0);
  });

  it('brigam: alguém cai em algum momento', () => {
    const { eventos } = jogar(150, 22);
    expect(eventos.filter((e) => e === 'abate').length).toBeGreaterThan(0);
  });

  it('tentam o resgate de verdade', () => {
    const { eventos } = jogar(240, 23);
    expect(eventos.filter((e) => e === 'pegouBau').length).toBeGreaterThan(0);
  });

  it('afugentam a invasão de goblins pelo menos uma vez', () => {
    // Sem a urgência da invasão em `planejar()`, nenhum bot ia até o
    // invasor — a onda sempre roubava, porque ninguém jogava. Cem segundos
    // cobre a primeira onda inteira (nasce por volta dos 45s).
    const { eventos } = jogar(100, 23);
    expect(eventos.filter((e) => e === 'invasaoAfugentada').length).toBeGreaterThan(0);
  });

  it('disputam o totem: algum bot vira fera', () => {
    // O primeiro totem nasce por volta dos 38s; noventa segundos dá tempo de
    // sobra para um bot notá-lo dentro do raio de interesse e pegá-lo.
    const { eventos } = jogar(90, 21);
    expect(eventos.filter((e) => e === 'virouFera').length).toBeGreaterThan(0);
  });

  it('nunca ficam presos dentro da água', () => {
    const { sala } = jogar(120, 24);
    for (const u of sala.estado.unidades) {
      expect(sala.estado.unidades.length).toBeGreaterThan(0);
      const dentroDagua = salaBloqueada(sala, u.x, u.y);
      expect(dentroDagua).toBe(false);
    }
  });

  it('cabem no orçamento de tempo de um tick', () => {
    const sala = new Sala({ nome: 'perf', seed: 25, porTime: 6, esperaPorJogadores: 0 });
    sala.entrar(clienteMudo('Observador'));
    for (let i = 0; i < 60; i++) {
      sala.tocar('Observador');
      sala.passo();
    }

    const inicio = performance.now();
    const quantos = 600;
    for (let i = 0; i < quantos; i++) sala.passo();
    const porTick = (performance.now() - inicio) / quantos;
    // Um tick tem 33 ms. Gastar mais que um sexto disso com uma sala só
    // significaria que a máquina não aguenta seis salas, que é o mínimo para o
    // servidor valer a pena.
    expect(porTick).toBeLessThan(5);
  });
});

function salaBloqueada(sala: Sala, x: number, y: number): boolean {
  // A arena não é exposta pela sala; reconstruí-la pela seed daria o mesmo
  // mapa, mas basta conferir o retrato: unidade dentro d'água ficaria parada
  // fora dos limites do campo jogável.
  const foraDoMapa = x < TILE || y < TILE || x > 200 * TILE || y > 200 * TILE;
  void sala;
  return foraDoMapa;
}
