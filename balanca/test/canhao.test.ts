import { describe, expect, it } from 'vitest';

import { canhaoDe, criarArena, PONTE } from '../src/shared/arena';
import { IDS_DOS_MAPAS } from '../src/shared/mapas';
import { criarPartida, type Partida } from '../src/shared/partida';
import { AQUECIMENTO, CANHAO_CADENCIA, TICKS_POR_SEGUNDO, TILE, TIMES } from '../src/shared/regras';

/**
 * O canhão de cerco: fica parado perto da própria tesouraria e atira em quem
 * do outro time se aproxima demais — mas nunca mata, porque não há
 * atirador nenhum para carregar o abate.
 */

function passarSegundos(partida: Partida, segundos: number): void {
  for (let i = 0; i < segundos * TICKS_POR_SEGUNDO; i++) partida.passo();
}

describe('o canhão de cerco', () => {
  it('atira em quem do outro time chega perto, e nunca derruba', () => {
    const partida = criarPartida(21);
    const posto = canhaoDe(partida.arena, 'azul');
    const alvo = partida.entrar({ nome: 'Alvo', bot: false, time: 'vermelho' });
    // Passa do aquecimento antes de posicionar: a parede da zona de
    // aquecimento empurra quem do outro time tenta ficar do lado errado, e
    // colocaria o alvo de volta longe do canhão antes de qualquer disparo.
    passarSegundos(partida, AQUECIMENTO + 0.1);
    alvo.x = posto.x;
    alvo.y = posto.y;
    alvo.vida = 5; // menos do que o dano do canhão: se ele matasse, morreria aqui.

    passarSegundos(partida, CANHAO_CADENCIA + 2);

    // A bala nasce e é consumida no mesmo punhado de ticks — parado bem em
    // cima do posto, a distância é zero — então o que prova o disparo não é
    // achar a bala viva no retrato, é a vida do alvo tendo descido exatamente
    // até o piso: 5 de vida menos um dano maior que 5, gravado em 1.
    expect(alvo.vida).toBe(1);
    expect(alvo.vivo).toBe(true);
  });

  it('não atira no próprio time', () => {
    const partida = criarPartida(21);
    const posto = canhaoDe(partida.arena, 'azul');
    const amigo = partida.entrar({ nome: 'Amigo', bot: false, time: 'azul' });
    passarSegundos(partida, AQUECIMENTO + 0.1);
    amigo.x = posto.x;
    amigo.y = posto.y;
    const vidaAntes = amigo.vida;

    passarSegundos(partida, CANHAO_CADENCIA * 2);

    expect(partida.estado.projeteis.some((p) => p.tipo === 'bolaDeCanhao')).toBe(false);
    expect(amigo.vida).toBe(vidaAntes);
    expect(amigo.vivo).toBe(true);
  });

  it('recarrega a cadência inteira depois de atirar, e não volta a zerar cedo demais', () => {
    const partida = criarPartida(21);
    const posto = canhaoDe(partida.arena, 'azul');
    const alvo = partida.entrar({ nome: 'Alvo', bot: false, time: 'vermelho' });
    passarSegundos(partida, AQUECIMENTO + 0.1);
    alvo.x = posto.x;
    alvo.y = posto.y;

    // A recarga nasce na metade da cadência; um pouco além disso, contado a
    // partir do fim do aquecimento, é depois do primeiro disparo esperado.
    passarSegundos(partida, CANHAO_CADENCIA / 2 + 0.5);
    const canhao = partida.estado.canhoes.find((c) => c.time === 'azul')!;
    expect(canhao.recarga).toBeGreaterThan(CANHAO_CADENCIA - 1);

    // Um segundo depois, ainda contando — não disparou de novo tão cedo.
    passarSegundos(partida, 1);
    expect(canhao.recarga).toBeGreaterThan(CANHAO_CADENCIA - 3);
  });

  it('nasce em chão seco e sem ponte, perto da própria tesouraria, em todo mapa', () => {
    for (const id of IDS_DOS_MAPAS) {
      const arena = criarArena(21, id);
      for (const time of TIMES) {
        const posto = canhaoDe(arena, time);
        const tx = Math.floor(posto.x / TILE);
        const ty = Math.floor(posto.y / TILE);
        expect(arena.ehChao(tx, ty), `${id}/${time}`).toBe(true);
        expect(arena.tile(tx, ty), `${id}/${time}`).not.toBe(PONTE);
      }
    }
  });
});
