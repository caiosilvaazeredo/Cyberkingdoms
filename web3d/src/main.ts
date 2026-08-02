import * as THREE from 'three';

import { DensityField } from './render/density';
import { createGrassField, defaultGrassOptions, type GrassField } from './render/grass';
import { createTerrain, type Terrain } from './render/terrain';
import { biomeDef } from './world/biome';
import { WorldGenerator } from './world/worldGen';

/**
 * Visualizador do mundo do CyberKingdoms em três dimensões.
 *
 * A geração é a **mesma** do cliente Flutter — mesmo RNG, mesmo ruído, mesmos
 * limiares de bioma, verificado tile a tile em `test/determinism.test.ts`. O
 * que muda é só como o mundo é desenhado: lá, sprites isométricos; aqui,
 * relevo contínuo com grama instanciada.
 */

// Céu de fim de tarde encoberto. Preto quase absoluto — que era o fundo do
// cliente isométrico — some com a silhueta da grama contra o horizonte.
const FOG_COLOR = 0x8fa6b8;
const PATCH = defaultGrassOptions.patchSize;

interface Scene {
  regenerate(seedLabel: string, centerX: number, centerZ: number): void;
  dispose(): void;
}

function boot(): Scene {
  const canvas = document.querySelector<HTMLCanvasElement>('#viewport')!;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(FOG_COLOR);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(FOG_COLOR, 0.0085);

  const camera = new THREE.PerspectiveCamera(
    52,
    window.innerWidth / window.innerHeight,
    0.1,
    900,
  );

  // Luz de céu e de chão em vez de ambiente uniforme: é o que separa o topo da
  // moita da base sem precisar de sombra projetada, que no celular sai caro.
  scene.add(new THREE.HemisphereLight(0xd8ecff, 0x4a5236, 1.5));
  const sun = new THREE.DirectionalLight(0xfff2dc, 2.1);
  sun.position.set(60, 90, 40);
  scene.add(sun);

  let world: WorldGenerator;
  let density: DensityField;
  let terrain: Terrain | null = null;
  let grass: GrassField | null = null;
  let center = new THREE.Vector2(0, 0);

  // Câmera orbital simples. Não uso `OrbitControls` do pacote de exemplos
  // porque o que este visualizador precisa cabe em vinte linhas, e o pincel
  // disputaria os mesmos eventos de ponteiro.
  // Câmera baixa e perto: é o ângulo em que a grama tem volume. De cima ela
  // vira textura, que é justamente o que o campo instanciado existe para evitar.
  const orbit = { azimuth: 0.7, elevation: 0.16, distance: 22 };

  function placeCamera(): void {
    const y = world.heightAt(center.x, center.y);
    const r = orbit.distance * Math.cos(orbit.elevation);
    camera.position.set(
      center.x + r * Math.sin(orbit.azimuth),
      y + orbit.distance * Math.sin(orbit.elevation) + 2,
      center.y + r * Math.cos(orbit.azimuth),
    );
    camera.lookAt(center.x, y + 1.5, center.y);
  }

  function rebuild(): void {
    terrain?.dispose();
    grass?.dispose();
    if (terrain) scene.remove(terrain.mesh, terrain.water);
    if (grass) scene.remove(grass.mesh);

    terrain = createTerrain(world, center.x, center.y, PATCH * 1.6, 200, density.biomes);
    grass = createGrassField(world, density, center.x, center.y);
    scene.add(terrain.mesh, terrain.water, grass.mesh);

    report(biomeDef(density.biomes.at(center.x, center.y)).label, grass.bladeCount);
    placeCamera();
  }

  function report(biomeLabel: string, blades: number): void {
    const el = document.querySelector('#readout');
    if (el) {
      el.textContent = `${biomeLabel} · ${blades.toLocaleString('pt-BR')} lâminas`;
    }
  }

  // ---------------------------------------------------------------- entrada
  let dragging: 'orbit' | 'paint' | null = null;
  let last = new THREE.Vector2();
  const brush = { radius: 6, strength: 0.5, falloff: 0.7 };
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

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
    // Só a grama é refeita: o relevo não mudou, e reconstruir a malha de
    // terreno a cada pincelada derrubaria o frame rate justamente enquanto o
    // jogador arrasta o dedo.
    grass?.dispose();
    if (grass) scene.remove(grass.mesh);
    grass = createGrassField(world, density, center.x, center.y);
    scene.add(grass.mesh);
    report(biomeDef(density.biomes.at(center.x, center.y)).label, grass.bladeCount);
  }

  canvas.addEventListener('pointerdown', (event) => {
    canvas.setPointerCapture(event.pointerId);
    // Botão direito, ou tecla shift, pinta; o resto orbita.
    dragging = event.button === 2 || event.shiftKey ? 'paint' : 'orbit';
    last.set(event.clientX, event.clientY);
    if (dragging === 'paint') paintAt(event.clientX, event.clientY);
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    if (dragging === 'paint') {
      paintAt(event.clientX, event.clientY);
      return;
    }
    orbit.azimuth -= (event.clientX - last.x) * 0.005;
    orbit.elevation = Math.min(
      1.45,
      Math.max(0.05, orbit.elevation + (event.clientY - last.y) * 0.004),
    );
    last.set(event.clientX, event.clientY);
    placeCamera();
  });

  const stop = (event: PointerEvent) => {
    dragging = null;
    canvas.releasePointerCapture(event.pointerId);
  };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      orbit.distance = Math.min(160, Math.max(6, orbit.distance + event.deltaY * 0.05));
      placeCamera();
    },
    { passive: false },
  );

  window.addEventListener('keydown', (event) => {
    const stride = 12;
    if (event.key === 'w') center.y -= stride;
    else if (event.key === 's') center.y += stride;
    else if (event.key === 'a') center.x -= stride;
    else if (event.key === 'd') center.x += stride;
    else if (event.key === 'c') {
      density.clearPaint();
    } else return;
    rebuild();
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // ------------------------------------------------------------------ laço
  const clock = new THREE.Clock();
  let running = true;
  function frame(): void {
    if (!running) return;
    requestAnimationFrame(frame);
    grass?.update(clock.getElapsedTime());
    renderer.render(scene, camera);
  }

  const api: Scene = {
    regenerate(seedLabel, centerX, centerZ) {
      world = WorldGenerator.fromLabel(seedLabel);
      density = new DensityField(world);
      center.set(centerX, centerZ);
      rebuild();
    },
    dispose() {
      running = false;
      terrain?.dispose();
      grass?.dispose();
      renderer.dispose();
    },
  };

  api.regenerate('captura-do-mundo', 0, 0);
  frame();
  return api;
}

const app = boot();

const seedInput = document.querySelector<HTMLInputElement>('#seed');
document.querySelector('#regenerate')?.addEventListener('click', () => {
  app.regenerate(seedInput?.value?.trim() || 'captura-do-mundo', 0, 0);
});
seedInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    app.regenerate(seedInput.value.trim() || 'captura-do-mundo', 0, 0);
  }
});
