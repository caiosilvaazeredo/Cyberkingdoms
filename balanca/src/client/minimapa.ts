import { AGUA, PONTE, type Arena } from '../shared/arena';
import type { Estado } from '../shared/estado';
import { TILE, outroTime, type Time } from '../shared/regras';
import { avistados, pontoAvistado } from '../shared/vista';
import { DURACAO_DA_MARCA } from './rede';

/**
 * O minimapa: onde o seu time está, e onde o inimigo foi visto.
 *
 * ## O terreno é desenhado uma vez
 *
 * Pintar dois mil tiles por quadro num retângulo de duzentos pixels é trabalho
 * jogado fora: o relevo não muda durante a partida. Ele é desenhado uma vez num
 * `canvas` de memória e daí em diante copiado inteiro, que é uma operação só.
 * A troca de mapa entre partidas invalida o desenho pela chave — seed e nome do
 * mapa —, então uma sala que sorteia campos não fica mostrando o anterior.
 *
 * ## Relevo, e não o tileset
 *
 * Em duzentos pixels de largura, um tile tem três. A arte do jogo vira ruído
 * nesse tamanho, e por isso o minimapa é desenhado como **mapa**, com as
 * convenções da cartografia, e não como foto do jogo:
 *
 * - **Luz do noroeste**, a convenção do sombreamento de relevo: a borda de
 *   cima e a da esquerda de cada margem clareiam, a de baixo escurece.
 * - **O chão é um platô**: a terra fica alguns pixels acima da água, com uma
 *   falésia escura onde ela cai para o sul. É o que faz o mapa ler em 3D
 *   sem precisar de câmera, e o que separa terra de água de relance.
 * - **Profundidade da água**: mais clara rente à costa, mais escura longe, e
 *   uma linha de espuma onde as duas se encontram.
 * - **Prédios em bloco**: um tampo na cor do time, a face da frente mais
 *   escura e uma sombra no chão — o mesmo volume do mundo 3D, em miniatura.
 * - **Mato** em pontinhos escuros com sombra, que dão textura sem roubar cor.
 *
 * O mapa é levemente inclinado (achatado na vertical), para o platô e os
 * blocos aparecerem — mas pouco, para a forma do campo continuar a mesma.
 *
 * ## O que aparece
 *
 * O seu time inteiro, sempre. O inimigo, só o que alguém do seu time está vendo
 * — a regra é de `shared/vista.ts` e tem os testes dela lá. Os dois baús
 * seguem a mesma lógica, com uma exceção deliberada: **o seu aparece sempre**,
 * porque a bússola do jogo já aponta para ele e escondê-lo aqui seria o mapa
 * contradizer a seta na tela.
 *
 * O retângulo da câmera fecha o desenho: sem ele, a pessoa vê os pontos e não
 * sabe qual deles é o pedaço de mundo que está na frente dela.
 */

const COR_DO_TIME: Readonly<Record<Time, string>> = {
  azul: '#5b9bf0',
  vermelho: '#e2564b',
};

/** Cores do relevo, no tamanho em que ele é só forma — mais vivas que o
 * tileset de verdade, porque em duzentos pixels é a cor que carrega a forma. */
const COR_AGUA_RASA = [92, 178, 196] as const;
const COR_AGUA_FUNDA = [34, 92, 128] as const;
const COR_ESPUMA = 'rgba(225, 248, 255, 0.85)';
const COR_CHAO = '#74b44c';
const COR_CHAO_LUZ = 'rgba(255, 255, 210, 0.38)';
const COR_CHAO_SOMBRA = 'rgba(20, 40, 10, 0.35)';
const COR_FALESIA = '#6b5432';
const COR_FALESIA_PE = '#3a2c18';
const COR_PONTE = '#c9903f';
const COR_PONTE_TABUA = '#8a5a2b';
const COR_ARVORE = '#2f5a24';
const COR_PEDRA = '#8a96a0';

/** Pixels por tile no relevo guardado: quatro dá margem, falésia e espuma. */
const PIXELS_POR_TILE = 6;
/** Quanto o chão sobe acima da água, nesses pixels. */
const ALTURA_DO_CHAO = 4;
/** O achatamento vertical da inclinação. */
export const INCLINACAO_DO_MINIMAPA = 0.78;

/** O tampo dos prédios, por time, e a face da frente. */
const COR_DO_BLOCO: Readonly<Record<Time, { tampo: string; frente: string }>> = {
  azul: { tampo: '#6f9be0', frente: '#36598f' },
  vermelho: { tampo: '#e07a6a', frente: '#8f3a30' },
};

/** A moldura: bronze por fora, ouro fino por dentro — o mesmo par de cores
 * do resto do chrome do jogo, só que fino o bastante para caber num canto. */
const COR_MOLDURA_EXTERNA = '#2a1d10';
const COR_MOLDURA_INTERNA = 'rgba(217, 164, 65, 0.85)';

export interface Enquadramento {
  /** Centro da câmera, em unidades de mundo. */
  x: number;
  y: number;
  /** Quanto do mundo cabe na tela, em unidades de mundo. */
  largura: number;
  altura: number;
  /**
   * Com a câmera 3D atrás do personagem, o que se vê não é um retângulo, é um
   * leque à frente dele: de onde ele olha, para onde (radianos a partir do
   * norte, como `rumo` do renderer) e até onde.
   */
  cone?: { x: number; y: number; rumo: number; alcance: number };
}

/**
 * Onde a caixa do minimapa fica, e quanto ela ocupa.
 *
 * Está fora da classe porque **o HUD precisa da mesma conta**: o mural de
 * abates é do mesmo canto de cima à direita, e na primeira captura ele saiu
 * por baixo do minimapa — duas coisas desenhadas por arquivos diferentes no
 * mesmo pedaço de tela. Com a caixa vindo daqui, mudar o tamanho do minimapa
 * empurra o mural junto, em vez de reabrir o mesmo defeito.
 */
export function caixaDoMinimapa(
  largura: number,
  arena: Pick<Arena, 'largura' | 'altura'>,
): { x: number; y: number; l: number; a: number } {
  const l = Math.min(208, Math.max(120, largura * 0.16));
  return {
    x: largura - l - 12,
    y: 12,
    l,
    a: ((l * arena.altura) / arena.largura) * INCLINACAO_DO_MINIMAPA,
  };
}

export class Minimapa {
  private terreno: HTMLCanvasElement | null = null;
  /** Que arena o terreno guardado desenha. Ver o topo do arquivo. */
  private chave = '';

  /**
   * @param meuTime de quem é o ponto de vista. Sem time — plateia — o minimapa
   * não é desenhado: não há "seu time" para mostrar, e mostrar os dois seria
   * dar ao espectador o que nenhum jogador tem.
   */
  desenhar(
    ctx: CanvasRenderingContext2D,
    arena: Arena,
    estado: Estado,
    meuTime: Time,
    enquadramento: Enquadramento,
    largura: number,
    marcas: readonly { x: number; y: number; quando: number }[] = [],
    euId: number | null = null,
  ): void {
    const { x, y, l, a } = caixaDoMinimapa(largura, arena);
    const b = 5; // a borda da moldura, por fora do relevo

    const mundoL = arena.largura * TILE;
    const mundoA = arena.altura * TILE;
    const paraX = (mx: number): number => x + (mx / mundoL) * l;
    // Quem está em terra fica em cima do platô: sobe a altura do chão.
    const subida = (ALTURA_DO_CHAO / (arena.altura * PIXELS_POR_TILE)) * a;
    const paraY = (my: number): number => y + (my / mundoA) * a - subida;

    ctx.save();

    // A moldura: painel escuro arredondado, bronze por fora e um fio de ouro
    // por dentro — o mesmo par de cores do resto do chrome do jogo, só que
    // fino o bastante para caber num canto. Sem ela o minimapa era só um
    // retângulo de cor solta no canto da tela, sem pertencer ao resto da HUD.
    arredondado(ctx, x - b, y - b, l + b * 2, a + b * 2, 9);
    ctx.fillStyle = 'rgba(10, 12, 17, 0.82)';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = COR_MOLDURA_EXTERNA;
    ctx.stroke();
    arredondado(ctx, x - b + 2, y - b + 2, l + b * 2 - 4, a + b * 2 - 4, 7);
    ctx.lineWidth = 1;
    ctx.strokeStyle = COR_MOLDURA_INTERNA;
    ctx.stroke();

    ctx.save();
    arredondado(ctx, x, y, l, a, 3);
    ctx.clip();
    // Suavizado: o relevo guardado é maior que a caixa, e reduzir sem filtro
    // faria a falésia e a espuma piscarem conforme a largura da tela.
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.terrenoDe(arena), x, y, l, a);

    // As construções antes de todo mundo: elas são o mapa, e os pontos passam
    // por cima delas. Cada uma é um bloco — sombra no chão, face da frente
    // escura, tampo na cor do time —, na planta que a simulação usa para a
    // colisão: o que se vê no minimapa é a parede em que se esbarra.
    const alturaDoBloco = Math.max(2.5, l / 70);
    for (let i = 0; i < arena.estruturas.length; i++) {
      const e = arena.estruturas[i]!;
      const p = arena.paredes[i];
      if (!p) continue;
      const bx = paraX(p.x0);
      const bl = Math.max(3, paraX(p.x1) - bx);
      const by = paraY(p.y0);
      const ba = Math.max(2, paraY(p.y1) - by);
      const cor = COR_DO_BLOCO[e.time];
      ctx.fillStyle = 'rgba(0, 0, 0, 0.32)';
      ctx.fillRect(bx + 1.5, by + 1.5, bl, ba);
      ctx.fillStyle = cor.frente;
      ctx.fillRect(bx, by + ba - alturaDoBloco, bl, alturaDoBloco);
      ctx.fillStyle = cor.tampo;
      ctx.fillRect(bx, by - alturaDoBloco, bl, ba);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.fillRect(bx, by - alturaDoBloco, bl, 1);
      // A tesouraria e o cofre ganham a marca do que guardam: é para lá que
      // se corre com o baú, e é ali que o do inimigo é entulhado.
      if (e.tipo === 'tesouraria' || e.tipo === 'cofre') {
        const mx = bx + bl / 2;
        const my = by - alturaDoBloco + ba / 2;
        ctx.fillStyle = e.tipo === 'tesouraria' ? '#f2c869' : '#2a2f3d';
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(mx, my - 2.5);
        ctx.lineTo(mx + 2.5, my);
        ctx.lineTo(mx, my + 2.5);
        ctx.lineTo(mx - 2.5, my);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }

    const inimigo = outroTime(meuTime);
    const vistos = avistados(arena, estado, meuTime);

    // Os baús primeiro, para um boneco em cima deles não os esconder.
    for (const p of estado.baus) {
      if (p.onde === 'resgatado') continue;
      const minha = p.time === meuTime;
      if (!minha && !pontoAvistado(arena, estado, meuTime, p)) continue;
      sombra(ctx, paraX(p.x), paraY(p.y), 3.5);
      ctx.fillStyle = minha ? '#ffd479' : 'rgba(255, 212, 121, 0.55)';
      ctx.beginPath();
      ctx.arc(paraX(p.x), paraY(p.y) - 1, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.stroke();
    }

    for (const u of estado.unidades) {
      if (!u.vivo) continue;
      const meu = u.time === meuTime;
      if (!meu && !vistos.has(u.id)) continue;
      // Quem carrega o baú é o que decide a partida: um ponto maior é a
      // diferença entre olhar o mapa e entender o mapa.
      const raio = u.carga === 'bau' ? 3.5 : 2.2;
      const ux = paraX(u.x);
      const uy = paraY(u.y) - 1;
      sombra(ctx, ux, uy + 1, raio);
      if (u.id === euId) {
        // Você é uma seta para onde está olhando — a única peça do mapa que
        // diz direção, e é a sua.
        const ang = Math.atan2(u.olharY, u.olharX);
        ctx.save();
        ctx.translate(ux, uy);
        ctx.rotate(ang);
        ctx.beginPath();
        ctx.moveTo(5.5, 0);
        ctx.lineTo(-3.5, -3.8);
        ctx.lineTo(-1.8, 0);
        ctx.lineTo(-3.5, 3.8);
        ctx.closePath();
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = COR_DO_TIME[meuTime];
        ctx.stroke();
        ctx.restore();
        continue;
      }
      ctx.beginPath();
      ctx.arc(ux, uy, raio, 0, Math.PI * 2);
      ctx.fillStyle = meu ? COR_DO_TIME[meuTime] : COR_DO_TIME[inimigo];
      ctx.fill();
      // Um fio escuro em volta: sem ele o azul do próprio time sobre a água
      // do mapa vira quase invisível — a cor que devia saltar aos olhos some
      // no fundo que mais se parece com ela.
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.stroke();
    }

    // O que está na sua tela, agora. Com a câmera 3D atrás do personagem é um
    // leque claro à frente dele; com a de cima, o retângulo de sempre.
    const cone = enquadramento.cone;
    if (cone) {
      const cx = paraX(cone.x);
      const cy = paraY(cone.y);
      const abertura = 0.62;
      const r = (cone.alcance / mundoL) * l;
      const ponta = (ang: number): [number, number] => [
        cx + Math.sin(ang) * r,
        cy - Math.cos(ang) * r * INCLINACAO_DO_MINIMAPA,
      ];
      const [ax, ay] = ponta(cone.rumo - abertura);
      const [bx, by] = ponta(cone.rumo + abertura);
      const degrade = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      degrade.addColorStop(0, 'rgba(255, 255, 255, 0.55)');
      degrade.addColorStop(1, 'rgba(255, 255, 255, 0.05)');
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(ax, ay);
      ctx.quadraticCurveTo(...ponta(cone.rumo), bx, by);
      ctx.closePath();
      ctx.fillStyle = degrade;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(cx, cy);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }

    ctx.restore(); // fecha o recorte do relevo

    if (cone) {
      desenharMarcas(ctx, marcas, paraX, paraY, COR_DO_TIME[meuTime]);
      ctx.restore();
      return;
    }

    // O retângulo da tela — um fio escuro por baixo do claro, para aparecer
    // tanto sobre a água quanto sobre o chão.
    const cl = (enquadramento.largura / mundoL) * l;
    const ca = (enquadramento.altura / mundoA) * a;
    const cx = Math.round(paraX(enquadramento.x) - cl / 2) + 0.5;
    const cy = Math.round(paraY(enquadramento.y) - ca / 2) + 0.5;
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.strokeRect(cx, cy, Math.round(cl), Math.round(ca));
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.strokeRect(cx, cy, Math.round(cl), Math.round(ca));

    desenharMarcas(ctx, marcas, paraX, paraY, COR_DO_TIME[meuTime]);

    ctx.restore();
  }

  /** O relevo, pintado uma vez por arena. Ver o topo do arquivo. */
  private terrenoDe(arena: Arena): HTMLCanvasElement {
    const chave = `${arena.seed}:${arena.mapa}`;
    if (this.terreno && this.chave === chave) return this.terreno;

    const E = PIXELS_POR_TILE;
    const H = ALTURA_DO_CHAO;
    const tela = document.createElement('canvas');
    tela.width = arena.largura * E;
    tela.height = arena.altura * E;
    const c = tela.getContext('2d')!;
    const terra = (tx: number, ty: number): boolean => arena.tile(tx, ty) !== AGUA;

    // A água, pela distância até a terra: rasa na costa, funda no meio.
    const distancia = distanciaDaTerra(arena);
    for (let ty = 0; ty < arena.altura; ty++) {
      for (let tx = 0; tx < arena.largura; tx++) {
        if (terra(tx, ty)) continue;
        const t = Math.min(1, (distancia[ty * arena.largura + tx]! - 1) / 4);
        const cor = COR_AGUA_RASA.map((v, i) => Math.round(v + (COR_AGUA_FUNDA[i]! - v) * t));
        c.fillStyle = `rgb(${cor[0]}, ${cor[1]}, ${cor[2]})`;
        c.fillRect(tx * E, ty * E, E, E);
      }
    }

    // A falésia: onde a terra cai para a água ao sul, a face aparece.
    for (let ty = 0; ty < arena.altura; ty++) {
      for (let tx = 0; tx < arena.largura; tx++) {
        if (!terra(tx, ty) || terra(tx, ty + 1)) continue;
        c.fillStyle = COR_FALESIA;
        c.fillRect(tx * E, (ty + 1) * E - H, E, H);
        c.fillStyle = COR_FALESIA_PE;
        c.fillRect(tx * E, (ty + 1) * E - 1, E, 1);
        // A sombra do platô na água, e a espuma no pé da falésia.
        c.fillStyle = 'rgba(10, 30, 50, 0.35)';
        c.fillRect(tx * E, (ty + 1) * E, E, 2);
        c.fillStyle = COR_ESPUMA;
        c.fillRect(tx * E, (ty + 1) * E, E, 1);
      }
    }

    // O platô, um pouco acima de onde a água está: a falésia aparece embaixo.
    for (let ty = 0; ty < arena.altura; ty++) {
      for (let tx = 0; tx < arena.largura; tx++) {
        if (!terra(tx, ty)) continue;
        const px = tx * E;
        const py = ty * E - H;
        c.fillStyle = arena.tile(tx, ty) === PONTE ? COR_PONTE : COR_CHAO;
        c.fillRect(px, py, E, E);
        if (arena.tile(tx, ty) === PONTE) {
          c.fillStyle = COR_PONTE_TABUA;
          for (let k = 1; k < E; k += 2) c.fillRect(px, py + k, E, 1);
          continue;
        }
        // Luz do noroeste: a beira de cima e a da esquerda clareiam, a da
        // direita escurece. A de baixo já é a falésia.
        if (!terra(tx, ty - 1)) {
          c.fillStyle = COR_CHAO_LUZ;
          c.fillRect(px, py, E, 1);
          c.fillStyle = COR_ESPUMA;
          c.fillRect(px, py - 1, E, 1);
        }
        if (!terra(tx - 1, ty)) {
          c.fillStyle = COR_CHAO_LUZ;
          c.fillRect(px, py, 1, E);
          c.fillStyle = COR_ESPUMA;
          c.fillRect(px - 1, py, 1, E + H);
        }
        if (!terra(tx + 1, ty)) {
          c.fillStyle = COR_CHAO_SOMBRA;
          c.fillRect(px + E - 1, py, 1, E);
          c.fillStyle = COR_FALESIA_PE;
          c.fillRect(px + E, py + 1, 1, E + H - 1);
        }
      }
    }

    // O mato: copa escura com sombra para o sudeste; pedra cinza.
    for (let ty = 0; ty < arena.altura; ty++) {
      for (let tx = 0; tx < arena.largura; tx++) {
        const deco = arena.decoracao(tx, ty);
        if (!deco || (deco.tipo !== 'arvore' && deco.tipo !== 'pedra')) continue;
        const px = tx * E + E / 2;
        const py = ty * E - H + E / 2;
        c.fillStyle = 'rgba(0, 0, 0, 0.28)';
        c.beginPath();
        c.arc(px + 1, py + 1, E * 0.45, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = deco.tipo === 'arvore' ? COR_ARVORE : COR_PEDRA;
        c.beginPath();
        c.arc(px, py, E * 0.42, 0, Math.PI * 2);
        c.fill();
      }
    }
    for (const j of arena.jazidas) {
      const px = (j.x / TILE) * E;
      const py = (j.y / TILE) * E - H;
      c.fillStyle = 'rgba(0, 0, 0, 0.28)';
      c.beginPath();
      c.arc(px + 1, py + 1, E * 0.5, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = j.tipo === 'arvore' ? '#3c6e2c' : '#e8c24a';
      c.beginPath();
      c.arc(px, py, E * 0.48, 0, Math.PI * 2);
      c.fill();
    }

    this.terreno = tela;
    this.chave = chave;
    return tela;
  }
}

/** Para cada tile, a quantos passos (em cruz) está a terra mais perto. */
function distanciaDaTerra(arena: Arena): Uint16Array {
  const n = arena.largura * arena.altura;
  const d = new Uint16Array(n).fill(65535);
  const fila: number[] = [];
  for (let i = 0; i < n; i++) {
    if (arena.tile(i % arena.largura, Math.floor(i / arena.largura)) !== AGUA) {
      d[i] = 0;
      fila.push(i);
    }
  }
  for (let k = 0; k < fila.length; k++) {
    const i = fila[k]!;
    const tx = i % arena.largura;
    const ty = Math.floor(i / arena.largura);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = tx + dx;
      const ny = ty + dy;
      if (nx < 0 || ny < 0 || nx >= arena.largura || ny >= arena.altura) continue;
      const j = ny * arena.largura + nx;
      if (d[j]! <= d[i]! + 1) continue;
      d[j] = d[i]! + 1;
      fila.push(j);
    }
  }
  return d;
}

/** A sombra de um ponto no chão, para ele parecer em pé sobre o mapa. */
function sombra(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.beginPath();
  ctx.ellipse(x + 0.8, y + r * 0.6, r * 1.05, r * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * As marcas do time — "olha aqui" — por cima de tudo, porque são a coisa mais
 * nova na tela e é para isso que existem. Um anel que nasce grande e fecha,
 * junto com um ponto fixo por baixo: o anel puxa o olho no primeiro meio
 * segundo, o ponto continua legível depois que ele sumiu.
 */
function desenharMarcas(
  ctx: CanvasRenderingContext2D,
  marcas: readonly { x: number; y: number; quando: number }[],
  paraX: (x: number) => number,
  paraY: (y: number) => number,
  cor: string,
): void {
  const agora = performance.now();
  for (const m of marcas) {
    const idade = (agora - m.quando) / DURACAO_DA_MARCA;
    if (idade < 0 || idade >= 1) continue;
    const mx = paraX(m.x);
    const my = paraY(m.y);
    ctx.beginPath();
    ctx.fillStyle = cor;
    ctx.arc(mx, my, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.strokeStyle = cor;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 1 - idade;
    ctx.arc(mx, my, 3 + idade * 10, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function arredondado(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  l: number,
  a: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + l, y, x + l, y + a, r);
  ctx.arcTo(x + l, y + a, x, y + a, r);
  ctx.arcTo(x, y + a, x, y, r);
  ctx.arcTo(x, y, x + l, y, r);
  ctx.closePath();
}
