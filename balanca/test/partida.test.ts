import { beforeEach, describe, expect, it } from 'vitest';

import { bauDe, type Unidade } from '../src/shared/estado';
import { vidaMaxima } from '../src/shared/classes';
import { criarPartida, moverUnidade, type Partida } from '../src/shared/partida';
import type { Comando } from '../src/shared/protocolo';
import {
  ALCANCE_DE_AJUDA,
  ANIMAL_VIDA,
  AQUECIMENTO,
  MINERIO_POR_BOLSA,
  CUSTO_DO_NIVEL,
  DT,
  PONTOS_PARA_VENCER,
  TEMPO_DE_CUNHAGEM,
  TEMPO_DE_TRABALHO,
  TICKS_POR_SEGUNDO,
} from '../src/shared/regras';

const parado: Comando = { seq: 0, mx: 0, my: 0, ax: 0, ay: 0, atacar: false, usar: false };

function emJogo(): Partida {
  const partida = criarPartida(11);
  for (let i = 0; i < Math.ceil(AQUECIMENTO * TICKS_POR_SEGUNDO) + 2; i++) partida.passo();
  return partida;
}

function usar(partida: Partida, id: number): void {
  partida.comandar(id, { ...parado, seq: 1, usar: true });
  partida.passo();
  partida.comandar(id, { ...parado, seq: 2, usar: false });
  partida.passo();
}

function em(u: Unidade, ponto: { x: number; y: number }): void {
  u.x = ponto.x;
  u.y = ponto.y;
}

describe('o resgate', () => {
  let partida: Partida;
  let heroi: Unidade;

  beforeEach(() => {
    partida = emJogo();
    heroi = partida.entrar({ nome: 'Herói', bot: false, time: 'azul' });
  });

  it('pega o próprio baú no cofre inimiga', () => {
    const minha = bauDe(partida.estado, 'azul');
    em(heroi, minha);
    usar(partida, heroi.id);
    expect(heroi.carga).toBe('bau');
    expect(minha.onde).toBe('carregado');
    expect(minha.portador).toBe(heroi.id);
  });

  it('não sequestra a bau inimiga: ela não é para carregar', () => {
    const refem = bauDe(partida.estado, 'vermelho');
    em(heroi, refem);
    usar(partida, heroi.id);
    expect(heroi.carga).not.toBe('bau');
    expect(refem.onde).toBe('cofre');
  });

  it('sem escolta suficiente, o cortejo não sai do lugar', () => {
    const minha = bauDe(partida.estado, 'azul');
    minha.peso = 100; // dois carregadores
    em(heroi, minha);
    usar(partida, heroi.id);

    const antes = { x: heroi.x, y: heroi.y };
    for (let i = 0; i < 20; i++) {
      partida.comandar(heroi.id, { ...parado, seq: 10 + i, mx: -1 });
      partida.passo();
    }
    expect(Math.hypot(heroi.x - antes.x, heroi.y - antes.y)).toBeLessThan(1);

    // Um companheiro encostado destrava o peso.
    const ajudante = partida.entrar({ nome: 'Ajuda', bot: false, time: 'azul' });
    em(ajudante, { x: heroi.x + ALCANCE_DE_AJUDA * 0.5, y: heroi.y });
    for (let i = 0; i < 20; i++) {
      partida.comandar(heroi.id, { ...parado, seq: 40 + i, mx: -1 });
      partida.passo();
    }
    expect(Math.hypot(heroi.x - antes.x, heroi.y - antes.y)).toBeGreaterThan(20);
  });

  it('entregar no tesouraria vale um ponto e reinicia a rodada', () => {
    const minha = bauDe(partida.estado, 'azul');
    minha.peso = 60; // um carregador basta
    em(heroi, minha);
    usar(partida, heroi.id);
    expect(heroi.carga).toBe('bau');

    em(heroi, partida.arena.estrutura('tesouraria', 'azul'));
    usar(partida, heroi.id);

    expect(partida.estado.placar.azul).toBe(1);
    expect(heroi.resgates).toBe(1);
    expect(partida.estado.fase).toBe('ponto');
  });

  it('a partida acaba quando um reino chega aos pontos combinados', () => {
    for (let ponto = 0; ponto < PONTOS_PARA_VENCER; ponto++) {
      const minha = bauDe(partida.estado, 'azul');
      minha.peso = 60;
      minha.onde = 'cofre';
      em(heroi, minha);
      usar(partida, heroi.id);
      em(heroi, partida.arena.estrutura('tesouraria', 'azul'));
      usar(partida, heroi.id);
      // Deixa a pausa entre pontos passar.
      for (let i = 0; i < 5 * TICKS_POR_SEGUNDO; i++) partida.passo();
    }
    expect(partida.estado.fase).toBe('fim');
    expect(partida.estado.vencedor).toBe('azul');
  });

  it('quem morre carregando a bau a deixa cair', () => {
    const minha = bauDe(partida.estado, 'azul');
    minha.peso = 60;
    em(heroi, minha);
    usar(partida, heroi.id);

    const carrasco = partida.entrar({ nome: 'Carrasco', bot: false, time: 'vermelho' });
    carrasco.classe = 'guerreiro';
    em(carrasco, { x: heroi.x - 30, y: heroi.y });
    carrasco.olharX = 1;
    carrasco.olharY = 0;
    for (let i = 0; i < 300 && heroi.vivo; i++) {
      partida.comandar(carrasco.id, { ...parado, seq: 100 + i, ax: 1, atacar: true });
      partida.passo();
    }
    expect(heroi.vivo).toBe(false);
    expect(bauDe(partida.estado, 'azul').onde).toBe('chao');
  });
});

describe('os ofícios', () => {
  it('o lenhador tira madeira e a entrega na obra', () => {
    const partida = emJogo();
    const lenhador = partida.entrar({ nome: 'Lenhador', bot: false, time: 'azul' });
    lenhador.classe = 'lenhador';

    const arvore = partida.arena.jazidas.find((j) => j.tipo === 'arvore' && j.lado === 'azul')!;
    em(lenhador, arvore);
    usar(partida, lenhador.id);
    expect(lenhador.colhendoId).toBe(arvore.id);
    for (let i = 0; i < Math.ceil(TEMPO_DE_TRABALHO / DT) + 2; i++) partida.passo();
    expect(lenhador.carga).toBe('madeira');
    // A árvore virou toco e leva um tempo para rebrotar.
    expect(partida.estado.jazidas.find((j) => j.id === arvore.id)!.cheia).toBe(false);

    em(lenhador, partida.arena.estrutura('chapelaria', 'azul'));
    usar(partida, lenhador.id);
    expect(lenhador.carga).toBe('nada');
    expect(partida.estado.oficinas.find((o) => o.time === 'azul')!.madeira).toBe(1);
  });

  it('o minerador tira ouro, e o aldeão faz o mesmo trabalho mais devagar', () => {
    const partida = emJogo();
    const veia = partida.arena.jazidas.find((j) => j.tipo === 'ouro' && j.lado === 'azul')!;

    const minerador = partida.entrar({ nome: 'Minerador', bot: false, time: 'azul' });
    minerador.classe = 'minerador';
    em(minerador, veia);
    usar(partida, minerador.id);
    let ticksDoMinerador = 0;
    while (minerador.carga === 'nada' && ticksDoMinerador < 600) {
      partida.passo();
      ticksDoMinerador++;
    }
    expect(minerador.carga).toBe('ouro');

    // Mesma jazida, agora com um aldeão. Ela precisa estar cheia de novo.
    const jazida = partida.estado.jazidas.find((j) => j.id === veia.id)!;
    jazida.cheia = true;
    const aldeao = partida.entrar({ nome: 'Aldeão', bot: false, time: 'azul' });
    em(aldeao, veia);
    usar(partida, aldeao.id);
    let ticksDoAldeao = 0;
    while (aldeao.carga === 'nada' && ticksDoAldeao < 600) {
      partida.passo();
      ticksDoAldeao++;
    }
    expect(aldeao.carga).toBe('ouro');
    // O especialista é claramente mais rápido — é o que justifica o chapéu.
    expect(ticksDoAldeao).toBeGreaterThan(ticksDoMinerador * 1.4);
  });

  it('a obra sobe de nível e engorda o time', () => {
    const partida = emJogo();
    const u = partida.entrar({ nome: 'Obreiro', bot: false, time: 'azul' });
    const oficina = partida.estado.oficinas.find((o) => o.time === 'azul')!;
    const custo = CUSTO_DO_NIVEL[2]!;
    const chapelaria = partida.arena.estrutura('chapelaria', 'azul');

    for (let i = 0; i < custo.madeira; i++) {
      u.carga = 'madeira';
      em(u, chapelaria);
      usar(partida, u.id);
    }
    expect(oficina.nivel).toBe(1);
    for (let i = 0; i < custo.ouro; i++) {
      u.carga = 'ouro';
      em(u, chapelaria);
      usar(partida, u.id);
    }
    // Os dois materiais juntos é o que sobe a obra: um ofício só não levanta.
    expect(oficina.nivel).toBe(2);
    expect(vidaMaxima('guerreiro', 2)).toBeGreaterThan(vidaMaxima('guerreiro', 1));
  });

  it('só se tira minerio matando o bicho', () => {
    const partida = emJogo();
    const saqueador = partida.entrar({ nome: 'Saqueador', bot: false, time: 'azul' });
    saqueador.classe = 'saqueador';
    const bicho = partida.estado.animais[0]!;
    em(saqueador, { x: bicho.x - 30, y: bicho.y });

    // Apertar "usar" na frente do bicho não faz nada: caça não é barra de
    // progresso.
    usar(partida, saqueador.id);
    expect(saqueador.colhendoId).toBeNull();
    expect(saqueador.carga).toBe('nada');

    for (let i = 0; i < 400 && bicho.vivo; i++) {
      const dx = bicho.x - saqueador.x;
      const dy = bicho.y - saqueador.y;
      const d = Math.hypot(dx, dy) || 1;
      // Corre atrás: o bicho foge quando apanha.
      em(saqueador, { x: bicho.x - (dx / d) * 30, y: bicho.y - (dy / d) * 30 });
      partida.comandar(saqueador.id, { ...parado, seq: 500 + i, ax: dx / d, ay: dy / d, atacar: true });
      partida.passo();
    }
    expect(bicho.vivo).toBe(false);
    const minerio = partida.estado.itens.find((i) => i.tipo === 'minerio');
    expect(minerio).toBeDefined();

    em(saqueador, minerio!);
    usar(partida, saqueador.id);
    expect(saqueador.carga).toBe('minerio');

    em(saqueador, partida.arena.estrutura('casaDaMoeda', 'azul'));
    usar(partida, saqueador.id);
    expect(partida.estado.casasDaMoeda.find((c) => c.time === 'azul')!.minerio).toBe(1);
  });

  it('o saqueador derruba o bicho mais rápido que um guerreiro', () => {
    const golpesDo = (classe: 'saqueador' | 'guerreiro'): number => {
      const partida = emJogo();
      const u = partida.entrar({ nome: classe, bot: false, time: 'azul' });
      u.classe = classe;
      const bicho = partida.estado.animais[0]!;
      bicho.vida = ANIMAL_VIDA;
      let golpes = 0;
      for (let i = 0; i < 900 && bicho.vivo; i++) {
        em(u, { x: bicho.x - 30, y: bicho.y });
        const antes = bicho.vida;
        partida.comandar(u.id, { ...parado, seq: 900 + i, ax: 1, ay: 0, atacar: true });
        partida.passo();
        if (bicho.vida < antes) golpes++;
      }
      return golpes;
    };
    expect(golpesDo('saqueador')).toBeLessThan(golpesDo('guerreiro'));
  });

  it('a minerio vira bolsa no forno', () => {
    const partida = emJogo();
    const u = partida.entrar({ nome: 'U', bot: false, time: 'azul' });
    const casaDaMoeda = partida.arena.estrutura('casaDaMoeda', 'azul');
    const forno = partida.estado.casasDaMoeda.find((c) => c.time === 'azul')!;
    forno.bolsas = 0;

    for (let i = 0; i < MINERIO_POR_BOLSA; i++) {
      u.carga = 'minerio';
      em(u, casaDaMoeda);
      usar(partida, u.id);
    }
    for (let i = 0; i < Math.ceil(TEMPO_DE_CUNHAGEM / DT) + 4; i++) partida.passo();
    expect(forno.bolsas).toBe(1);

    usar(partida, u.id);
    expect(u.carga).toBe('bolsa');
  });

  it('andar cancela o trabalho — ofício é ficar exposto', () => {
    const partida = emJogo();
    const lenhador = partida.entrar({ nome: 'L', bot: false, time: 'azul' });
    lenhador.classe = 'lenhador';
    em(lenhador, partida.arena.jazidas[0]!);
    usar(partida, lenhador.id);
    expect(lenhador.colhendoId).not.toBeNull();

    partida.comandar(lenhador.id, { ...parado, seq: 9, mx: 1 });
    partida.passo();
    expect(lenhador.colhendoId).toBeNull();
    expect(lenhador.carga).toBe('nada');
  });
});

describe('a lança', () => {
  it('fura a fila: atinge todos na linha', () => {
    const partida = emJogo();
    const lanceiro = partida.entrar({ nome: 'Lanceiro', bot: false, time: 'azul' });
    lanceiro.classe = 'lanceiro';
    const perto = partida.entrar({ nome: 'Perto', bot: false, time: 'vermelho' });
    const longe = partida.entrar({ nome: 'Longe', bot: false, time: 'vermelho' });
    em(lanceiro, { x: 600, y: 600 });
    em(perto, { x: 640, y: 600 });
    em(longe, { x: 690, y: 600 });
    const vidas = [perto.vida, longe.vida];

    partida.comandar(lanceiro.id, { ...parado, seq: 1, ax: 1, ay: 0, atacar: true });
    partida.passo();
    // Os dois apanham no mesmo golpe: é o que faz o lanceiro segurar uma ponte.
    expect(perto.vida).toBeLessThan(vidas[0]!);
    expect(longe.vida).toBeLessThan(vidas[1]!);
  });

  it('não atinge quem está fora do corredor', () => {
    const partida = emJogo();
    const lanceiro = partida.entrar({ nome: 'Lanceiro', bot: false, time: 'azul' });
    lanceiro.classe = 'lanceiro';
    const aoLado = partida.entrar({ nome: 'AoLado', bot: false, time: 'vermelho' });
    em(lanceiro, { x: 600, y: 600 });
    em(aoLado, { x: 640, y: 680 });
    const antes = aoLado.vida;
    partida.comandar(lanceiro.id, { ...parado, seq: 1, ax: 1, ay: 0, atacar: true });
    partida.passo();
    expect(aoLado.vida).toBe(antes);
  });
});

describe('os chapéus', () => {
  it('a chapelaria dá o próximo chapéu do estoque e desconta', () => {
    const partida = emJogo();
    const u = partida.entrar({ nome: 'U', bot: false, time: 'azul' });
    em(u, partida.arena.estrutura('chapelaria', 'azul'));
    const antes = partida.estado.estoque.azul.guerreiro;
    usar(partida, u.id);
    expect(u.classe).toBe('guerreiro');
    expect(partida.estado.estoque.azul.guerreiro).toBe(antes - 1);
  });

  it('cai no chão quando o dono morre, e o inimigo pode vesti-lo', () => {
    const partida = emJogo();
    const vitima = partida.entrar({ nome: 'V', bot: false, time: 'azul' });
    em(vitima, partida.arena.estrutura('chapelaria', 'azul'));
    usar(partida, vitima.id);
    expect(vitima.classe).toBe('guerreiro');
    const estoqueDepoisDeVestir = partida.estado.estoque.azul.guerreiro;

    const algoz = partida.entrar({ nome: 'A', bot: false, time: 'vermelho' });
    algoz.classe = 'guerreiro';
    em(algoz, { x: vitima.x - 30, y: vitima.y });
    for (let i = 0; i < 300 && vitima.vivo; i++) {
      partida.comandar(algoz.id, { ...parado, seq: 200 + i, ax: 1, atacar: true });
      partida.passo();
    }
    expect(vitima.vivo).toBe(false);
    expect(vitima.classe).toBe('aldeao');

    const chapeu = partida.estado.itens.find((i) => i.tipo === 'chapeu');
    expect(chapeu).toBeDefined();
    expect(chapeu!.origem).toBe('azul');

    em(algoz, chapeu!);
    usar(partida, algoz.id);
    expect(algoz.classe).toBe('guerreiro');
    // O chapéu não voltou para o estoque azul: está na cabeça do inimigo, e o
    // time que o perdeu só o recupera matando quem o roubou.
    expect(partida.estado.estoque.azul.guerreiro).toBe(estoqueDepoisDeVestir);
  });

  it('o chapéu esquecido no chão volta para a chapelaria de origem', () => {
    const partida = emJogo();
    const u = partida.entrar({ nome: 'U', bot: false, time: 'azul' });
    em(u, partida.arena.estrutura('chapelaria', 'azul'));
    usar(partida, u.id);
    expect(u.classe).toBe('guerreiro');
    const antes = partida.estado.estoque.azul.guerreiro;

    const algoz = partida.entrar({ nome: 'A', bot: false, time: 'vermelho' });
    algoz.classe = 'guerreiro';
    em(algoz, { x: u.x - 30, y: u.y });
    for (let i = 0; i < 300 && u.vivo; i++) {
      partida.comandar(algoz.id, { ...parado, seq: 300 + i, ax: 1, atacar: true });
      partida.passo();
    }
    expect(partida.estado.itens.some((i) => i.tipo === 'chapeu')).toBe(true);
    for (let i = 0; i < 30 * TICKS_POR_SEGUNDO; i++) partida.passo();
    expect(partida.estado.itens.some((i) => i.tipo === 'chapeu')).toBe(false);
    expect(partida.estado.estoque.azul.guerreiro).toBe(antes + 1);
  });
});

describe('o movimento', () => {
  it('não atravessa a água', () => {
    const partida = criarPartida(3);
    const u = partida.entrar({ nome: 'U', bot: false, time: 'azul' });
    // Empurra para o oeste por dez segundos: lá está a moldura de água.
    for (let i = 0; i < 10 * TICKS_POR_SEGUNDO; i++) {
      moverUnidade(partida.arena, partida.estado, u, { ...parado, mx: -1 }, DT);
    }
    expect(partida.arena.bloqueado(Math.floor(u.x / 64), Math.floor(u.y / 64))).toBe(false);
  });

  it('a mira manda no olhar, e não o movimento', () => {
    const partida = criarPartida(3);
    const u = partida.entrar({ nome: 'U', bot: false, time: 'azul' });
    moverUnidade(partida.arena, partida.estado, u, { ...parado, mx: -1, ax: 1, ay: 0 }, DT);
    expect(u.olharX).toBeCloseTo(1);
  });
});
