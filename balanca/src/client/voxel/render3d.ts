import {
  Box3,
  BufferGeometry,
  CircleGeometry,
  Color,
  ColorManagement,
  DataTexture,
  DepthTexture,
  DoubleSide,
  Fog,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshDepthMaterial,
  MeshStandardMaterial,
  NearestFilter,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Texture,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

import { TILE } from '../../shared/regras';
import type {
  CameraDoMundo,
  IndiceDeVoxels,
  ModeloNoIndice,
  PintorVoxel,
  PontoNaTela,
} from './adaptador';

/**
 * O renderer 3D: cenário em volumes, personagens em sprites, câmera em
 * perspectiva.
 *
 * ## A câmera
 *
 * Em perspectiva, baixa, olhando do sul para o norte por cima do ombro de
 * quem joga — o horizonte e o céu aparecem. Ela mira o mesmo ponto que a
 * câmera 2D do jogo (`seguir`, `prender` e o zoom continuam valendo) e fica
 * à distância em que esse ponto sai na tela na mesma escala do 2D.
 *
 * No espaço do three: X é o x do mundo, **Z é o y do mundo** (sul = perto de
 * quem olha) e Y é a altura.
 *
 * ## Como o mundo chega aqui
 *
 * `desenhar` entrega ao desenho 2D um contexto **gravador**. O jogo desenha o
 * mundo plano de sempre; cada pedido é anotado e remontado em 3D:
 *
 * - `drawImage` de imagem com modelo → o modelo, no ponto do chão em que o pé
 *   do sprite estaria;
 * - `drawImage` de qualquer outra imagem → um sprite plano em pé (ou deitado,
 *   se for água e espuma, que são pintadas antes de tudo);
 * - traço e texto → guardados por **grupo** (uma coisa do mundo) e tocados em
 *   2D por cima do quadro 3D, no ponto da tela em que a coisa foi parar e na
 *   escala daquela distância.
 *
 * ## O que é de quem
 *
 * O desenho 2D diz "o nome fica 34 px acima do boneco", e em perspectiva isso
 * só tem sentido relativo ao boneco. Cada grupo tem uma âncora — o pé da
 * primeira imagem dele, ou a linha do mundo em que foi aberto — e tudo o mais
 * do grupo é posto em relação a ela.
 */

// As cores daqui são as do sprite, byte a byte, e os shaders as escrevem como
// vieram. Com a gestão de cor ligada, `new Color('#8a5a2b')` seria convertida
// para linear — e a ponte, o mar e a névoa sairiam mais escuros que o resto.
ColorManagement.enabled = false;

/** Abertura vertical da câmera, em graus. */
const ABERTURA = 38;

// A câmera é a de um jogo de construir e defender: alta, inclinada, sempre
// virada para o norte, seguindo quem joga de longe o bastante para ver a base
// e de onde vêm as ondas. Ela não gira — "para cima" no controle é sempre o
// norte do mapa, como no 2D.
/** Quanto ela olha para baixo, a partir do horizonte. */
const INCLINACAO = (52 * Math.PI) / 180;
/** A distância até quem ela segue, jogando sozinho. */
const DISTANCIA = 1050;
/** O alvo fica um pouco ao norte de quem joga: vê-se mais do que vem pela frente. */
const ADIANTE = 60;

// O desenho 2D que alimenta o 3D é feito numa vista de cima larga, bem maior
// que a tela: a câmera em perspectiva vê muito mais longe que a 2D.
/** Até onde, a partir do centro, o mundo é desenhado (unidades de mundo). */
const ALCANCE = 1500;
/** O zoom dessa vista: alto, para o arredondamento do 2D não virar tremor. */
const ZOOM_DO_DESENHO = 2;
/** A névoa esconde a borda do que foi desenhado: começa e fecha aqui. */
const NEVOA = [900, 1450] as const;
const COR_DA_NEVOA = 0xcfeaff;
/** O maior tamanho em que nome, barra e placa são pintados (1 = como no 2D). */
const ESCALA_MAXIMA_DO_TRACO = 1.5;
/** Abaixo deste tamanho o nome, a barra e a placa deixam de ser pintados. */
const ESCALA_MINIMA_DO_TRACO = 0.45;
/** Quantas camadas dão espessura a um personagem, e a distância entre elas. */
const CAMADAS_DO_SPRITE = 3;
const PASSO_DA_CAMADA = 1.6;
/** Onde fica o topo da cabeça de um personagem, em fração do lado do quadro. */
const ALTURA_DA_CABECA = 0.36;

/** A altura da água, abaixo do topo dos blocos de chão (que têm 16). */
const NIVEL_DA_AGUA = -10;

/**
 * A luz do mundo, à maneira dos jogos de construir e defender em low poly:
 * um sol baixo e fixo, que projeta sombras longas e duras, e sombra
 * **colorida** — azul-arroxeada, e não preta —, que é o que dá ao cenário o
 * contraste quente/frio das referências.
 *
 * Duas técnicas de renderização não fotorrealista (Santos, Ivo & Rabelo,
 * *RETRÔ*, SBGames 2024): **toon shading** — a difusa de Lambert cortada em
 * duas faixas, luz ou sombra, sem degradê — e **contorno** por filtro de Sobel
 * no buffer de profundidade (ver `CONTORNO`).
 *
 * A sombra projetada é um shadow map feito à mão: a cena é renderizada do
 * ponto de vista do sol (`apontarOSol`) e cada fragmento confere se está atrás
 * do que o sol vê primeiro.
 */
const LUZ = /* glsl */ `
  uniform sampler2D mapaDoSol;
  uniform mat4 matrizDoSol;
  uniform vec3 direcaoDoSol;
  uniform vec3 corDaSombra;
  uniform vec3 corDaLuz;
  uniform float texelDoSol;

  // 1 no sol, 0 na sombra projetada; quatro amostras para a borda não serrilhar.
  float noSol(vec3 mundo) {
    vec4 s = matrizDoSol * vec4(mundo, 1.0);
    vec3 p = s.xyz * 0.5 + 0.5;
    if (p.x <= 0.0 || p.x >= 1.0 || p.y <= 0.0 || p.y >= 1.0) return 1.0;
    float vies = 0.0015;
    float soma = 0.0;
    for (int i = 0; i < 4; i++) {
      vec2 d = vec2(float(i / 2) - 0.5, float(i - (i / 2) * 2) - 0.5) * texelDoSol;
      soma += step(p.z - vies, texture2D(mapaDoSol, p.xy + d).r);
    }
    return soma * 0.25;
  }

  // Toon: a face virada para o sol leva a cor quente da luz; a que dá as
  // costas para ele, ou está na sombra de outra coisa, leva a sombra fria.
  vec3 iluminar(vec3 cor, vec3 n, vec3 mundo) {
    float difusa = dot(n, direcaoDoSol);
    float luz = step(0.12, difusa) * noSol(mundo);
    return cor * mix(corDaSombra, corDaLuz, luz);
  }
`;

const VERTICE_DO_MODELO = /* glsl */ `
  uniform vec4 uvDaPaleta;
  uniform float vento;
  uniform float tempo;
  uniform float contato;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vMundo;
  varying float vContato;
  varying float vFundo;
  void main() {
    vUv = uv * uvDaPaleta.xy + uvDaPaleta.zw;
    vNormal = normalize(mat3(instanceMatrix) * normal);
    vec4 noMundo = instanceMatrix * vec4(position, 1.0);
    // Sombra de contato: o pé de toda parede e de todo tronco escurece onde
    // encosta no chão — a oclusão de ambiente mais barata que existe.
    vContato = mix(1.0, mix(0.7, 1.0, smoothstep(0.0, 22.0, noMundo.y)), contato);
    // O vento: a copa balança e o pé não sai do lugar. O deslocamento cresce
    // com o quadrado da altura, e a fase vem de onde a árvore está plantada —
    // cada uma no seu tempo, como uma rajada que atravessa o campo.
    vec3 raiz = instanceMatrix[3].xyz;
    float alto = max(noMundo.y, 0.0);
    float fase = tempo * 1.3 + raiz.x * 0.011 + raiz.z * 0.015 + alto * 0.012;
    float forca = vento * alto * alto * 0.00022;
    noMundo.x += (sin(fase) + 0.4 * sin(fase * 2.3 + 1.0)) * forca;
    noMundo.z += cos(fase * 0.8) * forca * 0.6;
    vMundo = noMundo.xyz;
    vec4 naCamera = viewMatrix * noMundo;
    vFundo = -naCamera.z;
    gl_Position = projectionMatrix * naCamera;
  }
`;

const FRAGMENTO_DO_MODELO = /* glsl */ `
  uniform sampler2D paleta;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vMundo;
  varying float vContato;
  varying float vFundo;
  uniform vec3 nevoa;
  uniform vec2 faixaDaNevoa;
  ${LUZ}
  void main() {
    // O lado interno de uma instância espelhada: a normal vira junto.
    vec3 n = gl_FrontFacing ? vNormal : -vNormal;
    vec3 cor = iluminar(texture2D(paleta, vUv).rgb, n, vMundo) * vContato;
    gl_FragColor = vec4(mix(cor, nevoa, smoothstep(faixaDaNevoa.x, faixaDaNevoa.y, vFundo)), 1.0);
  }
`;

/**
 * A água em movimento: ondas largas que clareiam e escurecem a cor, e
 * cintilações que correm por cima. Tudo em blocos de quatro unidades, para a
 * água ter o mesmo grão do resto do mundo.
 */
const ONDAS = /* glsl */ `
  uniform float tempo;
  vec3 ondular(vec3 cor, vec2 chao) {
    vec2 q = floor(chao / 4.0) * 4.0;
    float onda =
      sin(q.x * 0.045 + tempo * 1.1) +
      sin(q.y * 0.06 - tempo * 0.8) +
      sin((q.x + q.y) * 0.03 + tempo * 0.5);
    cor *= 1.0 + 0.045 * onda;
    float brilho = step(2.5, onda + 0.4 * sin(q.x * 0.21 + q.y * 0.17 + tempo * 2.0));
    return mix(cor, vec3(0.86, 0.97, 1.0), brilho * 0.5);
  }
`;

const VERTICE_DO_SPRITE = /* glsl */ `
  attribute vec4 recorte;
  attribute vec3 tinta;
  varying vec2 vUv;
  varying vec3 vTinta;
  varying float vFundo;
  varying vec2 vChao;
  varying vec3 vMundo;
  void main() {
    vUv = recorte.xy + position.xy * recorte.zw;
    vTinta = tinta;
    vec4 noMundo = instanceMatrix * vec4(position, 1.0);
    vChao = noMundo.xz;
    vMundo = noMundo.xyz;
    vec4 naCamera = viewMatrix * noMundo;
    vFundo = -naCamera.z;
    gl_Position = projectionMatrix * naCamera;
  }
`;

const FRAGMENTO_DO_SPRITE = /* glsl */ `
  uniform sampler2D mapa;
  uniform float agua;
  varying vec2 vUv;
  varying vec3 vTinta;
  varying float vFundo;
  varying vec2 vChao;
  varying vec3 vMundo;
  uniform vec3 nevoa;
  uniform vec2 faixaDaNevoa;
  ${ONDAS}
  ${LUZ}
  void main() {
    vec4 cor = texture2D(mapa, vUv);
    // Recorte duro: tira o vazio e também a sombra do chão, que o pacote pinta
    // com alfa parcial.
    if (cor.a < 0.4) discard;
    vec3 tingida = cor.rgb * vTinta;
    if (agua > 0.5) tingida = ondular(tingida, vChao);
    // O personagem tem o sombreado do próprio desenho: do sol ele só recebe
    // a sombra que os prédios e as árvores projetam nele.
    else tingida *= mix(corDaSombra, vec3(1.0), noSol(vMundo + vec3(0.0, 2.0, 0.0)));
    gl_FragColor = vec4(mix(tingida, nevoa, smoothstep(faixaDaNevoa.x, faixaDaNevoa.y, vFundo)), 1.0);
  }
`;

const VERTICE_DO_MAR = /* glsl */ `
  varying float vFundo;
  varying vec2 vChao;
  void main() {
    vec4 noMundo = modelMatrix * vec4(position, 1.0);
    vChao = noMundo.xz;
    vec4 naCamera = viewMatrix * noMundo;
    vFundo = -naCamera.z;
    gl_Position = projectionMatrix * naCamera;
  }
`;

const FRAGMENTO_DO_MAR = /* glsl */ `
  uniform vec3 cor;
  varying float vFundo;
  varying vec2 vChao;
  uniform vec3 nevoa;
  uniform vec2 faixaDaNevoa;
  ${ONDAS}
  ${LUZ}
  void main() {
    vec3 c = ondular(cor, vChao) * mix(corDaSombra, vec3(1.0), noSol(vec3(vChao.x, -11.0, vChao.y)));
    gl_FragColor = vec4(mix(c, nevoa, smoothstep(faixaDaNevoa.x, faixaDaNevoa.y, vFundo)), 1.0);
  }
`;

/**
 * O passe final, em tela cheia: contorno e gradação de cor.
 *
 * O contorno é o de *RETRÔ* (Santos, Ivo & Rabelo, 2024), por filtro de borda
 * no buffer de profundidade. Usa-se o laplaciano, e não o Sobel puro, da
 * profundidade linear: num plano inclinado — o chão visto de cima — a
 * primeira derivada é constante e não nula, e o Sobel riscaria o chão
 * inteiro; a segunda derivada só acende onde a superfície quebra (silhueta,
 * quina). Dividir pela profundidade deixa o limiar igual perto e longe.
 */
const VERTICE_DO_PASSE = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const FRAGMENTO_DO_PASSE = /* glsl */ `
  uniform sampler2D tCor;
  uniform sampler2D tProf;
  uniform vec2 passo;
  uniform float perto;
  uniform float longe;
  uniform vec3 corDoContorno;
  varying vec2 vUv;
  float linear(vec2 uv) {
    float z = texture2D(tProf, uv).r * 2.0 - 1.0;
    return 2.0 * perto * longe / (longe + perto - z * (longe - perto));
  }
  void main() {
    vec4 cor = texture2D(tCor, vUv);
    float c = linear(vUv);
    float l = linear(vUv - vec2(passo.x, 0.0));
    float r = linear(vUv + vec2(passo.x, 0.0));
    float u = linear(vUv - vec2(0.0, passo.y));
    float d = linear(vUv + vec2(0.0, passo.y));
    float maisPerto = min(min(l, r), min(u, d));
    // Só o lado de dentro da borda é riscado (o mais perto da câmera): o
    // contorno fica colado no objeto, e não flutuando no fundo atrás dele.
    float lap = (4.0 * c - l - r - u - d) / maisPerto;
    float borda = smoothstep(0.035, 0.09, lap);
    vec3 rgb = cor.rgb;
    // Gradação: um pouco mais de saturação e de densidade nos meios-tons —
    // as cores das referências são cheias, não lavadas.
    float cinza = dot(rgb, vec3(0.299, 0.587, 0.114));
    rgb = mix(vec3(cinza), rgb, 1.18);
    rgb = pow(max(rgb, 0.0), vec3(1.08));
    // O verde puxa para o azul e escurece: a grama das referências é um
    // verde-petróleo fundo, que deixa as construções quentes saltarem.
    float verde = clamp((rgb.g - max(rgb.r, rgb.b)) * 5.0, 0.0, 1.0);
    rgb = mix(rgb, rgb * vec3(0.42, 0.66, 0.66) + vec3(0.0, 0.03, 0.09), verde * 0.85);
    rgb = mix(rgb, corDoContorno, borda * 0.85);
    gl_FragColor = vec4(rgb, max(cor.a, borda * step(c, longe * 0.99)));
  }
`;

interface Quadro {
  geometria: BufferGeometry;
  /** A matriz do nó no `.glb` — desfaz a quantização do conversor. */
  matriz: Matrix4;
  /** O ponto mais alto e mais ao fundo do modelo, em unidades dele. */
  topo: { altura: number; fundo: number };
  /** A caixa que envolve o modelo, em unidades dele. */
  caixa: Box3;
}

interface Modelo {
  dados: ModeloNoIndice;
  quadros: Quadro[];
  uvDaPaleta: Vector4;
  materiais: Map<string, ShaderMaterial>;
  lotes: Map<string, { malha: InstancedMesh; usados: number }>;
}

/** Os sprites de uma mesma imagem: um `InstancedMesh` só. */
interface LoteDeSprites {
  malha: InstancedMesh;
  material: ShaderMaterial;
  recorte: InstancedBufferAttribute;
  tinta: InstancedBufferAttribute;
  usados: number;
}

interface Ponto {
  x: number;
  y: number;
}

type Fonte = { width: number; height: number; src?: string };

/** Uma imagem a pôr no mundo como sprite. */
interface ImagemPendente {
  fonte: Fonte;
  /** Recorte de origem, em pixels da imagem. */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** Cantos de destino no desenho 2D: cima-esquerda, cima-direita, baixo-esquerda. */
  cantos: [Ponto, Ponto, Ponto];
}

interface Grupo {
  /** A âncora no desenho 2D, em pixels de CSS. */
  ancora: Ponto | null;
  /**
   * O ponto do mundo a que a âncora corresponde. Sem ele, é o chão debaixo
   * dela. Um prédio ancora pelo **topo**: o nome dele é pintado "acima do
   * sprite", e o sprite é bem mais alto que a caixa que o prédio virou.
   */
  mundo: { x: number; altura: number; z: number } | null;
  /** A linha do mundo em que o grupo foi aberto, se foi o jogo que abriu. */
  y: number | null;
  /** Já tem âncora de imagem: as próximas não a trocam. */
  fixo: boolean;
  /** É o próprio prédio: o nome dele não some atrás dele mesmo. */
  predio: boolean;
  /** Profundidade de `save` — é o que fecha um grupo implícito. */
  salvos: number;
}

function texturaDaPaleta(cores: readonly string[]): DataTexture {
  const dados = new Uint8Array(cores.length * 4);
  cores.forEach((cor, i) => {
    const n = parseInt(cor.slice(1), 16);
    dados.set([(n >> 16) & 255, (n >> 8) & 255, n & 255, 255], i * 4);
  });
  const t = new DataTexture(dados, cores.length, 1, RGBAFormat);
  t.magFilter = NearestFilter;
  t.minFilter = NearestFilter;
  t.needsUpdate = true;
  return t;
}

/** O quadrado de (0,0) a (1,1) em que todo sprite é desenhado. */
function quadrado(): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

// O que cada operação gravada é.
const ATRIBUIR = 0;
const CHAMAR = 1;
const GRUPO = 2;
const FIM_DO_GRUPO = 3;

/** Métodos que pintam. */
const PINTAM = new Set([
  'fillRect',
  'strokeRect',
  'clearRect',
  'fillText',
  'strokeText',
  'fill',
  'stroke',
]);

/** Métodos que só perguntam: respondidos na hora pelo contexto de verdade. */
const PERGUNTAM = new Set([
  'measureText',
  'getTransform',
  'getLineDash',
  'getImageData',
  'createLinearGradient',
  'createRadialGradient',
  'createConicGradient',
  'createPattern',
  'isPointInPath',
  'isPointInStroke',
]);

/** Onde, nos argumentos de cada método, está o primeiro ponto (x, y). */
const PONTO_EM: Readonly<Record<string, number>> = {
  translate: 0,
  moveTo: 0,
  lineTo: 0,
  arc: 0,
  ellipse: 0,
  rect: 0,
  roundRect: 0,
  fillRect: 0,
  strokeRect: 0,
  fillText: 1,
  strokeText: 1,
};

const BRANCO: Fonte = { width: 1, height: 1 };

export class RenderVoxel implements PintorVoxel {
  private readonly tela = document.createElement('canvas');
  private readonly gl: WebGLRenderer;
  private readonly cena = new Scene();
  private readonly camera = new PerspectiveCamera(ABERTURA, 1, 20, 60000);
  private readonly carregador = new GLTFLoader();
  /** Por `.glb`: o modelo, ou `null` enquanto baixa (ou se falhou). */
  private readonly modelos = new Map<string, Modelo | null>();
  private readonly sprites = new Map<object, LoteDeSprites>();
  /** Por imagem: o caminho dela em `/tiny`, sem extensão. */
  private readonly caminhos = new WeakMap<object, string | null>();
  private readonly quadrado = quadrado();
  private readonly mar: Mesh;
  /** A sombra redonda debaixo de cada sprite em pé. */
  private sombras: InstancedMesh;
  private sombrasUsadas = 0;
  /** As caixas dos prédios postos em cena neste quadro: x0, x1, altura, z0, z1. */
  private readonly paredes: number[] = [];
  /**
   * A copa das árvores e o corpo das pedras deste quadro, no mesmo formato
   * de `paredes` mais a altura de baixo: x0, x1, alto, z0, z1, baixo. Só
   * servem para esconder o 2D que fica atrás delas (nome, baú, bolsa).
   */
  private readonly copas: number[] = [];

  private real!: CanvasRenderingContext2D;
  private gravador: CanvasRenderingContext2D | null = null;
  private readonly metodos = new Map<string, (...args: unknown[]) => unknown>();
  private ops: unknown[] = [];
  /** A vista de cima em que o desenho 2D é feito — não é a da tela. */
  private vista: CameraDoMundo = { x: 0, y: 0, zoom: ZOOM_DO_DESENHO };
  private readonly ladoDoDesenho = 2 * ALCANCE * ZOOM_DO_DESENHO;
  /** O tamanho da tela de verdade, em pixels de CSS. */
  private largura = 1;
  private altura = 1;
  /** Quem a câmera segue de perto; `null` é a câmera de plateia. */
  private alvo: { x: number; y: number } | null = null;
  /** Para onde a câmera está virada: 0 é o norte, cresce no sentido horário. */
  // --- o sol ----------------------------------------------------------------
  /** Para onde fica o sol: baixo, a nordeste — as sombras caem para sudoeste. */
  private readonly direcaoDoSol = new Vector3(0.62, 0.58, -0.53).normalize();
  private readonly ladoDoMapaDoSol = 2048;
  private readonly alvoDoSol = (() => {
    const alvo = new WebGLRenderTarget(this.ladoDoMapaDoSol, this.ladoDoMapaDoSol);
    alvo.depthTexture = new DepthTexture(this.ladoDoMapaDoSol, this.ladoDoMapaDoSol);
    return alvo;
  })();
  private readonly camaraDoSol = new OrthographicCamera(-1600, 1600, 1600, -1600, 1, 8000);
  private readonly materialDoSol = new MeshDepthMaterial({ side: DoubleSide });
  /** Os uniformes da luz, compartilhados por todo material da cena. */
  private readonly luz = {
    mapaDoSol: { value: this.alvoDoSol.depthTexture },
    matrizDoSol: { value: new Matrix4() },
    direcaoDoSol: { value: this.direcaoDoSol },
    // A sombra é fria e a luz é quente: o contraste das referências.
    corDaSombra: { value: new Color(0.44, 0.46, 0.74) },
    corDaLuz: { value: new Color(1.02, 0.99, 0.93) },
    texelDoSol: { value: 1 / this.ladoDoMapaDoSol },
  };

  // --- o passe final -----------------------------------------------------------
  private alvoDaCena: WebGLRenderTarget | null = null;
  private readonly cenaDoPasse = new Scene();
  private readonly camaraDoPasse = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly passe = new ShaderMaterial({
    vertexShader: VERTICE_DO_PASSE,
    fragmentShader: FRAGMENTO_DO_PASSE,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      tCor: { value: null },
      tProf: { value: null },
      passo: { value: new Vector2() },
      perto: { value: 20 },
      longe: { value: 60000 },
      corDoContorno: { value: new Color(0.11, 0.1, 0.22) },
    },
  });

  /** Quão longe a câmera está de quem segue — a névoa e o sol dependem disso. */
  private distancia = DISTANCIA;
  /** A direita da câmera no chão do mundo, e o estica dos sprites em pé. */
  private direitaX = 1;
  private direitaZ = 0;
  private estica = 1;
  /** Os uniformes que todo material compartilha: a névoa e o relógio. */
  private readonly nevoa = {
    nevoa: { value: new Color(COR_DA_NEVOA) },
    faixaDaNevoa: { value: new Vector2(NEVOA[0], NEVOA[1]) },
    tempo: { value: 0 },
  };
  private dpr = 1;
  /** 0: antes da lista ordenada (o chão). 1: dentro dela. 2: depois (efeitos). */
  private fase = 0;
  private grupo: Grupo | null = null;
  private deitados = 0;

  private readonly m = new Matrix4();
  private readonly p = new Vector3();
  private readonly e = new Vector3();
  private readonly v = new Vector3();
  private readonly semGiro = new Quaternion();
  private readonly cor = new Color();

  private constructor(
    private readonly indice: IndiceDeVoxels,
    private readonly raiz: string,
  ) {
    this.gl = new WebGLRenderer({ canvas: this.tela, alpha: true, antialias: false });
    this.gl.setClearColor(0x000000, 0);
    this.carregador.setMeshoptDecoder(MeshoptDecoder);
    // O mar até o horizonte: o mapa acaba, a água não.
    this.mar = new Mesh(
      new PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new ShaderMaterial({
        vertexShader: VERTICE_DO_MAR,
        fragmentShader: FRAGMENTO_DO_MAR,
        uniforms: { ...this.nevoa, ...this.luz, cor: { value: new Color(0x47abaa) } },
      }),
    );
    this.mar.scale.setScalar(120000);
    this.mar.position.y = NIVEL_DA_AGUA - 1;
    this.cena.add(this.mar);
    this.cena.fog = new Fog(COR_DA_NEVOA, NEVOA[0], NEVOA[1]);
    this.cenaDoPasse.add(new Mesh(new PlaneGeometry(2, 2), this.passe));
    this.sombras = this.criarSombras(128);
  }

  /**
   * O pacote pinta a sombra dentro do sprite, com alfa parcial, e ela é
   * recortada junto com o vazio — de pé, ela ficaria no ar. Esta é a
   * substituta: um disco escuro deitado no chão, no pé de cada um.
   */
  private criarSombras(capacidade: number): InstancedMesh {
    const malha = new InstancedMesh(
      new CircleGeometry(1, 20).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({ color: 0x10202a, transparent: true, opacity: 0.28, depthWrite: false }),
      capacidade,
    );
    malha.frustumCulled = false;
    malha.count = 0;
    this.cena.add(malha);
    return malha;
  }

  private sombra(x: number, z: number, raio: number): void {
    if (this.sombrasUsadas >= this.sombras.instanceMatrix.count) {
      const maior = this.criarSombras(this.sombras.instanceMatrix.count * 2);
      (maior.instanceMatrix.array as Float32Array).set(this.sombras.instanceMatrix.array);
      this.cena.remove(this.sombras);
      this.sombras.dispose();
      this.sombras = maior;
    }
    this.m.compose(this.p.set(x, 0.3, z), this.semGiro, this.e.set(raio, 1, raio * 0.55));
    this.sombras.setMatrixAt(this.sombrasUsadas++, this.m);
  }

  /** Lê o índice. Os modelos são baixados um a um, quando aparecem em cena. */
  static async criar(raiz = '/voxel'): Promise<RenderVoxel> {
    const indice = (await (await fetch(`${raiz}/indice.json`)).json()) as IndiceDeVoxels;
    return new RenderVoxel(indice, raiz);
  }

  mirar(alvo: { x: number; y: number; frenteX: number; frenteY: number } | null, _dt: number): void {
    this.alvo = alvo ? { x: alvo.x, y: alvo.y } : null;
  }

  /** A câmera não gira: o controle nunca precisa ser desgirado. */
  get rumo(): number {
    return 0;
  }

  enquadrar(camera: CameraDoMundo, largura: number, altura: number): void {
    this.largura = largura;
    this.altura = altura;
    const c = this.camera;
    c.aspect = largura / altura;
    c.updateProjectionMatrix();
    // Seguindo alguém, a distância é fixa; de plateia, a que põe o alvo na
    // escala do zoom 2D (o menu e o Assistir abrem mais).
    const centro = this.alvo ?? camera;
    const distancia = this.alvo
      ? DISTANCIA
      : Math.max(DISTANCIA, altura / (2 * camera.zoom * Math.tan((ABERTURA * Math.PI) / 360)));
    const alvoZ = centro.y - ADIANTE;
    c.position.set(
      centro.x,
      distancia * Math.sin(INCLINACAO),
      alvoZ + distancia * Math.cos(INCLINACAO),
    );
    c.lookAt(centro.x, 0, alvoZ);
    c.updateMatrixWorld(true);
    this.distancia = distancia;
    const m = c.matrixWorld.elements;
    const direita = Math.hypot(m[0]!, m[2]!) || 1;
    this.direitaX = m[0]! / direita;
    this.direitaZ = m[2]! / direita;
    // O eixo −Z da câmera é para onde ela olha; a componente vertical dele dá
    // a inclinação, e os sprites em pé esticam o que ela achataria.
    const horizontal = Math.hypot(m[8]!, m[10]!);
    this.estica = Math.min(1.35, 1 / Math.max(0.74, horizontal));
    // O mapa do sol cobre o que a câmera alcança daqui.
    const meia = Math.min(2400, this.distancia * 1.4);
    Object.assign(this.camaraDoSol, { left: -meia, right: meia, top: meia, bottom: -meia });
    this.vista = { x: centro.x, y: centro.y, zoom: ZOOM_DO_DESENHO };
    this.mar.position.x = centro.x;
    this.mar.position.z = centro.y;
    // A névoa fecha antes da borda do que foi desenhado.
    const perto = distancia + 350;
    const longe = distancia + 1000;
    this.nevoa.faixaDaNevoa.value.set(perto, longe);
    (this.cena.fog as Fog).near = perto;
    (this.cena.fog as Fog).far = longe;
    this.apontarOSol(centro.x, centro.y);
  }

  /** O sol olha para o centro da vista, de longe, na direção dele. */
  private apontarOSol(x: number, z: number): void {
    const c = this.camaraDoSol;
    c.position.set(x, 0, z).addScaledVector(this.direcaoDoSol, 4000);
    c.lookAt(x, 0, z);
    c.updateMatrixWorld(true);
    c.updateProjectionMatrix();
    this.luz.matrizDoSol.value.multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse);
  }

  paraTela(x: number, y: number): PontoNaTela | null {
    return this.projetar(x, 0, y);
  }

  private projetar(x: number, h: number, z: number): PontoNaTela | null {
    const v = this.v.set(x, h, z).applyMatrix4(this.camera.matrixWorldInverse);
    const fundo = -v.z;
    if (fundo < this.camera.near) return null;
    const escala = this.altura / 2 / (Math.tan((ABERTURA * Math.PI) / 360) * fundo);
    return {
      x: this.largura / 2 + v.x * escala,
      y: this.altura / 2 - v.y * escala,
      escala,
    };
  }

  paraMundo(telaX: number, telaY: number): Ponto | null {
    const origem = this.camera.position;
    const raio = this.v
      .set((telaX / this.largura) * 2 - 1, 1 - (telaY / this.altura) * 2, 0.5)
      .unproject(this.camera)
      .sub(origem);
    if (raio.y >= -1e-6) return null;
    const t = -origem.y / raio.y;
    return { x: origem.x + raio.x * t, y: origem.z + raio.z * t };
  }

  desenhar(
    ctx: CanvasRenderingContext2D,
    camera: CameraDoMundo,
    largura: number,
    altura: number,
    pintar: (
      ctx: CanvasRenderingContext2D,
      camera: CameraDoMundo,
      largura: number,
      altura: number,
    ) => void,
  ): void {
    this.real = ctx;
    this.dpr = ctx.getTransform().a;
    this.enquadrar(camera, largura, altura);
    const l = Math.floor(largura * this.dpr);
    const a = Math.floor(altura * this.dpr);
    if (this.tela.width !== l || this.tela.height !== a) this.gl.setSize(l, a, false);

    this.ops.length = 0;
    this.fase = 0;
    this.grupo = null;
    this.deitados = 0;
    this.sombrasUsadas = 0;
    this.paredes.length = 0;
    this.copas.length = 0;
    for (const modelo of this.modelos.values()) {
      if (modelo) for (const lote of modelo.lotes.values()) lote.usados = 0;
    }
    for (const lote of this.sprites.values()) lote.usados = 0;

    // O desenho de sempre, no gravador. O estado (transformações, fonte,
    // traçado) também é aplicado ao contexto de verdade na hora, para que as
    // perguntas — `measureText`, `getTransform` — tenham resposta certa; o
    // `save`/`restore` em volta devolve o contexto como estava antes de tocar.
    ctx.save();
    try {
      pintar(
        this.gravador ?? (this.gravador = this.criarGravador()),
        this.vista,
        this.ladoDoDesenho,
        this.ladoDoDesenho,
      );
      this.fecharGrupo();
    } finally {
      ctx.restore();
    }

    for (const modelo of this.modelos.values()) {
      if (!modelo) continue;
      for (const lote of modelo.lotes.values()) {
        lote.malha.count = lote.usados;
        lote.malha.visible = lote.usados > 0;
        if (lote.usados > 0) lote.malha.instanceMatrix.needsUpdate = true;
      }
    }
    for (const lote of this.sprites.values()) {
      lote.malha.count = lote.usados;
      lote.malha.visible = lote.usados > 0;
      if (lote.usados > 0) {
        lote.malha.instanceMatrix.needsUpdate = true;
        lote.recorte.needsUpdate = true;
        lote.tinta.needsUpdate = true;
      }
    }

    this.sombras.count = this.sombrasUsadas;
    this.sombras.visible = this.sombrasUsadas > 0;
    this.sombras.instanceMatrix.needsUpdate = true;

    this.nevoa.tempo.value = performance.now() / 1000;
    this.ceu();

    // 1. O mapa do sol: só o que projeta sombra (os modelos, na camada 1).
    this.cena.overrideMaterial = this.materialDoSol;
    this.camaraDoSol.layers.set(1);
    this.gl.setRenderTarget(this.alvoDoSol);
    this.gl.clear();
    this.gl.render(this.cena, this.camaraDoSol);
    this.cena.overrideMaterial = null;

    // 2. A cena, numa textura com profundidade.
    if (!this.alvoDaCena || this.alvoDaCena.width !== l || this.alvoDaCena.height !== a) {
      this.alvoDaCena?.dispose();
      this.alvoDaCena = new WebGLRenderTarget(l, a);
      this.alvoDaCena.depthTexture = new DepthTexture(l, a);
    }
    this.gl.setRenderTarget(this.alvoDaCena);
    this.gl.clear();
    this.gl.render(this.cena, this.camera);

    // 3. Contorno e gradação, na tela.
    const u = this.passe.uniforms;
    u.tCor!.value = this.alvoDaCena.texture;
    u.tProf!.value = this.alvoDaCena.depthTexture;
    const px = Math.max(1, this.dpr * 0.75);
    (u.passo!.value as Vector2).set(px / l, px / a);
    u.perto!.value = this.camera.near;
    u.longe!.value = this.camera.far;
    this.gl.setRenderTarget(null);
    this.gl.clear();
    this.gl.render(this.cenaDoPasse, this.camaraDoPasse);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.tela, 0, 0);
    ctx.restore();
    this.tocar();
  }

  /** O céu: um degradê que clareia até o horizonte. */
  private ceu(): void {
    const ctx = this.real;
    const o = this.camera.position;
    const longe = this.projetar(o.x, 0, o.z - 50000);
    const horizonte = Math.max(8, Math.min(this.altura, (longe?.y ?? 0) + 2));
    const degrade = ctx.createLinearGradient(0, 0, 0, horizonte);
    degrade.addColorStop(0, '#3f86e0');
    degrade.addColorStop(1, '#cfeaff');
    ctx.fillStyle = degrade;
    ctx.fillRect(0, 0, this.largura, this.altura);
  }

  // --- gravação -------------------------------------------------------------

  private criarGravador(): CanvasRenderingContext2D {
    const eu = this;
    return new Proxy({} as CanvasRenderingContext2D, {
      get(_alvo, nome: string) {
        if (nome === 'grupoVoxel') return (y: number) => eu.abrirGrupo(y);
        if (nome === 'fimDosGruposVoxel') {
          return () => {
            eu.fecharGrupo();
            eu.fase = 2;
          };
        }
        const valor = (eu.real as unknown as Record<string, unknown>)[nome];
        if (typeof valor !== 'function') return valor;
        let metodo = eu.metodos.get(nome);
        if (!metodo) {
          metodo = eu.criarMetodo(nome);
          eu.metodos.set(nome, metodo);
        }
        return metodo;
      },
      set(_alvo, nome: string, valor: unknown) {
        (eu.real as unknown as Record<string, unknown>)[nome] = valor;
        eu.ops.push(ATRIBUIR, nome, valor);
        return true;
      },
    });
  }

  private criarMetodo(nome: string): (...args: unknown[]) => unknown {
    const chamar = (args: unknown[]): unknown =>
      (this.real as unknown as Record<string, (...a: unknown[]) => unknown>)[nome]!(...args);
    if (PERGUNTAM.has(nome)) return (...args) => chamar(args);
    if (nome === 'drawImage') return (...args) => this.imagem(args);
    const pinta = PINTAM.has(nome);
    const pontoEm = PONTO_EM[nome];
    return (...args) => {
      if (this.fase === 0 && pinta) {
        if (nome === 'fillRect') this.retanguloNoChao(args as number[]);
        return undefined;
      }
      // Fora da lista ordenada, o que é traço vira um grupo próprio, ancorado
      // no primeiro ponto que aparecer — um dizer que sobe, um clarão.
      if (this.fase === 2 && !this.grupo) this.abrirGrupo(null);
      const g = this.grupo;
      if (g && pontoEm !== undefined && !g.ancora && g.y === null) {
        g.ancora = this.noDesenho(args[pontoEm] as number, args[pontoEm + 1] as number);
      }
      this.ops.push(CHAMAR, nome, args);
      const volta = pinta ? undefined : chamar(args);
      if (g && g.y === null) {
        if (nome === 'save') g.salvos++;
        else if (nome === 'restore') g.salvos--;
        if (g.salvos <= 0 && (pinta || nome === 'restore')) this.fecharGrupo();
      }
      return volta;
    };
  }

  private abrirGrupo(y: number | null): void {
    this.fecharGrupo();
    if (y !== null) this.fase = 1;
    this.grupo = { ancora: null, mundo: null, y, fixo: false, predio: false, salvos: 0 };
    this.ops.push(GRUPO, this.grupo, 0);
  }

  private fecharGrupo(): void {
    const g = this.grupo;
    if (!g) return;
    this.grupo = null;
    if (!g.ancora) {
      g.ancora = {
        x: this.ladoDoDesenho / 2,
        y:
          this.ladoDoDesenho / 2 +
          (g.y === null ? 0 : (g.y - this.vista.y) * this.vista.zoom),
      };
    }
    this.ops.push(FIM_DO_GRUPO, 0, 0);
  }

  /** Um ponto dos argumentos, levado pela transformação atual a pixels de CSS. */
  private noDesenho(x: number, y: number): Ponto {
    const t = this.real.getTransform();
    return { x: (t.a * x + t.c * y + t.e) / this.dpr, y: (t.b * x + t.d * y + t.f) / this.dpr };
  }

  /** O ponto do chão do mundo que o desenho 2D põe naquele pixel. */
  private noChao(p: Ponto): Ponto {
    return {
      x: (p.x - this.ladoDoDesenho / 2) / this.vista.zoom + this.vista.x,
      y: (p.y - this.ladoDoDesenho / 2) / this.vista.zoom + this.vista.y,
    };
  }

  private caminhoDe(img: Fonte): string | null {
    let caminho = this.caminhos.get(img);
    if (caminho === undefined) {
      caminho =
        typeof img.src === 'string'
          ? img.src.replace(/^.*\/tiny\//, '').replace(/\.png$/, '')
          : null;
      this.caminhos.set(img, caminho);
    }
    return caminho;
  }

  /** Um `drawImage`: vira modelo, sprite em pé ou sprite deitado. */
  private imagem(args: unknown[]): void {
    const img = args[0] as Fonte;
    let sx = 0;
    let sy = 0;
    let sw = img.width;
    let sh = img.height;
    let dx: number, dy: number, dw: number, dh: number;
    if (args.length === 9) {
      [sx, sy, sw, sh, dx, dy, dw, dh] = args.slice(1) as [
        number, number, number, number, number, number, number, number,
      ];
    } else if (args.length === 5) {
      [dx, dy, dw, dh] = args.slice(1) as [number, number, number, number];
    } else {
      return;
    }
    if (this.real.globalAlpha < 0.2) return;
    if (this.fase === 2 && !this.grupo) this.abrirGrupo(null);
    const g = this.grupo;
    const caminho = this.caminhoDe(img);
    const fechaSeSolto = (): void => {
      if (g && g === this.grupo && g.y === null && g.salvos <= 0) this.fecharGrupo();
    };

    const entrada = caminho ? this.indice.folhas[caminho] : undefined;
    if (entrada && this.modelo(entrada, sx, sy, sw, sh, dx, dy, dw, dh)) {
      fechaSeSolto();
      return;
    }

    const pendente: ImagemPendente = {
      fonte: img,
      sx,
      sy,
      sw,
      sh,
      cantos: [
        this.noDesenho(dx, dy),
        this.noDesenho(dx + dw, dy),
        this.noDesenho(dx, dy + dh),
      ],
    };
    if (this.fase === 0) {
      this.sprite(pendente, null, true);
      return;
    }
    // Uma folha de personagem sabe onde ficam os pés dela, e vira um sprite
    // em pé no mundo. Qualquer outra imagem de um grupo (o ícone da placa, o
    // retrato sobre a cabeça) é pintada em 2D junto com o traço dele — e, sem
    // grupo que tenha âncora, fica em pé na própria base.
    const dados = caminho ? this.indice.sprites[caminho] : undefined;
    const semAncora = !g || (!g.ancora && g.y === null);
    const pe = dados
      ? this.noDesenho(dx + dw / 2, dy + (dados.pes / dados.lado) * dh)
      : semAncora
        ? this.noDesenho(dx + dw / 2, dy + dh)
        : null;
    if (pe) {
      if (dados) {
        const t = this.real.getTransform();
        const escala = ((dw / sw) * Math.hypot(t.a, t.b)) / this.dpr / this.vista.zoom;
        const chao = this.noChao(pe);
        this.sombra(chao.x, chao.y, dados.larguraQuadro * 0.15 * escala);
        if (g && !g.fixo) {
          // O nome e a barra de vida ficam logo acima da cabeça, e é por ela
          // que o grupo se ancora: de perto o traço tem tamanho máximo, e
          // ancorado no pé o nome cairia no meio do rosto.
          const cabeca = dados.lado * ALTURA_DA_CABECA * escala;
          g.ancora = { x: pe.x, y: pe.y - cabeca * this.vista.zoom };
          g.mundo = { x: chao.x, altura: cabeca * this.estica, z: chao.y };
          g.fixo = true;
        }
      }
      if (g && !g.fixo) {
        g.ancora = pe;
        g.fixo = true;
      }
      // Sempre pelo próprio pé: a âncora do grupo pode ser o topo de um prédio.
      // O clarão do golpe recebido chega como `filter: brightness(…)` — ver
      // `reacaoAoGolpe` em desenho.ts.
      const brilho = /brightness\(([\d.]+)\)/.exec(this.real.filter ?? '');
      this.sprite(pendente, pe, false, undefined, Boolean(dados), brilho ? Number(brilho[1]) : 1);
    } else {
      this.ops.push(CHAMAR, 'drawImage', args);
    }
    fechaSeSolto();
  }

  /** Põe o modelo de uma folha em cena. Devolve `false` se ainda não há modelo. */
  private modelo(
    entrada: { glb: string; paleta: string },
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): boolean {
    let modelo = this.modelos.get(entrada.glb);
    if (modelo === undefined) {
      // Primeira vez que esta folha aparece: baixa, e até chegar é sprite.
      this.modelos.set(entrada.glb, null);
      void this.baixar(entrada.glb);
      modelo = null;
    }
    if (!modelo) return false;
    const d = modelo.dados;
    if (Math.abs(sw - d.larguraQuadro) > 0.5 || Math.abs(sh - d.lado) > 0.5) return false;
    // Modelo de um quadro só (árvore, arbusto, construção): serve para qualquer
    // quadro da folha — a animação do sprite vira o vento do shader.
    const quadro =
      d.quadros === 1 ? 0 : Math.round(sy / d.lado) * d.colunas + Math.round(sx / d.larguraQuadro);
    if (quadro < 0 || quadro >= d.quadros) return false;

    const t = this.real.getTransform();
    const escala = ((dh / d.lado) * Math.hypot(t.a, t.b)) / this.dpr / this.vista.zoom;
    const espelhar = t.a * t.d - t.b * t.c < 0;
    const noDesenho =
      d.plano === 'chao'
        ? this.noDesenho(dx, dy)
        : this.noDesenho(dx + dw / 2, dy + (d.pes / d.lado) * dh);
    const chao = this.noChao(noDesenho);
    const g = this.grupo;
    // O prédio fica onde a simulação diz que está o corpo dele: fachada na
    // borda de cima do tile da porta (ver `CORPO_DA_ESTRUTURA` em
    // shared/arena.ts), que é a parede em que o personagem para.
    if (d.oclui && g && g.y !== null) chao.y = g.y - TILE / 2;
    if (g && !g.fixo && d.plano !== 'chao') {
      const topo = modelo.quadros[quadro]!.topo;
      g.ancora = this.noDesenho(dx + dw / 2, dy);
      g.mundo = { x: chao.x, altura: topo.altura * escala, z: chao.y + topo.fundo * escala };
      g.predio = true;
      g.fixo = true;
    }

    if (d.redondo) {
      // Só o miolo da copa: a borda é rendada, e o tronco é fino.
      const c = modelo.quadros[quadro]!.caixa;
      const rx = (c.max.x - c.min.x) * 0.5 * escala * 0.55;
      const rz = (c.max.z - c.min.z) * 0.5 * escala * 0.55;
      this.copas.push(
        chao.x - rx,
        chao.x + rx,
        c.max.y * escala * 0.9,
        chao.y - rz,
        chao.y + rz,
        c.max.y * escala * (d.vento ? 0.3 : 0),
      );
    }
    if (d.oclui) {
      const c = modelo.quadros[quadro]!.caixa;
      const i = this.paredes.length;
      this.paredes.push(
        chao.x + c.min.x * escala,
        chao.x + c.max.x * escala,
        c.max.y * escala,
        chao.y + c.min.z * escala,
        chao.y + c.max.z * escala,
      );
      // Prédio não barra ninguém, e a câmera vai atrás de quem anda: um
      // prédio entre os dois taparia a tela inteira com o telhado. Esse some
      // — fica o nome dele, pintado por cima —, e não tapa mais nada.
      if (this.alvo && this.raioCruza(this.paredes, i, 0, this.alvo.x, 40, this.alvo.y, 1)) {
        this.paredes.length = i;
        return true;
      }
    }

    const chave = `${quadro}:${entrada.paleta}`;
    let lote = modelo.lotes.get(chave);
    if (!lote || lote.usados >= lote.malha.instanceMatrix.count) {
      let material = modelo.materiais.get(entrada.paleta);
      if (!material) {
        material = new ShaderMaterial({
          vertexShader: VERTICE_DO_MODELO,
          fragmentShader: FRAGMENTO_DO_MODELO,
          // O espelho inverte a ordem dos vértices; sem isto ele sumiria.
          side: DoubleSide,
          uniforms: {
            ...this.nevoa,
            ...this.luz,
            paleta: { value: texturaDaPaleta(d.paletas[entrada.paleta]!) },
            uvDaPaleta: { value: modelo.uvDaPaleta },
            vento: { value: d.vento ? 1 : 0 },
            contato: { value: d.plano === 'chao' ? 0 : 1 },
          },
        });
        modelo.materiais.set(entrada.paleta, material);
      }
      // Lote cheio: dobra, levando o que já foi posto neste quadro.
      const malha = new InstancedMesh(
        modelo.quadros[quadro]!.geometria,
        material,
        lote ? lote.malha.instanceMatrix.count * 2 : 16,
      );
      malha.frustumCulled = false;
      // Camada 1: projeta sombra. O chão não precisa (só recebe), e de fora
      // fica o passe do sol mais barato.
      if (d.plano !== 'chao') malha.layers.enable(1);
      if (lote) {
        (malha.instanceMatrix.array as Float32Array).set(lote.malha.instanceMatrix.array);
        this.cena.remove(lote.malha);
        lote.malha.dispose();
        lote.malha = malha;
      } else {
        lote = { malha, usados: 0 };
        modelo.lotes.set(chave, lote);
      }
      this.cena.add(malha);
    }
    this.m.compose(
      this.p.set(chao.x, 0, chao.y),
      this.semGiro,
      this.e.set(espelhar ? -escala : escala, escala, escala),
    );
    this.m.multiply(modelo.quadros[quadro]!.matriz);
    lote.malha.setMatrixAt(lote.usados++, this.m);
    return true;
  }

  private async baixar(glb: string): Promise<void> {
    const dados = this.indice.modelos[glb];
    if (!dados) return;
    try {
      const gltf = await this.carregador.loadAsync(`${this.raiz}/${glb}`);
      gltf.scene.updateMatrixWorld(true);
      const quadros: Quadro[] = [];
      const uvDaPaleta = new Vector4(1, 1, 0, 0);
      for (let q = 0; q < dados.quadros; q++) {
        let malha: Mesh | null = null;
        gltf.scene.getObjectByName(`q${q}`)?.traverse((o) => {
          if (!malha && (o as Mesh).isMesh) malha = o as Mesh;
        });
        if (!malha) throw new Error(`sem o quadro q${q}`);
        const achada = malha as Mesh;
        // O compactador quantiza a UV e deixa a conta de volta na textura.
        const mapa = (achada.material as MeshStandardMaterial).map;
        if (mapa) uvDaPaleta.set(mapa.repeat.x, mapa.repeat.y, mapa.offset.x, mapa.offset.y);
        achada.geometry.computeBoundingBox();
        const caixa = achada.geometry.boundingBox!.clone().applyMatrix4(achada.matrixWorld);
        quadros.push({
          geometria: achada.geometry,
          matriz: achada.matrixWorld.clone(),
          topo: { altura: caixa.max.y, fundo: caixa.min.z },
          caixa,
        });
      }
      this.modelos.set(glb, { dados, quadros, uvDaPaleta, materiais: new Map(), lotes: new Map() });
    } catch (erro) {
      console.warn(`voxel: ${glb} fica como sprite —`, erro);
    }
  }

  /**
   * Um sprite: o retângulo que o 2D pintaria, posto no mundo.
   *
   * Em pé, o retângulo fica num plano vertical que passa pelo ponto do chão
   * da âncora; o que no desenho 2D estava "acima" dela vira altura. A altura
   * é esticada pelo tanto que a inclinação da câmera a achataria, para o sprite
   * sair na tela
   * com a proporção do desenho em vez de achatado. Deitado (água, espuma), o
   * retângulo é o próprio pedaço de chão.
   */
  private sprite(
    img: ImagemPendente,
    ancora: Ponto | null,
    deitado: boolean,
    tinta?: Color,
    espesso = false,
    brilho = 1,
  ): void {
    const zoom = this.vista.zoom;
    const lote = this.loteDeSprites(img.fonte);
    // De pé, o sprite fica de frente para a câmera. Quando ela está virada
    // para o sul, o leste do mundo é a esquerda da tela — e quem olha para o
    // leste tem de sair olhando para a esquerda.
    const lado = (this.direitaX < 0 ? -1 : 1) / zoom;
    const chao = ancora ? this.noChao(ancora) : null;
    // Cada um um fio acima do anterior: o que foi pintado depois fica por cima.
    const ordem = Math.min(this.deitados++, 8000) * 0.0005;
    const altura = tinta ? 0.4 + ordem : NIVEL_DA_AGUA + ordem;
    const ponto = (c: Ponto, saida: Vector3): Vector3 => {
      if (deitado || !ancora || !chao) {
        const m = this.noChao(c);
        return saida.set(m.x, altura, m.y);
      }
      const dx = (c.x - ancora.x) * lado;
      return saida.set(
        chao.x + dx * this.direitaX,
        ((ancora.y - c.y) / zoom) * this.estica,
        chao.y + dx * this.direitaZ,
      );
    };
    const o = ponto(img.cantos[0], this.p);
    const ex = ponto(img.cantos[1], this.e).sub(o);
    const ey = ponto(img.cantos[2], this.v).sub(o);
    // prettier-ignore
    this.m.set(
      ex.x, ey.x, 0, o.x,
      ex.y, ey.y, 0, o.y,
      ex.z, ey.z, 1, o.z,
      0,    0,    0, 1,
    );
    const f = img.fonte;
    const por = (alvo: LoteDeSprites, tom: number): void => {
      const i = alvo.usados++;
      alvo.malha.setMatrixAt(i, this.m);
      alvo.recorte.setXYZW(i, img.sx / f.width, img.sy / f.height, img.sw / f.width, img.sh / f.height);
      alvo.tinta.setXYZ(i, (tinta?.r ?? 1) * tom, (tinta?.g ?? 1) * tom, (tinta?.b ?? 1) * tom);
    };
    por(lote, brilho);
    if (!espesso) return;
    // Espessura de papel recortado: a mesma folha repetida atrás, um pouco
    // mais para dentro da cena a cada camada e mais escura. De frente não se
    // vê nada; quando a câmera gira em volta, a perspectiva desloca as
    // camadas de trás e aparece uma borda escura do lado oposto à luz — o
    // personagem deixa de ser uma folha sem espessura nenhuma.
    const fx = this.direitaZ;
    const fz = -this.direitaX;
    for (let k = 1; k <= CAMADAS_DO_SPRITE; k++) {
      const recuo = k * PASSO_DA_CAMADA;
      this.m.elements[12] = o.x + fx * recuo;
      this.m.elements[14] = o.z + fz * recuo;
      por(this.loteDeSprites(f), 0.52 * Math.min(1, brilho));
    }
  }

  private loteDeSprites(fonte: Fonte): LoteDeSprites {
    let lote = this.sprites.get(fonte);
    if (lote && lote.usados < lote.malha.instanceMatrix.count) return lote;
    let material = lote?.material;
    if (!material) {
      const mapa =
        fonte === BRANCO
          ? new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, RGBAFormat)
          : new Texture(fonte as unknown as HTMLImageElement);
      mapa.magFilter = NearestFilter;
      mapa.minFilter = NearestFilter;
      mapa.generateMipmaps = false;
      mapa.flipY = false;
      mapa.needsUpdate = true;
      material = new ShaderMaterial({
        vertexShader: VERTICE_DO_SPRITE,
        fragmentShader: FRAGMENTO_DO_SPRITE,
        side: DoubleSide,
        uniforms: {
          ...this.nevoa,
          ...this.luz,
          mapa: { value: mapa },
          agua: { value: this.caminhoDe(fonte) === 'terrain/water' ? 1 : 0 },
        },
      });
    }
    const capacidade = lote ? lote.malha.instanceMatrix.count * 2 : 32;
    const geometria = this.quadrado.clone();
    const recorte = new InstancedBufferAttribute(new Float32Array(capacidade * 4), 4);
    const tinta = new InstancedBufferAttribute(new Float32Array(capacidade * 3), 3);
    geometria.setAttribute('recorte', recorte);
    geometria.setAttribute('tinta', tinta);
    const malha = new InstancedMesh(geometria, material, capacidade);
    malha.frustumCulled = false;
    if (lote) {
      (malha.instanceMatrix.array as Float32Array).set(lote.malha.instanceMatrix.array);
      (recorte.array as Float32Array).set(lote.recorte.array);
      (tinta.array as Float32Array).set(lote.tinta.array);
      this.cena.remove(lote.malha);
      lote.malha.geometry.dispose();
      lote.malha.dispose();
    }
    this.cena.add(malha);
    lote = { malha, material, recorte, tinta, usados: lote?.usados ?? 0 };
    this.sprites.set(fonte, lote);
    return lote;
  }

  /**
   * Um `fillRect` pintado antes da lista ordenada: é chão — a ponte. O que
   * cobre a tela inteira é o fundo, e o fundo aqui é o mar e o céu.
   */
  private retanguloNoChao(args: number[]): void {
    const [x, y, l, a] = args as [number, number, number, number];
    const cantos: [Ponto, Ponto, Ponto] = [
      this.noDesenho(x, y),
      this.noDesenho(x + l, y),
      this.noDesenho(x, y + a),
    ];
    if (cantos[1].x - cantos[0].x > this.ladoDoDesenho * 0.9) return;
    const estilo = this.real.fillStyle;
    if (typeof estilo !== 'string') return;
    this.cor.setStyle(estilo);
    this.sprite({ fonte: BRANCO, sx: 0, sy: 0, sw: 1, sh: 1, cantos }, null, true, this.cor);
  }

  // --- o 2D por cima ----------------------------------------------------------

  /** Se há um prédio entre a câmera e um ponto à altura do peito, no chão dado. */
  private tapado(x: number, z: number): boolean {
    for (let i = 0; i < this.paredes.length; i += 5) {
      if (this.raioCruza(this.paredes, i, 0, x, 28, z, 1)) return true;
    }
    // Atrás de árvore e pedra também — mas só **atrás**: quem está debaixo
    // da copa, colhendo, continua visível.
    for (let i = 0; i < this.copas.length; i += 6) {
      if (this.raioCruza(this.copas, i, this.copas[i + 5]!, x, 28, z, 0.9)) return true;
    }
    return false;
  }

  /**
   * Se o segmento da câmera até um ponto atravessa a caixa `i` de `paredes`.
   * Vai até o próprio ponto: quem está **dentro** da caixa também conta.
   */
  private raioCruza(
    p: readonly number[],
    i: number,
    baixo: number,
    x: number,
    h: number,
    z: number,
    ate: number,
  ): boolean {
    const o = this.camera.position;
    const d = [x - o.x, h - o.y, z - o.z] as const;
    const origem = [o.x, o.y, o.z] as const;
    const min = [p[i]!, baixo, p[i + 3]!] as const;
    const max = [p[i + 1]!, p[i + 2]!, p[i + 4]!] as const;
    let entra = 0;
    let sai = ate;
    for (let k = 0; k < 3; k++) {
      if (Math.abs(d[k]!) < 1e-9) {
        if (origem[k]! < min[k]! || origem[k]! > max[k]!) return false;
        continue;
      }
      const a = (min[k]! - origem[k]!) / d[k]!;
      const b = (max[k]! - origem[k]!) / d[k]!;
      entra = Math.max(entra, Math.min(a, b));
      sai = Math.min(sai, Math.max(a, b));
      if (entra > sai) return false;
    }
    return true;
  }

  /**
   * Toca o traço e o texto gravados, grupo a grupo, por cima do quadro 3D.
   *
   * Cada grupo é desenhado com uma transformação que leva a âncora dele, no
   * desenho 2D, ao ponto da tela em que ela caiu em perspectiva — e na escala
   * daquela distância. O que está fora de grupo é só estado (cor, fonte), e é
   * reaplicado sem pintar nada.
   */
  private tocar(): void {
    const ctx = this.real as unknown as Record<string, unknown>;
    const ops = this.ops;
    const dpr = this.dpr;
    let pular = false;
    for (let i = 0; i < ops.length; i += 3) {
      const tipo = ops[i];
      if (tipo === GRUPO) {
        const grupo = ops[i + 1] as Grupo;
        const ancora = grupo.ancora!;
        const chao = this.noChao(ancora);
        const tela = grupo.mundo
          ? this.projetar(grupo.mundo.x, grupo.mundo.altura, grupo.mundo.z)
          : this.projetar(chao.x, 0, chao.y);
        this.real.save();
        // O 2D vai por cima do quadro 3D e não tem profundidade: sem esta
        // conta, o nome de quem está atrás do castelo apareceria na fachada.
        pular =
          !tela ||
          // De longe o traço vira um borrão de letras miúdas: some.
          tela.escala < ESCALA_MINIMA_DO_TRACO ||
          (!grupo.predio && this.tapado(grupo.mundo?.x ?? chao.x, grupo.mundo?.z ?? chao.y));
        if (tela) {
          // Com teto: de perto, um nome não pode crescer até tapar a cena.
          const s = Math.min(tela.escala, ESCALA_MAXIMA_DO_TRACO) / this.vista.zoom;
          this.real.setTransform(
            dpr * s,
            0,
            0,
            dpr * s,
            dpr * (tela.x - s * ancora.x),
            dpr * (tela.y - s * ancora.y),
          );
        }
      } else if (tipo === FIM_DO_GRUPO) {
        this.real.restore();
        pular = false;
      } else if (tipo === ATRIBUIR) {
        ctx[ops[i + 1] as string] = ops[i + 2];
      } else if (!pular) {
        (ctx[ops[i + 1] as string] as (...a: unknown[]) => unknown)(...(ops[i + 2] as unknown[]));
      }
    }
  }
}
