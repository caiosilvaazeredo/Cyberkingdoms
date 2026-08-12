import { beforeEach, describe, expect, it } from 'vitest';

import { princesaDe, type Unidade } from '../src/shared/estado';
import { criarPartida, moverUnidade, type Partida } from '../src/shared/partida';
import type { Comando } from '../src/shared/protocolo';
import {
  ALCANCE_DE_AJUDA,
  AQUECIMENTO,
  DT,
  PONTOS_PARA_VENCER,
  TEMPO_DE_COLHEITA,
  TEMPO_DE_FORNO,
  TICKS_POR_SEGUNDO,
  TRIGO_POR_BOLO,
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

  it('pega a própria princesa na masmorra inimiga', () => {
    const minha = princesaDe(partida.estado, 'azul');
    em(heroi, minha);
    usar(partida, heroi.id);
    expect(heroi.carga).toBe('princesa');
    expect(minha.onde).toBe('carregada');
    expect(minha.portador).toBe(heroi.id);
  });

  it('não sequestra a princesa inimiga: ela não é para carregar', () => {
    const refem = princesaDe(partida.estado, 'vermelho');
    em(heroi, refem);
    usar(partida, heroi.id);
    expect(heroi.carga).not.toBe('princesa');
    expect(refem.onde).toBe('jaula');
  });

  it('sem escolta suficiente, o cortejo não sai do lugar', () => {
    const minha = princesaDe(partida.estado, 'azul');
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

  it('entregar no trono vale um ponto e reinicia a rodada', () => {
    const minha = princesaDe(partida.estado, 'azul');
    minha.peso = 60; // um carregador basta
    em(heroi, minha);
    usar(partida, heroi.id);
    expect(heroi.carga).toBe('princesa');

    em(heroi, partida.arena.estrutura('trono', 'azul'));
    usar(partida, heroi.id);

    expect(partida.estado.placar.azul).toBe(1);
    expect(heroi.resgates).toBe(1);
    expect(partida.estado.fase).toBe('ponto');
  });

  it('a partida acaba quando um reino chega aos pontos combinados', () => {
    for (let ponto = 0; ponto < PONTOS_PARA_VENCER; ponto++) {
      const minha = princesaDe(partida.estado, 'azul');
      minha.peso = 60;
      minha.onde = 'jaula';
      em(heroi, minha);
      usar(partida, heroi.id);
      em(heroi, partida.arena.estrutura('trono', 'azul'));
      usar(partida, heroi.id);
      // Deixa a pausa entre pontos passar.
      for (let i = 0; i < 5 * TICKS_POR_SEGUNDO; i++) partida.passo();
    }
    expect(partida.estado.fase).toBe('fim');
    expect(partida.estado.vencedor).toBe('azul');
  });

  it('quem morre carregando a princesa a deixa cair', () => {
    const minha = princesaDe(partida.estado, 'azul');
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
    expect(princesaDe(partida.estado, 'azul').onde).toBe('chao');
  });
});

describe('a economia do bolo', () => {
  it('vai do trigo colhido ao bolo assado', () => {
    const partida = emJogo();
    const aldeao = partida.entrar({ nome: 'Aldeão', bot: false, time: 'azul' });
    const cozinha = partida.arena.estrutura('cozinha', 'azul');

    for (let entrega = 0; entrega < TRIGO_POR_BOLO; entrega++) {
      const trigal = partida.arena.trigais.find(
        (t) => partida.estado.trigais.find((x) => x.id === t.id)?.maduro,
      )!;
      em(aldeao, trigal);
      usar(partida, aldeao.id);
      expect(aldeao.colhendoId).toBe(trigal.id);
      for (let i = 0; i < Math.ceil(TEMPO_DE_COLHEITA / DT) + 2; i++) partida.passo();
      expect(aldeao.carga).toBe('trigo');

      em(aldeao, cozinha);
      usar(partida, aldeao.id);
      expect(aldeao.carga).toBe('nada');
    }

    const forno = partida.estado.cozinhas.find((c) => c.time === 'azul')!;
    const bolosAntes = forno.bolos;
    for (let i = 0; i < Math.ceil(TEMPO_DE_FORNO / DT) + 4; i++) partida.passo();
    expect(forno.bolos).toBeGreaterThan(bolosAntes);

    usar(partida, aldeao.id);
    expect(aldeao.carga).toBe('bolo');
  });

  it('andar cancela a colheita — colher é ficar exposto', () => {
    const partida = emJogo();
    const aldeao = partida.entrar({ nome: 'Aldeão', bot: false, time: 'azul' });
    const trigal = partida.arena.trigais[0]!;
    em(aldeao, trigal);
    usar(partida, aldeao.id);
    expect(aldeao.colhendoId).not.toBeNull();

    partida.comandar(aldeao.id, { ...parado, seq: 9, mx: 1 });
    partida.passo();
    expect(aldeao.colhendoId).toBeNull();
    expect(aldeao.carga).toBe('nada');
  });

  it('guerreiro não colhe: o chapéu tem preço', () => {
    const partida = emJogo();
    const guerreiro = partida.entrar({ nome: 'G', bot: false, time: 'azul' });
    guerreiro.classe = 'guerreiro';
    em(guerreiro, partida.arena.trigais[0]!);
    usar(partida, guerreiro.id);
    expect(guerreiro.colhendoId).toBeNull();
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
    usar(partida, vitima.id);
    usar(partida, vitima.id);
    expect(vitima.classe).toBe('mago');
    const estoqueDepoisDeVestir = partida.estado.estoque.azul.mago;

    const algoz = partida.entrar({ nome: 'A', bot: false, time: 'vermelho' });
    algoz.classe = 'guerreiro';
    em(algoz, { x: vitima.x - 30, y: vitima.y });
    for (let i = 0; i < 300 && vitima.vivo; i++) {
      partida.comandar(algoz.id, { ...parado, seq: 200 + i, ax: 1, atacar: true });
      partida.passo();
    }
    expect(vitima.vivo).toBe(false);
    expect(vitima.classe).toBe('aldeao');

    const chapeu = partida.estado.itens.find((i) => i.tipo === 'chapeu' && i.classe === 'mago');
    expect(chapeu).toBeDefined();
    expect(chapeu!.origem).toBe('azul');

    em(algoz, chapeu!);
    usar(partida, algoz.id);
    expect(algoz.classe).toBe('mago');
    // O chapéu não voltou para o estoque azul: está na cabeça do inimigo, e o
    // time que o perdeu só o recupera matando quem o roubou.
    expect(partida.estado.estoque.azul.mago).toBe(estoqueDepoisDeVestir);
  });

  it('o chapéu esquecido no chão volta para a chapelaria de origem', () => {
    const partida = emJogo();
    const u = partida.entrar({ nome: 'U', bot: false, time: 'azul' });
    em(u, partida.arena.estrutura('chapelaria', 'azul'));
    usar(partida, u.id);
    expect(u.classe).toBe('guerreiro');
    const antes = partida.estado.estoque.azul.guerreiro;

    // Trocar de volta para aldeão devolve direto; aqui o caminho é a morte.
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
