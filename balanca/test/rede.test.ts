import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MAPA_PADRAO } from '../src/shared/mapas';
import { MODO_PADRAO } from '../src/shared/modos';
import { Rede } from '../src/client/rede';

/**
 * A reconexão automática de `Rede` não tem como ser testada contra um
 * WebSocket de verdade — o que importa aqui é a máquina de estados em volta
 * dele (quando tenta de novo, quando desiste, quando destrava), não o fio.
 * Este stub imita só o que `rede.ts` toca: `readyState`, `send`, `close`, e
 * os quatro `on*`.
 */
class WebSocketFalso {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = WebSocketFalso.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly enviadas: string[] = [];

  constructor(readonly url: string) {
    instancias.push(this);
  }

  send(dado: string): void {
    this.enviadas.push(dado);
  }

  /** O que o navegador faz quando o código pede `.close()`. */
  close(): void {
    if (this.readyState === WebSocketFalso.CLOSED) return;
    this.readyState = WebSocketFalso.CLOSED;
    this.onclose?.();
  }

  /** O que o navegador faz quando o servidor derruba a conexão sozinho. */
  cair(): void {
    this.readyState = WebSocketFalso.CLOSED;
    this.onclose?.();
  }

  abrir(): void {
    this.readyState = WebSocketFalso.OPEN;
    this.onopen?.();
  }
}

let instancias: WebSocketFalso[] = [];

function bemVindo(): string {
  return JSON.stringify({
    t: 'bemvindo',
    seed: 1,
    sala: 'teste',
    porTime: 6,
    modo: MODO_PADRAO,
    botsPorTime: 0,
    mapa: MAPA_PADRAO,
  });
}

beforeEach(() => {
  instancias = [];
  vi.stubGlobal('WebSocket', WebSocketFalso);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('a reconexão automática', () => {
  it('tenta de novo sozinha depois de uma queda inesperada, sem avisar desconexão na hora', () => {
    const rede = new Rede('ws://teste');
    rede.conectar('Jogador');
    expect(instancias.length).toBe(1);

    instancias[0]!.abrir();
    instancias[0]!.cair(); // a rede caiu — ninguém pediu isso

    // Não é hora de mostrar a tela de desconectado: a primeira tentativa
    // ainda nem começou a esperar.
    expect(rede.fechado).toBe(false);
    expect(instancias.length).toBe(1);

    vi.advanceTimersByTime(500); // primeiro passo do backoff
    expect(instancias.length).toBe(2);
    expect(rede.fechado).toBe(false);
  });

  it('reconecta com sucesso, e o bemvindo zera as tentativas', () => {
    const rede = new Rede('ws://teste');
    rede.conectar('Jogador');
    instancias[0]!.abrir();
    instancias[0]!.cair();
    vi.advanceTimersByTime(500);
    expect(instancias.length).toBe(2);

    instancias[1]!.abrir();
    instancias[1]!.onmessage?.({ data: bemVindo() });
    expect(rede.sala).toBe('teste');
    expect(rede.fechado).toBe(false);

    // Se cair de novo agora, é uma queda nova — a série de tentativas
    // recomeça do primeiro passo do backoff, não continua de onde parou.
    instancias[1]!.cair();
    vi.advanceTimersByTime(499);
    expect(instancias.length).toBe(2);
    vi.advanceTimersByTime(1);
    expect(instancias.length).toBe(3);
  });

  it('desiste depois de esgotar as tentativas, e só então mostra a desconexão', () => {
    const rede = new Rede('ws://teste');
    rede.conectar('Jogador');
    instancias[0]!.abrir();

    // Cinco quedas seguidas, cada uma sem nunca abrir de novo — o pior caso.
    const backoff = [500, 1000, 2000, 4000, 8000];
    for (let i = 0; i < backoff.length; i++) {
      instancias[instancias.length - 1]!.cair();
      expect(rede.fechado, `tentativa ${i}`).toBe(false);
      vi.advanceTimersByTime(backoff[i]!);
    }
    // A tentativa (instancias.length agora é 6: a original + 5 reconexões)
    // também cai, e desta vez não há mais backoff — desiste de verdade.
    instancias[instancias.length - 1]!.cair();
    expect(rede.fechado).toBe(true);

    // E não tenta uma sexta vez.
    vi.advanceTimersByTime(20000);
    expect(instancias.length).toBe(6);
  });

  it('desconectar() de propósito não reconecta', () => {
    const rede = new Rede('ws://teste');
    rede.conectar('Jogador');
    instancias[0]!.abrir();

    rede.desconectar();
    expect(instancias[0]!.readyState).toBe(WebSocketFalso.CLOSED);

    vi.advanceTimersByTime(20000);
    expect(instancias.length).toBe(1);
    expect(rede.fechado).toBe(false);
  });
});
