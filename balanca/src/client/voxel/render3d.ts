import {
  BufferGeometry,
  Camera,
  DataTexture,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  NearestFilter,
  Quaternion,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Vector3,
  Vector4,
  WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

import type { CameraDoMundo, IndiceDeVoxels, ModeloNoIndice, PintorVoxel } from './adaptador';

/**
 * O renderer voxel: modelos `.glb` de `public/voxel`, câmera oblíqua.
 *
 * ## A câmera
 *
 * Ortográfica oblíqua: `telaX = x`, `telaY = y − altura`. O chão cai na tela
 * exatamente onde o 2D o põe (tile de 64 px × zoom) e um voxel de altura vale
 * um pixel do sprite, então o enquadramento não muda — `seguir`, `prender` e o
 * zoom são os mesmos, só a projeção é uma matriz em vez de duas contas.
 *
 * No espaço do three: X é o x do mundo, **Z é o y do mundo** (sul = perto de
 * quem olha) e Y é a altura.
 *
 * ## Quem fica na frente de quem
 *
 * Entre objetos, vale a **ordem de pintura do 2D**, e não a geometria: o jogo
 * ordena por uma chave que nem sempre é o pé do sprite (o prédio ordena pela
 * porta, e quem está na soleira aparece na frente dele). Cada objeto é
 * empurrado ao longo do raio de visão — o que não muda onde ele cai na tela —
 * até uma fatia de profundidade só dele, na ordem em que foi pedido. O
 * z-buffer resolve o que sobra: as faces de um mesmo modelo.
 *
 * ## Como o mundo chega aqui
 *
 * `desenhar` entrega ao desenho 2D um contexto **gravador**. Cada chamada é
 * anotada numa lista em vez de ir para o canvas, e cada `drawImage` é
 * conferido: se a imagem tem modelo, o modelo entra em cena no retângulo que o
 * sprite ocuparia e a lista ganha um "cole aqui o pedaço do 3D". Depois o 3D é
 * renderizado de uma vez e a lista é tocada em ordem.
 *
 * Tocar em ordem é o que mantém a ordenação por y entre o que já é modelo e o
 * que ainda é desenho 2D (baú, bolsa, ponte, efeitos): cada modelo cola o seu
 * retângulo na vez dele, e entre modelos quem resolve é o z-buffer.
 *
 * ## Espelho
 *
 * Onde o 2D faz `scale(-1, 1)`, aqui o modelo é espelhado em x. Girar 180°
 * não serve: a frente do modelo é plana (é o desenho do sprite) e o volume
 * cresce para trás, então o giro mostraria as costas.
 *
 * ## Instancing
 *
 * Um `InstancedMesh` por (modelo, quadro, paleta): cem árvores no mesmo quadro
 * de animação são uma chamada de desenho. O chão vai numa cena à parte,
 * renderizada e colada inteira antes de tudo.
 */

const VERTICE = /* glsl */ `
  uniform vec4 uvDaPaleta;
  varying vec2 vUv;
  varying float vLuz;
  void main() {
    vUv = uv * uvDaPaleta.xy + uvDaPaleta.zw;
    vec3 n = normalize(mat3(instanceMatrix) * mat3(modelMatrix) * normal);
    vLuz = n.y > 0.5 ? 1.0 : (abs(n.z) > 0.5 ? 0.0 : -1.0);
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENTO = /* glsl */ `
  uniform sampler2D paleta;
  uniform float clarearTopo;
  varying vec2 vUv;
  varying float vLuz;
  void main() {
    vec3 cor = texture2D(paleta, vUv).rgb;
    // A frente leva a cor exata do pixel; o topo clareia um nada para o volume
    // se ler, e o resto (que a câmera quase não vê) escurece.
    if (vLuz > 0.5) cor = mix(cor, vec3(1.0), clarearTopo);
    else if (vLuz < -0.5) cor *= 0.8;
    gl_FragColor = vec4(cor, 1.0);
  }
`;

interface Quadro {
  geometria: BufferGeometry;
  /** A matriz do nó no `.glb` — desfaz a quantização do conversor. */
  matriz: Matrix4;
}

interface Modelo {
  dados: ModeloNoIndice;
  quadros: Quadro[];
  uvDaPaleta: Vector4;
  materiais: Map<string, ShaderMaterial>;
  lotes: Map<string, Lote>;
}

interface Lote {
  malha: InstancedMesh;
  usados: number;
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

// O que cada operação gravada é.
/**
 * A fatia de profundidade de cada objeto — maior que qualquer modelo. O mais
 * fundo é o telhado de um prédio, que deita para trás uma linha por pixel.
 */
const FATIA = 512;
/** Quantas fatias cabem na faixa de profundidade da câmera. */
const FATIAS = 2048;

const ATRIBUIR = 0;
const CHAMAR = 1;
const COLAR_CHAO = 2;
const COLAR = 3;

/** Métodos que pintam: ficam só na lista, e vão ao canvas na hora de tocar. */
const PINTAM = new Set([
  'drawImage',
  'fillRect',
  'strokeRect',
  'clearRect',
  'fillText',
  'strokeText',
  'fill',
  'stroke',
]);

/**
 * O estado que um texto leva consigo quando é adiado para o fim do quadro.
 */
const ESTADO_DO_TEXTO = [
  'font',
  'textAlign',
  'textBaseline',
  'fillStyle',
  'strokeStyle',
  'lineWidth',
  'lineJoin',
  'globalAlpha',
  'shadowColor',
  'shadowBlur',
  'shadowOffsetX',
  'shadowOffsetY',
] as const;

interface Texto {
  nome: string;
  args: unknown[];
  estado: unknown[];
  matriz: DOMMatrix;
}

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

export class RenderVoxel implements PintorVoxel {
  private readonly tela = document.createElement('canvas');
  private readonly gl: WebGLRenderer;
  private readonly cenaDoChao = new Scene();
  private readonly cena = new Scene();
  private readonly camera = new Camera();
  private readonly carregador = new GLTFLoader();
  /** Por `.glb`: o modelo, ou `null` enquanto baixa (ou se falhou). */
  private readonly modelos = new Map<string, Modelo | null>();
  /** Por imagem: o modelo e a paleta dela, ou `null` se não tem. */
  private readonly porImagem = new WeakMap<object, { glb: string; paleta: string } | null>();

  private real!: CanvasRenderingContext2D;
  private gravador: CanvasRenderingContext2D | null = null;
  private readonly metodos = new Map<string, (...args: unknown[]) => unknown>();
  private ops: unknown[] = [];
  /**
   * Nomes e placas, pintados por cima de tudo no fim do quadro.
   *
   * Colar o retângulo de um modelo traz junto os pixels de qualquer outro
   * modelo que esteja nele — inclusive um pintado **antes** de um rótulo, que
   * assim acabaria por cima do rótulo. Texto por último resolve isso, e é
   * também o que se quer de um nome: que dê para ler.
   */
  private textos: Texto[] = [];
  private vista: CameraDoMundo = { x: 0, y: 0, zoom: 1 };
  private largura = 1;
  private altura = 1;
  private dpr = 1;
  private temChao = false;
  private ordem = 0;

  private readonly m = new Matrix4();
  private readonly p = new Vector3();
  private readonly e = new Vector3();
  private readonly semGiro = new Quaternion();

  private constructor(
    private readonly indice: IndiceDeVoxels,
    private readonly raiz: string,
  ) {
    this.gl = new WebGLRenderer({ canvas: this.tela, alpha: true, antialias: false });
    this.gl.setClearColor(0x000000, 0);
    this.camera.matrixAutoUpdate = false;
    this.carregador.setMeshoptDecoder(MeshoptDecoder);
  }

  /** Lê o índice. Os modelos são baixados um a um, quando aparecem em cena. */
  static async criar(raiz = '/voxel'): Promise<RenderVoxel> {
    const indice = (await (await fetch(`${raiz}/indice.json`)).json()) as IndiceDeVoxels;
    return new RenderVoxel(indice, raiz);
  }

  desenhar(
    ctx: CanvasRenderingContext2D,
    camera: CameraDoMundo,
    largura: number,
    altura: number,
    pintar: (ctx: CanvasRenderingContext2D) => void,
  ): void {
    this.real = ctx;
    this.vista = camera;
    this.largura = largura;
    this.altura = altura;
    this.dpr = ctx.getTransform().a;
    this.ops.length = 0;
    this.textos.length = 0;
    this.temChao = false;
    this.ordem = 0;
    this.projetar();
    for (const modelo of this.modelos.values()) {
      if (modelo) for (const lote of modelo.lotes.values()) lote.usados = 0;
    }

    // O desenho de sempre, no gravador. O estado (transformações, fonte,
    // traçado) também é aplicado ao contexto de verdade na hora, para que as
    // perguntas — `measureText`, `getTransform` — tenham resposta certa; o
    // `save`/`restore` em volta devolve o contexto como estava antes de tocar.
    ctx.save();
    try {
      pintar(this.gravador ?? (this.gravador = this.criarGravador()));
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
    this.tocar();
  }

  /**
   * A projeção oblíqua, escrita direto em coordenadas de recorte:
   *
   *     ndcX =  2z/L · (X − cx)
   *     ndcY =  2z/A · (Y − Z + cy)      ← altura sobe, sul desce
   *     ndcZ = −2/F · (Z − cy)           ← mais ao sul = mais perto
   */
  private projetar(): void {
    const l = Math.floor(this.largura * this.dpr);
    const a = Math.floor(this.altura * this.dpr);
    if (this.tela.width !== l || this.tela.height !== a) this.gl.setSize(l, a, false);
    const { x, y, zoom } = this.vista;
    const sx = (2 * zoom) / this.largura;
    const sy = (2 * zoom) / this.altura;
    const sz = 2 / (FATIA * FATIAS);
    // prettier-ignore
    this.camera.projectionMatrix.set(
      sx, 0,   0,  -sx * x,
      0,  sy, -sy,  sy * y,
      0,  0,  -sz,  sz * y,
      0,  0,   0,   1,
    );
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
  }

  private criarGravador(): CanvasRenderingContext2D {
    const eu = this;
    return new Proxy({} as CanvasRenderingContext2D, {
      get(_alvo, nome: string) {
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
    if (nome === 'drawImage') {
      return (...args) => {
        if (!this.imagem(args)) this.ops.push(CHAMAR, nome, args);
      };
    }
    if (nome === 'fillText' || nome === 'strokeText') {
      return (...args) => {
        const real = this.real as unknown as Record<string, unknown>;
        this.textos.push({
          nome,
          args,
          estado: ESTADO_DO_TEXTO.map((p) => real[p]),
          matriz: this.real.getTransform(),
        });
      };
    }
    if (PINTAM.has(nome)) {
      return (...args) => {
        this.ops.push(CHAMAR, nome, args);
      };
    }
    return (...args) => {
      this.ops.push(CHAMAR, nome, args);
      return chamar(args);
    };
  }

  /**
   * Um `drawImage`. Devolve `true` se virou modelo.
   *
   * O retângulo de destino é o do sprite, já com o arredondamento que o 2D
   * fez; o modelo é encaixado nele. O recorte de origem diz qual é o quadro.
   */
  private imagem(args: unknown[]): boolean {
    const img = args[0] as { width: number; height: number; src?: string };
    let sx = 0;
    let sy = 0;
    let sw = img.width;
    let sh = img.height;
    let dx: number, dy: number, dw: number, dh: number;
    if (args.length === 9) {
      [sx, sy, sw, sh, dx, dy, dw, dh] = args.slice(1) as number[] as [
        number, number, number, number, number, number, number, number,
      ];
    } else if (args.length === 5) {
      [dx, dy, dw, dh] = args.slice(1) as [number, number, number, number];
    } else {
      return false;
    }
    if (this.real.globalAlpha < 1) return false;
    const achado = this.modeloDe(img);
    if (!achado) return false;
    const { modelo, paleta } = achado;
    const d = modelo.dados;
    if (Math.abs(sw - d.larguraQuadro) > 0.5 || Math.abs(sh - d.lado) > 0.5) return false;
    const quadro = Math.round(sy / d.lado) * d.colunas + Math.round(sx / d.larguraQuadro);
    if (quadro < 0 || quadro >= d.quadros) return false;

    const t = this.real.getTransform();
    const dpr = this.dpr;
    const zoom = this.vista.zoom;
    // Escala do sprite na tela, em pixels de CSS por pixel de sprite.
    const giro = Math.hypot(t.a, t.b) / dpr;
    const escala = (dh / d.lado) * giro;
    const paraMundo = (px: number, py: number): { x: number; y: number } => ({
      x: ((t.a * px + t.c * py + t.e) / dpr - this.largura / 2) / zoom + this.vista.x,
      y: ((t.b * px + t.d * py + t.f) / dpr - this.altura / 2) / zoom + this.vista.y,
    });

    if (d.plano === 'chao') {
      const canto = paraMundo(dx, dy);
      this.instancia(modelo, quadro, paleta, canto.x, canto.y, escala / zoom, false, this.cenaDoChao);
      if (!this.temChao) {
        this.temChao = true;
        this.ops.push(COLAR_CHAO, 0, 0);
      }
      return true;
    }

    const espelhar = t.a * t.d - t.b * t.c < 0;
    const pe = paraMundo(dx + dw / 2, dy + (d.pes / d.lado) * dh);
    // Subir e ir para o sul na mesma medida anda sobre o raio de visão: o
    // objeto fica no mesmo pixel e muda só de profundidade.
    const fatia = this.vista.y + (Math.min(this.ordem++, FATIAS - 2) - FATIAS / 2 + 1) * FATIA;
    this.instancia(modelo, quadro, paleta, pe.x, pe.y, escala / zoom, espelhar, this.cena, fatia - pe.y);

    // O retângulo a colar: o do sprite na tela, mais a espessura do modelo —
    // que a câmera oblíqua mostra como alguns pixels a mais em cima e embaixo.
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [cx, cy] of [
      [dx, dy],
      [dx + dw, dy],
      [dx, dy + dh],
      [dx + dw, dy + dh],
    ] as const) {
      const px = t.a * cx + t.c * cy + t.e;
      const py = t.b * cx + t.d * cy + t.f;
      x0 = Math.min(x0, px);
      x1 = Math.max(x1, px);
      y0 = Math.min(y0, py);
      y1 = Math.max(y1, py);
    }
    const folga = Math.ceil((d.meiaProfundidade + 2) * escala * dpr);
    x0 = Math.max(0, Math.floor(x0) - 1);
    y0 = Math.max(0, Math.floor(y0) - folga);
    x1 = Math.min(this.tela.width, Math.ceil(x1) + 1);
    y1 = Math.min(this.tela.height, Math.ceil(y1) + folga);
    if (x1 > x0 && y1 > y0) this.ops.push(COLAR, x0 | (y0 << 16), (x1 - x0) | ((y1 - y0) << 16));
    return true;
  }

  private modeloDe(img: { src?: string }): { modelo: Modelo; paleta: string } | null {
    let entrada = this.porImagem.get(img);
    if (entrada === undefined) {
      const caminho =
        typeof img.src === 'string'
          ? img.src.replace(/^.*\/tiny\//, '').replace(/\.png$/, '')
          : null;
      entrada = (caminho && this.indice.folhas[caminho]) || null;
      this.porImagem.set(img, entrada);
    }
    if (!entrada) return null;
    const modelo = this.modelos.get(entrada.glb);
    if (modelo === undefined) {
      // Primeira vez que esta folha aparece: baixa, e até chegar é sprite.
      this.modelos.set(entrada.glb, null);
      void this.baixar(entrada.glb);
      return null;
    }
    return modelo ? { modelo, paleta: entrada.paleta } : null;
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
        quadros.push({ geometria: achada.geometry, matriz: achada.matrixWorld.clone() });
      }
      this.modelos.set(glb, { dados, quadros, uvDaPaleta, materiais: new Map(), lotes: new Map() });
    } catch (erro) {
      console.warn(`voxel: ${glb} fica em 2D —`, erro);
    }
  }

  private instancia(
    modelo: Modelo,
    quadro: number,
    paleta: string,
    x: number,
    y: number,
    escala: number,
    espelhar: boolean,
    cena: Scene,
    noRaio = 0,
  ): void {
    const lote = this.lote(modelo, quadro, paleta, cena);
    this.m.compose(
      this.p.set(x, noRaio, y + noRaio),
      this.semGiro,
      this.e.set(espelhar ? -escala : escala, escala, escala),
    );
    this.m.multiply(modelo.quadros[quadro]!.matriz);
    lote.malha.setMatrixAt(lote.usados++, this.m);
  }

  private lote(modelo: Modelo, quadro: number, paleta: string, cena: Scene): Lote {
    const chave = `${quadro}:${paleta}`;
    let lote = modelo.lotes.get(chave);
    if (lote && lote.usados < lote.malha.instanceMatrix.count) return lote;

    let material = modelo.materiais.get(paleta);
    if (!material) {
      material = new ShaderMaterial({
        vertexShader: VERTICE,
        fragmentShader: FRAGMENTO,
        // O espelho inverte a ordem dos vértices; sem isto ele sumiria.
        side: DoubleSide,
        uniforms: {
          paleta: { value: texturaDaPaleta(modelo.dados.paletas[paleta]!) },
          uvDaPaleta: { value: modelo.uvDaPaleta },
          // No chão e nos prédios o topo é o próprio desenho: cor exata.
          clarearTopo: { value: modelo.dados.topoExato ? 0 : 0.14 },
        },
      });
      modelo.materiais.set(paleta, material);
    }
    // Lote cheio: dobra, levando o que já foi posto neste quadro.
    const capacidade = lote ? lote.malha.instanceMatrix.count * 2 : 16;
    const malha = new InstancedMesh(modelo.quadros[quadro]!.geometria, material, capacidade);
    malha.frustumCulled = false;
    malha.count = 0;
    if (lote) {
      (malha.instanceMatrix.array as Float32Array).set(lote.malha.instanceMatrix.array);
      cena.remove(lote.malha);
      lote.malha.dispose();
      lote.malha = malha;
    } else {
      lote = { malha, usados: 0 };
      modelo.lotes.set(chave, lote);
    }
    cena.add(malha);
    return lote;
  }

  /** Toca a lista gravada no canvas de verdade, colando o 3D onde foi pedido. */
  private tocar(): void {
    const ctx = this.real as unknown as Record<string, unknown>;
    const ops = this.ops;
    let objetosProntos = false;
    const prepararObjetos = (): void => {
      if (objetosProntos) return;
      objetosProntos = true;
      this.gl.render(this.cena, this.camera);
    };
    // Sem chão em cena, os objetos já podem ser renderizados.
    if (!this.temChao) prepararObjetos();

    for (let i = 0; i < ops.length; i += 3) {
      const tipo = ops[i];
      if (tipo === CHAMAR) {
        (ctx[ops[i + 1] as string] as (...a: unknown[]) => unknown)(...(ops[i + 2] as unknown[]));
      } else if (tipo === ATRIBUIR) {
        ctx[ops[i + 1] as string] = ops[i + 2];
      } else {
        this.real.save();
        this.real.setTransform(1, 0, 0, 1, 0, 0);
        if (tipo === COLAR_CHAO) {
          this.gl.render(this.cenaDoChao, this.camera);
          this.real.drawImage(this.tela, 0, 0);
          prepararObjetos();
        } else {
          const a = ops[i + 1] as number;
          const b = ops[i + 2] as number;
          const x = a & 0xffff;
          const y = a >>> 16;
          const l = b & 0xffff;
          const h = b >>> 16;
          this.real.drawImage(this.tela, x, y, l, h, x, y, l, h);
        }
        this.real.restore();
      }
    }

    for (const texto of this.textos) {
      this.real.save();
      this.real.setTransform(texto.matriz);
      ESTADO_DO_TEXTO.forEach((p, i) => {
        ctx[p] = texto.estado[i];
      });
      (ctx[texto.nome] as (...a: unknown[]) => unknown)(...texto.args);
      this.real.restore();
    }
  }
}
