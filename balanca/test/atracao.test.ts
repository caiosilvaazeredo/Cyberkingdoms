import { describe, expect, it } from 'vitest';

import { alvoDaAtracao, aproximar } from '../src/client/atracao';
import { princesaDe, type Estado } from '../src/shared/estado';
import { criarPartida } from '../src/shared/partida';
import { ARENA_ALTURA, ARENA_LARGURA, AQUECIMENTO, TICKS_POR_SEGUNDO, TILE } from '../src/shared/regras';

/**
 * A câmera do menu.
 *
 * Ela decide o que o jogo mostra para quem ainda não jogou — e é a primeira
 * impressão do jogo inteiro. Uma câmera que fica olhando um canto vazio do mapa
 * enquanto a princesa é carregada do outro lado não quebra nada; só faz o jogo
 * parecer morto para quem acabou de chegar, que é pior.
 */

function emJogo() {
  const partida = criarPartida(77);
  for (let i = 0; i < Math.ceil(AQUECIMENTO * TICKS_POR_SEGUNDO) + 2; i++) partida.passo();
  return partida;
}

const olhar = (estado: Estado | null) => alvoDaAtracao(estado, ARENA_LARGURA, ARENA_ALTURA);

describe('a câmera do modo atração', () => {
  it('sem partida, fica no meio do mapa', () => {
    const alvo = olhar(null);
    expect(alvo.motivo).toBe('centro');
    expect(alvo.x).toBeCloseTo((ARENA_LARGURA * TILE) / 2);
  });

  it('larga tudo para seguir o cortejo', () => {
    const partida = emJogo();
    const heroi = partida.entrar({ nome: 'H', bot: false, time: 'azul' });
    const minha = princesaDe(partida.estado, 'azul');
    minha.peso = 60;
    heroi.x = minha.x;
    heroi.y = minha.y;
    partida.comandar(heroi.id, { seq: 1, mx: 0, my: 0, ax: 0, ay: 0, atacar: false, usar: true });
    partida.passo();
    expect(minha.onde).toBe('carregada');

    const alvo = olhar(partida.estado);
    expect(alvo.motivo).toBe('cortejo');
    expect(Math.hypot(alvo.x - minha.x, alvo.y - minha.y)).toBeLessThan(1);
  });

  it('sem cortejo, procura o amontoado com os dois times', () => {
    const partida = emJogo();
    // Uma briga de dois no canto de cima…
    const a1 = partida.entrar({ nome: 'a1', bot: true, time: 'azul' });
    const v1 = partida.entrar({ nome: 'v1', bot: true, time: 'vermelho' });
    a1.x = 900;
    a1.y = 300;
    v1.x = 950;
    v1.y = 310;
    // …e uma fila de três do mesmo time no canto de baixo.
    for (let i = 0; i < 3; i++) {
      const u = partida.entrar({ nome: `a${i + 2}`, bot: true, time: 'azul' });
      u.x = 1800 + i * 20;
      u.y = 1600;
    }

    const alvo = olhar(partida.estado);
    expect(alvo.motivo).toBe('briga');
    // A briga ganha da fila: dois times misturados valem mais que três amigos.
    expect(Math.hypot(alvo.x - 925, alvo.y - 305)).toBeLessThan(120);
  });

  it('fila do mesmo time não é briga: a câmera abre para o campo', () => {
    const partida = emJogo();
    for (let i = 0; i < 5; i++) {
      const u = partida.entrar({ nome: `a${i}`, bot: true, time: 'azul' });
      u.x = 400 + i * 20;
      u.y = 1300;
    }
    const alvo = olhar(partida.estado);
    expect(alvo.motivo).toBe('campo');
  });

  it('a princesa caída no chão chama mais atenção que uma briga', () => {
    const partida = emJogo();
    const a1 = partida.entrar({ nome: 'a1', bot: true, time: 'azul' });
    const v1 = partida.entrar({ nome: 'v1', bot: true, time: 'vermelho' });
    a1.x = 900;
    a1.y = 300;
    v1.x = 940;
    v1.y = 300;
    const minha = princesaDe(partida.estado, 'azul');
    minha.onde = 'chao';
    minha.x = 1500;
    minha.y = 1200;

    const alvo = olhar(partida.estado);
    expect(alvo.motivo).toBe('princesa-no-chao');
    expect(alvo.x).toBe(1500);
  });
});

describe('a suavização', () => {
  it('chega perto do alvo sem saltar', () => {
    let camera = { x: 0, y: 0 };
    const alvo = { x: 1000, y: 0 };
    camera = aproximar(camera, alvo, 1 / 60);
    // Um quadro move pouco: nada de corte seco.
    expect(camera.x).toBeGreaterThan(0);
    expect(camera.x).toBeLessThan(80);

    for (let i = 0; i < 60 * 3; i++) camera = aproximar(camera, alvo, 1 / 60);
    expect(camera.x).toBeGreaterThan(950);
  });

  it('não depende da taxa de quadros', () => {
    // Dois segundos entregues em passos diferentes têm de chegar ao mesmo
    // lugar; sem a correção pelo `dt`, o monitor de 144 Hz chegaria antes.
    let lenta = { x: 0, y: 0 };
    let rapida = { x: 0, y: 0 };
    const alvo = { x: 600, y: 0 };
    for (let i = 0; i < 2 * 30; i++) lenta = aproximar(lenta, alvo, 1 / 30);
    for (let i = 0; i < 2 * 144; i++) rapida = aproximar(rapida, alvo, 1 / 144);
    expect(Math.abs(lenta.x - rapida.x)).toBeLessThan(5);
  });
});
