import { CLASSES, type Classe } from '../shared/classes';
import { TIMES, type Time } from '../shared/regras';

/**
 * A arte: carregamento das folhas do Tiny Swords e recorte em quadros.
 *
 * ## Cada classe tem as folhas dela, e é isso que dá identidade ao jogo
 *
 * O pacote traz unidades inteiras — Warrior, Lancer, Archer, Monk e o Pawn com
 * machado, picareta e faca —, cada uma com parado, corrida e o próprio gesto de
 * golpe. Usar as folhas certas em vez de recolorir um peão só é a diferença
 * entre doze bonecos iguais e um campo onde se lê, de longe, que o vulto que
 * vem pela ponte é um lanceiro.
 *
 * Os nomes já chegam traduzidos: `tools/importar-arte.mjs` copia do pacote e
 * renomeia para o vocabulário do jogo, para que o inglês do Pixel Frog não
 * apareça no meio de um `switch` em português.
 *
 * ## Por que o lado do quadro sai da altura da imagem
 *
 * Todas as folhas do pacote são tiras horizontais de quadros quadrados: o
 * `guerreiro_parado` tem 1536×192, que são oito quadros de 192; o lanceiro usa
 * caixa de 320 porque a lança não cabe em 192. Deduzir o lado pela **altura**
 * cobre o pacote inteiro sem uma tabela de metadados para manter em sincronia.
 *
 * ## Por que não se tinge mais nada
 *
 * Antes o peão era pintado com a cor do time por composição. Agora não precisa:
 * o pacote entrega cada unidade nas cinco cores, e o azul e o vermelho vêm
 * prontos do desenhista — com o sombreado certo, que a tintura achatava.
 */

export interface Animacao {
  readonly imagem: CanvasImageSource;
  /** Largura de cada quadro; difere da altura nas árvores altas. */
  readonly larguraQuadro: number;
  readonly lado: number;
  readonly quadros: number;
  readonly fps: number;
}

const RAIZ = '/tiny';

/** Quadros por segundo que o pacote assume. Está escrito na página dele. */
const FPS_DO_PACOTE = 10;

/** As folhas de cada unidade, por chave (`'guerreiro_parado'`). */
export type Folhas = Readonly<Record<string, Animacao>>;

export interface Arte {
  readonly chao: HTMLImageElement;
  readonly agua: HTMLImageElement;
  readonly espuma: Animacao;
  readonly sombra: HTMLImageElement;
  readonly arvores: readonly Animacao[];
  readonly tocos: readonly HTMLImageElement[];
  readonly arbustos: readonly Animacao[];
  readonly pedras: readonly HTMLImageElement[];
  readonly predios: Readonly<Record<string, HTMLImageElement>>;
  readonly fogo: Animacao;
  readonly fumaca: Animacao;
  /** Unidades, por time e por chave de folha. */
  readonly unidades: Readonly<Record<Time, Folhas>>;
  readonly ovelha: Readonly<Record<'parada' | 'andando' | 'pastando', Animacao>>;
  /**
   * O ícone de cada carga no chão.
   *
   * `HTMLCanvasElement` entra na união porque o minério é repintado no
   * carregamento (ver `pedra`), e não um arquivo. As duas formas têm `width`,
   * que é o que o desenho precisa — `CanvasImageSource` sozinho não tem.
   */
  readonly recursos: Readonly<
    Record<'minerio' | 'madeira' | 'ouro', HTMLImageElement | HTMLCanvasElement>
  >;
  readonly jazidaOuro: HTMLImageElement;
  readonly jazidaOuroVazia: HTMLImageElement;
}

async function carregar(caminho: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = `${RAIZ}/${caminho}`;
  await img.decode();
  return img;
}

/** Pinta uma folha inteira com uma cor, preservando o sombreado. */
function tingir(
  img: HTMLImageElement | HTMLCanvasElement,
  cor: string,
  forca: number,
): HTMLCanvasElement {
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

/**
 * O bife do pacote virando pedra de minério.
 *
 * O Tiny Swords não tem sprite de minério, e o que o saqueador derruba da mula
 * é justamente o alforje de pedra. Repintar sai mais barato — e sai melhor —
 * que desenhar: no tamanho em que a coisa aparece em jogo, o que se lê é a
 * silhueta de um bloco carregado na cabeça, e o vermelho do bife era a única
 * coisa que a denunciava.
 *
 * São duas passadas porque uma só não chega lá. A primeira **apaga** o vermelho
 * quase por inteiro; sozinha, ela deixa um cinza de chumbo que some no chão. A
 * segunda devolve o ocre que faz a pedra parecer que tem metal dentro.
 */
function pedra(img: HTMLImageElement): HTMLCanvasElement {
  return tingir(tingir(img, '#7c8088', 0.82), '#c79a3c', 0.22);
}

export function animacao(
  imagem: HTMLImageElement,
  fps = FPS_DO_PACOTE,
  larguraQuadro = imagem.height,
): Animacao {
  const lado = imagem.height;
  return {
    imagem,
    larguraQuadro,
    lado,
    quadros: Math.max(1, Math.floor(imagem.width / larguraQuadro)),
    fps,
  };
}

/** As folhas que cada classe pede, além das comuns a todas. */
const FOLHAS_POR_CLASSE: Readonly<Record<Classe, readonly string[]>> = {
  aldeao: [],
  guerreiro: ['golpe1', 'golpe2'],
  // A lança é a única com folha por direção — o pacote desenha a estocada para
  // cima, para o lado e para baixo, e o espelho horizontal dá o resto.
  lanceiro: ['golpe_lado', 'golpe_cima_lado', 'golpe_baixo_lado', 'golpe_cima', 'golpe_baixo'],
  arqueiro: ['golpe'],
  clerigo: ['golpe', 'bencao'],
  minerador: ['trabalhando'],
  lenhador: ['trabalhando'],
  saqueador: ['trabalhando'],
};

/** O nome do arquivo de cada ofício segue a ferramenta, como no pacote. */
export const FERRAMENTA_DA_CLASSE: Readonly<Partial<Record<Classe, string>>> = {
  minerador: 'picareta',
  lenhador: 'machado',
  saqueador: 'faca',
};

/** A carga na mão troca a folha inteira: o peão carrega com os dois braços. */
export const CARGAS_DESENHADAS = ['madeira', 'ouro', 'minerio'] as const;

function arquivoDaClasse(classe: Classe): string {
  return FERRAMENTA_DA_CLASSE[classe] ?? classe;
}

/** Progresso do carregamento, para a tela de espera mostrar algo honesto. */
export type AoCarregar = (feitos: number, total: number) => void;

export async function carregarArte(aoCarregar?: AoCarregar): Promise<Arte> {
  const pedidos: { chave: string; caminho: string }[] = [];
  const pede = (chave: string, caminho: string): void => {
    pedidos.push({ chave, caminho });
  };

  pede('chao', 'terrain/ground.png');
  pede('agua', 'terrain/water.png');
  pede('espuma', 'terrain/foam.png');
  pede('sombra', 'terrain/shadow.png');
  pede('fogo', 'fx/fogo.png');
  pede('fumaca', 'fx/fumaca.png');
  for (let i = 1; i <= 4; i++) {
    pede(`arvore${i}`, `deco/Tree${i}.png`);
    pede(`toco${i}`, `deco/Stump${i}.png`);
    pede(`arbusto${i}`, `deco/Bushe${i}.png`);
    pede(`pedra${i}`, `deco/Rock${i}.png`);
  }
  for (const cor of ['blue', 'red']) {
    for (const forma of ['Castle', 'Tower', 'Monastery', 'Barracks', 'House1']) {
      pede(`predio:${cor}/${forma}`, `buildings/${cor}/${forma}.png`);
    }
  }
  pede('ovelha_parada', 'recursos/ovelha_parada.png');
  pede('ovelha_andando', 'recursos/ovelha_andando.png');
  pede('ovelha_pastando', 'recursos/ovelha_pastando.png');
  pede('recurso_minerio', 'recursos/minerio.png');
  pede('recurso_madeira', 'recursos/madeira.png');
  pede('recurso_ouro', 'recursos/ouro.png');
  pede('jazida_ouro', 'recursos/jazida_ouro.png');
  pede('jazida_ouro_vazia', 'recursos/jazida_ouro_vazia.png');

  for (const time of TIMES) {
    for (const classe of CLASSES) {
      const base = arquivoDaClasse(classe);
      pede(`u:${time}:${classe}_parado`, `units/${time}/${base}_parado.png`);
      pede(`u:${time}:${classe}_correndo`, `units/${time}/${base}_correndo.png`);
      for (const extra of FOLHAS_POR_CLASSE[classe]) {
        pede(`u:${time}:${classe}_${extra}`, `units/${time}/${base}_${extra}.png`);
      }
    }
    for (const carga of CARGAS_DESENHADAS) {
      pede(`u:${time}:carregando_${carga}_parado`, `units/${time}/carregando_${carga}_parado.png`);
      pede(
        `u:${time}:carregando_${carga}_correndo`,
        `units/${time}/carregando_${carga}_correndo.png`,
      );
    }
    pede(`u:${time}:flecha`, `units/${time}/flecha.png`);
  }

  const total = pedidos.length;
  let feitos = 0;
  const imagens: Record<string, HTMLImageElement> = {};
  await Promise.all(
    pedidos.map(async ({ chave, caminho }) => {
      imagens[chave] = await carregar(caminho);
      feitos++;
      aoCarregar?.(feitos, total);
    }),
  );

  const img = (chave: string): HTMLImageElement => {
    const i = imagens[chave];
    if (!i) throw new Error(`arte ausente: ${chave}`);
    return i;
  };

  const unidades = {} as Record<Time, Record<string, Animacao>>;
  for (const time of TIMES) {
    const folhas: Record<string, Animacao> = {};
    for (const { chave } of pedidos) {
      const prefixo = `u:${time}:`;
      if (!chave.startsWith(prefixo)) continue;
      folhas[chave.slice(prefixo.length)] = animacao(img(chave));
    }
    // As duas folhas de quem leva minério nascem do bife do pacote e passam
    // pela repintura antes de entrar no mapa. Feito aqui e não na hora de
    // desenhar: são duas composições por folha, e elas não mudam nunca.
    for (const folha of ['carregando_minerio_parado', 'carregando_minerio_correndo']) {
      const base = folhas[folha];
      if (base) folhas[folha] = { ...base, imagem: pedra(img(`u:${time}:${folha}`)) };
    }
    unidades[time] = folhas;
  }

  const predios: Record<string, HTMLImageElement> = {};
  for (const { chave } of pedidos) {
    if (chave.startsWith('predio:')) predios[chave.slice('predio:'.length)] = img(chave);
  }

  return {
    chao: img('chao'),
    agua: img('agua'),
    espuma: animacao(img('espuma'), 8),
    sombra: img('sombra'),
    // Tree1 e Tree2 são oito quadros de 192×256; Tree3 e Tree4 são quadradas.
    // Recortar as duas primeiras em 256×256 avançava 64 px no quadro vizinho e
    // deixava as faixas verticais visíveis entre as árvores.
    arvores: [
      animacao(img('arvore1'), 8, 192),
      animacao(img('arvore2'), 8, 192),
      animacao(img('arvore3'), 8),
      animacao(img('arvore4'), 8),
    ],
    tocos: [1, 2, 3, 4].map((i) => img(`toco${i}`)),
    arbustos: [1, 2, 3, 4].map((i) => animacao(img(`arbusto${i}`), 6)),
    pedras: [1, 2, 3, 4].map((i) => img(`pedra${i}`)),
    predios,
    fogo: animacao(img('fogo'), 12),
    fumaca: animacao(img('fumaca'), 10),
    unidades,
    ovelha: {
      parada: animacao(img('ovelha_parada'), 8),
      andando: animacao(img('ovelha_andando'), 10),
      pastando: animacao(img('ovelha_pastando'), 8),
    },
    recursos: {
      minerio: img('recurso_minerio'),
      madeira: img('recurso_madeira'),
      ouro: img('recurso_ouro'),
    },
    jazidaOuro: img('jazida_ouro'),
    jazidaOuroVazia: img('jazida_ouro_vazia'),
  };
}

/**
 * Desenha um quadro.
 *
 * @param ancora `'pe'` planta o sprite no chão pelo pé — é o que serve para
 * árvore e prédio. `'centro'` põe o meio do quadro no ponto, que é o que as
 * folhas de unidade pedem: o pacote desenha o boneco no centro de uma caixa
 * grande o bastante para a arma, e ancorar pelo pé faria o lanceiro (caixa de
 * 320) flutuar meio corpo acima do guerreiro (caixa de 192).
 */
export function quadro(
  ctx: CanvasRenderingContext2D,
  anim: Animacao,
  indice: number,
  x: number,
  y: number,
  escala: number,
  ancora: 'pe' | 'centro' = 'pe',
): void {
  const q = ((indice % anim.quadros) + anim.quadros) % anim.quadros;
  const largura = anim.larguraQuadro * escala;
  const altura = anim.lado * escala;
  ctx.drawImage(
    anim.imagem,
    q * anim.larguraQuadro,
    0,
    anim.larguraQuadro,
    anim.lado,
    Math.round(x - largura / 2),
    Math.round(ancora === 'pe' ? y - altura : y - altura / 2),
    Math.ceil(largura),
    Math.ceil(altura),
  );
}

export function quadroEm(anim: Animacao, segundos: number, deslocamento = 0): number {
  return Math.floor(segundos * anim.fps) + deslocamento;
}

/** O quadro de uma animação que toca **uma vez**, dado o quanto ela já andou. */
export function quadroDaVez(anim: Animacao, progresso: number): number {
  return Math.min(anim.quadros - 1, Math.max(0, Math.floor(progresso * anim.quadros)));
}
