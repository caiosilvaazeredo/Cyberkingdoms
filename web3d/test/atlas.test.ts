import { describe, expect, it } from 'vitest';

import { animacao } from '../src/render2d/atlas';

describe('atlas de sprites', () => {
  it('mantém os oito quadros de uma árvore com quadros retangulares', () => {
    const folha = { width: 1536, height: 256 } as HTMLImageElement;
    const arvore = animacao(folha, 8, 192);

    expect(arvore.quadros).toBe(8);
    expect(arvore.larguraQuadro).toBe(192);
    expect(arvore.alturaQuadro).toBe(256);
  });
});
