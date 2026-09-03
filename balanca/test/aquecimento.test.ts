import { describe, expect, it } from 'vitest';

import { criarArena } from '../src/shared/arena';
import { IDS_DOS_MAPAS, MAPAS, MAPA_PADRAO } from '../src/shared/mapas';
import { criarPartida, type Partida } from '../src/shared/partida';
import type { Comando } from '../src/shared/protocolo';
import { AQUECIMENTO, TICKS_POR_SEGUNDO, TILE, TIMES } from '../src/shared/regras';

/**
 * A parede fechada do aquecimento, e a hora em que ela some.
 *
 * A promessa é a de um "champion select": todo mundo se prepara sem ver o que
 * o outro lado decidiu, e o apito liberta os dois de uma vez. Ela quebra de
 * dois jeitos, e os dois são silenciosos — a parede não segura ninguém, e o
 * time nunca aprende onde fica a própria chapelaria porque ela nasceu do lado
 * errado da parede.
 */

/**
 * A mesma conta de `fronteiraDoAquecimento`, refeita aqui.
 *
 * Não é reaproveitada porque é interna a `partida.ts` — só o tick precisa
 * dela. Refazê-la aqui é o preço de testar o comportamento de fora, e vale a
 * pena: se a fórmula real divergir desta, é porque a regra mudou sem querer,
 * e é exatamente isso que os quatro testes abaixo têm de acusar.
 */
function fronteira(idDoMapa: string, time: 'azul' | 'vermelho'): number {
  const mapa = MAPAS[idDoMapa as keyof typeof MAPAS];
  const portao = mapa.portoes[0];
  const colunaTx = portao ? portao.coluna : (mapa.largura - 1) / 2;
  const colunaMundo = (colunaTx + 0.5) * TILE;
  return time === 'azul' ? colunaMundo : mapa.largura * TILE - colunaMundo;
}

const correndo = (mx: number): Comando => ({
  seq: 1,
  mx,
  my: 0,
  ax: 0,
  ay: 0,
  atacar: false,
  usar: false,
});

/** Corre na direção dada por `segundos`, um comando por tick. */
function correrPor(partida: Partida, id: number, mx: number, segundos: number): void {
  const c = correndo(mx);
  for (let i = 0; i < segundos * TICKS_POR_SEGUNDO; i++) {
    partida.comandar(id, { ...c, seq: i });
    partida.passo();
  }
}

describe('a parede do aquecimento', () => {
  it('segura o azul do lado de cá do portão, correndo o aquecimento inteiro', () => {
    const partida = criarPartida(7);
    const u = partida.entrar({ nome: 'Azul', bot: false, time: 'azul' });
    expect(partida.estado.fase).toBe('aquecimento');

    // Corre para a direita — rumo ao inimigo — pelo aquecimento inteiro e um
    // pouco mais: se a parede vazasse, dez segundos de corrida bastam para
    // atravessar qualquer mapa da lista.
    correrPor(partida, u.id, 1, AQUECIMENTO + 2);

    expect(u.x).toBeLessThan(fronteira(MAPA_PADRAO, 'azul'));
  });

  it('segura o vermelho do lado de lá, na mesma partida', () => {
    const partida = criarPartida(7);
    const u = partida.entrar({ nome: 'Vermelho', bot: false, time: 'vermelho' });
    correrPor(partida, u.id, -1, AQUECIMENTO + 2);

    expect(u.x).toBeGreaterThan(fronteira(MAPA_PADRAO, 'vermelho'));
  });

  it('some assim que o apito toca: o mesmo comando cruza para o outro lado', () => {
    const partida = criarPartida(7);
    const u = partida.entrar({ nome: 'Azul', bot: false, time: 'azul' });
    // Alinhado com uma ponte: sem isto, o fosso do próprio mapa barraria a
    // travessia por conta própria, e o teste não saberia dizer se foi a
    // parede do aquecimento que segurou ou a água — que é a mesma confusão
    // que a parede existe para não causar do lado de dentro.
    u.y = 10.5 * TILE;

    // Ainda no aquecimento: empurra contra a parede e vê que ela segura.
    correrPor(partida, u.id, 1, AQUECIMENTO - 1);
    const limite = fronteira(MAPA_PADRAO, 'azul');
    expect(u.x).toBeLessThan(limite);

    // Passa o apito. O mesmo comando, sem soltar o botão, agora atravessa —
    // pouco mais de um segundo de corrida já basta, porque a parede é a
    // mesma linha que acabou de segurar, não o mapa inteiro.
    correrPor(partida, u.id, 1, 2);
    expect(partida.estado.fase).toBe('jogando');
    expect(u.x).toBeGreaterThan(limite);
  });

  it('a chapelaria do próprio time está sempre do lado de cá da parede', () => {
    // A regressão que este teste existe para prevenir: uma parede desenhada
    // como um raio em torno do ninho prendia o aquecimento — que é para
    // trocar de chapéu — do lado de fora da chapelaria em qualquer mapa onde
    // ela não fica colada ao ninho. Aqui a parede é a coluna do portão, e
    // isso é o que garante que a chapelaria nunca fica presa lá fora.
    for (const id of IDS_DOS_MAPAS) {
      const arena = criarArena(1, id);
      for (const time of TIMES) {
        const chapelaria = arena.estrutura('chapelaria', time);
        const limite = fronteira(id, time);
        if (time === 'azul') {
          expect(chapelaria.x, `${id}/${time}`).toBeLessThan(limite);
        } else {
          expect(chapelaria.x, `${id}/${time}`).toBeGreaterThan(limite);
        }
      }
    }
  });
});
