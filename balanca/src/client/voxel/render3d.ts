import {
  Box3,
  BufferGeometry,
  CircleGeometry,
  Color,
  DataTexture,
  DoubleSide,
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
  Vector3,
  Vector4,
  WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

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

/** Abertura vertical da câmera, em graus. */
const ABERTURA = 50;
/** Quanto a câmera olha para baixo, a partir do horizonte. */
const INCLINACAO = (22 * Math.PI) / 180;
/** O alvo fica um pouco ao norte de quem joga: vê-se mais do que vem pela frente. */
const ADIANTE = 64;
/** A altura da água, abaixo do topo dos blocos de chão (que têm 16). */
const NIVEL_DA_AGUA = -10;

const VERTICE_DO_MODELO = /* glsl */ `
  uniform vec4 uvDaPaleta;
  varying vec2 vUv;
  varying float vLuz;
  void main() {
    vUv = uv * uvDaPaleta.xy + uvDaPaleta.zw;
    vec3 n = normalize(mat3(instanceMatrix) * normal);
    // Luz fixa, de cima e de frente: o topo na cor exata, a frente um pouco
    // abaixo, os lados na sombra. É o que separa telhado de parede.
    vLuz = n.y > 0.5 ? 1.0 : (n.z > 0.5 ? 0.84 : 0.66);
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENTO_DO_MODELO = /* glsl */ `
  uniform sampler2D paleta;
  varying vec2 vUv;
  varying float vLuz;
  void main() {
    gl_FragColor = vec4(texture2D(paleta, vUv).rgb * vLuz, 1.0);
  }
`;

const VERTICE_DO_SPRITE = /* glsl */ `
  attribute vec4 recorte;
  attribute vec3 tinta;
  varying vec2 vUv;
  varying vec3 vTinta;
  void main() {
    vUv = recorte.xy + position.xy * recorte.zw;
    vTinta = tinta;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENTO_DO_SPRITE = /* glsl */ `
  uniform sampler2D mapa;
  varying vec2 vUv;
  varying vec3 vTinta;
  void main() {
    vec4 cor = texture2D(mapa, vUv);
    // Recorte duro: tira o vazio e também a sombra do chão, que o pacote pinta
    // com alfa parcial.
    if (cor.a < 0.4) discard;
    gl_FragColor = vec4(cor.rgb * vTinta, 1.0);
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

  private real!: CanvasRenderingContext2D;
  private gravador: CanvasRenderingContext2D | null = null;
  private readonly metodos = new Map<string, (...args: unknown[]) => unknown>();
  private ops: unknown[] = [];
  private vista: CameraDoMundo = { x: 0, y: 0, zoom: 1 };
  private largura = 1;
  private altura = 1;
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
      new MeshBasicMaterial({ color: 0x47abaa }),
    );
    this.mar.scale.setScalar(120000);
    this.mar.position.y = NIVEL_DA_AGUA - 1;
    this.cena.add(this.mar);
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

  enquadrar(camera: CameraDoMundo, largura: number, altura: number): void {
    this.vista = camera;
    this.largura = largura;
    this.altura = altura;
    const c = this.camera;
    c.aspect = largura / altura;
    c.updateProjectionMatrix();
    // À distância em que o alvo sai na tela na escala do zoom 2D.
    const distancia = altura / (2 * camera.zoom * Math.tan((ABERTURA * Math.PI) / 360));
    const alvoZ = camera.y - ADIANTE;
    c.position.set(
      camera.x,
      distancia * Math.sin(INCLINACAO),
      alvoZ + distancia * Math.cos(INCLINACAO),
    );
    c.lookAt(camera.x, 0, alvoZ);
    c.updateMatrixWorld(true);
    this.mar.position.x = camera.x;
    this.mar.position.z = camera.y;
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
    pintar: (ctx: CanvasRenderingContext2D) => void,
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
      pintar(this.gravador ?? (this.gravador = this.criarGravador()));
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
    const longe = this.projetar(this.vista.x, 0, this.vista.y - 50000);
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
    this.grupo = { ancora: null, mundo: null, y, fixo: false, salvos: 0 };
    this.ops.push(GRUPO, this.grupo, 0);
  }

  private fecharGrupo(): void {
    const g = this.grupo;
    if (!g) return;
    this.grupo = null;
    if (!g.ancora) {
      g.ancora = {
        x: this.largura / 2,
        y: g.y === null ? this.altura / 2 : (g.y - this.vista.y) * this.vista.zoom + this.altura / 2,
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
      x: (p.x - this.largura / 2) / this.vista.zoom + this.vista.x,
      y: (p.y - this.altura / 2) / this.vista.zoom + this.vista.y,
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
      }
      if (g && !g.fixo) {
        g.ancora = pe;
        g.fixo = true;
      }
      // Sempre pelo próprio pé: a âncora do grupo pode ser o topo de um prédio.
      this.sprite(pendente, pe, false);
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
    // Prédio não barra ninguém na simulação: anda-se por cima do pé do sprite
    // dele, e o 2D resolve isso pintando na frente quem está ao sul da linha
    // em que o prédio é ordenado. A caixa fica com a fachada nessa linha — e
    // não na base do desenho —, senão quem para na porta some dentro dela.
    if (d.oclui && g && g.y !== null) chao.y = g.y;
    if (g && !g.fixo && d.plano !== 'chao') {
      const topo = modelo.quadros[quadro]!.topo;
      g.ancora = this.noDesenho(dx + dw / 2, dy);
      g.mundo = { x: chao.x, altura: topo.altura * escala, z: chao.y + topo.fundo * escala };
      g.fixo = true;
    }

    if (d.oclui) {
      const c = modelo.quadros[quadro]!.caixa;
      this.paredes.push(
        chao.x + c.min.x * escala,
        chao.x + c.max.x * escala,
        c.max.y * escala,
        chao.y + c.min.z * escala,
        chao.y + c.max.z * escala,
      );
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
            paleta: { value: texturaDaPaleta(d.paletas[entrada.paleta]!) },
            uvDaPaleta: { value: modelo.uvDaPaleta },
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
   * é esticada por 1/cos da inclinação da câmera, para o sprite sair na tela
   * com a proporção do desenho em vez de achatado. Deitado (água, espuma), o
   * retângulo é o próprio pedaço de chão.
   */
  private sprite(img: ImagemPendente, ancora: Ponto | null, deitado: boolean, tinta?: Color): void {
    const lote = this.loteDeSprites(img.fonte);
    const zoom = this.vista.zoom;
    const estica = 1 / Math.cos(INCLINACAO);
    const chao = ancora ? this.noChao(ancora) : null;
    // Cada um um fio acima do anterior: o que foi pintado depois fica por cima.
    const ordem = Math.min(this.deitados++, 8000) * 0.0005;
    const altura = tinta ? 0.4 + ordem : NIVEL_DA_AGUA + ordem;
    const ponto = (c: Ponto, saida: Vector3): Vector3 => {
      if (deitado || !ancora || !chao) {
        const m = this.noChao(c);
        return saida.set(m.x, altura, m.y);
      }
      return saida.set(
        chao.x + (c.x - ancora.x) / zoom,
        ((ancora.y - c.y) / zoom) * estica,
        chao.y,
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
    const i = lote.usados++;
    lote.malha.setMatrixAt(i, this.m);
    const f = img.fonte;
    lote.recorte.setXYZW(i, img.sx / f.width, img.sy / f.height, img.sw / f.width, img.sh / f.height);
    lote.tinta.setXYZ(i, tinta?.r ?? 1, tinta?.g ?? 1, tinta?.b ?? 1);
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
        uniforms: { mapa: { value: mapa } },
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
    if (cantos[1].x - cantos[0].x > this.largura * 0.9) return;
    const estilo = this.real.fillStyle;
    if (typeof estilo !== 'string') return;
    this.cor.setStyle(estilo);
    this.sprite({ fonte: BRANCO, sx: 0, sy: 0, sw: 1, sh: 1, cantos }, null, true, this.cor);
  }

  // --- o 2D por cima ----------------------------------------------------------

  /** Se há um prédio entre a câmera e um ponto à altura do peito, no chão dado. */
  private tapado(x: number, z: number): boolean {
    const o = this.camera.position;
    const d = [x - o.x, 28 - o.y, z - o.z] as const;
    const origem = [o.x, o.y, o.z] as const;
    const p = this.paredes;
    for (let i = 0; i < p.length; i += 5) {
      const min = [p[i]!, 0, p[i + 3]!] as const;
      const max = [p[i + 1]!, p[i + 2]!, p[i + 4]!] as const;
      let entra = 0;
      // Até o próprio ponto: quem está **dentro** da caixa — prédio não barra
      // ninguém — também está tapado.
      let sai = 1;
      for (let k = 0; k < 3 && entra <= sai; k++) {
        if (Math.abs(d[k]!) < 1e-9) {
          if (origem[k]! < min[k]! || origem[k]! > max[k]!) entra = 2;
          continue;
        }
        const a = (min[k]! - origem[k]!) / d[k]!;
        const b = (max[k]! - origem[k]!) / d[k]!;
        entra = Math.max(entra, Math.min(a, b));
        sai = Math.min(sai, Math.max(a, b));
      }
      if (entra <= sai) return true;
    }
    return false;
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
        pular = !tela || tela.escala < 0.05 || (!grupo.mundo && this.tapado(chao.x, chao.y));
        if (tela) {
          const s = tela.escala / this.vista.zoom;
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
