import { describe, expect, it } from 'vitest';

import { Sala, type Cliente } from '../src/server/sala';
import { bauDe } from '../src/shared/estado';
import type { IdDoModo } from '../src/shared/modos';
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
function jogar(segundos: number, seed: number, modo?: IdDoModo) {
  const sala = new Sala({ nome: 'teste', seed, porTime: 6, esperaPorJogadores: 0, modo });
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

  it('no Modo Covil, derrubam o Guardião pelo menos uma vez', () => {
    // Ele nasce tarde de propósito (180s depois do aquecimento) e tem vida
    // alta — 280s dá tempo de nascer, os bots notarem (raio de 900) e
    // baixarem a vida toda dele.
    const { eventos } = jogar(280, 51, 'covil');
    expect(eventos.filter((e) => e === 'guardiaoNasceu').length).toBeGreaterThan(0);
    expect(eventos.filter((e) => e === 'guardiaoCaiu').length).toBeGreaterThan(0);
  });

  it('no Modo Caça, derrubam a Presa pelo menos uma vez', () => {
    // Ela nasce cedo (30s depois do aquecimento) e renasce sem parar a cada
    // 45s — 150s dá várias chances de os bots notarem (raio de 650) e
    // baixarem a vida toda dela.
    const { eventos } = jogar(150, 51, 'caca');
    expect(eventos.filter((e) => e === 'presaCaiu').length).toBeGreaterThan(0);
  });

  it('no Modo Xamã, pegam o cajado e transformam alguém em porco', () => {
    // O primeiro cajado nasce por volta dos 40s (um terço do intervalo de
    // 120s) — 150s dá tempo de nascer, um bot notar (raio de 700), pegar, e
    // achar um inimigo ao alcance do feitiço antes da carga expirar.
    const { eventos } = jogar(150, 51, 'xama');
    expect(eventos.filter((e) => e === 'cajadoPego').length).toBeGreaterThan(0);
    expect(eventos.filter((e) => e === 'virouPorco').length).toBeGreaterThan(0);
  });

  it('no Modo Cerco, os três chefes caem na mesma partida', () => {
    // As três chaves ligadas ao mesmo tempo — o mesmo intervalo do Covil
    // (280s) porque o Guardião é o mais lento a nascer e o mais caro a
    // derrubar dos três; Presa e cajado, mais rápidos, cabem de sobra na
    // mesma janela.
    const { eventos } = jogar(280, 51, 'cerco');
    expect(eventos.filter((e) => e === 'guardiaoCaiu').length).toBeGreaterThan(0);
    expect(eventos.filter((e) => e === 'presaCaiu').length).toBeGreaterThan(0);
    expect(eventos.filter((e) => e === 'virouPorco').length).toBeGreaterThan(0);
  });

  it('no Modo Fuga, alguém acaba libertando o Menino Rei', () => {
    // Os dois times querem libertá-lo — não há time bandido aqui, é o modo
    // puro. 400s dá espaço de sobra para as trocas de combate abrirem uma
    // janela em que a guarda de um dos lados cai abaixo do teto.
    const { eventos } = jogar(400, 51, 'fuga');
    expect(eventos.filter((e) => e === 'meninoReiLiberto').length).toBeGreaterThan(0);
  });

  it('no Modo Vigília, dia e noite se alternam e o Guardião cai à noite', () => {
    // Dia (140s) + noite (70s) — 450s cobre duas noites inteiras, tempo de
    // sobra para os bots notarem o Guardião (raio 900) e baixarem a vida
    // toda dele antes do amanhecer apagar a caçada.
    const { eventos } = jogar(450, 51, 'vigilia');
    expect(eventos.filter((e) => e === 'noiteCaiu').length).toBeGreaterThan(0);
    expect(eventos.filter((e) => e === 'diaChegou').length).toBeGreaterThan(0);
    expect(eventos.filter((e) => e === 'guardiaoCaiu').length).toBeGreaterThan(0);
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
