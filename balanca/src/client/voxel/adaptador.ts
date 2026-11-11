/**
 * A fronteira entre o jogo e o renderer voxel.
 *
 * ## O que atravessa, e o que não
 *
 * O jogo continua decidindo **o que** desenhar exatamente como antes: a mesma
 * máquina de estados escolhe a folha, o quadro e o lado, com os mesmos nomes e
 * os mesmos fps, e manda desenhar com `drawImage`. O renderer voxel recebe o
 * mundo por um contexto 2D de mentira que **grava** esses pedidos: quando a
 * imagem pedida tem modelo em `public/voxel`, ele põe o modelo em cena no
 * mesmo lugar, com o mesmo quadro e a mesma escala; quando não tem, o pedido
 * segue para o canvas como sempre.
 *
 * Por isso `desenho.ts` não sabe que o 3D existe — nem a simulação, a colisão
 * ou as hitboxes, que continuam em 2D.
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

export interface PintorVoxel {
  /**
   * Desenha um quadro do mundo.
   *
   * `pintar` é o desenho 2D de sempre; ele recebe o contexto gravador no lugar
   * do de verdade. `largura` e `altura` são em pixels de CSS.
   */
  desenhar(
    ctx: CanvasRenderingContext2D,
    camera: CameraDoMundo,
    largura: number,
    altura: number,
    pintar: (ctx: CanvasRenderingContext2D) => void,
  ): void;
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
  meiaProfundidade: number;
  /** O topo fica na cor exata do pixel (chão e prédios), sem clarear. */
  topoExato?: boolean;
  paletas: Record<string, string[]>;
}

/** O índice que `tools/voxelizar.py` escreve em `public/voxel/indice.json`. */
export interface IndiceDeVoxels {
  /** Caminho da folha em `/tiny` (sem `.png`) → o modelo e a paleta dela. */
  folhas: Record<string, { glb: string; paleta: string }>;
  modelos: Record<string, ModeloNoIndice>;
}
