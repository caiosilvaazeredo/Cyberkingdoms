import * as THREE from 'three';

import { buildingDef, upgradeDays, type BuildingDef } from '../building/buildingType';
import type { PlacedBuilding, Plot } from '../building/plot';
import { createBuildLabel, type BuildLabel } from './buildLabel';
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
  /** Avança as animações. Chame uma vez por quadro. */
  update(elapsedSeconds: number): void;
  /** Realça a construção sob o ponteiro. `null` limpa. */
  setHovered(instanceId: string | null): void;
  /** Realça a célula sob o ponteiro. `null` esconde. */
  setHoveredCell(px: number, py: number, valid: boolean): void;
  clearHoveredCell(): void;
  /** A construção num ponto do mundo, se houver. */
  buildingAt(worldX: number, worldZ: number): PlacedBuilding | null;
  /** Converte um ponto do mundo na célula da grade, ou `null` se fora. */
  cellAt(worldX: number, worldZ: number): { x: number; y: number } | null;
  dispose(): void;
}

/** Total de dias que aquela obra leva, para virar barra de progresso. */
function totalBuildDays(b: PlacedBuilding): number {
  const total = b.upgrading
    ? upgradeDays(b.def, Math.max(1, b.level - 1))
    : b.def.buildDays;
  // Nunca zero: a fração vira divisão por zero e a peça pisca entre 0% e 100%.
  return Math.max(1, total);
}

interface EmObra {
  readonly building: PlacedBuilding;
  readonly raiz: THREE.Object3D;
  readonly label: BuildLabel;
  readonly alturaCheia: number;
  /**
   * Escala da peça pronta.
   *
   * A animação **multiplica** esta escala em vez de escrever por cima. Escrever
   * `scale.set(1, altura, 1)` jogava fora a largura e a profundidade que
   * `place()` (na caixa) e `instantiate()` (no modelo) tinham acabado de
   * calcular: toda construção em obra virava um bloco de 1 m de lado esmagado
   * contra o chão.
   */
  readonly escalaBase: THREE.Vector3;
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
  //
  // A grade flutua a 75 cm do chão, e não rente a ele. Rente ela não existe: a
  // grama tem meio metro e uma linha de um pixel a 6 cm some por baixo — foi
  // assim que a grade e o contorno do lote ficaram invisíveis por completo.
  // Acima do mato ela vira o que já é convenção em jogo de construção: uma
  // planta projetada sobre o terreno.
  const GRID_Y = 0.75;

  const gridPoints: number[] = [];
  for (let i = 0; i <= plot.width; i++) {
    const x = cornerX + i * TILE;
    gridPoints.push(x, GRID_Y, cornerZ, x, GRID_Y, cornerZ + depth);
  }
  for (let j = 0; j <= plot.height; j++) {
    const z = cornerZ + j * TILE;
    gridPoints.push(cornerX, GRID_Y, z, cornerX + width, GRID_Y, z);
  }
  const gridGeom = new THREE.BufferGeometry();
  gridGeom.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(gridPoints, 3),
  );
  const gridMat = new THREE.LineBasicMaterial({
    color: 0x9ff0cf,
    transparent: true,
    opacity: 0.55,
    // Sem teste de profundidade a grade atravessa o que já está construído.
    // É o comportamento certo aqui: no modo de construção o que importa é onde
    // a peça encaixa, e uma grade escondida atrás de um galpão não ajuda.
    depthTest: false,
  });
  const grid = new THREE.LineSegments(gridGeom, gridMat);
  grid.visible = false;
  grid.renderOrder = 2;
  group.add(grid);

  // Contorno do lote, sempre visível: é o que separa "seu" de "da cidade".
  //
  // Quem faz o trabalho pesado é a trilha batida no chão (`world/plotArea.ts`),
  // que é ausência de grama e por isso nunca some. Esta linha é o realce por
  // cima dela — na mesma altura da grade, pelo mesmo motivo.
  const outlineGeom = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(cornerX, GRID_Y, cornerZ),
    new THREE.Vector3(cornerX + width, GRID_Y, cornerZ),
    new THREE.Vector3(cornerX + width, GRID_Y, cornerZ + depth),
    new THREE.Vector3(cornerX, GRID_Y, cornerZ + depth),
    new THREE.Vector3(cornerX, GRID_Y, cornerZ),
  ]);
  group.add(
    new THREE.Line(
      outlineGeom,
      new THREE.LineBasicMaterial({ color: 0x8dffc8, transparent: true, opacity: 0.9 }),
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

  // ---------------------------------------------------------- célula sob o mouse
  //
  // Um quadrado rente ao chão, do tamanho de um tile. É o retorno que faltava
  // no PC: sem ele o jogador move o mouse sobre o terreno e nada responde, e a
  // única forma de descobrir onde a peça vai cair é soltar e ver.
  const cellGeom = new THREE.PlaneGeometry(TILE, TILE);
  cellGeom.rotateX(-Math.PI / 2);
  const cellMat = new THREE.MeshBasicMaterial({
    color: VALID,
    transparent: true,
    opacity: 0.3,
    depthTest: false,
  });
  const cell = new THREE.Mesh(cellGeom, cellMat);
  cell.visible = false;
  cell.renderOrder = 1;
  group.add(cell);

  /** Obras em andamento, para animar. */
  const emObra: EmObra[] = [];
  /** Peças por instância, para o realce do hover. */
  const porInstancia = new Map<string, THREE.Object3D>();
  let realcada: string | null = null;
  let plotAtual: Plot = plot;

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
      plotAtual = current;

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
      for (const o of emObra) {
        buildings.remove(o.label.sprite);
        o.label.dispose();
      }
      emObra.length = 0;
      porInstancia.clear();

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
        porInstancia.set(b.instanceId, provisorio);
        if (!b.isReady) registrarObra(b, provisorio, boxFor(def, b.level).y);

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
                  m.opacity = 0.5;
                  o.material = m;
                }
              });
            }
            modelo.userData.instanceId = b.instanceId;
            buildings.add(modelo);
            buildings.remove(provisorio);
            porInstancia.set(b.instanceId, modelo);
            provisorio.geometry.dispose();
            material.dispose();

            if (!b.isReady) {
              // A placa muda de dono junto com a peça. Sem isto ela ficaria
              // presa à caixa que acabou de sair de cena, e o prazo sumiria no
              // instante em que o modelo aparecesse.
              const antiga = emObra.findIndex(
                (o) => o.building.instanceId === b.instanceId,
              );
              if (antiga >= 0) {
                const o = emObra[antiga]!;
                buildings.remove(o.label.sprite);
                o.label.dispose();
                emObra.splice(antiga, 1);
              }
              const caixa = new THREE.Box3().setFromObject(modelo);
              registrarObra(b, modelo, Math.max(1.5, caixa.max.y - caixa.min.y));
            }
          },
        );
      }
    },

    update(elapsed) {
      for (const o of emObra) {
        const total = totalBuildDays(o.building);
        const restante = Math.max(0, o.building.daysRemaining);
        // O progresso do dia em curso não existe: `daysRemaining` só anda no
        // tick. Por isso a obra cresce em degraus de um dia, e é a **pulsação**
        // que diz "isto está vivo" entre uma virada e outra.
        const progresso = Math.min(1, (total - restante) / total);
        const altura = 0.28 + 0.72 * progresso;

        const pulso = 1 + Math.sin(elapsed * 2.6) * 0.018;
        o.raiz.scale.set(
          o.escalaBase.x,
          o.escalaBase.y * altura * pulso,
          o.escalaBase.z,
        );

        o.label.setDays(restante);
        // A placa acompanha o topo da obra em vez de ficar numa altura fixa:
        // parada, ela some dentro da peça conforme o galpão sobe.
        o.label.sprite.position.y = o.alturaCheia * altura + 1.6;
      }
    },

    setHovered(instanceId) {
      if (instanceId === realcada) return;
      aplicarRealce(realcada, false);
      realcada = instanceId;
      aplicarRealce(realcada, true);
    },

    setHoveredCell(px, py, valid) {
      const [wx, wz] = toWorld(px + 0.5, py + 0.5);
      cell.position.set(wx, 0.12, wz);
      cellMat.color.setHex(valid ? VALID : INVALID);
      cell.visible = true;
    },

    clearHoveredCell() {
      cell.visible = false;
    },

    buildingAt(worldX, worldZ) {
      const px = Math.floor((worldX - cornerX) / TILE);
      const py = Math.floor((worldZ - cornerZ) / TILE);
      for (const b of plotAtual.buildings as readonly PlacedBuilding[]) {
        if (
          px >= b.x &&
          px < b.x + b.def.width &&
          py >= b.y &&
          py < b.y + b.def.height
        ) {
          return b;
        }
      }
      return null;
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
      cellGeom.dispose();
      cellMat.dispose();
      for (const o of emObra) o.label.dispose();
      for (const child of buildings.children) {
        (child as THREE.Mesh).geometry.dispose();
        ((child as THREE.Mesh).material as THREE.Material).dispose();
      }
    },
  };

  function registrarObra(
    b: PlacedBuilding,
    raiz: THREE.Object3D,
    alturaCheia: number,
  ): void {
    // Entre 3 e 6 metros. Amarrada só à footprint, a placa de uma refinaria
    // 3×2 saía com quase 10 m e cobria a obra que ela estava explicando.
    const larguraPlaca = Math.min(6, Math.max(3, b.def.width * TILE * 0.7));
    const label = createBuildLabel(b.daysRemaining, larguraPlaca);
    const escalaBase = raiz.scale.clone();

    // A placa é irmã da peça, não filha dela. Como filha, ela herdaria a escala
    // animada e apareceria achatada contra o chão a 28% de altura — que é
    // exatamente quando o jogador mais precisa ler o prazo.
    const [wx, wz] = toWorld(b.x + b.def.width / 2, b.y + b.def.height / 2);
    label.sprite.position.set(wx, alturaCheia + 1.6, wz);
    buildings.add(label.sprite);

    emObra.push({ building: b, raiz, label, alturaCheia, escalaBase });
  }

  /**
   * Realce por emissividade, e não por trocar o material.
   *
   * Trocar material perderia a textura do `.glb` e faria a peça piscar de cor
   * a cada passada do mouse. Mexer só no `emissive` mantém a arte da Kenney e
   * ainda funciona nas caixas provisórias, que usam o mesmo tipo de material.
   */
  function aplicarRealce(instanceId: string | null, ligado: boolean): void {
    if (!instanceId) return;
    const alvo = porInstancia.get(instanceId);
    alvo?.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if ('emissive' in m && m.emissive instanceof THREE.Color) {
          m.emissive.setHex(ligado ? 0x2f6b52 : 0x000000);
        }
      }
    });
  }
}
