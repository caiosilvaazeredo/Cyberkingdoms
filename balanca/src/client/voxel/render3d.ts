import {
  Box3,
  BufferGeometry,
  CircleGeometry,
  Color,
  ColorManagement,
  DataTexture,
  DoubleSide,
  Fog,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NearestFilter,
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
const ABERTURA = 55;

// A câmera de quem joga: perto, atrás do personagem, olhando por cima do
// ombro dele para onde ele está andando.
/** Quanto a câmera fica atrás do personagem, e a que altura. */
const RECUO = 250;
const ALTURA_DA_CAMERA = 125;
/** Para onde ela olha: um ponto à frente dele, à altura da cabeça. */
const ADIANTE = 150;
const ALTURA_DO_OLHAR = 48;
/** Com que pressa ela se vira para onde o personagem anda (1/s). */
const PRESSA_DO_GIRO = 1.8;
/** Abaixo desta velocidade (unidades/s) ele está parado, e a câmera também. */
const VELOCIDADE_MINIMA = 25;
/** A partir deste desvio (radianos) o passo é para trás, e a câmera não vira. */
const RE = (125 * Math.PI) / 180;

// A câmera de plateia (menu, assistir, vários jogadores no mesmo aparelho):
// mais alta e aberta, sempre olhando para o norte.
const INCLINACAO_DA_PLATEIA = (22 * Math.PI) / 180;
const ADIANTE_DA_PLATEIA = 64;

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
/** A que distância da câmera uma árvore ou pedra deixa de ser desenhada. */
const FOLGA_DA_LENTE = 110;
/** Abaixo deste tamanho o nome, a barra e a placa deixam de ser pintados. */
const ESCALA_MINIMA_DO_TRACO = 0.45;
/** Quantas camadas dão espessura a um personagem, e a distância entre elas. */
const CAMADAS_DO_SPRITE = 3;
const PASSO_DA_CAMADA = 1.6;
/** Onde fica o topo da cabeça de um personagem, em fração do lado do quadro. */
const ALTURA_DA_CABECA = 0.36;

/** A altura da água, abaixo do topo dos blocos de chão (que têm 16). */
const NIVEL_DA_AGUA = -10;

const VERTICE_DO_MODELO = /* glsl */ `
  uniform vec4 uvDaPaleta;
  uniform float ladoIgual;
  uniform float vento;
  uniform float tempo;
  uniform float contato;
  uniform float lambert;
  varying vec2 vUv;
  varying float vLuz;
  varying float vFundo;
  void main() {
    vUv = uv * uvDaPaleta.xy + uvDaPaleta.zw;
    vec3 n = normalize(mat3(instanceMatrix) * normal);
    // Luz fixa, de cima e de frente: o topo na cor exata, a frente um pouco
    // abaixo, os lados na sombra. É o que separa telhado de parede.
    // Num objeto redondo todos os lados levam a mesma luz: com a câmera
    // girando em volta, um lado "da frente" mais claro denunciaria a emenda.
    vLuz = n.y > 0.5 ? 1.0 : mix(n.z > 0.5 ? 0.88 : 0.76, 0.86, ladoIgual);
    // Nas construções, a luz difusa de Lambert com o sol fixo, alto e um
    // pouco à esquerda da frente: I = ambiente + difusa·max(N·L, 0). Cada
    // face sai com o tom da sua direção — telhado, frente, lado e fundo se
    // separam como num volume de verdade, de qualquer lado que se olhe.
    vec3 sol = normalize(vec3(-0.35, 0.85, 0.4));
    vLuz = mix(vLuz, 0.62 + 0.42 * max(dot(n, sol), 0.0), lambert);
    vec4 noMundo = instanceMatrix * vec4(position, 1.0);
    // Sombra de contato: o pé de toda parede e de todo tronco escurece onde
    // encosta no chão. É o que tira o objeto de "colado em cima da grama" e o
    // planta nela — a oclusão de ambiente mais barata que existe, uma rampa
    // na altura.
    vLuz *= mix(1.0, mix(0.58, 1.0, smoothstep(0.0, 26.0, noMundo.y)), contato);
    // O vento: a copa balança e o pé não sai do lugar. O deslocamento cresce
    // com o quadrado da altura, e a fase vem de onde a árvore está plantada —
    // cada uma no seu tempo, como uma rajada que atravessa o campo.
    vec3 raiz = instanceMatrix[3].xyz;
    float alto = max(noMundo.y, 0.0);
    float fase = tempo * 1.3 + raiz.x * 0.011 + raiz.z * 0.015 + alto * 0.012;
    float forca = vento * alto * alto * 0.00022;
    noMundo.x += (sin(fase) + 0.4 * sin(fase * 2.3 + 1.0)) * forca;
    noMundo.z += cos(fase * 0.8) * forca * 0.6;
    vec4 naCamera = viewMatrix * noMundo;
    vFundo = -naCamera.z;
    gl_Position = projectionMatrix * naCamera;
  }
`;

const FRAGMENTO_DO_MODELO = /* glsl */ `
  uniform sampler2D paleta;
  varying vec2 vUv;
  varying float vLuz;
  varying float vFundo;
  uniform vec3 nevoa;
  uniform vec2 faixaDaNevoa;
  void main() {
    vec3 cor = texture2D(paleta, vUv).rgb * vLuz;
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
  void main() {
    vUv = recorte.xy + position.xy * recorte.zw;
    vTinta = tinta;
    vec4 noMundo = instanceMatrix * vec4(position, 1.0);
    vChao = noMundo.xz;
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
  uniform vec3 nevoa;
  uniform vec2 faixaDaNevoa;
  ${ONDAS}
  void main() {
    vec4 cor = texture2D(mapa, vUv);
    // Recorte duro: tira o vazio e também a sombra do chão, que o pacote pinta
    // com alfa parcial.
    if (cor.a < 0.4) discard;
    vec3 tingida = cor.rgb * vTinta;
    if (agua > 0.5) tingida = ondular(tingida, vChao);
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
  void main() {
    vec3 c = ondular(cor, vChao);
    gl_FragColor = vec4(mix(c, nevoa, smoothstep(faixaDaNevoa.x, faixaDaNevoa.y, vFundo)), 1.0);
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
  private giro = 0;
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
        uniforms: { ...this.nevoa, cor: { value: new Color(0x47abaa) } },
      }),
    );
    this.mar.scale.setScalar(120000);
    this.mar.position.y = NIVEL_DA_AGUA - 1;
    this.cena.add(this.mar);
    this.cena.fog = new Fog(COR_DA_NEVOA, NEVOA[0], NEVOA[1]);
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

  mirar(alvo: { x: number; y: number; frenteX: number; frenteY: number } | null, dt: number): void {
    if (!alvo) {
      this.alvo = null;
      this.giro = 0;
      return;
    }
    const antes = this.alvo;
    this.alvo = { x: alvo.x, y: alvo.y };
    if (!antes) {
      // Ao entrar em campo ainda não há caminho andado: a câmera abre virada
      // para onde o jogo diz que é a frente (o meio do mapa).
      if (Math.hypot(alvo.frenteX, alvo.frenteY) > 1e-6) {
        this.giro = Math.atan2(alvo.frenteX, -alvo.frenteY);
      }
      return;
    }
    if (dt <= 0) return;
    // A câmera aponta para onde o personagem **anda**, e não para onde ele
    // mira: mede-se o passo dado desde o quadro anterior.
    const vx = (alvo.x - antes.x) / dt;
    const vy = (alvo.y - antes.y) / dt;
    if (Math.hypot(vx, vy) < VELOCIDADE_MINIMA) return;
    let falta = Math.atan2(vx, -vy) - this.giro;
    falta = Math.atan2(Math.sin(falta), Math.cos(falta));
    // Andar de costas não vira a câmera: virar faria o "para trás" do
    // controle passar a ser "para frente" no meio do passo, e o personagem
    // ficaria girando no lugar.
    if (Math.abs(falta) > RE) return;
    // Pelo caminho mais curto, e sem pressa: a câmera acompanha, não chicoteia.
    this.giro += falta * (1 - Math.exp(-dt * PRESSA_DO_GIRO));
  }

  get rumo(): number {
    return this.alvo ? this.giro : 0;
  }

  enquadrar(camera: CameraDoMundo, largura: number, altura: number): void {
    this.largura = largura;
    this.altura = altura;
    const c = this.camera;
    c.aspect = largura / altura;
    c.updateProjectionMatrix();
    let centro: { x: number; y: number };
    if (this.alvo) {
      // Atrás do personagem, olhando por cima dele para onde ele vai.
      centro = this.alvo;
      const fx = Math.sin(this.giro);
      const fz = -Math.cos(this.giro);
      c.position.set(centro.x - fx * RECUO, ALTURA_DA_CAMERA, centro.y - fz * RECUO);
      c.lookAt(centro.x + fx * ADIANTE, ALTURA_DO_OLHAR, centro.y + fz * ADIANTE);
    } else {
      // De plateia: à distância em que o alvo sai na escala do zoom 2D.
      centro = camera;
      const distancia = altura / (2 * camera.zoom * Math.tan((ABERTURA * Math.PI) / 360));
      const alvoZ = camera.y - ADIANTE_DA_PLATEIA;
      c.position.set(
        camera.x,
        distancia * Math.sin(INCLINACAO_DA_PLATEIA),
        alvoZ + distancia * Math.cos(INCLINACAO_DA_PLATEIA),
      );
      c.lookAt(camera.x, 0, alvoZ);
    }
    c.updateMatrixWorld(true);
    const m = c.matrixWorld.elements;
    const direita = Math.hypot(m[0]!, m[2]!) || 1;
    this.direitaX = m[0]! / direita;
    this.direitaZ = m[2]! / direita;
    // O eixo −Z da câmera é para onde ela olha; a componente vertical dele dá
    // a inclinação, e os sprites em pé esticam o que ela achataria.
    const horizontal = Math.hypot(m[8]!, m[10]!);
    this.estica = Math.min(1.35, 1 / Math.max(0.74, horizontal));
    this.vista = { x: centro.x, y: centro.y, zoom: ZOOM_DO_DESENHO };
    this.mar.position.x = centro.x;
    this.mar.position.z = centro.y;
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
    this.gl.render(this.cena, this.camera);
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
    const longe = this.projetar(
      o.x + Math.sin(this.rumo) * 50000,
      0,
      o.z - Math.cos(this.rumo) * 50000,
    );
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
    const quadro = Math.round(sy / d.lado) * d.colunas + Math.round(sx / d.larguraQuadro);
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

    // Árvore ou pedra encostada na lente tapa meia tela e não diz nada: a
    // câmera anda atrás de quem joga e passa por dentro delas. Some o que
    // estiver a menos de um corpo da câmera.
    if (this.alvo && d.plano !== 'chao' && !d.oclui) {
      const c = modelo.quadros[quadro]!.caixa;
      const raio = Math.max(c.max.x - c.min.x, c.max.z - c.min.z) * 0.5 * escala;
      const o = this.camera.position;
      if (Math.hypot(chao.x - o.x, chao.y - o.z) < raio + FOLGA_DA_LENTE) return true;
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
            paleta: { value: texturaDaPaleta(d.paletas[entrada.paleta]!) },
            uvDaPaleta: { value: modelo.uvDaPaleta },
            ladoIgual: { value: d.redondo ? 1 : 0 },
            vento: { value: d.vento ? 1 : 0 },
            contato: { value: d.plano === 'chao' ? 0 : 1 },
            lambert: { value: d.lambert ? 1 : 0 },
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
    // Como as árvores: um sprite encostado na lente tapa a tela e não é o
    // personagem de quem joga, que fica bem mais longe dela.
    if (!deitado && ancora && this.alvo) {
      const perto = this.noChao(ancora);
      const o = this.camera.position;
      if (Math.hypot(perto.x - o.x, perto.y - o.z) < FOLGA_DA_LENTE * 0.75) return;
    }
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
