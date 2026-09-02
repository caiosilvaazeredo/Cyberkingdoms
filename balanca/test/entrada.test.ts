import { describe, expect, it } from 'vitest';

import { mensagemDeEntrada } from '../src/client/rede';
import { VERSAO_DO_PROTOCOLO, salaConfiguravel } from '../src/shared/protocolo';

/**
 * A mensagem de entrada do cliente.
 *
 * Este arquivo existe por causa de um defeito real: `criar` foi acrescentado ao
 * chamador e esquecido no montador da mensagem, e quem pedia uma sala montada
 * recebia uma sala comum do lobby. Nada acusou — o compilador não confere
 * excesso em propriedade que nasce de espalhamento condicional, e o jogo
 * funcionava, só que numa sala diferente da pedida.
 *
 * A lição não é "revisar melhor": é que um pedaço de dado que o cliente monta e
 * o servidor lê precisa ser testável sem um WebSocket no meio. É o que estes
 * testes fazem — conferem que **cada destino chega inteiro no pacote**.
 */

describe('a mensagem de entrada', () => {
  it('sem destino, não pede sala nenhuma — o lobby decide', () => {
    const m = mensagemDeEntrada('Ana', true, {});
    expect(m).toEqual({ t: 'entrar', nome: 'Ana', versao: VERSAO_DO_PROTOCOLO, assistindo: true });
    // Os campos ausentes são ausentes de verdade, e não `undefined`: o servidor
    // distingue "não pedi sala" de "pedi a sala `undefined`".
    expect('sala' in m).toBe(false);
    expect('criar' in m).toBe(false);
    expect('privada' in m).toBe(false);
  });

  it('leva a sala pedida pelo nome — é como o sofá inteiro cai junto', () => {
    const m = mensagemDeEntrada('Bia', false, { sala: 'mesa-3' });
    expect(m.sala).toBe('mesa-3');
  });

  it('leva a marca de sala privada', () => {
    expect(mensagemDeEntrada('Cau', false, { privada: true }).privada).toBe(true);
  });

  it('leva a configuração da sala montada, inteira', () => {
    // O defeito que deu origem a este arquivo. Se `criar` sumir de novo, é aqui
    // que aparece — e não numa partida em que alguém percebe, dez minutos
    // depois, que os npcs não são os que pediu.
    const criar = salaConfiguravel({ modo: 'banquete', mapa: 'vau', porTime: 2, bots: 3 });
    const m = mensagemDeEntrada('Dora', true, { criar });
    // Comparação exata, e não parcial: é ela que faz este teste falhar quando o
    // formato ganha um campo novo, que é exatamente quando alguém precisa parar
    // e conferir se o campo novo está sendo repassado.
    expect(m.criar).toEqual({
      modo: 'banquete',
      mapa: 'vau',
      porTime: 2,
      bots: 3,
      privada: false,
    });
  });

  it('leva os três juntos quando os três foram pedidos', () => {
    const criar = salaConfiguravel({ porTime: 1, bots: 1, privada: true });
    const m = mensagemDeEntrada('Edu', false, { sala: 'mesa-9', privada: true, criar });
    expect(m).toMatchObject({ sala: 'mesa-9', privada: true, criar });
  });

  it('declara a versão do protocolo — é o que barra um cliente velho', () => {
    expect(mensagemDeEntrada('Ana', false, {}).versao).toBe(VERSAO_DO_PROTOCOLO);
  });
});
