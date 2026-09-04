import { AGUA, PONTE, type Arena } from '../shared/arena';
import type { Estado } from '../shared/estado';
import { TILE, outroTime, type Time } from '../shared/regras';
import { avistados, pontoAvistado } from '../shared/vista';

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
 * ## Cores chapadas, e não o tileset
 *
 * Em duzentos pixels de largura, um tile tem três. A arte do jogo vira ruído
 * nesse tamanho; três cores chapadas — água, chão, ponte — dizem a forma do mapa
 * de relance, que é para isso que se olha um minimapa.
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
const COR_AGUA = '#3f8fae';
const COR_CHAO = '#6bab46';
const COR_PONTE = '#c9903f';

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
  return { x: largura - l - 12, y: 12, l, a: (l * arena.altura) / arena.largura };
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
  ): void {
    const { x, y, l, a } = caixaDoMinimapa(largura, arena);
    const b = 5; // a borda da moldura, por fora do relevo

    const mundoL = arena.largura * TILE;
    const mundoA = arena.altura * TILE;
    const paraX = (mx: number): number => x + (mx / mundoL) * l;
    const paraY = (my: number): number => y + (my / mundoA) * a;

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
    ctx.drawImage(this.terrenoDe(arena), x, y, l, a);

    // As construções antes de todo mundo: elas são o mapa, e os pontos passam
    // por cima delas. Formas diferentes, e não só cor, porque a tesouraria e o
    // cofre também mudam para dourado quando avistados no mundo — a mesma
    // leitura vale aqui.
    for (const e of arena.estruturas) {
      if (e.tipo !== 'tesouraria' && e.tipo !== 'cofre') continue;
      const px = paraX(e.x);
      const py = paraY(e.y);
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(0,0,0,0.65)';
      if (e.tipo === 'tesouraria') {
        // Um losango dourado: é onde o ouro do reino descansa.
        ctx.fillStyle = '#f2c869';
        ctx.beginPath();
        ctx.moveTo(px, py - 3.5);
        ctx.lineTo(px + 3.5, py);
        ctx.lineTo(px, py + 3.5);
        ctx.lineTo(px - 3.5, py);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else {
        // Um cofre escuro com friso: é onde o refém do inimigo é entulhado.
        ctx.fillStyle = '#2a2f3d';
        ctx.fillRect(px - 3, py - 3, 6, 6);
        ctx.strokeRect(px - 3, py - 3, 6, 6);
        ctx.strokeStyle = 'rgba(242, 200, 105, 0.85)';
        ctx.beginPath();
        ctx.moveTo(px - 3, py);
        ctx.lineTo(px + 3, py);
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
      ctx.fillStyle = minha ? '#ffd479' : 'rgba(255, 212, 121, 0.55)';
      ctx.beginPath();
      ctx.arc(paraX(p.x), paraY(p.y), 3.5, 0, Math.PI * 2);
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
      ctx.beginPath();
      ctx.arc(paraX(u.x), paraY(u.y), raio, 0, Math.PI * 2);
      ctx.fillStyle = meu ? COR_DO_TIME[meuTime] : COR_DO_TIME[inimigo];
      ctx.fill();
      // Um fio escuro em volta: sem ele o azul do próprio time sobre a água
      // do mapa vira quase invisível — a cor que devia saltar aos olhos some
      // no fundo que mais se parece com ela.
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.stroke();
    }

    ctx.restore(); // fecha o recorte do relevo

    // O que está na sua tela, agora — um fio escuro por baixo do claro, para
    // aparecer tanto sobre a água quanto sobre o chão.
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

    ctx.restore();
  }

  /** O relevo, pintado uma vez por arena. */
  private terrenoDe(arena: Arena): HTMLCanvasElement {
    const chave = `${arena.seed}:${arena.mapa}`;
    if (this.terreno && this.chave === chave) return this.terreno;

    // Um pixel por tile: o navegador estica na hora de copiar, e esticar um
    // retângulo de sessenta por trinta e quatro é mais barato que desenhar dois
    // mil retângulos.
    const tela = document.createElement('canvas');
    tela.width = arena.largura;
    tela.height = arena.altura;
    const c = tela.getContext('2d')!;
    for (let ty = 0; ty < arena.altura; ty++) {
      for (let tx = 0; tx < arena.largura; tx++) {
        const t = arena.tile(tx, ty);
        c.fillStyle = t === AGUA ? COR_AGUA : t === PONTE ? COR_PONTE : COR_CHAO;
        c.fillRect(tx, ty, 1, 1);
      }
    }
    this.terreno = tela;
    this.chave = chave;
    return tela;
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
