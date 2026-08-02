import * as THREE from 'three';

import { DensityField } from './render/density';
import { createGrassField, type GrassField } from './render/grass';
import {
  QualityGovernor,
  grassOptionsFor,
  guessTier,
} from './render/quality';
import { CityCamera } from './render/cityCamera';
import { createTerrain, type Terrain } from './render/terrain';
import { GestureRecognizer } from './render/touch';
import { biomeDef } from './world/biome';
import { WorldGenerator } from './world/worldGen';

/**
 * O mundo do CyberKingdoms em três dimensões.
 *
 * A geração é a **mesma** do cliente Flutter — mesmo RNG, mesmo ruído, mesmos
 * limiares de bioma, verificado tile a tile em `test/determinism.test.ts`. O
 * que muda é como o mundo é desenhado: lá, sprites isométricos; aqui, relevo
 * contínuo com grama instanciada.
 *
 * **Mobile-first continua valendo depois da troca de motor.** O aparelho de
 * referência é um celular mediano, não um desktop: o orçamento de render se
 * mede sozinho e se ajusta (`render/quality.ts`), os controles são gestos e
 * não atalhos de teclado (`render/touch.ts`), e o laço para quando a aba sai
 * de vista, porque render em segundo plano é bateria queimada por nada.
 */

const FOG_COLOR = 0x8fa6b8;

function boot(): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#viewport')!;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    // Antialias custa caro em GPU integrada e o campo de grama já é ruidoso o
    // bastante para disfarçar a serrilha. Só nos aparelhos que sobram.
    antialias: guessTier() === 'alto',
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
  });
  renderer.setClearColor(FOG_COLOR);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(FOG_COLOR, 0.0085);

  const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 900);

  scene.add(new THREE.HemisphereLight(0xd8ecff, 0x4a5236, 1.5));
  const sun = new THREE.DirectionalLight(0xfff2dc, 2.1);
  sun.position.set(60, 90, 40);
  scene.add(sun);

  let world = WorldGenerator.fromLabel('captura-do-mundo');
  let density = new DensityField(world);
  let terrain: Terrain | null = null;
  let grass: GrassField | null = null;
  const center = new THREE.Vector2(0, 0);
  const seededAt = new THREE.Vector2(0, 0);
  let enquadrado = false;

  const governor = new QualityGovernor(guessTier(), () => {
    applyResolution();
    rebuild();
  });

  // Câmera de construtor de cidade: o alvo é um ponto do terreno, o dedo
  // arrasta o chão, e a inclinação sobe junto com o afastamento.
  const view = new CityCamera(camera, (x, z) => world.heightAt(x, z));

  function applyResolution(): void {
    const budget = governor.budget;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, budget.pixelRatio));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }

  const placeCamera = (): void => view.apply();

  function rebuild(): void {
    const budget = governor.budget;

    if (terrain) {
      scene.remove(terrain.mesh, terrain.water);
      terrain.dispose();
    }
    if (grass) {
      scene.remove(grass.mesh);
      grass.dispose();
    }

    terrain = createTerrain(
      world,
      center.x,
      center.y,
      budget.patchSize * 1.6,
      budget.terrainSegments,
      density.biomes,
    );
    grass = createGrassField(
      world,
      density,
      center.x,
      center.y,
      grassOptionsFor(budget),
    );
    scene.add(terrain.mesh, terrain.water, grass.mesh);
    seededAt.copy(center);

    // Enquadramento amarrado ao trecho semeado, e não a uma distância fixa.
    // Um aparelho de orçamento baixo semeia 42 m; a mesma distância que
    // enquadra 64 m deixaria o campo como um tapete manchado no horizonte.
    // Só na primeira montagem — depois quem manda é o jogador.
    if (!enquadrado) {
      view.distance = budget.patchSize * 0.62;
      enquadrado = true;
    }
    view.focusOn(center.x, center.y);

    report();
    placeCamera();
  }

  function report(): void {
    const biome = biomeDef(density.biomes.at(center.x, center.y));
    const el = document.querySelector('#readout');
    if (el) {
      el.textContent =
        `${biome.label} · ${(grass?.bladeCount ?? 0).toLocaleString('pt-BR')} lâminas` +
        ` · ${governor.tier}`;
    }
  }

  /**
   * Refaz só a grama. O relevo não mudou, e reconstruir a malha de terreno a
   * cada pincelada derrubaria o frame rate justamente enquanto o dedo está na
   * tela.
   */
  function reseedGrass(): void {
    if (grass) {
      scene.remove(grass.mesh);
      grass.dispose();
    }
    grass = createGrassField(
      world,
      density,
      center.x,
      center.y,
      grassOptionsFor(governor.budget),
    );
    scene.add(grass.mesh);
    report();
  }

  // ---------------------------------------------------------------- entrada
  const brush = { radius: 6, strength: 0.5, falloff: 0.7 };
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let paintPending = false;

  function paintAt(clientX: number, clientY: number): void {
    if (!terrain) return;
    pointer.set(
      (clientX / window.innerWidth) * 2 - 1,
      -(clientY / window.innerHeight) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObject(terrain.mesh, false)[0];
    if (!hit) return;

    density.paint(hit.point.x, hit.point.z, brush);
    // A semeadura custa alguns quadros; refazer a cada evento de movimento
    // engasgaria o arrasto. Marcar e resolver no próximo quadro mantém o dedo
    // respondendo.
    paintPending = true;
  }

  const gestures = new GestureRecognizer(canvas, {
    onStart(state) {
      if (state.kind === 'paint') paintAt(state.x, state.y);
    },
    onMove(state) {
      switch (state.kind) {
        case 'paint':
          paintAt(state.x, state.y);
          break;

        case 'pan':
          // Um dedo arrasta o terreno, como em qualquer construtor de cidade.
          view.pan(state.dx, state.dy, window.innerHeight);
          view.apply();
          center.set(view.target.x, view.target.z);
          break;

        case 'transform':
          // Pinça, torção e inclinação juntas: é o que a mão faz de verdade.
          if (state.scale !== 1) view.zoomBy(state.scale);
          if (state.rotation !== 0) view.rotateBy(-state.rotation);
          // Arrasto vertical com dois dedos inclina, desde que não esteja
          // girando nem pinçando — senão a câmera cabeceia a cada gesto.
          if (state.scale === 1 && state.rotation === 0) {
            view.tiltBy(state.dy * 0.004);
          }
          view.apply();
          break;
      }
    },
    onEnd() {
      // Ao soltar depois de arrastar, o trecho semeado pode ter ficado para
      // trás. Refazer só aqui evita reconstruir durante o movimento.
      if (center.distanceTo(seededAt) > governor.budget.patchSize * 0.3) {
        rebuild();
      }
    },
  });

  const paintButton = document.querySelector<HTMLButtonElement>('#modo-pincel');
  paintButton?.addEventListener('click', () => {
    gestures.paintMode = !gestures.paintMode;
    paintButton.setAttribute('aria-pressed', String(gestures.paintMode));
    paintButton.textContent = gestures.paintMode ? 'PINCEL ✓' : 'PINCEL';
  });

  document.querySelector('#limpar')?.addEventListener('click', () => {
    density.clearPaint();
    reseedGrass();
  });

  const seedInput = document.querySelector<HTMLInputElement>('#seed');
  const regenerate = (): void => {
    world = WorldGenerator.fromLabel(seedInput?.value.trim() || 'captura-do-mundo');
    density = new DensityField(world);
    center.set(0, 0);
    enquadrado = false;
    rebuild();
  };
  document.querySelector('#regenerate')?.addEventListener('click', regenerate);
  seedInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      seedInput.blur(); // fecha o teclado do celular
      regenerate();
    }
  });

  // O painel recolhe: numa tela de 360px ele ocuparia metade do mundo.
  const panel = document.querySelector('#painel');
  document.querySelector('#alternar-painel')?.addEventListener('click', () => {
    panel?.classList.toggle('recolhido');
  });

  // `resize` também dispara ao rodar o aparelho e ao abrir o teclado virtual.
  const onResize = (): void => {
    applyResolution();
    // O enquadramento depende da proporção — a `CityCamera` soma inclinação em
    // telas altas —, então rodar o aparelho precisa reposicionar a câmera, não
    // só redimensionar o buffer.
    placeCamera();
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);

  // ------------------------------------------------------------------ laço
  const clock = new THREE.Clock();
  let visible = !document.hidden;

  document.addEventListener('visibilitychange', () => {
    visible = !document.hidden;
    // O relógio continua correndo com a aba oculta; sem descartar o acúmulo, o
    // primeiro quadro de volta traz um delta de minutos e a grama dá um salto.
    if (visible) clock.getDelta();
  });

  function frame(): void {
    requestAnimationFrame(frame);
    // Render em segundo plano é bateria queimada por nada — o motivo número um
    // de um jogo web esquentar o celular no bolso.
    if (!visible) return;

    const delta = clock.getDelta();
    governor.sample(delta);

    if (paintPending) {
      paintPending = false;
      reseedGrass();
    }

    grass?.update(clock.getElapsedTime());
    renderer.render(scene, camera);
  }

  applyResolution();
  rebuild();
  frame();

  // Sinal para a captura automatizada saber que a cena está pronta.
  (window as unknown as { __pronto?: boolean }).__pronto = true;
}

boot();
