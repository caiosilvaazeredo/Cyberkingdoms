import {
  BufferGeometry,
  Camera,
  DataTexture,
  InstancedMesh,
  Matrix4,
  Mesh,
  NearestFilter,
  Quaternion,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Vector3,
  WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import type { Animacao } from '../arte';
import type { CameraDoMundo, IndiceDeVoxels, PintorVoxel, Recorte } from './adaptador';

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
 * quem olha) e Y é a altura. A profundidade do z-buffer segue o y do mundo,
 * que é a mesma ordenação por y do 2D.
 *
 * ## Espelho vira rotação
 *
 * Onde o 2D faz `scale(-1, 1)`, aqui o modelo gira 180° em torno do eixo
 * vertical. O modelo é simétrico em profundidade (sai de um sprite só), então
 * a silhueta é o espelho exato.
 *
 * ## Instancing
 *
 * Um `InstancedMesh` por (modelo, quadro, paleta). Dez guerreiros azuis no
 * mesmo quadro de animação são uma chamada de desenho.
 */

const VERTICE = /* glsl */ `
  varying vec2 vUv;
  varying float vLuz;
  void main() {
    vUv = uv;
    vec3 n = normalize(mat3(instanceMatrix) * normal);
    // A frente leva a cor exata do pixel; o topo clareia um nada para o volume
    // se ler, e o resto (que a câmera quase não vê) escurece.
    vLuz = n.y > 0.5 ? 1.0 : (abs(n.z) > 0.5 ? 0.0 : -1.0);
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENTO = /* glsl */ `
  uniform sampler2D paleta;
  varying vec2 vUv;
  varying float vLuz;
  void main() {
    vec3 cor = texture2D(paleta, vUv).rgb;
    if (vLuz > 0.5) cor = mix(cor, vec3(1.0), 0.14);
    else if (vLuz < -0.5) cor *= 0.8;
    gl_FragColor = vec4(cor, 1.0);
  }
`;

interface Extras {
  quadros: number;
  larguraQuadro: number;
  lado: number;
  /** Onde o 2D ancora o quadro, em pixels a partir do canto de cima. */
  pivo: [number, number];
  /** A linha da base dos pés — a origem vertical do modelo. */
  pes: number;
  paletas: Record<string, string[]>;
}

interface Modelo {
  geometrias: BufferGeometry[];
  /** A escala do nó do glb (o conversor quantiza no dobro e desfaz aqui). */
  escalaDoNo: number;
  extras: Extras;
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

/** `/tiny/units/azul/guerreiro_parado.png` → `units/azul/guerreiro_parado`. */
function caminhoDe(anim: Animacao): string | null {
  return anim.caminho ?? null;
}

export class RenderVoxel implements PintorVoxel {
  private readonly tela = document.createElement('canvas');
  private readonly gl: WebGLRenderer;
  private readonly cena = new Scene();
  private readonly camera = new Camera();
  private readonly modelos = new Map<string, Modelo>();
  /** Folha do 2D → modelo e paleta, resolvido uma vez por `Animacao`. */
  private readonly porFolha = new Map<Animacao, { modelo: Modelo; paleta: string } | null>();
  private vista: CameraDoMundo = { x: 0, y: 0, zoom: 1 };
  private largura = 1;
  private altura = 1;
  private dpr = 1;

  private readonly m = new Matrix4();
  private readonly p = new Vector3();
  private readonly e = new Vector3();
  private readonly frente = new Quaternion();
  private readonly costas = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);

  private constructor(private readonly indice: IndiceDeVoxels) {
    this.gl = new WebGLRenderer({ canvas: this.tela, alpha: true, antialias: false });
    this.gl.setClearColor(0x000000, 0);
    this.camera.matrixAutoUpdate = false;
  }

  /** Lê o índice e baixa todos os modelos que ele lista. */
  static async criar(raiz = '/voxel'): Promise<RenderVoxel> {
    const indice = (await (await fetch(`${raiz}/indice.json`)).json()) as IndiceDeVoxels;
    const r = new RenderVoxel(indice);
    const carregador = new GLTFLoader();
    const arquivos = [...new Set(Object.values(indice.folhas).map((f) => f.glb))];
    await Promise.all(
      arquivos.map(async (arquivo) => {
        const gltf = await carregador.loadAsync(`${raiz}/${arquivo}`);
        const extras = gltf.scene.userData as Extras;
        const geometrias: BufferGeometry[] = [];
        let escalaDoNo = 1;
        for (let q = 0; q < extras.quadros; q++) {
          // Pela ordem, e não pelo nome: o carregador renomeia para evitar
          // repetição, e a ordem dos nós da cena é a dos quadros.
          const no = gltf.scene.children[q] as Mesh | undefined;
          if (!no?.isMesh) throw new Error(`voxel: ${arquivo} sem o quadro ${q}`);
          escalaDoNo = no.scale.x;
          geometrias.push(no.geometry);
        }
        r.modelos.set(arquivo, {
          geometrias,
          escalaDoNo,
          extras,
          materiais: new Map(),
          lotes: new Map(),
        });
      }),
    );
    return r;
  }

  comecar(camera: CameraDoMundo, largura: number, altura: number, dpr: number): void {
    this.vista = camera;
    this.largura = largura;
    this.altura = altura;
    this.dpr = dpr;
    const l = Math.floor(largura * dpr);
    const a = Math.floor(altura * dpr);
    if (this.tela.width !== l || this.tela.height !== a) this.gl.setSize(l, a, false);

    // A projeção oblíqua, escrita direto em coordenadas de recorte:
    //   ndcX =  2z/L · (X − cx)
    //   ndcY =  2z/A · (Y − Z + cy)      ← altura sobe, sul desce
    //   ndcZ = −z/2A · (Z − cy)          ← mais ao sul = mais perto
    const z = camera.zoom;
    const sx = (2 * z) / largura;
    const sy = (2 * z) / altura;
    const sz = z / (2 * altura);
    // prettier-ignore
    this.camera.projectionMatrix.set(
      sx, 0,   0,   -sx * camera.x,
      0,  sy, -sy,   sy * camera.y,
      0,  0,  -sz,   sz * camera.y,
      0,  0,   0,    1,
    );
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();

    for (const modelo of this.modelos.values()) {
      for (const lote of modelo.lotes.values()) lote.usados = 0;
    }
  }

  folha(
    anim: Animacao,
    indice: number,
    x: number,
    y: number,
    escala: number,
    espelhar: boolean,
  ): Recorte | null {
    const achado = this.resolver(anim);
    if (!achado) return null;
    const { modelo, paleta } = achado;
    const ex = modelo.extras;
    const q = ((indice % ex.quadros) + ex.quadros) % ex.quadros;
    const zoom = this.vista.zoom;

    // O retângulo que o 2D pintaria, com o mesmo arredondamento de `quadro` —
    // o modelo é encaixado nele, e não só "perto" dele.
    const l = ex.larguraQuadro * escala * zoom;
    const a = ex.lado * escala * zoom;
    const telaX = (x - this.vista.x) * zoom + this.largura / 2;
    const telaY = (y - this.vista.y) * zoom + this.altura / 2;
    const esquerda = Math.round(telaX - l / 2);
    const topo = Math.round(telaY - (ex.pivo[1] / ex.lado) * a);

    // De volta ao mundo: a origem do modelo é (centro do quadro, pés).
    const mundoX = (esquerda + l / 2 - this.largura / 2) / zoom + this.vista.x;
    const mundoY = (topo + (ex.pes / ex.lado) * a - this.altura / 2) / zoom + this.vista.y;

    const lote = this.lote(modelo, q, paleta);
    if (lote.usados >= lote.malha.instanceMatrix.count) return null;
    const s = modelo.escalaDoNo * escala;
    this.m.compose(
      this.p.set(mundoX, 0, mundoY),
      espelhar ? this.costas : this.frente,
      this.e.set(s, s, s),
    );
    lote.malha.setMatrixAt(lote.usados++, this.m);

    // A folga cobre a espessura do modelo, que a câmera oblíqua mostra como
    // alguns pixels a mais em cima e embaixo.
    const folga = Math.ceil(10 * escala * zoom);
    return { x: esquerda, y: topo - folga, l: Math.ceil(l), a: Math.ceil(a) + 2 * folga };
  }

  renderizar(): void {
    for (const modelo of this.modelos.values()) {
      for (const lote of modelo.lotes.values()) {
        lote.malha.count = lote.usados;
        lote.malha.visible = lote.usados > 0;
        if (lote.usados > 0) lote.malha.instanceMatrix.needsUpdate = true;
      }
    }
    // Sem modelo em cena ainda assim limpa: o quadro anterior não pode sobrar.
    this.gl.render(this.cena, this.camera);
  }

  colar(ctx: CanvasRenderingContext2D, r: Recorte): void {
    const d = this.dpr;
    const x0 = Math.max(0, Math.floor(r.x * d));
    const y0 = Math.max(0, Math.floor(r.y * d));
    const x1 = Math.min(this.tela.width, Math.ceil((r.x + r.l) * d));
    const y1 = Math.min(this.tela.height, Math.ceil((r.y + r.a) * d));
    if (x1 <= x0 || y1 <= y0) return;
    ctx.drawImage(this.tela, x0, y0, x1 - x0, y1 - y0, x0 / d, y0 / d, (x1 - x0) / d, (y1 - y0) / d);
  }

  private resolver(anim: Animacao): { modelo: Modelo; paleta: string } | null {
    const pronto = this.porFolha.get(anim);
    if (pronto !== undefined) return pronto;
    const caminho = caminhoDe(anim);
    const entrada = caminho ? this.indice.folhas[caminho] : undefined;
    const modelo = entrada ? this.modelos.get(entrada.glb) : undefined;
    const achado =
      entrada && modelo && modelo.extras.paletas[entrada.paleta]
        ? { modelo, paleta: entrada.paleta }
        : null;
    this.porFolha.set(anim, achado);
    return achado;
  }

  private lote(modelo: Modelo, quadro: number, paleta: string): Lote {
    const chave = `${quadro}:${paleta}`;
    let lote = modelo.lotes.get(chave);
    if (lote) return lote;
    let material = modelo.materiais.get(paleta);
    if (!material) {
      material = new ShaderMaterial({
        vertexShader: VERTICE,
        fragmentShader: FRAGMENTO,
        uniforms: { paleta: { value: texturaDaPaleta(modelo.extras.paletas[paleta]!) } },
      });
      modelo.materiais.set(paleta, material);
    }
    // Sessenta e quatro cobre o 32 × 32 inteiro no mesmo quadro da mesma folha.
    const malha = new InstancedMesh(modelo.geometrias[quadro]!, material, 64);
    malha.frustumCulled = false;
    malha.count = 0;
    this.cena.add(malha);
    lote = { malha, usados: 0 };
    modelo.lotes.set(chave, lote);
    return lote;
  }
}
