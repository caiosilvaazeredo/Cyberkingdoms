/**
 * A ferramenta de sprite: corta uma imagem solta, ou uma folha de quadros
 * inteira, no formato que o jogo já espera — uma tira horizontal de quadros
 * do mesmo tamanho, um do lado do outro (é assim que toda `unidades/*.png`
 * do jogo já é lida, em `arte.ts`: `quadros = imagem.width / larguraQuadro`).
 *
 * Não converte nada, não redimensiona, não retinge — só corta e recompõe.
 * Isso é de propósito: qualquer coisa mais esperta (auto-detecção de bordas,
 * reamostragem) arrisca introduzir um artefato de um pixel que só aparece
 * dentro do jogo, tarde demais para associar à ferramenta.
 */

export interface RetanguloDeRecorte {
  x: number;
  y: number;
  largura: number;
  altura: number;
}

export class FerramentaDeSprite {
  imagem: HTMLImageElement | null = null;
  larguraDoQuadro = 192;
  alturaDoQuadro = 192;
  /** Índices `col,row` (na grade atual), na ordem em que devem sair na tira. */
  selecionados: { col: number; row: number }[] = [];
  recorteLivre: RetanguloDeRecorte | null = null;

  get colunas(): number {
    if (!this.imagem) return 0;
    return Math.max(1, Math.floor(this.imagem.width / this.larguraDoQuadro));
  }

  get linhas(): number {
    if (!this.imagem) return 0;
    return Math.max(1, Math.floor(this.imagem.height / this.alturaDoQuadro));
  }

  async carregar(arquivo: File): Promise<void> {
    const url = URL.createObjectURL(arquivo);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      this.imagem = img;
      this.selecionados = [];
      this.recorteLivre = null;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /** Clique num quadro da grade: entra se não estava, sai se já estava. */
  alternarQuadro(col: number, row: number): void {
    const i = this.selecionados.findIndex((q) => q.col === col && q.row === row);
    if (i >= 0) this.selecionados.splice(i, 1);
    else this.selecionados.push({ col, row });
  }

  limparSelecao(): void {
    this.selecionados = [];
  }

  /** Recorta um quadro da grade para um canvas novo, no tamanho exato dele. */
  private recortarQuadro(col: number, row: number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = this.larguraDoQuadro;
    c.height = this.alturaDoQuadro;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      this.imagem!,
      col * this.larguraDoQuadro,
      row * this.alturaDoQuadro,
      this.larguraDoQuadro,
      this.alturaDoQuadro,
      0,
      0,
      this.larguraDoQuadro,
      this.alturaDoQuadro,
    );
    return c;
  }

  /** A tira final — os quadros selecionados, na ordem do clique, lado a lado. */
  montarTira(): HTMLCanvasElement {
    const n = Math.max(1, this.selecionados.length);
    const c = document.createElement('canvas');
    c.width = this.larguraDoQuadro * n;
    c.height = this.alturaDoQuadro;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    this.selecionados.forEach((q, i) => {
      const quadro = this.recortarQuadro(q.col, q.row);
      ctx.drawImage(quadro, i * this.larguraDoQuadro, 0);
    });
    return c;
  }

  montarRecorteLivre(): HTMLCanvasElement | null {
    if (!this.recorteLivre || !this.imagem) return null;
    const { x, y, largura, altura } = this.recorteLivre;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(largura));
    c.height = Math.max(1, Math.round(altura));
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.imagem, x, y, largura, altura, 0, 0, c.width, c.height);
    return c;
  }
}

/** Baixa um canvas como arquivo PNG — o mesmo gesto para tira e recorte. */
export function baixarComoPng(canvas: HTMLCanvasElement, nomeDoArquivo: string): void {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nomeDoArquivo.endsWith('.png') ? nomeDoArquivo : `${nomeDoArquivo}.png`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }, 'image/png');
}
