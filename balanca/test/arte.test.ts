import { describe, expect, it } from 'vitest';

import { animacao } from '../src/client/arte';

describe('folhas de decoração', () => {
  it('recorta os oito quadros retangulares das árvores altas', () => {
    const folha = { width: 1536, height: 256 } as HTMLImageElement;
    const arvore = animacao(folha, 8, 192);

    expect(arvore.quadros).toBe(8);
    expect(arvore.larguraQuadro).toBe(192);
    expect(arvore.lado).toBe(256);
  });
});
