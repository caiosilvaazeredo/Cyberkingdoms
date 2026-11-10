import type { Animacao } from '../arte';

/**
 * A fronteira entre o jogo e o renderer voxel.
 *
 * ## O que atravessa, e o que não
 *
 * O jogo continua decidindo **o que** desenhar exatamente como antes:
 * `folhaDaUnidade` escolhe a folha, o quadro e o lado, com a mesma máquina de
 * estados, os mesmos nomes e os mesmos fps. O que atravessa esta interface é
 * só essa escolha — "esta `Animacao`, quadro tal, neste ponto do mundo,
 * espelhada ou não". Quem está do outro lado troca o retângulo de pixels por
 * um modelo e mais nada: colisão, hitbox e simulação nem sabem que ele existe.
 *
 * ## Por que o three.js não aparece aqui
 *
 * Este arquivo é importado por `desenho.ts`, que todo mundo carrega. A
 * implementação (`render3d.ts`) é importada por `import()` só quando o ajuste
 * pede 3D — quem joga em 2D não baixa a biblioteca.
 *
 * ## Por que "recorte"
 *
 * Enquanto só parte do jogo tem modelo, 2D e 3D convivem no mesmo quadro. O
 * renderer desenha todos os modelos de uma vez num canvas próprio, e cada
 * unidade cola o seu pedaço no canvas 2D **na vez dela** na ordenação por y —
 * é o que mantém o guerreiro voxel atrás da árvore que ainda é sprite.
 */
export interface Recorte {
  x: number;
  y: number;
  l: number;
  a: number;
}

export interface CameraDoMundo {
  x: number;
  y: number;
  zoom: number;
}

export interface PintorVoxel {
  /** Abre o quadro: câmera e tamanho da tela em pixels de CSS. */
  comecar(camera: CameraDoMundo, largura: number, altura: number, dpr: number): void;
  /**
   * Põe um quadro de uma folha em cena.
   *
   * `x`/`y` são o ponto do mundo em que o 2D ancoraria a mesma folha, e
   * `escala` é o fator do sprite (1 para as unidades). Devolve `null` quando
   * a folha ainda não tem modelo — e aí quem chamou desenha o sprite.
   */
  folha(
    anim: Animacao,
    indice: number,
    x: number,
    y: number,
    escala: number,
    espelhar: boolean,
  ): Recorte | null;
  /** Desenha tudo o que foi posto em cena desde `comecar`. */
  renderizar(): void;
  /** Cola um pedaço do quadro 3D no canvas 2D. */
  colar(ctx: CanvasRenderingContext2D, recorte: Recorte): void;
}

/** O índice que `tools/voxelizar.py` escreve em `public/voxel/indice.json`. */
export interface IndiceDeVoxels {
  /** Caminho da folha em `/tiny` (sem `.png`) → o modelo e a paleta dela. */
  folhas: Record<string, { glb: string; paleta: string }>;
}
