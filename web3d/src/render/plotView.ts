import * as THREE from 'three';

import { buildingDef, type BuildingDef } from '../building/buildingType';
import type { PlacedBuilding, Plot } from '../building/plot';
import { instantiate } from './models';

/**
 * A grade do terreno, o fantasma da construção e os prédios já erguidos.
 *
 * ## Os modelos da Kenney, e a caixa como rede
 *
 * Cada construção usa o `.glb` que o catálogo já mapeava — o mesmo `spriteId`
 * que o cliente isométrico usava para escolher o sprite. Cheguei a desenhar
 * caixas coloridas argumentando que silhueta e cor bastam de longe; o
 * argumento não era falso, mas a conclusão era: a arte já existia e já estava
 * mapeada, e trocá-la por primitiva foi economia no lugar errado.
 *
 * A caixa continua no código como **rede**: o modelo chega por rede e pode
 * demorar ou faltar. Enquanto isso o bloco marca o lugar com a footprint
 * correta, e some quando o modelo entra. Um terreno que fica vazio esperando
 * download parece quebrado.
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
      // O fantasma segue sendo uma caixa, e de propósito: ele precisa aparecer
      // no mesmo quadro em que o dedo se move. Esperar um `.glb` para mostrar
      // onde a peça vai cair transformaria a mira num arrasto com atraso.
      const def = buildingDef(type);
      ghost.visible = true;
      ghostMat.color.setHex(valid ? VALID : INVALID);
      place(ghost, def, px, py, 1);
    },

    sync(current) {
      // Limpa e refaz. Com algumas dezenas de peças isso custa menos que
      // manter um índice de instâncias em dia — e não erra.
      for (const child of [...buildings.children]) {
        buildings.remove(child);
        child.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            o.geometry.dispose();
            const m = o.material;
            if (Array.isArray(m)) m.forEach((x) => x.dispose());
            else m.dispose();
          }
        });
      }

      for (const b of current.buildings as readonly PlacedBuilding[]) {
        const def = b.def;

        // Caixa primeiro, modelo depois. O bloco marca o lugar enquanto o
        // `.glb` carrega — um terreno vazio esperando download parece
        // quebrado — e sai de cena quando o modelo chega.
        const material = new THREE.MeshStandardMaterial({
          color: b.accentColor ?? CATEGORY_COLORS[def.category] ?? 0xaaaaaa,
          roughness: 0.9,
          transparent: true,
          opacity: b.isReady ? 0.55 : 0.4,
        });
        const provisorio = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
        place(provisorio, def, b.x, b.y, b.level);
        provisorio.userData.instanceId = b.instanceId;
        buildings.add(provisorio);

        void instantiate(def.spriteId, def.width * TILE, def.height * TILE).then(
          (modelo) => {
            // A construção pode ter sido demolida enquanto o modelo carregava.
            if (!modelo || provisorio.parent !== buildings) return;

            const [wx, wz] = toWorld(b.x + def.width / 2, b.y + def.height / 2);
            modelo.position.set(wx, 0, wz);
            // Obra em andamento fica translúcida: mesmo sinal do cliente
            // isométrico, que o jogador já conhece.
            if (!b.isReady) {
              modelo.traverse((o) => {
                if (o instanceof THREE.Mesh) {
                  const m = (o.material as THREE.Material).clone();
                  m.transparent = true;
                  m.opacity = 0.45;
                  o.material = m;
                }
              });
            }
            modelo.userData.instanceId = b.instanceId;
            buildings.add(modelo);
            buildings.remove(provisorio);
            provisorio.geometry.dispose();
            material.dispose();
          },
        );
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
