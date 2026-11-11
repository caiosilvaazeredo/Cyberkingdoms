/**
 * A fronteira entre o jogo e o renderer 3D.
 *
 * ## O que atravessa, e o que não
 *
 * O jogo continua decidindo **o que** desenhar exatamente como antes: a mesma
 * máquina de estados escolhe a folha, o quadro e o lado, com os mesmos nomes e
 * os mesmos fps, e manda desenhar com `drawImage` num mundo plano visto de
 * cima. O renderer 3D recebe esse desenho por um contexto 2D de mentira que
 * **grava** os pedidos e os remonta em perspectiva:
 *
 * - imagem que tem modelo em `public/voxel` (chão, prédio, árvore, pedra) vira
 *   o modelo, no mesmo lugar do mundo;
 * - qualquer outra imagem (personagem, bicho, efeito) vira um sprite plano em
 *   pé, com o mesmo quadro e o mesmo espelho;
 * - o que é traço e texto (nome, barra de vida, baú, bolsa) é redesenhado em
 *   2D por cima, no ponto da tela em que a coisa foi parar.
 *
 * Por isso `desenho.ts` quase não sabe que o 3D existe — só avisa onde começa
 * a pintura de cada coisa (`abrirGrupo`) — e a simulação, a colisão e as
 * hitboxes continuam em 2D.
 *
 * ## Por que o three.js não aparece aqui
 *
 * Este arquivo é importado por `desenho.ts`, que todo mundo carrega. A
 * implementação (`render3d.ts`) vem por `import()` só quando o ajuste pede 3D
 * — quem joga em 2D não baixa a biblioteca.
 */
export interface CameraDoMundo {
  x: number;
  y: number;
  zoom: number;
}

export interface PontoNaTela {
  x: number;
  y: number;
  /** Pixels de tela por unidade de mundo naquela distância da câmera. */
  escala: number;
}

export interface PintorVoxel {
  /**
   * Diz quem a câmera segue de perto, por trás — ou `null` para a câmera de
   * plateia, alta e virada para o norte. A câmera se vira para onde ele
   * **anda**; `frente` só vale ao entrar em campo, antes do primeiro passo.
   */
  mirar(alvo: { x: number; y: number; frenteX: number; frenteY: number } | null, dt: number): void;
  /**
   * Para onde a câmera está virada, em radianos a partir do norte. É por
   * quanto se gira o que vem do controle: "para frente" é para onde ela olha.
   */
  readonly rumo: number;
  /** Aponta a câmera 3D. `camera` é a do jogo, usada na vista de plateia. */
  enquadrar(camera: CameraDoMundo, largura: number, altura: number): void;
  /**
   * Desenha um quadro do mundo.
   *
   * `pintar` é o desenho 2D de sempre. Ele recebe o contexto gravador no
   * lugar do de verdade, e a vista de cima em que deve desenhar — maior que a
   * tela, porque a câmera em perspectiva enxerga mais longe.
   */
  desenhar(
    ctx: CanvasRenderingContext2D,
    camera: CameraDoMundo,
    largura: number,
    altura: number,
    pintar: (
      ctx: CanvasRenderingContext2D,
      camera: CameraDoMundo,
      largura: number,
      altura: number,
    ) => void,
  ): void;
  /** Onde um ponto do chão do mundo cai na tela; `null` se atrás da câmera. */
  paraTela(x: number, y: number): PontoNaTela | null;
  /** Que ponto do chão está debaixo de um pixel; `null` se for céu. */
  paraMundo(telaX: number, telaY: number): { x: number; y: number } | null;
}

interface Gravador {
  grupoVoxel?: (y: number) => void;
  fimDosGruposVoxel?: () => void;
}

/**
 * Avisa que começa a pintura de **uma coisa** do mundo, na linha `y` dele.
 *
 * O desenho 2D põe o nome "34 pixels acima" do boneco; em perspectiva, isso só
 * tem sentido relativo ao boneco. O grupo é o que amarra o traço e o texto ao
 * objeto a que pertencem. No canvas de verdade isto não faz nada.
 */
export function abrirGrupo(ctx: CanvasRenderingContext2D, y: number): void {
  (ctx as unknown as Gravador).grupoVoxel?.(y);
}

/** Fecha a lista ordenada: o que vier depois é efeito solto por cima. */
export function fecharGrupos(ctx: CanvasRenderingContext2D): void {
  (ctx as unknown as Gravador).fimDosGruposVoxel?.();
}

/** Um modelo, como `tools/voxelizar.py` o descreve em `indice.json`. */
export interface ModeloNoIndice {
  glb: string;
  quadros: number;
  /** Quantos quadros por linha da folha (o chão é uma grade, não uma tira). */
  colunas: number;
  larguraQuadro: number;
  lado: number;
  /** `'pe'`: em pé no chão. `'chao'`: deitado, é um tile do terreno. */
  plano: 'pe' | 'chao';
  /** A linha do quadro em que ficam os pés — a origem vertical do modelo. */
  pes: number;
  /** É um prédio: esconde o nome e a barra de quem está atrás dele. */
  oclui?: boolean;
  paletas: Record<string, string[]>;
}

/** O índice que `tools/voxelizar.py` escreve em `public/voxel/indice.json`. */
export interface IndiceDeVoxels {
  /** Caminho da folha em `/tiny` (sem `.png`) → o modelo e a paleta dela. */
  folhas: Record<string, { glb: string; paleta: string }>;
  modelos: Record<string, ModeloNoIndice>;
  /** Folhas que ficam como sprite em pé: só se sabe onde estão os pés. */
  sprites: Record<string, { larguraQuadro: number; lado: number; pes: number }>;
}
