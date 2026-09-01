import { describe, expect, it } from 'vitest';

import { IDS_DOS_MODOS, MODOS, MODO_PADRAO, PESO_QUE_VENCE, modoDe } from '../src/shared/modos';
import { princesaDe } from '../src/shared/estado';
import { Sala } from '../src/server/sala';
import { criarPartida } from '../src/shared/partida';
import { AQUECIMENTO, PESO_TOTAL, TICKS_POR_SEGUNDO } from '../src/shared/regras';

/**
 * Os modos de jogo.
 *
 * Um modo é uma promessa feita na tela de criação de sala: "um resgate decide",
 * "a balança vence", "chapéu à vontade". O jeito de essa promessa ser quebrada
 * é sempre o mesmo — alguém mexe no tick sem lembrar de que existe um modo que
 * depende daquele trecho — e o sintoma é uma partida que simplesmente não acaba
 * quando deveria. Cada teste aqui é uma dessas promessas.
 */

function emJogo(modo = MODO_PADRAO) {
  const partida = criarPartida(31, modo);
  for (let i = 0; i < Math.ceil(AQUECIMENTO * TICKS_POR_SEGUNDO) + 2; i++) partida.passo();
  return partida;
}

/**
 * Marca `quantos` resgates para o azul, do jeito mais curto possível.
 *
 * A princesa e o herói são **teleportados** para a jaula e para o trono: andar
 * até lá seria exercitar a navegação, que tem os testes dela, e faria este
 * arquivo depender do mapa. O que não é teleportado é o gesto — os dois toques
 * no botão de contexto, com a solta entre eles, porque é exatamente o caminho
 * que a regra do modo atravessa.
 */
function resgatar(partida: ReturnType<typeof criarPartida>, quantos: number): void {
  let seq = 1;
  const tocar = (id: number, usar: boolean): void => {
    partida.comandar(id, { seq: seq++, mx: 0, my: 0, ax: 0, ay: 0, atacar: false, usar });
    partida.passo();
  };

  for (let i = 0; i < quantos; i++) {
    if (partida.estado.fase === 'fim') return;
    const heroi =
      partida.estado.unidades.find((u) => u.time === 'azul' && u.vivo) ??
      partida.entrar({ nome: 'H', bot: false, time: 'azul' });
    const minha = princesaDe(partida.estado, 'azul');
    const trono = partida.arena.estrutura('trono', 'azul');

    // Leve o bastante para um carregador só: escolta é outro teste.
    minha.peso = 60;
    heroi.x = minha.x;
    heroi.y = minha.y;
    tocar(heroi.id, false);
    tocar(heroi.id, true);
    expect(minha.onde).toBe('carregada');

    heroi.x = trono.x;
    heroi.y = trono.y;
    // O botão precisa ser solto antes de valer de novo: segurar não repete.
    tocar(heroi.id, false);
    tocar(heroi.id, true);

    // A pausa depois do ponto precisa acabar antes do próximo resgate.
    for (let t = 0; t < 8 * TICKS_POR_SEGUNDO && partida.estado.fase === 'ponto'; t++) {
      partida.passo();
    }
  }
}

describe('a tabela de modos', () => {
  it('lista todos os modos que existem, sem sobra nem falta', () => {
    // A lista é o que a tela mostra e a tabela é o que o jogo usa. Um modo em
    // só uma das duas é um modo invisível ou um botão que não faz nada.
    expect([...IDS_DOS_MODOS].sort()).toEqual(Object.keys(MODOS).sort());
    for (const id of IDS_DOS_MODOS) expect(MODOS[id].id).toBe(id);
  });

  it('cai no clássico quando o id não existe', () => {
    // O id chega pela rede. Derrubar a sala por causa de um nome de modo seria
    // punir o jogador pelo erro de outra pessoa.
    for (const lixo of [undefined, null, 42, 'batalha-naval', {}]) {
      expect(modoDe(lixo).id).toBe(MODO_PADRAO);
    }
  });

  it('dá a cada modo uma frase própria para a tela de criação', () => {
    const lemas = IDS_DOS_MODOS.map((id) => MODOS[id].lema);
    expect(new Set(lemas).size).toBe(lemas.length);
    for (const lema of lemas) expect(lema.length).toBeGreaterThan(10);
  });
});

describe('o modo Assalto', () => {
  it('acaba no primeiro resgate', () => {
    const partida = emJogo('assalto');
    resgatar(partida, 1);
    expect(partida.estado.fase).toBe('fim');
    expect(partida.estado.vencedor).toBe('azul');
  });

  it('no clássico, um resgate só não acaba nada', () => {
    // O par do teste acima: sem ele, um modo que acabasse sempre no primeiro
    // ponto passaria os dois.
    const partida = emJogo('resgate');
    resgatar(partida, 1);
    expect(partida.estado.fase).not.toBe('fim');
    expect(partida.estado.placar.azul).toBe(1);
  });

  it('começa com o relógio curto e devolve o morto rápido ao campo', () => {
    expect(criarPartida(1, 'assalto').estado.relogio).toBe(6 * 60);
    expect(MODOS.assalto.renascimentoBase).toBeLessThan(MODOS.resgate.renascimentoBase);
  });
});

describe('o modo Banquete', () => {
  it('acaba quando a balança chega ao talo', () => {
    const partida = emJogo('banquete');
    const heroi = partida.entrar({ nome: 'H', bot: false, time: 'azul' });
    const refem = princesaDe(partida.estado, 'vermelho');
    const minha = princesaDe(partida.estado, 'azul');
    // Uma fatia antes do fim: o resto do caminho já foi andado.
    minha.peso = PESO_QUE_VENCE + 5;
    refem.peso = PESO_TOTAL - minha.peso;

    heroi.x = refem.x;
    heroi.y = refem.y;
    heroi.carga = 'bolo';
    partida.comandar(heroi.id, { seq: 1, mx: 0, my: 0, ax: 0, ay: 0, atacar: false, usar: true });
    partida.passo();

    expect(minha.peso).toBe(PESO_QUE_VENCE);
    expect(partida.estado.fase).toBe('fim');
    expect(partida.estado.vencedor).toBe('azul');
  });

  it('no clássico, a mesma fatia não acaba a partida', () => {
    const partida = emJogo('resgate');
    const heroi = partida.entrar({ nome: 'H', bot: false, time: 'azul' });
    const refem = princesaDe(partida.estado, 'vermelho');
    const minha = princesaDe(partida.estado, 'azul');
    minha.peso = PESO_QUE_VENCE + 5;
    refem.peso = PESO_TOTAL - minha.peso;

    heroi.x = refem.x;
    heroi.y = refem.y;
    heroi.carga = 'bolo';
    partida.comandar(heroi.id, { seq: 1, mx: 0, my: 0, ax: 0, ay: 0, atacar: false, usar: true });
    partida.passo();

    expect(minha.peso).toBe(PESO_QUE_VENCE);
    expect(partida.estado.fase).not.toBe('fim');
  });

  it('o resgate continua valendo: são dois caminhos, não um', () => {
    const partida = emJogo('banquete');
    resgatar(partida, MODOS.banquete.pontosParaVencer);
    expect(partida.estado.fase).toBe('fim');
    expect(partida.estado.vencedor).toBe('azul');
  });

  it('a balança não relaxa depois de um ponto — senão a vitória por peso nunca vem', () => {
    // Este é o teste que faltava, e a ausência dele deixou o modo nascer vazio:
    // o fim por peso existia, mas `recomecarRodada` devolvia metade do caminho
    // andado a cada resgate, e medindo com bots o Banquete terminava idêntico
    // ao clássico — mesmo placar, mesmos pesos, mesma duração.
    // `resgatar` deixa a princesa em 60 para o cortejo caber num carregador só,
    // o que serve de ponto de partida: 60 está longe do meio, e é justamente a
    // distância que o relaxamento comeria.
    const partida = emJogo('banquete');
    resgatar(partida, 1);
    expect(partida.estado.placar.azul).toBe(1);
    // O trabalho de economia sobrevive ao ponto.
    expect(princesaDe(partida.estado, 'azul').peso).toBe(60);
  });

  it('no clássico ela relaxa: o ponto devolve metade do caminho', () => {
    // O par do teste acima. Sem ele, tirar o relaxamento do jogo inteiro
    // passaria os dois — e a bola de neve do clássico voltaria sem aviso.
    const partida = emJogo('resgate');
    resgatar(partida, 1);
    expect(princesaDe(partida.estado, 'azul').peso).toBe(80);
  });
});

describe('os modos jogados de verdade', () => {
  /** Roda uma sala só de bots e devolve em quantos segundos a partida acabou. */
  function ateAcabar(modo: Parameters<typeof criarPartida>[1], limite: number): number | null {
    const sala = new Sala({ nome: 'm', seed: 11, porTime: 6, esperaPorJogadores: 0, modo });
    sala.entrar({
      chave: 'Obs',
      nome: 'Obs',
      unidade: null,
      time: null,
      assistindo: false,
      silencio: 0,
      enviar() {},
      fechar() {},
    });
    for (let i = 0; i < limite * TICKS_POR_SEGUNDO; i++) {
      sala.tocar('Obs');
      sala.passo();
      if (sala.estado.fase === 'fim') return Math.floor(i / TICKS_POR_SEGUNDO);
    }
    return null;
  }

  /**
   * O teste que faltava quando os modos nasceram.
   *
   * Os outros conferem cada alavanca em isolamento, com a partida montada à
   * mão — e todos passavam enquanto o Banquete terminava idêntico ao clássico
   * numa partida de verdade. O que uma tabela de números não prova é que o jogo
   * **fica diferente**; só rodar a partida prova.
   */
  it('o Assalto acaba muito antes do clássico', () => {
    const assalto = ateAcabar('assalto', 200);
    expect(assalto).not.toBeNull();
    expect(assalto!).toBeLessThan(150);
    // E o clássico, no mesmo mapa, ainda está em jogo bem depois disso.
    expect(ateAcabar('resgate', 150)).toBeNull();
  });
});

describe('o modo Chapelaria aberta', () => {
  /** Veste na chapelaria apertando "usar" uma vez. */
  function vestir(partida: ReturnType<typeof criarPartida>, id: number, seq: number): void {
    const u = partida.estado.unidades.find((x) => x.id === id)!;
    const casa = partida.arena.estrutura('chapelaria', u.time);
    u.x = casa.x;
    u.y = casa.y;
    partida.comandar(id, { seq, mx: 0, my: 0, ax: 0, ay: 0, atacar: false, usar: false });
    partida.passo();
    partida.comandar(id, { seq: seq + 1, mx: 0, my: 0, ax: 0, ay: 0, atacar: false, usar: true });
    partida.passo();
  }

  it('veste todo mundo de guerreiro sem esvaziar a chapelaria', () => {
    const partida = emJogo('chapelaria');
    const time = partida.estado.estoque.azul;
    const guerreiros = time.guerreiro;
    // Mais gente do que há chapéus de guerreiro guardados.
    const gente = Array.from({ length: guerreiros + 2 }, (_, i) =>
      partida.entrar({ nome: `g${i}`, bot: false, time: 'azul' }),
    );
    let seq = 1;
    for (const u of gente) {
      // Roda a lista até chegar no guerreiro; o primeiro passo já basta, porque
      // todos começam aldeões e o guerreiro é o primeiro chapéu do ciclo.
      vestir(partida, u.id, seq);
      seq += 2;
    }
    expect(gente.every((u) => u.classe !== 'aldeao')).toBe(true);
  });

  it('no clássico, o chapéu acaba', () => {
    const partida = emJogo('resgate');
    const gente = Array.from({ length: 12 }, (_, i) =>
      partida.entrar({ nome: `g${i}`, bot: false, time: 'azul' }),
    );
    let seq = 1;
    for (const u of gente) {
      vestir(partida, u.id, seq);
      seq += 2;
    }
    // Com estoque finito, alguém fica sem: é a escassez que o modo aberto tira.
    const estoque = partida.estado.estoque.azul;
    expect(Object.values(estoque).some((n) => n === 0)).toBe(true);
  });
});
