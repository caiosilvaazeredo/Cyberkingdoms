import { describe, expect, it } from 'vitest';

import { CLASSES_COM_CHAPEU } from '../src/shared/classes';
import { criarArena } from '../src/shared/arena';
import { IDS_DOS_MAPAS } from '../src/shared/mapas';
import { criarPartida, type Partida } from '../src/shared/partida';
import type { Evento } from '../src/shared/estado';
import { AQUECIMENTO, INVASAO_INTERVALO, INVASAO_TAMANHO, TICKS_POR_SEGUNDO, TILE, TIMES } from '../src/shared/regras';

/**
 * A invasão de goblins: chega perto da chapelaria, e some — roubada ou
 * afugentada.
 *
 * Os quatro testes cobrem as duas saídas e as duas garantias que evitam um
 * goblin preso para sempre: o aviso dispara antes da onda de verdade, e o
 * ponto onde ela nasce não é chão bloqueado em nenhum mapa da lista.
 */

/**
 * Avança a partida `segundos`, sem nenhum comando, e devolve todo evento que
 * apareceu no caminho.
 *
 * `estado.eventos` é zerado a cada `passo()` — "o servidor despacha e
 * esquece" — então um teste que rodasse cem ticks e só lesse o evento do
 * último veria só o do último. Aqui cada tick entrega o que tem antes do
 * próximo apagar.
 */
function passarSegundos(partida: Partida, segundos: number): Evento[] {
  const colhidos: Evento[] = [];
  for (let i = 0; i < segundos * TICKS_POR_SEGUNDO; i++) {
    partida.passo();
    colhidos.push(...partida.estado.eventos);
  }
  return colhidos;
}

/** A soma de todo chapéu em estoque, dos dois reinos. */
function totalDeChapeus(partida: Partida): number {
  return TIMES.reduce(
    (soma, t) => soma + CLASSES_COM_CHAPEU.reduce((s, c) => s + partida.estado.estoque[t][c], 0),
    0,
  );
}

/** Quantos segundos até o primeiro aviso, contados do começo da partida. */
const ATE_O_PRIMEIRO_AVISO = AQUECIMENTO + INVASAO_INTERVALO / 2;

describe('a invasão de goblins', () => {
  it('avisa antes de a onda chegar, para os dois reinos, uma vez só', () => {
    const partida = criarPartida(11);
    const eventos = passarSegundos(partida, ATE_O_PRIMEIRO_AVISO + 1);
    const avisos = eventos.filter((e) => e.tipo === 'invasaoAvisada');
    // Um por reino, e não mais — o aviso dispara no tick em que o relógio
    // cruza a marca, não em todo tick da janela.
    expect(avisos.length).toBe(TIMES.length);
    expect(new Set(avisos.map((e) => e.time))).toEqual(new Set(TIMES));
  });

  it('rouba um chapéu de cada reino quando ninguém defende', () => {
    const partida = criarPartida(11);
    passarSegundos(partida, ATE_O_PRIMEIRO_AVISO + 1);
    expect(partida.estado.invasores.length).toBe(INVASAO_TAMANHO * 2);

    const antes = totalDeChapeus(partida);
    // Os goblins nascem a poucos tiles da chapelaria; tempo de sobra para
    // cruzar isso na velocidade deles.
    const eventos = passarSegundos(partida, 4);

    expect(partida.estado.invasores.length).toBe(0);
    const roubos = eventos.filter((e) => e.tipo === 'invasaoRoubou');
    expect(roubos.length).toBe(INVASAO_TAMANHO * 2);
    const roubados = roubos.filter((e) => e.tipo === 'invasaoRoubou' && e.classe !== null).length;
    expect(totalDeChapeus(partida)).toBe(antes - roubados);
  });

  it('um jogador perto da chapelaria afugenta a onda, e o estoque não muda', () => {
    const partida = criarPartida(11);
    const chapelariaAzul = partida.arena.estrutura('chapelaria', 'azul');
    const u = partida.entrar({ nome: 'Guarda', bot: false, time: 'azul' });
    u.x = chapelariaAzul.x;
    u.y = chapelariaAzul.y;

    const estoqueAntes = { ...partida.estado.estoque.azul };
    const eventos = passarSegundos(partida, ATE_O_PRIMEIRO_AVISO + 5);

    const afugentados = eventos.filter(
      (e) => e.tipo === 'invasaoAfugentada' && e.time === 'azul',
    );
    expect(afugentados.length).toBeGreaterThanOrEqual(1);
    expect(partida.estado.estoque.azul).toEqual(estoqueAntes);
  });

  it('a onda inteira nasce com a mesma tocha — nunca metade tocha e metade não', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const partida = criarPartida(seed);
      passarSegundos(partida, ATE_O_PRIMEIRO_AVISO + 1);
      for (const time of TIMES) {
        const daOnda = partida.estado.invasores.filter((i) => i.time === time);
        expect(new Set(daOnda.map((i) => i.tocha)).size, `seed ${seed}/${time}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('de vez em quando, uma onda nasce em chamas — e na maioria das vezes não', () => {
    let comTocha = 0;
    let semTocha = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const partida = criarPartida(seed);
      passarSegundos(partida, ATE_O_PRIMEIRO_AVISO + 1);
      const azul = partida.estado.invasores.find((i) => i.time === 'azul');
      if (azul?.tocha) comTocha++;
      else semTocha++;
    }
    expect(comTocha).toBeGreaterThan(0);
    expect(semTocha).toBeGreaterThan(comTocha);
  });

  it('o evento de roubo carrega a mesma tocha do goblin que chegou', () => {
    // Procura uma seed cuja onda do Azul nasça em chamas — determinístico,
    // não sorte de execução.
    let seedComTocha: number | null = null;
    for (let seed = 1; seed <= 60; seed++) {
      const partida = criarPartida(seed);
      passarSegundos(partida, ATE_O_PRIMEIRO_AVISO + 1);
      if (partida.estado.invasores.find((i) => i.time === 'azul')?.tocha) {
        seedComTocha = seed;
        break;
      }
    }
    expect(seedComTocha).not.toBeNull();

    const partida = criarPartida(seedComTocha!);
    const eventos = passarSegundos(partida, ATE_O_PRIMEIRO_AVISO + 5);
    const roubos = eventos.filter((e) => e.tipo === 'invasaoRoubou' && e.time === 'azul');
    expect(roubos.length).toBeGreaterThan(0);
    expect(roubos.every((e) => e.tipo === 'invasaoRoubou' && e.tocha === true)).toBe(true);
  });

  it('nasce em chão livre, do lado de fora da própria chapelaria, em todo mapa', () => {
    for (const id of IDS_DOS_MAPAS) {
      const arena = criarArena(11, id);
      for (const time of TIMES) {
        const chapelaria = arena.estrutura('chapelaria', time);
        const ladoDeFora = time === 'azul' ? -1 : 1;
        const x = chapelaria.x + ladoDeFora * TILE * 3.5;
        const y = chapelaria.y;
        const tx = Math.floor(x / TILE);
        const ty = Math.floor(y / TILE);
        expect(arena.bloqueado(tx, ty), `${id}/${time}`).toBe(false);
      }
    }
  });
});
