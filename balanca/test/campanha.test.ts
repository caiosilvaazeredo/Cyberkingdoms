import { describe, expect, it } from 'vitest';

import { perkDoNivel } from '../src/shared/campanha';
import type { Classe } from '../src/shared/classes';
import { Lobby } from '../src/server/lobby';
import { Sala, type Cliente } from '../src/server/sala';
import { salaConfiguravel, type DoServidor } from '../src/shared/protocolo';
import { TICKS_POR_SEGUNDO } from '../src/shared/regras';

/**
 * A Regência: vencer sobe de nível e reforça a chapelaria; perder zera a
 * corrente. Testado aqui porque as duas promessas moram no mesmo lugar que
 * qualquer defeito futuro vai mexer — `Sala.reiniciarSeAcabou` — e o olho
 * não pega uma conta de estoque errada sem rodar a partida de verdade.
 */

function clienteFalso(nome: string): Cliente & { recebidas: DoServidor[] } {
  const recebidas: DoServidor[] = [];
  return {
    chave: nome,
    nome,
    unidade: null,
    time: null,
    assistindo: false,
    silencio: 0,
    recebidas,
    enviar(msg) {
      recebidas.push(msg);
    },
    fechar() {},
  };
}

function rodar(sala: Sala, segundos: number, chaves: string[]): void {
  for (let i = 0; i < segundos * TICKS_POR_SEGUNDO; i++) {
    for (const c of chaves) sala.tocar(c);
    sala.passo();
  }
}

/** Força o fim da partida atual com o vencedor pedido, e deixa a sala
 * remontar a próxima — a mesma técnica de `salas-montadas.test.ts`. */
function terminarPartida(sala: Sala, vencedor: 'azul' | 'vermelho' | null, chaves: string[]): void {
  sala.estado.fase = 'fim';
  sala.estado.vencedor = vencedor;
  sala.estado.faseEm = 0;
  rodar(sala, 10, chaves);
}

/** O estoque nasce escalado pelo tamanho do time (`chapeusDe`), não pelos
 * números crus de `ESTOQUE_INICIAL` — por isso o ponto de partida de cada
 * teste vem da própria sala, e não da tabela. */
const estoqueBase = (classe: Classe, time: 'azul' | 'vermelho', porTime: number): number => {
  const sala = new Sala({ nome: 'base', seed: 0, porTime, esperaPorJogadores: 0 });
  return sala.estado.estoque[time][classe];
};

describe('a Regência', () => {
  it('o reino bandido é sempre a máquina — humano não escolhe vermelho', () => {
    const sala = new Sala({ nome: 'r1', seed: 1, porTime: 2, esperaPorJogadores: 0, campanha: true });
    const ana = clienteFalso('Ana');
    sala.entrar(ana);

    expect(sala.escolher('Ana', 'vermelho')).toBe(false);
    expect(ana.recebidas.some((m) => m.t === 'recusado')).toBe(true);
    expect(ana.unidade).toBeNull();

    expect(sala.escolher('Ana', 'azul')).toBe(true);
  });

  it('vencer sobe de nível e reforça a chapelaria do time', () => {
    const sala = new Sala({ nome: 'r2', seed: 2, porTime: 2, esperaPorJogadores: 0, campanha: true });
    const ana = clienteFalso('Ana');
    sala.entrar(ana);
    sala.escolher('Ana', 'azul');
    rodar(sala, 1, ['Ana']);

    terminarPartida(sala, 'azul', ['Ana']);

    const perk = perkDoNivel(2);
    expect(sala.estado.estoque.azul[perk.classe]).toBe(
      estoqueBase(perk.classe, 'azul', 2) + 2,
    );
    // O reino bandido ainda não cresceu: o primeiro reforço é sempre do time.
    for (const classe of Object.keys(sala.estado.estoque.vermelho) as Classe[]) {
      expect(sala.estado.estoque.vermelho[classe]).toBe(estoqueBase(classe, 'vermelho', 2));
    }
  });

  it('perder zera a corrente — a chapelaria volta ao ponto de partida', () => {
    const sala = new Sala({ nome: 'r3', seed: 3, porTime: 2, esperaPorJogadores: 0, campanha: true });
    const ana = clienteFalso('Ana');
    sala.entrar(ana);
    sala.escolher('Ana', 'azul');
    rodar(sala, 1, ['Ana']);

    terminarPartida(sala, 'azul', ['Ana']);
    terminarPartida(sala, 'vermelho', ['Ana']);

    for (const classe of Object.keys(sala.estado.estoque.azul) as Classe[]) {
      expect(sala.estado.estoque.azul[classe]).toBe(estoqueBase(classe, 'azul', 2));
      expect(sala.estado.estoque.vermelho[classe]).toBe(estoqueBase(classe, 'vermelho', 2));
    }
  });

  it('o reino bandido cresce pela mesma tabela, sempre um nível atrás', () => {
    const sala = new Sala({ nome: 'r4', seed: 4, porTime: 2, esperaPorJogadores: 0, campanha: true });
    const ana = clienteFalso('Ana');
    sala.entrar(ana);
    sala.escolher('Ana', 'azul');
    rodar(sala, 1, ['Ana']);

    terminarPartida(sala, 'azul', ['Ana']); // nível 2
    terminarPartida(sala, 'azul', ['Ana']); // nível 3

    const perkDoBandido = perkDoNivel(2);
    expect(sala.estado.estoque.vermelho[perkDoBandido.classe]).toBe(
      estoqueBase(perkDoBandido.classe, 'vermelho', 2) + 2,
    );
  });

  it('fora da Regência, ninguém é forçado e a chapelaria não muda sozinha', () => {
    const sala = new Sala({ nome: 'r5', seed: 5, porTime: 2, esperaPorJogadores: 0 });
    const ana = clienteFalso('Ana');
    sala.entrar(ana);
    expect(sala.escolher('Ana', 'vermelho')).toBe(true);
    rodar(sala, 1, ['Ana']);

    terminarPartida(sala, 'vermelho', ['Ana']);
    for (const classe of Object.keys(sala.estado.estoque.azul) as Classe[]) {
      expect(sala.estado.estoque.azul[classe]).toBe(estoqueBase(classe, 'azul', 2));
      expect(sala.estado.estoque.vermelho[classe]).toBe(estoqueBase(classe, 'vermelho', 2));
    }
  });

  it('pelo caminho de verdade (Lobby + sala montada), vermelho enche sozinho', () => {
    // A sala montada sempre manda um número concreto de bots
    // (`salaConfiguravel` nunca deixa `bots` indefinido) — é a este número
    // que `Sala` precisa saber dizer não, e não só quando construída direto
    // como as outras marcas deste arquivo fazem.
    const lobby = new Lobby({ seed: () => 9, esperaPorJogadores: 0 });
    const ana = clienteFalso('Ana');
    const criar = salaConfiguravel({ campanha: true, porTime: 3, bots: 5 });
    const sala = lobby.acolher(ana, { criar });
    expect(sala).not.toBeNull();
    sala!.escolher('Ana', 'azul');
    lobby.avancar(2);

    expect(sala!.estado.unidades.filter((u) => u.time === 'vermelho')).toHaveLength(3);
    expect(sala!.estado.unidades.filter((u) => u.time === 'azul')).toHaveLength(3);
  });
});
