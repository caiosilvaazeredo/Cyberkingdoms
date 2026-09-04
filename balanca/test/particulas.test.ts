import { describe, expect, it } from 'vitest';

import { animacao, type Arte } from '../src/client/arte';
import type { Vista } from '../src/client/desenho';
import { Particulas } from '../src/client/particulas';

/**
 * `Particulas.desenhar()` só pede um `CanvasRenderingContext2D` de verdade
 * por causa do `drawImage` final — todo o resto (quando um efeito morre,
 * quando ele começa a sumir) é aritmética pura. Este stub grava as chamadas
 * sem abrir um canvas real, que Node não tem.
 */
function ctxDeMentira(aoDesenhar?: (alpha: number) => void): CanvasRenderingContext2D {
  const ctx = {
    globalAlpha: 1,
    drawImage: () => aoDesenhar?.(ctx.globalAlpha),
  };
  return ctx as unknown as CanvasRenderingContext2D;
}

const VISTA_IDENTIDADE: Vista = { paraTelaX: (x) => x, paraTelaY: (y) => y, escala: 1 };

/** Uma `Arte` só com o `trollCaido` de que este teste precisa. */
function arteComTrollCaido(quadros: number, fps: number): Arte {
  const folha = animacao({ width: quadros * 10, height: 10 } as HTMLImageElement, fps, 10);
  return { efeitos: { trollCaido: folha } } as unknown as Arte;
}

describe('o resquício de batalha (Troll Dead) segura o último quadro antes de sumir', () => {
  it('sobrevive à duração da folha, e só desaparece depois de duracao + segura', () => {
    // 8 quadros a 8fps: a folha dura 1s. A receita do trollCaido soma 6s de
    // `segura` — o efeito só devia sumir em 7s de relógio, não em 1s.
    const arte = arteComTrollCaido(8, 8);
    const particulas = new Particulas();
    particulas.acender(arte, 'trollCaido', 100, 100, 0);

    let chamadas = 0;
    const ctx = ctxDeMentira(() => chamadas++);

    // Dentro da folha (0.5s de 1s): vivo.
    particulas.desenhar(ctx, VISTA_IDENTIDADE, 1, 0.5);
    expect(chamadas).toBe(1);

    // Passou da folha (1.5s), mas ainda dentro do segura de 6s: continua
    // vivo, preso no último quadro — é exatamente o comportamento que
    // `segura` existe para dar.
    chamadas = 0;
    particulas.desenhar(ctx, VISTA_IDENTIDADE, 1, 1.5);
    expect(chamadas).toBe(1);

    // Passou de duracao + segura (1 + 6 = 7s): já era para ter sumido.
    chamadas = 0;
    particulas.desenhar(ctx, VISTA_IDENTIDADE, 1, 7.5);
    expect(chamadas).toBe(0);

    // E continua sumido depois — `desenhar` já descartou o efeito da lista
    // interna na chamada anterior, não só ignorou por esta vez.
    particulas.desenhar(ctx, VISTA_IDENTIDADE, 1, 100);
    expect(chamadas).toBe(0);
  });

  it('desaparece suavizando: globalAlpha cai no último segundo da espera, e volta a 1 depois', () => {
    const arte = arteComTrollCaido(8, 8);
    const particulas = new Particulas();
    particulas.acender(arte, 'trollCaido', 0, 0, 0);

    let alphaAoDesenhar: number | null = null;
    const ctx = ctxDeMentira((alpha) => {
      alphaAoDesenhar = alpha;
    });

    // duracaoTotal = 7s. Em 6.7s, restante = 0.3s < 1 — o alfa no instante do
    // drawImage precisa refletir esse desvanecer.
    particulas.desenhar(ctx, VISTA_IDENTIDADE, 1, 6.7);
    expect(alphaAoDesenhar).not.toBeNull();
    expect(alphaAoDesenhar!).toBeCloseTo(0.3, 4);
    // E o alfa da própria folha não fica manchado para o próximo efeito.
    expect(ctx.globalAlpha).toBe(1);
  });
});
