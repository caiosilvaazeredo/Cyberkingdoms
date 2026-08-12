import { describe, expect, it } from 'vitest';

import { Autosave } from '../src/campaign/autosave';
import { Campaign } from '../src/campaign/campaign';
import { MemoryStore } from '../src/net/localServer';
import { runDailyTick } from '../src/campaign/dailyTick';

/**
 * O que estes testes protegem.
 *
 * Desde que o cliente 2D virou a porta de entrada, é este arquivo que separa
 * "jogar" de "perder tudo no F5". As três falhas que importam são silenciosas:
 * gravar e não recuperar, recuperar a partida de outro mundo, e explodir num
 * save corrompido — a última tranca o jogador para fora do jogo, sem saída.
 */

function nova(seed = 'a'): Campaign {
  return Campaign.create({ id: 't', seedLabel: seed, characterName: 'A', now: 0 });
}

describe('salvamento automático', () => {
  it('vazio quando nunca gravou', () => {
    expect(new Autosave('a', new MemoryStore()).carregar()).toBeNull();
  });

  it('grava e recupera a partida inteira', () => {
    const store = new MemoryStore();
    const c = nova();
    runDailyTick(c, { publicWork: 'dump' });
    runDailyTick(c, { publicWork: 'dump' });

    expect(new Autosave('a', store).salvar(c)).toBe(true);
    const voltou = new Autosave('a', store).carregar()!;
    expect(voltou).not.toBeNull();
    expect(voltou.day).toBe(c.day);
    expect(voltou.character.credits).toBe(c.character.credits);
    expect(voltou.toJson()).toEqual(c.toJson());
  });

  it('cada seed tem o próprio espaço', () => {
    // Abrir `?seed=krom` não pode carregar por cima a partida de `?seed=verde`:
    // trocar de mundo é começar outra coisa, não perder a anterior.
    const store = new MemoryStore();
    new Autosave('verde', store).salvar(nova('verde'));
    expect(new Autosave('krom', store).carregar()).toBeNull();
    expect(new Autosave('verde', store).carregar()).not.toBeNull();
  });

  it('save corrompido devolve nulo em vez de quebrar a abertura', () => {
    // Perder a partida é ruim; não conseguir abrir o jogo é pior, e sem saída.
    const store = new MemoryStore();
    store.setItem('ck.2d.a', '{isso não é json');
    expect(() => new Autosave('a', store).carregar()).not.toThrow();
    expect(new Autosave('a', store).carregar()).toBeNull();
  });

  it('apagar zera só aquele mundo', () => {
    const store = new MemoryStore();
    new Autosave('a', store).salvar(nova('a'));
    new Autosave('b', store).salvar(nova('b'));
    new Autosave('a', store).apagar();
    expect(new Autosave('a', store).carregar()).toBeNull();
    expect(new Autosave('b', store).carregar()).not.toBeNull();
  });

  it('não estoura quando o armazenamento recusa a gravação', () => {
    // Cota cheia ou aba privada: falhar em salvar não pode derrubar o laço de
    // desenho junto.
    const recusa = {
      getItem: () => null,
      setItem: () => {
        throw new Error('cota cheia');
      },
      removeItem: () => {},
    };
    const autosave = new Autosave('a', recusa);
    expect(() => autosave.salvar(nova())).not.toThrow();
    expect(autosave.salvar(nova())).toBe(false);
  });
});
