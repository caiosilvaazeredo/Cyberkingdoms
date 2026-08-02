import * as THREE from 'three';

import { buildingDef, type BuildingDef } from '../building/buildingType';
import type { PlacedBuilding, Plot } from '../building/plot';

/**
 * A grade do terreno, o fantasma da construção e os prédios já erguidos.
 *
 * ## Por que caixas, e não os sprites da Kenney
 *
 * O cliente isométrico desenhava sprites pré-renderizados. Em três dimensões
 * eles não servem: um sprite é uma foto de um ângulo, e aqui a câmera gira.
 * Trazer os modelos `.glb` de volta é trabalho de uma rodada inteira — carregar,
 * escalar, orientar, e um orçamento de memória de textura que ainda não existe.
 *
 * Até lá, cada construção é um bloco com a cor da categoria e a altura do
 * nível. Isso não é placeholder preguiçoso: num construtor de cidade, o que o
 * jogador lê de longe é **silhueta e cor**, não detalhe. Um bloco que respeita
 * a footprint correta comunica mais que um modelo bonito no lugar errado.
 *
 * ## Por que a grade só aparece no modo de construção
 *
 * Grade sempre visível vira ruído: o jogador passa 90% do tempo olhando a vila,
 * não encaixando peça. Ela entra quando ele escolhe o que construir e some
 * quando ele desiste.
 */

/** Metros por tile do terreno. */
export const TILE = 4;

const CATEGORY_COLORS: Record<string, number> = {
  housing: 0xd9a066,
  extraction: 0x8b6d4a,
  refining: 0x9aa0b5,
  manufacturing: 0x7f8fbf,
  commerce: 0xd4b062,
  infrastructure: 0x7ab8a0,
  defense: 0xb07a7a,
  civic: 0xa88fc0,
};

const VALID = 0x63e6a4;
const INVALID = 0xff6b6b;

export interface PlotView {
  readonly group: THREE.Group;
  /** Liga ou desliga a grade de encaixe. */
  setGridVisible(visible: boolean): void;
  /** Move o fantasma. `null` esconde. */
  showGhost(type: string | null, px: number, py: number, valid: boolean): void;
  /** Redesenha os prédios a partir do terreno. */
  sync(plot: Plot): void;
  /** Converte um ponto do mundo na célula da grade, ou `null` se fora. */
  cellAt(worldX: number, worldZ: number): { x: number; y: number } | null;
  dispose(): void;
}

export function createPlotView(plot: Plot, originX = 0, originZ = 0): PlotView {
  const group = new THREE.Group();

  const width = plot.width * TILE;
  const depth = plot.height * TILE;
  // O terreno é centrado na origem do mundo para a câmera começar olhando
  // para ele; a grade do jogo continua indexada de (0,0) no canto.
  const cornerX = originX - width / 2;
  const cornerZ = originZ - depth / 2;

  const toWorld = (px: number, py: number): [number, number] => [
    cornerX + px * TILE,
    cornerZ + py * TILE,
  ];

  // ------------------------------------------------------------------ grade
  const gridPoints: number[] = [];
  for (let i = 0; i <= plot.width; i++) {
    const x = cornerX + i * TILE;
    gridPoints.push(x, 0.06, cornerZ, x, 0.06, cornerZ + depth);
  }
  for (let j = 0; j <= plot.height; j++) {
    const z = cornerZ + j * TILE;
    gridPoints.push(cornerX, 0.06, z, cornerX + width, 0.06, z);
  }
  const gridGeom = new THREE.BufferGeometry();
  gridGeom.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(gridPoints, 3),
  );
  const gridMat = new THREE.LineBasicMaterial({
    color: 0x9ff0cf,
    transparent: true,
    opacity: 0.42,
  });
  const grid = new THREE.LineSegments(gridGeom, gridMat);
  grid.visible = false;
  group.add(grid);

  // Contorno do lote, sempre visível: é o que separa "seu" de "da cidade".
  const outlineGeom = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(cornerX, 0.08, cornerZ),
    new THREE.Vector3(cornerX + width, 0.08, cornerZ),
    new THREE.Vector3(cornerX + width, 0.08, cornerZ + depth),
    new THREE.Vector3(cornerX, 0.08, cornerZ + depth),
    new THREE.Vector3(cornerX, 0.08, cornerZ),
  ]);
  group.add(
    new THREE.Line(
      outlineGeom,
      new THREE.LineBasicMaterial({ color: 0x63e6a4, transparent: true, opacity: 0.8 }),
    ),
  );

  // --------------------------------------------------------------- fantasma
  const ghostGeom = new THREE.BoxGeometry(1, 1, 1);
  const ghostMat = new THREE.MeshStandardMaterial({
    color: VALID,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
  });
  const ghost = new THREE.Mesh(ghostGeom, ghostMat);
  ghost.visible = false;
  group.add(ghost);

  const buildings = new THREE.Group();
  group.add(buildings);

  function boxFor(def: BuildingDef, level: number): THREE.Vector3 {
    // Altura pelo nível, para o jogador ler evolução de longe sem abrir menu.
    return new THREE.Vector3(
      def.width * TILE * 0.86,
      2.2 + level * 1.6,
      def.height * TILE * 0.86,
    );
  }

  function place(
    mesh: THREE.Mesh,
    def: BuildingDef,
    px: number,
    py: number,
    level: number,
  ): void {
    const size = boxFor(def, level);
    mesh.scale.copy(size);
    // Ancora no centro da footprint, e não no canto: uma construção 3x2
    // colocada pelo canto fica meia célula fora da grade.
    const [wx, wz] = toWorld(px + def.width / 2, py + def.height / 2);
    mesh.position.set(wx, size.y / 2, wz);
  }

  return {
    group,

    setGridVisible(visible) {
      grid.visible = visible;
    },

    showGhost(type, px, py, valid) {
      if (!type) {
        ghost.visible = false;
        return;
      }
      const def = buildingDef(type);
      ghost.visible = true;
      ghostMat.color.setHex(valid ? VALID : INVALID);
      place(ghost, def, px, py, 1);
    },

    sync(current) {
      // Limpa e refaz. Com algumas dezenas de blocos isso custa menos que
      // manter um índice de instâncias em dia — e não erra.
      for (const child of [...buildings.children]) {
        buildings.remove(child);
        (child as THREE.Mesh).geometry.dispose();
        ((child as THREE.Mesh).material as THREE.Material).dispose();
      }

      for (const b of current.buildings as readonly PlacedBuilding[]) {
        const def = b.def;
        const material = new THREE.MeshStandardMaterial({
          color: b.accentColor ?? CATEGORY_COLORS[def.category] ?? 0xaaaaaa,
          roughness: 0.85,
          // Obra em andamento fica translúcida: é o mesmo sinal do cliente
          // isométrico, e o jogador já o conhece.
          transparent: !b.isReady,
          opacity: b.isReady ? 1 : 0.45,
        });
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
        place(mesh, def, b.x, b.y, b.level);
        mesh.userData.instanceId = b.instanceId;
        buildings.add(mesh);
      }
    },

    cellAt(worldX, worldZ) {
      const px = Math.floor((worldX - cornerX) / TILE);
      const py = Math.floor((worldZ - cornerZ) / TILE);
      if (px < 0 || py < 0 || px >= plot.width || py >= plot.height) return null;
      return { x: px, y: py };
    },

    dispose() {
      gridGeom.dispose();
      gridMat.dispose();
      outlineGeom.dispose();
      ghostGeom.dispose();
      ghostMat.dispose();
      for (const child of buildings.children) {
        (child as THREE.Mesh).geometry.dispose();
        ((child as THREE.Mesh).material as THREE.Material).dispose();
      }
    },
  };
}
