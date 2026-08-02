import { describe, expect, it } from 'vitest';

import { gameModeInfo, gameModes, type ServerInfo } from '../src/net/gameServer';
import { joinBlocker, sortServers } from '../src/ui/serverBrowser';
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

describe('Navegador de servidores', () => {
  const base = {
    region: 'local (simulado)',
    mode: 'persistent' as const,
    seedLabel: 's',
    capacity: 200,
    day: 1,
  };
  const srv = (
    id: string,
    ping: number | null,
    players = 10,
    online = true,
  ): ServerInfo => ({ ...base, id, name: id, ping, players, online });

  it('ordena pelo ping, e não pela lotação', () => {
    // Ordenar por gente põe o pior lag no topo sempre que ele for popular.
    const ordem = sortServers([
      srv('c', 90, 190),
      srv('a', 12, 3),
      srv('b', 40, 150),
    ]).map((s) => s.id);
    expect(ordem).toEqual(['a', 'b', 'c']);
  });

  it('lotado e fora do ar caem para o fim, nessa ordem', () => {
    // Nenhum dos dois é escolha, mas lotado pode esvaziar e fora do ar não.
    const ordem = sortServers([
      srv('fora', 5, 10, false),
      srv('lotado', 6, 200),
      srv('livre', 300),
    ]).map((s) => s.id);
    expect(ordem).toEqual(['livre', 'lotado', 'fora']);
  });

  it('ping desconhecido vai para o fim dos disponíveis, não para o topo', () => {
    // `null` comparado como número viraria 0 e ganharia de todo mundo.
    const ordem = sortServers([srv('sem', null), srv('com', 200)]).map((s) => s.id);
    expect(ordem).toEqual(['com', 'sem']);
  });

  it('o motivo do bloqueio é dito, não escondido', () => {
    expect(joinBlocker(srv('a', 10))).toBeNull();
    expect(joinBlocker(srv('a', 10, 200))).toBe('lotado');
    expect(joinBlocker(srv('a', 10, 10, false))).toBe('fora do ar');
    // Fora do ar ganha de lotado: é o impedimento mais forte.
    expect(joinBlocker(srv('a', 10, 200, false))).toBe('fora do ar');
  });
});
