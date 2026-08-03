import * as THREE from 'three';

import { biomeDef } from '../world/biome';
import type { WorldGenerator } from '../world/worldGen';
import type { DensityField } from './density';
import { outsideRatio, type VillageBounds } from './villageBounds';

/**
 * Campo de grama estilizada.
 *
 * ## Por que geometria instanciada, e não um plano com textura
 *
 * Grama de textura funciona de cima; este jogo olha o mundo de perto e de lado,
 * onde um cartaz de grama denuncia que é um cartaz. Lâmina de verdade custa
 * caro só se cada lâmina for um objeto — por isso aqui há **uma** geometria de
 * lâmina e um buffer de instâncias. A GPU desenha tudo numa chamada.
 *
 * ## O que faz parecer pintado, e não plástico
 *
 * Quatro coisas, em ordem de importância:
 *
 * 1. **Gradiente ao longo da folha.** A base fica na sombra, a ponta pega luz.
 *    Grama de cor única vira feltro.
 * 2. **Curvatura.** Cada lâmina arqueia; a ponta cai. Lâmina reta parece cerda
 *    de escova.
 * 3. **Variação por instância.** Altura, largura, matiz e fase do vento variam
 *    de lâmina para lâmina. Sem isso o campo pulsa junto, como um estádio.
 * 4. **Escurecimento na raiz.** Um pouco de oclusão falsa perto do chão
 *    assenta a grama no terreno em vez de deixá-la boiando.
 *
 * Tudo isso é vertex shader — não custa preenchimento, que é o gargalo no
 * celular.
 */

/**
 * Densidade de névoa, igual à da cena em `main.ts`.
 *
 * Exportada para o dois não divergirem: a grama tem névoa própria porque o
 * shader dela não passa pelo pipeline padrão do three.js, e uma constante
 * duplicada aqui seria a segunda verdade sobre a mesma distância.
 */
export const FOG_DENSITY = 0.004;

/** Segmentos ao longo da lâmina. Cinco já dá curva lisa; sete não aparece. */
const BLADE_SEGMENTS = 5;

export interface GrassOptions {
  /** Lado do trecho coberto, em metros. */
  patchSize: number;
  /** Tentativas de lâmina por metro quadrado, antes do desconto de densidade. */
  bladesPerSquareMeter: number;
  /** Teto de instâncias. Protege o celular de uma seed muito densa. */
  maxBlades: number;
}

export const defaultGrassOptions: GrassOptions = {
  // Trecho menor e muito mais denso do que a primeira tentativa.
  //
  // 120 m a 26 lâminas/m² dava 9 lâminas/m² depois do desconto de densidade —
  // dá para contar as folhas na captura, e o campo lê como cabelo ralo. O
  // orçamento rende muito mais concentrado perto da câmera, que enxerga uns
  // 30 m: o que está a 60 m vira uma faixa de um pixel.
  //
  // 90 mil lâminas é o teto porque cada uma custa 12 vértices — 1,1 milhão de
  // vértices por quadro. Um celular de meia tabela aguenta; dobrar isso já
  // derruba o frame rate, e a diferença visual a 30 m é quase nenhuma.
  patchSize: 60,
  bladesPerSquareMeter: 70,
  maxBlades: 90_000,
};

/**
 * Geometria de uma lâmina: uma tira triangular que afina até a ponta.
 *
 * `y` vai de 0 (raiz) a 1 (ponta) e é o parâmetro que o shader usa para tudo —
 * gradiente de cor, quanto a lâmina entorta, quanta luz pega. Guardar isso na
 * própria posição evita mais um atributo.
 */
function bladeGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= BLADE_SEGMENTS; i++) {
    const t = i / BLADE_SEGMENTS;
    // Afinamento não linear: a folha guarda largura no meio e fecha rápido só
    // no fim. Afinar linearmente dá um triângulo, que lê como espinho.
    const halfWidth = 0.5 * (1 - t * t * 0.92);
    positions.push(-halfWidth, t, 0);
    positions.push(halfWidth, t, 0);

    if (i < BLADE_SEGMENTS) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setIndex(indices);
  return geometry;
}

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform vec2 uWindDirection;
  uniform float uWindStrength;

  attribute vec3 aOffset;     // posição da raiz no mundo
  attribute float aRotation;  // giro em torno do eixo vertical
  attribute float aHeight;
  attribute float aWidth;
  attribute float aPhase;     // dessincroniza o vento
  attribute float aTint;      // variação de matiz, 0..1
  attribute float aLean;      // quanto a lâmina já nasce tombada

  varying float vY;
  varying float vTint;
  varying float vFacing;

  void main() {
    float t = position.y;
    vY = t;
    vTint = aTint;

    vec3 local = vec3(position.x * aWidth, t * aHeight, 0.0);

    // Curvatura própria + vento. As duas crescem com t^2: a raiz fica firme e
    // a ponta é que passeia, que é como capim se comporta.
    float bend = aLean * t * t;
    float gust = sin(uTime * 1.7 + aPhase) * 0.5
               + sin(uTime * 0.6 + aPhase * 1.7) * 0.5;
    bend += uWindStrength * (0.55 + 0.45 * gust) * t * t;

    // Entortar encurta a lâmina; sem compensar, o campo inteiro "cresce"
    // quando o vento passa.
    local.z += bend * aHeight;
    local.y -= bend * bend * aHeight * 0.35;

    float c = cos(aRotation);
    float s = sin(aRotation);
    vec3 rotated = vec3(
      local.x * c - local.z * s,
      local.y,
      local.x * s + local.z * c
    );

    // Direção do vento aplicada depois do giro, senão cada lâmina sopraria
    // para o lado dela.
    rotated.xz += uWindDirection * bend * aHeight * 0.6;

    vec3 worldPosition = aOffset + rotated;

    // Normal aproximada da face, só para saber se estamos vendo a frente ou o
    // verso da folha — o verso é mais opaco.
    vec3 faceNormal = normalize(vec3(-s, 0.35, c));
    vec4 viewPos = modelViewMatrix * vec4(worldPosition, 1.0);
    vFacing = abs(dot(normalize(faceNormal), normalize(-viewPos.xyz)));

    gl_Position = projectionMatrix * viewPos;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uBaseColor;
  uniform vec3 uTipColor;
  uniform vec3 uFogColor;
  uniform float uFogDensity;

  varying float vY;
  varying float vTint;
  varying float vFacing;

  void main() {
    // Gradiente raiz -> ponta, com a curva puxada para a base: a maior parte
    // da folha fica no tom escuro e só o terço final acende.
    float gradient = pow(vY, 1.6);
    vec3 color = mix(uBaseColor, uTipColor, gradient);

    // Variação de matiz por lâmina, em torno de zero para não clarear o campo
    // inteiro.
    color *= 0.86 + vTint * 0.28;

    // Oclusão falsa na raiz: assenta a grama no chão.
    color *= 0.55 + 0.45 * smoothstep(0.0, 0.35, vY);

    // O verso da folha recebe menos luz.
    color *= 0.78 + 0.22 * vFacing;

    // Névoa por distância, calculada aqui para casar com o terreno.
    float depth = gl_FragCoord.z / gl_FragCoord.w;
    float fog = 1.0 - exp(-uFogDensity * uFogDensity * depth * depth);
    gl_FragColor = vec4(mix(color, uFogColor, clamp(fog, 0.0, 1.0)), 1.0);
  }
`;

export interface GrassField {
  readonly mesh: THREE.Mesh;
  readonly bladeCount: number;
  /** Avança a animação do vento. */
  update(elapsedSeconds: number): void;
  setWind(direction: THREE.Vector2, strength: number): void;
  dispose(): void;
}

/**
 * Semeia um trecho de grama sobre o terreno.
 *
 * A posição de cada lâmina vem de uma grade com jitter, não de coordenadas
 * aleatórias puras: aleatório uniforme produz aglomerados e buracos visíveis, e
 * a grade com jitter dá cobertura pareja mantendo a irregularidade. É
 * amostragem estratificada, e custa o mesmo.
 */
export function createGrassField(
  world: WorldGenerator,
  density: DensityField,
  centerX: number,
  centerZ: number,
  options: GrassOptions = defaultGrassOptions,
  bounds: VillageBounds | null = null,
): GrassField {
  const { patchSize, bladesPerSquareMeter, maxBlades } = options;

  // A resolução da grade sai do **menor** entre a densidade pedida e o teto do
  // aparelho — e é aqui que morava um buraco de verdade.
  //
  // Antes a grade vinha só da densidade e o teto era um `break` no meio do
  // laço. Como o laço varre linha por linha em +Z, estourar o teto não ralava
  // o campo: cortava fora tudo a partir da linha em que a conta fechou. Num
  // aparelho de orçamento médio, 52 m a 70 lâminas/m² pedem ~174 mil lâminas
  // para um teto de 60 mil — ou seja, **dois terços do trecho nasciam
  // pelados**, sempre no mesmo lado. Era o "tabuleiro sem mato".
  //
  // Derivando a grade do teto, o desbaste é espacialmente uniforme: as mesmas
  // 60 mil lâminas cobrem o trecho inteiro, só que mais espaçadas. E ainda sai
  // mais barato, porque o laço deixa de visitar células que seriam descartadas.
  const pedidas = patchSize * patchSize * bladesPerSquareMeter;
  const cells = Math.max(
    1,
    Math.floor(Math.sqrt(Math.min(pedidas, maxBlades))),
  );
  const step = patchSize / cells;
  const half = patchSize / 2;

  const offsets: number[] = [];
  const rotations: number[] = [];
  const heights: number[] = [];
  const widths: number[] = [];
  const phases: number[] = [];
  const tints: number[] = [];
  const leans: number[] = [];

  // O tom do campo vem do bioma do centro do trecho; a variação fina fica por
  // conta do `aTint`. Interpolar cor por lâmina entre biomas vizinhos seria
  // mais correto e custaria uma consulta de bioma por lâmina — caro no laço
  // mais quente do renderizador, e quase invisível em movimento.
  const centerBiome = biomeDef(density.biomes.at(centerX, centerZ));

  let placed = 0;
  for (let iz = 0; iz < cells && placed < maxBlades; iz++) {
    for (let ix = 0; ix < cells && placed < maxBlades; ix++) {
      // Jitter determinístico: o mesmo trecho sempre nasce igual, então voltar
      // a um lugar não redesenha o campo.
      const j1 = hash2(ix, iz, 1);
      const j2 = hash2(ix, iz, 2);
      const x = centerX - half + (ix + j1) * step;
      const z = centerZ - half + (iz + j2) * step;

      let d = density.at(x, z);
      if (d <= 0) continue;
      // A grama rareia junto com a cor ao passar do limite. Cortar de vez
      // desenharia um círculo perfeito de mato, que denuncia o truque.
      if (bounds) {
        const fora = outsideRatio(bounds, x, z);
        if (fora >= 1) continue;
        d *= 1 - fora;
      }
      // A densidade vira probabilidade de nascer, não altura: reduzir altura
      // deixaria um tapete rasteiro onde deveria haver mato alto.
      if (hash2(ix, iz, 3) > d) continue;

      const y = world.heightAt(x, z);
      if (y < -70) continue;

      const local = biomeDef(density.biomes.at(x, z));
      const r4 = hash2(ix, iz, 4);
      const r5 = hash2(ix, iz, 5);
      const r6 = hash2(ix, iz, 6);

      offsets.push(x, y, z);
      rotations.push(hash2(ix, iz, 7) * Math.PI * 2);
      heights.push(local.grassHeight * (0.6 + r4 * 0.8));
      // Lâmina mais larga é o jeito barato de fechar o campo: cobre mais chão
      // sem custar um vértice a mais. Dobrar o número de instâncias para o
      // mesmo efeito custaria doze vértices por lâmina extra.
      widths.push(0.048 + r5 * 0.042);
      phases.push(r6 * Math.PI * 2);
      tints.push(hash2(ix, iz, 8));
      leans.push(0.12 + hash2(ix, iz, 9) * 0.35);
      placed++;
    }
  }

  const geometry = new THREE.InstancedBufferGeometry();
  const blade = bladeGeometry();
  geometry.index = blade.index;
  geometry.setAttribute('position', blade.getAttribute('position'));
  geometry.instanceCount = placed;

  const instanced = (name: string, data: number[], size: number) => {
    geometry.setAttribute(
      name,
      new THREE.InstancedBufferAttribute(new Float32Array(data), size),
    );
  };
  instanced('aOffset', offsets, 3);
  instanced('aRotation', rotations, 1);
  instanced('aHeight', heights, 1);
  instanced('aWidth', widths, 1);
  instanced('aPhase', phases, 1);
  instanced('aTint', tints, 1);
  instanced('aLean', leans, 1);

  // O culling do three.js usa a bounding sphere da geometria base, que aqui é
  // uma lâmina de 1 metro na origem — o campo inteiro sumiria assim que a
  // origem saísse da tela. A esfera é declarada à mão.
  geometry.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(centerX, 0, centerZ),
    patchSize,
  );

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uWindDirection: { value: new THREE.Vector2(1, 0.35).normalize() },
      uWindStrength: { value: 0.22 },
      uBaseColor: { value: new THREE.Color(centerBiome.grassBase) },
      uTipColor: { value: new THREE.Color(centerBiome.grassTip) },
      uFogColor: { value: new THREE.Color(0x8fa6b8) },
      // A mesma densidade da cena. A grama tem a própria névoa porque o
      // shader dela não passa pelo pipeline padrão do three.js — e os dois
      // números precisam bater, senão a lâmina some numa distância e o chão
      // sob ela some noutra.
      uFogDensity: { value: FOG_DENSITY },
    },
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = true;

  return {
    mesh,
    bladeCount: placed,
    update(elapsedSeconds) {
      material.uniforms.uTime!.value = elapsedSeconds;
    },
    setWind(direction, strength) {
      material.uniforms.uWindDirection!.value.copy(direction).normalize();
      material.uniforms.uWindStrength!.value = strength;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      blade.dispose();
    },
  };
}

/**
 * Ruído inteiro estável em `[0, 1)`.
 *
 * Independente do RNG do mundo de propósito: isto decide onde uma folha nasce,
 * não o que existe no mundo. Amarrar as duas coisas faria a densidade da grama
 * entrar no contrato de determinismo entre app e web, que é uma promessa cara
 * de manter por nada.
 */
function hash2(x: number, y: number, salt: number): number {
  let h = Math.imul(x, 0x1f123bb5) ^ Math.imul(y, 0x7c4a7c15) ^ Math.imul(salt, 0x27d4eb2d);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}
