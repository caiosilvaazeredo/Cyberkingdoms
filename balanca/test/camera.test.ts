import { describe, expect, it } from 'vitest';

import { PADROES } from '../src/client/ajustes';
import { criarCamera, enquadrarGrupo } from '../src/client/desenho';
import { criarArena } from '../src/shared/arena';
import { TILE } from '../src/shared/regras';

/**
 * A câmera de sofá.
 *
 * Numa tela compartilhada, a câmera é a regra do jogo que ninguém escreve: se
 * ela seguir só o primeiro jogador, os outros três jogam às cegas. Estas
 * asserções são chatas de escrever e impossíveis de perceber no olho — a
 * diferença entre "abriu o bastante" e "quase" só aparece quando alguém
 * reclama que sumiu da tela.
 */

const arena = criarArena(77);
const LARGURA = 1280;
const ALTURA = 720;

describe('enquadrar o grupo', () => {
  it('centra no meio do grupo, e não no primeiro jogador', () => {
    const camera = criarCamera();
    const a = { x: 20 * TILE, y: 16 * TILE };
    const b = { x: 26 * TILE, y: 16 * TILE };
    enquadrarGrupo(camera, arena, [a, b], LARGURA, ALTURA, PADROES);
    expect(camera.x).toBeCloseTo(23 * TILE);
  });

  it('abre a vista quando o grupo se espalha', () => {
    const camera = criarCamera();
    const juntos = criarCamera();
    enquadrarGrupo(
      juntos,
      arena,
      [
        { x: 20 * TILE, y: 16 * TILE },
        { x: 21 * TILE, y: 16 * TILE },
      ],
      LARGURA,
      ALTURA,
      PADROES,
    );
    enquadrarGrupo(
      camera,
      arena,
      [
        { x: 14 * TILE, y: 16 * TILE },
        { x: 44 * TILE, y: 16 * TILE },
      ],
      LARGURA,
      ALTURA,
      PADROES,
    );
    expect(camera.zoom).toBeLessThan(juntos.zoom);
  });

  it('para de abrir num limite, e aí diz quem ficou de fora', () => {
    const camera = criarCamera();
    // Numa tela estreita — um celular deitado no colo de duas pessoas — dois
    // cantos opostos do mapa não cabem de jeito nenhum. A resposta certa não é
    // encolher o jogo até o boneco virar um pixel: é parar de abrir e apontar.
    const fora = enquadrarGrupo(
      camera,
      arena,
      [
        { x: 3 * TILE, y: 3 * TILE },
        { x: 56 * TILE, y: 30 * TILE },
      ],
      420,
      280,
      PADROES,
    );
    expect(camera.zoom).toBeGreaterThanOrEqual(0.3);
    expect(fora.length).toBeGreaterThan(0);
  });

  it('numa tela de computador, o mapa inteiro cabe e ninguém fica de fora', () => {
    const camera = criarCamera();
    const fora = enquadrarGrupo(
      camera,
      arena,
      [
        { x: 3 * TILE, y: 3 * TILE },
        { x: 56 * TILE, y: 30 * TILE },
      ],
      LARGURA,
      ALTURA,
      PADROES,
    );
    expect(fora).toEqual([]);
  });

  it('não mostra o lado de fora do mapa depois de abrir', () => {
    const camera = criarCamera();
    enquadrarGrupo(
      camera,
      arena,
      [
        { x: 2 * TILE, y: 2 * TILE },
        { x: 10 * TILE, y: 10 * TILE },
      ],
      LARGURA,
      ALTURA,
      PADROES,
    );
    // Reabrir o zoom muda quanto de mundo cabe: sem prender a câmera de novo, a
    // borda do mapa entraria em quadro e o jogo mostraria o vazio.
    expect(camera.x - LARGURA / 2 / camera.zoom).toBeGreaterThanOrEqual(-0.001);
    expect(camera.y - ALTURA / 2 / camera.zoom).toBeGreaterThanOrEqual(-0.001);
  });

  it('com uma pessoa só, é a câmera de sempre', () => {
    const grupo = criarCamera();
    const solo = criarCamera();
    const onde = { x: 30 * TILE, y: 17 * TILE };
    enquadrarGrupo(grupo, arena, [onde], LARGURA, ALTURA, PADROES);
    enquadrarGrupo(solo, arena, [onde], LARGURA, ALTURA, PADROES);
    expect(grupo).toEqual(solo);
    expect(grupo.zoom).toBeGreaterThan(0.3);
  });
});
