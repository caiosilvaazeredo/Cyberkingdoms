/**
 * Carregamento de imagem e recorte de folha de sprites.
 *
 * ## Por que uma folha vira quadros quadrados
 *
 * Todas as animações do Tiny Swords são tiras horizontais de quadros quadrados:
 * o `Pawn_Idle` tem 1536×192, que são oito quadros de 192; a espuma tem
 * 3072×192, dezesseis quadros. Deduzir o lado pela **altura** da imagem cobre o
 * pacote inteiro sem precisar de uma tabela de metadados que teria de ser
 * mantida em sincronia com os arquivos.
 */

export async function carregarImagem(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

export interface Animacao {
  readonly imagem: HTMLImageElement;
  /** Lado do quadro, em pixels. */
  readonly lado: number;
  readonly quadros: number;
  /** Quadros por segundo. */
  readonly fps: number;
}

export function animacao(imagem: HTMLImageElement, fps = 10): Animacao {
  const lado = imagem.height;
  return { imagem, lado, quadros: Math.max(1, Math.round(imagem.width / lado)), fps };
}

/**
 * Desenha um quadro de uma animação, ancorado no **pé** do sprite.
 *
 * A âncora no pé é o que faz um personagem alto e uma pedra baixa ficarem
 * plantados no mesmo chão: ancorar no centro deixaria cada sprite flutuando uma
 * fração da própria altura acima do tile.
 */
export function desenharQuadro(
  ctx: CanvasRenderingContext2D,
  anim: Animacao,
  indice: number,
  x: number,
  y: number,
  escala = 1,
): void {
  const q = ((indice % anim.quadros) + anim.quadros) % anim.quadros;
  const largura = anim.lado * escala;
  const altura = anim.lado * escala;
  ctx.drawImage(
    anim.imagem,
    q * anim.lado,
    0,
    anim.lado,
    anim.lado,
    Math.round(x - largura / 2),
    Math.round(y - altura),
    Math.round(largura),
    Math.round(altura),
  );
}

/** Índice do quadro para um instante, com deslocamento por instância. */
export function quadroEm(anim: Animacao, segundos: number, deslocamento = 0): number {
  return Math.floor(segundos * anim.fps) + deslocamento;
}
