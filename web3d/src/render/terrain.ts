import * as THREE from 'three';

import { biomeDef } from '../world/biome';
import { BiomeCache } from '../world/biomeCache';
import { WATER_HEIGHT, type WorldGenerator } from '../world/worldGen';

/**
 * A malha de terreno sob a grama.
 *
 * Um plano subdividido, deslocado pela altura contínua do gerador. O cliente
 * isométrico desenhava 9 degraus discretos porque sprites não interpolam; aqui
 * o relevo é liso de graça.
 *
 * A cor vem por **vértice**, do solo do bioma, e não de textura: a grama cobre
 * quase tudo, então o que o jogador enxerta do chão é o tom entre as folhas e
 * as manchas onde não nasce nada. Textura seria trabalho para um detalhe que
 * some.
 */
export interface Terrain {
  readonly mesh: THREE.Mesh;
  readonly water: THREE.Mesh;
  dispose(): void;
}

export function createTerrain(
  world: WorldGenerator,
  centerX: number,
  centerZ: number,
  size: number,
  segments = 200,
  biomes: BiomeCache = new BiomeCache(world),
): Terrain {
  const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
  geometry.rotateX(-Math.PI / 2);

  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const colors = new Float32Array(position.count * 3);
  const color = new THREE.Color();

  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i) + centerX;
    const z = position.getZ(i) + centerZ;

    position.setY(i, world.heightAt(x, z));

    const biome = biomeDef(biomes.at(x, z));
    color.setHex(biome.soil);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  // Depois de mexer em Y, as normais do plano original apontam todas para
  // cima; sem recalcular, o relevo fica sem sombreado nenhum.
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0,
    flatShading: false,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(centerX, 0, centerZ);
  mesh.receiveShadow = true;

  // Água morta: um plano na cota fixa. Não precisa de malha própria — ela é
  // sempre horizontal, e o terreno já mergulha por baixo.
  const waterGeometry = new THREE.PlaneGeometry(size, size);
  waterGeometry.rotateX(-Math.PI / 2);
  const waterMaterial = new THREE.MeshStandardMaterial({
    color: 0x14384a,
    transparent: true,
    opacity: 0.82,
    roughness: 0.18,
    metalness: 0.35,
  });
  const water = new THREE.Mesh(waterGeometry, waterMaterial);
  water.position.set(centerX, WATER_HEIGHT, centerZ);

  return {
    mesh,
    water,
    dispose() {
      geometry.dispose();
      material.dispose();
      waterGeometry.dispose();
      waterMaterial.dispose();
    },
  };
}
