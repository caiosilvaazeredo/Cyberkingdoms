import { describe, expect, it } from 'vitest';

import { Lobby } from '../src/server/lobby';
import { Sala, type Cliente } from '../src/server/sala';
import type { DoServidor } from '../src/shared/protocolo';
import { TICKS_POR_SEGUNDO, type Time } from '../src/shared/regras';

/**
 * A regra que o jogo promete no menu: **gente primeiro**.
 *
 * Bot entra quando não há com quem jogar e sai quando aparece alguém. Estes
 * testes existem porque é uma promessa fácil de quebrar sem perceber — basta
 * alguém trocar a ordem de duas linhas no `cuidarDosBots` para o servidor
 * passar a encher de bot antes de esperar por pessoas, e nada mais no jogo
 * reclamaria.
 */

function clienteFalso(nome: string): Cliente & { recebidas: DoServidor[] } {
  const recebidas: DoServidor[] = [];
  return {
    chave: nome,
    nome,
    unidade: null,
    time: null,
    silencio: 0,
    recebidas,
    enviar(msg) {
      recebidas.push(msg);
    },
    fechar() {},
  };
}

const contar = (sala: Sala, time: Time, bot: boolean): number =>
  sala.estado.unidades.filter((u) => u.time === time && u.bot === bot).length;

/** Entra e escolhe o lado — o caminho completo de quem senta para jogar. */
function jogarPor(sala: Sala, nome: string, time: Time) {
  const cliente = clienteFalso(nome);
  sala.entrar(cliente);
  sala.escolher(cliente.chave, time);
  return cliente;
}

function rodar(sala: Sala, segundos: number): void {
  for (let i = 0; i < Math.ceil(segundos * TICKS_POR_SEGUNDO); i++) sala.passo();
}

describe('a lotação da sala', () => {
  it('não chama bot nenhum enquanto não há ninguém jogando', () => {
    const sala = new Sala({ nome: 'vazia', seed: 1, porTime: 3, esperaPorJogadores: 0 });
    rodar(sala, 5);
    expect(sala.estado.unidades).toHaveLength(0);
  });

  it('dá adversários na hora, e espera antes de dar companheiros', () => {
    const sala = new Sala({ nome: 'r1', seed: 2, porTime: 3, esperaPorJogadores: 4 });
    jogarPor(sala, 'Ana', 'azul');

    // Um segundo depois já há inimigos: jogar contra o vazio não é jogar.
    rodar(sala, 1);
    expect(contar(sala, 'vermelho', true)).toBe(3);
    // Mas o time dela continua guardando as vagas para pessoas.
    expect(contar(sala, 'azul', true)).toBe(0);

    rodar(sala, 4);
    expect(contar(sala, 'azul', true)).toBe(2);
    expect(contar(sala, 'azul', false)).toBe(1);
  });

  it('quem chega tira o lugar de um bot, na hora', () => {
    const sala = new Sala({ nome: 'r2', seed: 3, porTime: 3, esperaPorJogadores: 0 });
    jogarPor(sala, 'Ana', 'azul');
    rodar(sala, 2);
    expect(sala.estado.unidades).toHaveLength(6);

    jogarPor(sala, 'Bruno', 'vermelho');
    // O total não passa do tamanho combinado: entrou gente, saiu bot.
    expect(sala.estado.unidades).toHaveLength(6);
    expect(sala.estado.unidades.filter((u) => !u.bot)).toHaveLength(2);
    expect(contar(sala, 'azul', false)).toBe(1);
    expect(contar(sala, 'vermelho', false)).toBe(1);
  });

  it('respeita o lado escolhido, mesmo o mais cheio de gente', () => {
    const sala = new Sala({ nome: 'r2b', seed: 31, porTime: 3, esperaPorJogadores: 0 });
    jogarPor(sala, 'Ana', 'azul');
    jogarPor(sala, 'Bruno', 'azul');
    rodar(sala, 2);
    // Escolher o lado é do jogador: quem quer jogar com a amiga joga com ela,
    // e o servidor completa o outro lado com bot.
    expect(contar(sala, 'azul', false)).toBe(2);
    expect(contar(sala, 'vermelho', false)).toBe(0);
  });

  it('recusa o lado cheio de gente sem trocar a escolha por baixo', () => {
    const sala = new Sala({ nome: 'r2c', seed: 32, porTime: 1, esperaPorJogadores: 0 });
    jogarPor(sala, 'Ana', 'azul');
    const bruno = clienteFalso('Bruno');
    sala.entrar(bruno);
    expect(sala.escolher(bruno.chave, 'azul')).toBe(false);
    expect(bruno.recebidas.some((m) => m.t === 'recusado')).toBe(true);
    expect(bruno.unidade).toBeNull();
    // E o outro lado continua aberto para ele.
    expect(sala.escolher(bruno.chave, 'vermelho')).toBe(true);
    expect(bruno.unidade).not.toBeNull();
  });

  it('quem entra fica assistindo até escolher', () => {
    const sala = new Sala({ nome: 'r2d', seed: 33, porTime: 3, esperaPorJogadores: 0 });
    const ana = clienteFalso('Ana');
    sala.entrar(ana);
    rodar(sala, 2);
    expect(ana.unidade).toBeNull();
    // A partida corre sem ela: há o que assistir enquanto se escolhe o lado.
    expect(sala.estado.unidades.filter((u) => u.bot)).toHaveLength(6);
    expect(ana.recebidas.some((m) => m.t === 'bemvindo')).toBe(true);
    expect(ana.recebidas.some((m) => m.t === 'elenco')).toBe(true);
    expect(ana.recebidas.some((m) => m.t === 'nasceu')).toBe(false);
  });

  it('conta vaga por gente, não por unidade', () => {
    const sala = new Sala({ nome: 'r3', seed: 4, porTime: 2, esperaPorJogadores: 0 });
    jogarPor(sala, 'Ana', 'azul');
    rodar(sala, 2);
    expect(sala.estado.unidades).toHaveLength(4);
    // Quatro em campo, e ainda há três vagas: as outras três são de bot.
    expect(sala.vagas).toBe(3);
    expect(sala.cheiaDeGente).toBe(false);
  });

  it('recusa quem chega quando as vagas de gente acabaram', () => {
    const sala = new Sala({ nome: 'r4', seed: 5, porTime: 1, esperaPorJogadores: 0 });
    jogarPor(sala, 'A', 'azul');
    jogarPor(sala, 'B', 'vermelho');
    const terceiro = clienteFalso('C');
    expect(sala.entrar(terceiro)).toBe(false);
    expect(terceiro.recebidas.some((m) => m.t === 'recusado')).toBe(true);
  });

  it('quem ainda está escolhendo já ocupa vaga', () => {
    const sala = new Sala({ nome: 'r4b', seed: 51, porTime: 1, esperaPorJogadores: 0 });
    expect(sala.entrar(clienteFalso('A'))).toBe(true);
    expect(sala.entrar(clienteFalso('B'))).toBe(true);
    // Dois espectadores já lotam uma sala de um por time: dizer "não cabe"
    // agora é melhor que dizer depois que a pessoa escolheu o lado.
    expect(sala.entrar(clienteFalso('C'))).toBe(false);
  });

  it('quem sai libera a vaga, e o bot volta a cobri-la', () => {
    const sala = new Sala({ nome: 'r5', seed: 6, porTime: 2, esperaPorJogadores: 0 });
    jogarPor(sala, 'Ana', 'azul');
    const bruno = jogarPor(sala, 'Bruno', 'vermelho');
    rodar(sala, 2);
    expect(sala.estado.unidades).toHaveLength(4);

    sala.sair(bruno.chave);
    expect(sala.estado.unidades.filter((u) => !u.bot)).toHaveLength(1);
    rodar(sala, 2);
    expect(sala.estado.unidades).toHaveLength(4);
    expect(sala.estado.unidades.filter((u) => u.bot)).toHaveLength(3);
  });
});

describe('o silêncio do cliente', () => {
  it('quem para de mandar comando é considerado ido', () => {
    const sala = new Sala({ nome: 'r6', seed: 8, porTime: 2, esperaPorJogadores: 0 });
    jogarPor(sala, 'Ana', 'azul');
    rodar(sala, 5);
    expect(sala.humanos).toBe(1);
    // Vinte segundos sem uma palavra: a conexão morreu sem avisar, que é como
    // conexões morrem de verdade.
    rodar(sala, 21);
    expect(sala.humanos).toBe(0);
  });

  it('quem continua mandando comando fica', () => {
    const sala = new Sala({ nome: 'r7', seed: 9, porTime: 2, esperaPorJogadores: 0 });
    const ana = jogarPor(sala, 'Ana', 'azul');
    for (let i = 0; i < 30 * TICKS_POR_SEGUNDO; i++) {
      sala.tocar(ana.chave);
      sala.passo();
    }
    expect(sala.humanos).toBe(1);
  });
});

describe('o lobby', () => {
  it('junta as pessoas na mesma sala em vez de espalhá-las', () => {
    const lobby = new Lobby({ porTime: 2, esperaPorJogadores: 0, seed: () => 42 });
    const salas = ['A', 'B', 'C'].map((n) => lobby.acolher(clienteFalso(n)));
    expect(lobby.quantidade).toBe(1);
    expect(new Set(salas.map((s) => s?.nome)).size).toBe(1);
  });

  it('abre sala nova só quando a anterior encheu de gente', () => {
    const lobby = new Lobby({ porTime: 1, esperaPorJogadores: 0, seed: () => 7 });
    lobby.acolher(clienteFalso('A'));
    lobby.acolher(clienteFalso('B'));
    expect(lobby.quantidade).toBe(1);
    lobby.acolher(clienteFalso('C'));
    expect(lobby.quantidade).toBe(2);
  });

  it('roda o número certo de ticks por segundo de relógio de parede', () => {
    const lobby = new Lobby({ porTime: 1, esperaPorJogadores: 0, seed: () => 3 });
    lobby.acolher(clienteFalso('Ana'));
    // Um segundo entregue em fatias de 16 ms, que é como o temporizador do
    // servidor entrega. O passo do jogo é 33,33 ms: pedir ao `setInterval` um
    // disparo por passo daria 33 ms inteiros, e o jogo rodaria em câmera lenta
    // sem nada no código parecer errado.
    let ticks = 0;
    for (let i = 0; i < 62; i++) ticks += lobby.avancar(0.016);
    expect(ticks).toBeGreaterThanOrEqual(TICKS_POR_SEGUNDO - 1);
    expect(ticks).toBeLessThanOrEqual(TICKS_POR_SEGUNDO + 1);
  });

  it('recolhe a sala que ficou sem ninguém', () => {
    const lobby = new Lobby({ porTime: 2, esperaPorJogadores: 0, seed: () => 9 });
    const ana = clienteFalso('Ana');
    const sala = lobby.acolher(ana);
    expect(sala).not.toBeNull();
    lobby.passo();
    sala!.sair(ana.chave);
    lobby.passo();
    expect(lobby.quantidade).toBe(0);
  });
});
