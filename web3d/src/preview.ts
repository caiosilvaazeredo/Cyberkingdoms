import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { biomeDef } from './world/biome';
import { DeterministicRandom } from './core/rng';
import { WorldGenerator } from './world/worldGen';

/**
 * Teste de arte: o mundo do CyberKingdoms com o visual 3D pixel art.
 *
 * Esta página **não** faz parte do jogo. Ela existe para responder a uma
 * pergunta antes de qualquer refatoração: o mundo procedural que já está
 * pronto, desenhado com a técnica do tutorial, fica bom? O terreno, o bioma e
 * a distribuição vêm do mesmo `WorldGenerator` do jogo — o que muda é só como
 * aquilo é pintado.
 *
 * ## As três coisas que fazem 3D virar pixel art
 *
 * **Renderizar pequeno e ampliar sem suavizar.** É a parte que ninguém pode
 * pular: a cena é desenhada num alvo de 384×216 e esticada para a tela com
 * filtro de vizinho mais próximo. Sem isso, qualquer textura de 16 px vira
 * borrão assim que a câmera se mexe, porque a placa interpola. É também o que
 * dá o serrilhado característico nas bordas em movimento.
 *
 * **Luz em degraus.** O tutorial usa `light_steps = 3`: o sombreamento não é
 * contínuo, é quantizado em três faixas. Pixel art tem paleta pequena, e
 * gradiente suave denuncia o 3D por baixo.
 *
 * **Grama como billboard com recorte duro.** As lâminas são planos que giram
 * para a câmera, com `ALPHA_SCISSOR` em vez de transparência: ou o pixel está
 * lá ou não está. Transparência suave criaria meio-tom nas bordas, que é
 * exatamente o que a arte não quer.
 *
 * A variação de cor da grama também é quantizada — `ceil(noise * 5) / 5` no
 * shader original —, e é isso que faz o campo ter manchas de tom em vez de um
 * degradê contínuo.
 */

const LARGURA_INTERNA = 384;
const ALTURA_INTERNA = 216;
const DEGRAUS_DE_LUZ = 3;

const canvas = document.querySelector<HTMLCanvasElement>('#tela')!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(1);

const cena = new THREE.Scene();
const semente = new URLSearchParams(location.search).get('seed') ?? 'verde';
const world = WorldGenerator.fromLabel(semente);
const rng = new DeterministicRandom(world.seed).fork('preview');

// O bioma vem do gerador do jogo: a cor do chão e a densidade de mato são as
// mesmas que o mundo real usaria neste ponto.
const bioma = biomeDef(world.biomeAt(0, 0));
cena.background = new THREE.Color(0x6b8fa3);
cena.fog = new THREE.Fog(0x6b8fa3, 30, 95);

// Três quartos, no mesmo enquadramento que a `CityCamera` do jogo usa: é a
// única forma de a comparação valer alguma coisa. Na altura do olho a grama
// engole a cena e o teste responderia outra pergunta.
const camera = new THREE.PerspectiveCamera(42, LARGURA_INTERNA / ALTURA_INTERNA, 0.1, 220);
const DISTANCIA = 34;
const ALTURA_CAMERA = 24;
camera.position.set(DISTANCIA * 0.7, ALTURA_CAMERA, DISTANCIA * 0.7);
camera.lookAt(0, 0, 0);

// ------------------------------------------------------------------- luz
//
// Uma direcional forte e um ambiente fraco. Pixel art não pede luz realista:
// pede contraste alto e poucas faixas, senão a quantização não aparece.
const sol = new THREE.DirectionalLight(0xfff2d0, 2.4);
sol.position.set(-8, 12, 6);
cena.add(sol);
cena.add(new THREE.AmbientLight(0x5b7f9a, 0.55));

/**
 * Quantiza a luz difusa em degraus.
 *
 * Feito por injeção no material padrão em vez de um `ShaderMaterial` inteiro: o
 * `MeshLambertMaterial` já resolve fog, sombra e tonemapping, e reescrever isso
 * à mão só para trocar a curva de luz seria refazer meio renderizador.
 */
function emDegraus(material: THREE.Material): void {
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <lights_lambert_pars_fragment>',
      `#include <lights_lambert_pars_fragment>
       float degrau(float v) {
         return ceil(clamp(v, 0.0, 1.0) * ${DEGRAUS_DE_LUZ.toFixed(1)}) / ${DEGRAUS_DE_LUZ.toFixed(1)};
       }`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      'vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;',
      `float brilho = dot(totalDiffuse, vec3(0.299, 0.587, 0.114));
       vec3 quantizado = brilho > 0.0001 ? totalDiffuse * (degrau(brilho) / brilho) : totalDiffuse;
       vec3 outgoingLight = quantizado + totalEmissiveRadiance;`,
    );
  };
}

// ----------------------------------------------------------------- terreno
const CHAO = 90;
const geoChao = new THREE.PlaneGeometry(CHAO, CHAO, 48, 48);
geoChao.rotateX(-Math.PI / 2);

// Ondulação suave vinda do mesmo ruído do jogo: chão perfeitamente plano
// entrega o truque, porque nenhum terreno de verdade é uma mesa.
const pos = geoChao.attributes['position'] as THREE.BufferAttribute;
for (let i = 0; i < pos.count; i++) {
  const x = pos.getX(i);
  const z = pos.getZ(i);
  pos.setY(i, world.elevationAt(Math.round(x), Math.round(z)) * 0.35);
}
geoChao.computeVertexNormals();

const matChao = new THREE.MeshLambertMaterial({ color: bioma.soil });
emDegraus(matChao);
cena.add(new THREE.Mesh(geoChao, matChao));

const alturaEm = (x: number, z: number): number =>
  world.elevationAt(Math.round(x), Math.round(z)) * 0.35;

// ------------------------------------------------------------------ grama
//
// Um plano por lâmina, girando para a câmera no vertex shader — o mesmo
// billboard do tutorial. Instanciado porque são dezenas de milhares: um objeto
// por lâmina seria uma chamada de desenho por lâmina.
const texturas = new THREE.TextureLoader();
const alphaGrama = texturas.load('/art3d/grass_thin.png');
alphaGrama.magFilter = THREE.NearestFilter;
alphaGrama.minFilter = THREE.NearestFilter;
alphaGrama.colorSpace = THREE.SRGBColorSpace;

const LAMINAS = 26000;
const geoLamina = new THREE.PlaneGeometry(1, 1);
geoLamina.translate(0, 0.5, 0);
const geoGrama = new THREE.InstancedBufferGeometry();
geoGrama.index = geoLamina.index;
geoGrama.attributes = geoLamina.attributes;

const offsets = new Float32Array(LAMINAS * 3);
const escalas = new Float32Array(LAMINAS);
const matizes = new Float32Array(LAMINAS);
for (let i = 0; i < LAMINAS; i++) {
  const x = rng.rangeDouble(-CHAO / 2, CHAO / 2);
  const z = rng.rangeDouble(-CHAO / 2, CHAO / 2);
  offsets[i * 3] = x;
  offsets[i * 3 + 1] = alturaEm(x, z);
  offsets[i * 3 + 2] = z;
  escalas[i] = rng.rangeDouble(0.45, 0.9);
  // Cinco faixas de tom, como no shader original: manchas de cor em vez de
  // degradê. É o que dá a aparência de paleta pequena.
  matizes[i] = Math.ceil(rng.nextDouble() * 5) / 5;
}
geoGrama.setAttribute('offset', new THREE.InstancedBufferAttribute(offsets, 3));
geoGrama.setAttribute('escala', new THREE.InstancedBufferAttribute(escalas, 1));
geoGrama.setAttribute('matiz', new THREE.InstancedBufferAttribute(matizes, 1));

const matGrama = new THREE.ShaderMaterial({
  uniforms: {
    tempo: { value: 0 },
    alphaMap: { value: alphaGrama },
    corBase: { value: new THREE.Color(0x1ab036) },
    corFundo: { value: new THREE.Color(cena.fog!.color) },
    nearFog: { value: 30 },
    farFog: { value: 95 },
  },
  vertexShader: `
    attribute vec3 offset;
    attribute float escala;
    attribute float matiz;
    uniform float tempo;
    varying vec2 vUv;
    varying float vMatiz;
    varying float vProfundidade;

    void main() {
      vUv = uv;
      vMatiz = matiz;

      // Billboard cilíndrico: gira em torno de Y para encarar a câmera, mas
      // não tomba — grama deitada denunciaria o plano.
      vec3 paraCamera = normalize(cameraPosition - offset);
      vec3 direita = normalize(cross(vec3(0.0, 1.0, 0.0), paraCamera));

      vec3 local = position * escala;
      // O vento dobra só o topo: a base fica presa no chão, como haste.
      float dobra = sin(tempo * 1.7 + offset.x * 0.35 + offset.z * 0.2) * 0.22 * uv.y;
      vec3 mundo = offset + direita * local.x + vec3(0.0, local.y, 0.0);
      mundo.x += dobra;
      mundo.z += dobra * 0.4;

      vec4 vista = viewMatrix * vec4(mundo, 1.0);
      vProfundidade = -vista.z;
      gl_Position = projectionMatrix * vista;
    }
  `,
  fragmentShader: `
    uniform sampler2D alphaMap;
    uniform vec3 corBase;
    uniform vec3 corFundo;
    uniform float nearFog;
    uniform float farFog;
    varying vec2 vUv;
    varying float vMatiz;
    varying float vProfundidade;

    void main() {
      // Recorte duro: ou o pixel está lá ou não está. Transparência suave
      // criaria meio-tom nas bordas, que é o que a arte não quer.
      float a = texture2D(alphaMap, vUv).r;
      if (a < 0.75) discard;

      vec3 cor = corBase * (0.55 + vMatiz * 0.55);
      // Base mais escura que a ponta, em dois degraus — sombra de tufo.
      cor *= vUv.y > 0.55 ? 1.0 : 0.72;

      float n = smoothstep(nearFog, farFog, vProfundidade);
      gl_FragColor = vec4(mix(cor, corFundo, n), 1.0);
    }
  `,
});

const grama = new THREE.Mesh(geoGrama, matGrama);
grama.frustumCulled = false;
cena.add(grama);

// ------------------------------------------------------------------ props
//
// Árvore, pedra e flor saem dos `.glb` do pacote. O material vem trocado por
// um Lambert com a mesma textura: o GLB traz material físico, que resolve
// reflexo e rugosidade — tudo que a arte de paleta pequena não usa e que
// custaria caro num celular.
const loader = new GLTFLoader();

/**
 * Pinta um modelo do pacote.
 *
 * ## Por que a cor não vem do arquivo
 *
 * Os `.glb` do tutorial chegam **sem material nenhum** — o projeto Godot
 * atribui tudo por `ShaderMaterial` externo, num `.tres` ao lado. Carregar o
 * modelo e confiar no que vem dentro dá o que deu na primeira tentativa: copa
 * branca, tronco branco, pedra branca. As cores abaixo são as dos materiais do
 * pacote, transcritas: folha `Color(0.365, 0.659, 0.176)`, casca e pedra da
 * média das texturas correspondentes.
 *
 * ## Como separar copa de tronco sem nome de material
 *
 * Sem material, também não há nome para consultar. A separação sai da
 * geometria: a parte cujo centro está acima de 40% da altura da árvore é copa,
 * o resto é tronco. Funciona para qualquer árvore do pacote e não depende da
 * ordem em que as malhas aparecem no arquivo — que muda de modelo para modelo.
 */
const CORES_DO_PACOTE = {
  folha: 0x5da82d,
  casca: 0xb06a42,
  pedra: 0xadad86,
  flor: 0xf9f8e5,
} as const;

const alphaFolha = texturas.load('/art3d/leaf_alpha.png');
alphaFolha.magFilter = THREE.NearestFilter;
alphaFolha.minFilter = THREE.NearestFilter;

function pixelar(objeto: THREE.Object3D, tipo: 'arvore' | 'pedra' | 'flor'): void {
  // As duas caixas precisam estar no **mesmo espaço**. Medir a árvore inteira
  // em mundo e cada malha em coordenadas locais foi o que inverteu a primeira
  // tentativa: a copa, cujo vértice local fica perto de zero, era classificada
  // como tronco, e a árvore saiu marrom da raiz à ponta.
  objeto.updateWorldMatrix(true, true);
  const caixa = new THREE.Box3().setFromObject(objeto);
  const alturaTotal = Math.max(0.001, caixa.max.y - caixa.min.y);

  objeto.traverse((filho) => {
    const malha = filho as THREE.Mesh;
    if (!malha.isMesh) return;

    const propria = new THREE.Box3().setFromObject(malha);
    const centro = propria.getCenter(new THREE.Vector3());
    const alto = (centro.y - caixa.min.y) / alturaTotal > 0.4;

    let novo: THREE.MeshLambertMaterial;
    if (tipo === 'arvore' && alto) {
      novo = new THREE.MeshLambertMaterial({
        color: CORES_DO_PACOTE.folha,
        alphaMap: alphaFolha,
        // Recorte duro na folha, como na grama: meio-tom na borda entregaria
        // que aquilo é um plano com textura.
        alphaTest: 0.5,
        side: THREE.DoubleSide,
      });
    } else if (tipo === 'arvore') {
      novo = new THREE.MeshLambertMaterial({ color: CORES_DO_PACOTE.casca });
    } else if (tipo === 'pedra') {
      // A pedra vem sem UV, então textura não teria onde se apoiar: fica a cor
      // média da `rock_color.png` do pacote, que é o que a textura entrega de
      // longe de qualquer forma.
      novo = new THREE.MeshLambertMaterial({ color: CORES_DO_PACOTE.pedra });
    } else {
      novo = new THREE.MeshLambertMaterial({
        color: CORES_DO_PACOTE.flor,
        side: THREE.DoubleSide,
      });
    }

    emDegraus(novo);
    malha.material = novo;
  });
}

interface Espalhar {
  readonly arquivo: string;
  readonly tipo: 'arvore' | 'pedra' | 'flor';
  readonly quantidade: number;
  readonly escala: [number, number];
  readonly raio: number;
}

const plantio: Espalhar[] = [
  { arquivo: '/art3d/tree3.glb', tipo: 'arvore', quantidade: 22, escala: [0.8, 1.4], raio: 40 },
  { arquivo: '/art3d/tree.glb', tipo: 'arvore', quantidade: 16, escala: [0.7, 1.2], raio: 42 },
  { arquivo: '/art3d/rock2.glb', tipo: 'pedra', quantidade: 26, escala: [0.12, 0.4], raio: 42 },
  { arquivo: '/art3d/flower.glb', tipo: 'flor', quantidade: 120, escala: [0.5, 0.9], raio: 36 },
];

let carregando = plantio.length;
for (const item of plantio) {
  loader.load(item.arquivo, (gltf) => {
    pixelar(gltf.scene, item.tipo);
    const grupoRng = rng.fork(item.arquivo);
    for (let i = 0; i < item.quantidade; i++) {
      const copia = gltf.scene.clone(true);
      const angulo = grupoRng.rangeDouble(0, Math.PI * 2);
      const distancia = Math.sqrt(grupoRng.nextDouble()) * item.raio;
      const x = Math.cos(angulo) * distancia;
      const z = Math.sin(angulo) * distancia;
      copia.position.set(x, alturaEm(x, z), z);
      copia.rotation.y = grupoRng.rangeDouble(0, Math.PI * 2);
      const s = grupoRng.rangeDouble(item.escala[0], item.escala[1]);
      copia.scale.setScalar(s);
      cena.add(copia);
    }
    carregando -= 1;
    if (carregando === 0) (window as unknown as { __pronto: boolean }).__pronto = true;
  });
}

// --------------------------------------------------- passe de baixa resolução
//
// O coração da técnica. A cena vai para um alvo de 384×216 e depois é esticada
// para a tela com vizinho mais próximo. Renderizar direto na resolução da tela
// e "pixelar" por cima não é a mesma coisa: aqui a geometria inteira é
// amostrada na grade baixa, então a silhueta também é feita de pixels grandes.
const alvo = new THREE.WebGLRenderTarget(LARGURA_INTERNA, ALTURA_INTERNA, {
  minFilter: THREE.NearestFilter,
  magFilter: THREE.NearestFilter,
  depthBuffer: true,
});

const cenaTela = new THREE.Scene();
const cameraTela = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
cenaTela.add(
  new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.MeshBasicMaterial({ map: alvo.texture }),
  ),
);

function redimensionar(): void {
  const largura = window.innerWidth;
  const altura = window.innerHeight;
  renderer.setSize(largura, altura, false);
  camera.aspect = largura / altura;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', redimensionar);
redimensionar();

const relogio = new THREE.Clock();
let orbita = 0;
const girando = new URLSearchParams(location.search).get('parado') !== '1';

function quadro(): void {
  requestAnimationFrame(quadro);
  const t = relogio.getElapsedTime();
  matGrama.uniforms['tempo']!.value = t;

  if (girando) {
    orbita = t * 0.08;
    camera.position.set(
      Math.cos(orbita) * DISTANCIA,
      ALTURA_CAMERA,
      Math.sin(orbita) * DISTANCIA,
    );
    camera.lookAt(0, 0, 0);
  }

  renderer.setRenderTarget(alvo);
  renderer.render(cena, camera);
  renderer.setRenderTarget(null);
  renderer.render(cenaTela, cameraTela);
}
quadro();

// Diagnóstico na tela: sem ele não dá para saber se o que está aparecendo é o
// mundo da seed pedida ou um fallback.
const rotulo = document.querySelector<HTMLElement>('#rotulo');
if (rotulo) {
  rotulo.textContent =
    `seed "${semente}" · bioma ${bioma.label} · ${LAMINAS.toLocaleString('pt-BR')} lâminas · ` +
    `render ${LARGURA_INTERNA}×${ALTURA_INTERNA} · luz em ${DEGRAUS_DE_LUZ} degraus`;
}
