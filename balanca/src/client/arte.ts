import type { Time } from '../shared/regras';

/**
 * A arte: carregamento, recorte de folha e tintura por time.
 *
 * ## De onde vem o desenho
 *
 * O pacote Tiny Swords, o mesmo que o resto do repositório usa. Ele traz um
 * peão, prédios em cinco cores de telhado, mato e água — e é quase exatamente o
 * que este jogo precisa, porque um jogo de castelo com dois times de bonequinho
 * gordo é o que aquele pacote foi desenhado para ser.
 *
 * Só a arte que entra na tela foi copiada para `public/tiny`: dois telhados dos
 * cinco, cinco formas das oito, e nada da interface de papel — o HUD é
 * desenhado. Copiar o pacote inteiro seria um megabyte que o jogador baixa para
 * não ver.
 *
 * ## Por que a tintura é feita uma vez, e não a cada quadro
 *
 * Colorir um sprite no `canvas` custa duas operações de composição. Fazer isso
 * doze vezes por quadro, sessenta vezes por segundo, é trabalho suficiente para
 * aparecer no celular. Como só existem dois times, as duas folhas tintas são
 * pintadas uma vez no carregamento e depois só se desenham.
 *
 * A tintura é `source-atop` com transparência: mantém o sombreado original do
 * pixel art por baixo e empurra a matiz para a cor do time. Substituir a cor
 * chapada apagaria o volume que o desenhista pintou à mão.
 */

export interface Animacao {
  readonly imagem: CanvasImageSource;
  readonly lado: number;
  readonly quadros: number;
  readonly fps: number;
}

export interface Arte {
  readonly chao: HTMLImageElement;
  readonly agua: HTMLImageElement;
  readonly espuma: Animacao;
  readonly arvores: readonly Animacao[];
  readonly arbustos: readonly Animacao[];
  readonly pedras: readonly HTMLImageElement[];
  readonly predios: Readonly<Record<string, HTMLImageElement>>;
  readonly fogo: Animacao;
  readonly fumaca: Animacao;
  /** Peão parado e correndo, já tintos, por time. */
  readonly parado: Readonly<Record<Time, Animacao>>;
  readonly correndo: Readonly<Record<Time, Animacao>>;
  /** A princesa é o mesmo peão, tinto de rosa. */
  readonly princesa: Animacao;
  readonly princesaCorrendo: Animacao;
}

const RAIZ = '/tiny';

/** As cores de telhado que cada time veste. */
export const COR_DO_TIME: Readonly<Record<Time, string>> = {
  azul: 'blue',
  vermelho: 'red',
};

export const TINTA_DO_TIME: Readonly<Record<Time, string>> = {
  azul: '#2f6fd0',
  vermelho: '#cf3b2f',
};

const FORMAS = ['Castle', 'Tower', 'Monastery', 'Barracks', 'House1'] as const;

async function carregar(caminho: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = `${RAIZ}/${caminho}`;
  await img.decode();
  return img;
}

function animacao(imagem: CanvasImageSource, largura: number, altura: number, fps: number): Animacao {
  return { imagem, lado: altura, quadros: Math.max(1, Math.round(largura / altura)), fps };
}

/** Pinta uma folha inteira com a cor do time, preservando o sombreado. */
function tingir(img: HTMLImageElement, cor: string, forca: number): HTMLCanvasElement {
  const tela = document.createElement('canvas');
  tela.width = img.width;
  tela.height = img.height;
  const ctx = tela.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0);
  ctx.globalCompositeOperation = 'source-atop';
  ctx.globalAlpha = forca;
  ctx.fillStyle = cor;
  ctx.fillRect(0, 0, tela.width, tela.height);
  return tela;
}

export async function carregarArte(): Promise<Arte> {
  const [chao, agua, espuma, parado, correndo, fogo, fumaca] = await Promise.all([
    carregar('terrain/ground.png'),
    carregar('terrain/water.png'),
    carregar('terrain/foam.png'),
    carregar('units/Pawn_Idle.png'),
    carregar('units/Pawn_Run.png'),
    carregar('fx/fogo.png'),
    carregar('fx/fumaca.png'),
  ]);

  const arvores = await Promise.all([1, 2, 3, 4].map((n) => carregar(`deco/Tree${n}.png`)));
  const arbustos = await Promise.all([1, 2, 3, 4].map((n) => carregar(`deco/Bushe${n}.png`)));
  const pedras = await Promise.all([1, 2, 3, 4].map((n) => carregar(`deco/Rock${n}.png`)));

  const predios: Record<string, HTMLImageElement> = {};
  await Promise.all(
    (['blue', 'red'] as const).flatMap((cor) =>
      FORMAS.map(async (forma) => {
        predios[`${cor}/${forma}`] = await carregar(`buildings/${cor}/${forma}.png`);
      }),
    ),
  );

  const porTime = <T>(fn: (t: Time) => T): Record<Time, T> => ({
    azul: fn('azul'),
    vermelho: fn('vermelho'),
  });

  return {
    chao,
    agua,
    espuma: animacao(espuma, espuma.width, espuma.height, 8),
    arvores: arvores.map((i) => animacao(i, i.width, i.height, 8)),
    arbustos: arbustos.map((i) => animacao(i, i.width, i.height, 6)),
    pedras,
    predios,
    fogo: animacao(fogo, fogo.width, fogo.height, 12),
    fumaca: animacao(fumaca, fumaca.width, fumaca.height, 10),
    parado: porTime((t) =>
      animacao(tingir(parado, TINTA_DO_TIME[t], 0.5), parado.width, parado.height, 8),
    ),
    correndo: porTime((t) =>
      animacao(tingir(correndo, TINTA_DO_TIME[t], 0.5), correndo.width, correndo.height, 12),
    ),
    princesa: animacao(tingir(parado, '#ff7bc2', 0.55), parado.width, parado.height, 6),
    princesaCorrendo: animacao(tingir(correndo, '#ff7bc2', 0.55), correndo.width, correndo.height, 10),
  };
}

/** Desenha um quadro ancorado no pé do sprite. */
export function quadro(
  ctx: CanvasRenderingContext2D,
  anim: Animacao,
  indice: number,
  x: number,
  y: number,
  escala: number,
): void {
  const q = ((indice % anim.quadros) + anim.quadros) % anim.quadros;
  const lado = anim.lado * escala;
  ctx.drawImage(
    anim.imagem,
    q * anim.lado,
    0,
    anim.lado,
    anim.lado,
    Math.round(x - lado / 2),
    Math.round(y - lado),
    Math.ceil(lado),
    Math.ceil(lado),
  );
}

export function quadroEm(anim: Animacao, segundos: number, deslocamento = 0): number {
  return Math.floor(segundos * anim.fps) + deslocamento;
}
