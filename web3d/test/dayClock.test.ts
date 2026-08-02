import { describe, expect, it } from 'vitest';

import {
  DAY_MS,
  DayClock,
  formatDays,
  formatRemaining,
} from '../src/campaign/dayClock';

describe('Relógio do reset diário', () => {
  const T0 = 1_700_000_000_000;

  it('começa no dia 1 com um dia inteiro pela frente', () => {
    const c = DayClock.start(T0);
    expect(c.day(T0)).toBe(1);
    expect(c.remaining(T0)).toBe(DAY_MS);
  });

  it('deriva o dia do relógio de parede, não de um contador', () => {
    // O jogo fechado por dois dias tem de voltar dois dias na frente. Um
    // contador que só soma com a aba aberta erraria exatamente aqui.
    const c = DayClock.start(T0);
    expect(c.day(T0 + DAY_MS * 2 + 1000)).toBe(3);
    expect(c.day(T0 + DAY_MS * 9.7)).toBe(10);
  });

  it('o prazo cai ao longo do dia e reinicia na virada', () => {
    const c = DayClock.start(T0);
    expect(c.remaining(T0 + DAY_MS * 0.25)).toBeCloseTo(DAY_MS * 0.75, 0);
    expect(c.remaining(T0 + DAY_MS - 1)).toBe(1);
    expect(c.remaining(T0 + DAY_MS)).toBe(DAY_MS);
  });

  it('relógio do sistema andando para trás não gera prazo maior que um dia', () => {
    // Acontece de verdade: fuso, sincronização de hora, aparelho voltando do
    // sono. Sem o módulo positivo, o resto vira negativo e o prazo passa de
    // 24 h — um cronômetro que sobe assusta mais do que um que zera.
    const c = DayClock.start(T0);
    const antes = T0 - DAY_MS * 0.3;
    expect(c.remaining(antes)).toBeGreaterThan(0);
    expect(c.remaining(antes)).toBeLessThanOrEqual(DAY_MS);
    expect(c.day(antes)).toBe(1);
  });

  it('encerrar o dia empurra a mesma linha do tempo', () => {
    // Não é um contador paralelo: o dia derivado continua valendo por cima.
    const c = DayClock.start(T0);
    c.endDay();
    expect(c.day(T0)).toBe(2);
    expect(c.day(T0 + DAY_MS)).toBe(3);
  });

  it('conta quantas viradas passaram desde a última vista', () => {
    const c = DayClock.start(T0);
    expect(c.consumeElapsed(1, T0 + DAY_MS * 3)).toBe(3);
    // Nunca negativo: o laço chama isto todo quadro e um valor negativo viraria
    // um tick para trás.
    expect(c.consumeElapsed(9, T0)).toBe(0);
  });

  it('sobrevive à ida e volta pelo JSON', () => {
    const c = DayClock.start(T0);
    c.endDay();
    const outro = DayClock.fromJson(c.toJson());
    expect(outro.day(T0 + DAY_MS)).toBe(c.day(T0 + DAY_MS));
  });

  it('save corrompido não vira "dia NaN"', () => {
    const c = DayClock.fromJson({ anchor: NaN, skipped: NaN });
    expect(Number.isFinite(c.day())).toBe(true);
    expect(c.day()).toBeGreaterThanOrEqual(1);
  });
});

describe('Formato dos prazos', () => {
  it('mostra hora, minuto e segundo com dois dígitos', () => {
    expect(formatRemaining(0)).toBe('00:00:00');
    expect(formatRemaining(DAY_MS - 1000)).toBe('23:59:59');
    expect(formatRemaining(3_723_000)).toBe('01:02:03');
  });

  it('prazo negativo não vira texto negativo', () => {
    expect(formatRemaining(-5000)).toBe('00:00:00');
  });

  it('concorda dias no singular e no plural', () => {
    expect(formatDays(0)).toBe('pronto');
    expect(formatDays(1)).toBe('1 dia');
    expect(formatDays(4)).toBe('4 dias');
  });
});
