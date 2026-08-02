import { describe, expect, it } from 'vitest';

import { gameModeInfo, gameModes } from '../src/net/gameServer';
import { LocalGameServer, MemoryStore } from '../src/net/localServer';

function servidor(): LocalGameServer {
  return new LocalGameServer(new MemoryStore());
}

describe('Modos de jogo', () => {
  it('os três modos do menu estão declarados', () => {
    // Partida rápida ficou para depois de propósito: é o único modo que precisa
    // de sincronização em tempo real, e não do tick de 24 h que o resto assume.
    expect(gameModes.map((m) => m.id)).toEqual([
      'campaign',
      'persistent',
      'sandbox',
    ]);
  });

  it('só o mundo persistente exige servidor', () => {
    expect(gameModeInfo('campaign').playableOffline).toBe(true);
    expect(gameModeInfo('sandbox').playableOffline).toBe(true);
    expect(gameModeInfo('persistent').playableOffline).toBe(false);
  });

  it('sandbox desliga a sobrevivência, os outros não', () => {
    expect(gameModeInfo('sandbox').survivalEnabled).toBe(false);
    expect(gameModeInfo('campaign').survivalEnabled).toBe(true);
    expect(gameModeInfo('persistent').survivalEnabled).toBe(true);
  });
});

describe('Servidor local', () => {
  it('modo offline não lista servidor nenhum', async () => {
    const s = servidor();
    expect(await s.listServers('campaign')).toHaveLength(0);
    expect(await s.listServers('sandbox')).toHaveLength(0);
  });

  it('o mundo persistente lista servidores, marcados como simulados', async () => {
    // O jogador tem de saber que ainda não é servidor de verdade.
    const lista = await servidor().listServers('persistent');
    expect(lista.length).toBeGreaterThan(0);
    for (const srv of lista) {
      expect(srv.region).toMatch(/simulado/);
      expect(srv.players).toBeLessThanOrEqual(srv.capacity);
    }
  });

  it('a lista de servidores é estável entre aberturas', async () => {
    // Uma lista que embaralha a cada abertura faria o jogador perder o servidor
    // onde ele estava.
    const a = await servidor().listServers('persistent');
    const b = await servidor().listServers('persistent');
    expect(a.map((s) => s.id)).toEqual(b.map((s) => s.id));
    expect(a.map((s) => s.seedLabel)).toEqual(b.map((s) => s.seedLabel));
  });

  it('cria, salva, recarrega e apaga uma sessão', async () => {
    const s = servidor();
    const sessao = await s.createSession({
      mode: 'campaign',
      seedLabel: 'neon-tokyo',
      characterName: 'Kaia Vex',
      serverId: null,
    });

    await s.saveState(sessao.slotId, { day: 7, foo: 'bar' });
    expect(await s.loadState(sessao.slotId)).toEqual({ day: 7, foo: 'bar' });

    const saves = await s.listSaves();
    expect(saves).toHaveLength(1);
    expect(saves[0]!.day).toBe(7);
    expect(saves[0]!.characterName).toBe('Kaia Vex');

    await s.deleteSave(sessao.slotId);
    expect(await s.listSaves()).toHaveLength(0);
    expect(await s.loadState(sessao.slotId)).toBeNull();
  });

  it('save corrompido devolve nulo em vez de lançar', async () => {
    // Melhor oferecer campanha nova do que uma tela de erro da qual não se sai.
    const store = new MemoryStore();
    const s = new LocalGameServer(store);
    const sessao = await s.createSession({
      mode: 'campaign',
      seedLabel: 'x',
      characterName: 'Y',
      serverId: null,
    });
    store.setItem(`ck.save.${sessao.slotId}`, '{{{ não é json');
    expect(await s.loadState(sessao.slotId)).toBeNull();
  });

  it('retomar um save inexistente falha com mensagem', async () => {
    await expect(servidor().resumeSession('nao-existe')).rejects.toThrow(
      /não encontrado/,
    );
  });

  it('saveState devolve o estado aceito, não void', async () => {
    // Num servidor de verdade isto vira uma proposta que pode voltar
    // diferente. O cliente já precisa estar escrito para receber de volta.
    const s = servidor();
    const sessao = await s.createSession({
      mode: 'persistent',
      seedLabel: 'z',
      characterName: 'W',
      serverId: 'local-0',
    });
    const aceito = await s.saveState(sessao.slotId, { day: 3 });
    expect(aceito).toEqual({ day: 3 });
  });

  it('a conexão reflete o ciclo de vida', async () => {
    const s = servidor();
    expect(s.connection).toBe('offline');
    await s.createSession({
      mode: 'campaign',
      seedLabel: 'a',
      characterName: 'b',
      serverId: null,
    });
    expect(s.connection).toBe('connected');
    await s.disconnect();
    expect(s.connection).toBe('offline');
  });

  it('os saves saem do mais recente para o mais antigo', async () => {
    const s = servidor();
    for (const nome of ['A', 'B', 'C']) {
      const h = await s.createSession({
        mode: 'campaign',
        seedLabel: nome,
        characterName: nome,
        serverId: null,
      });
      await s.saveState(h.slotId, { day: 1 });
    }
    const saves = await s.listSaves();
    expect(saves).toHaveLength(3);
    for (let i = 1; i < saves.length; i++) {
      expect(saves[i - 1]!.updatedAt).toBeGreaterThanOrEqual(saves[i]!.updatedAt);
    }
  });
});
