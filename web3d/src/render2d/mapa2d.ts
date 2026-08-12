import type { Campaign } from '../campaign/campaign';
import type { Settlement } from '../world/settlement';
import { corDoBioma, enquadrar } from '../ui/mapScreen';

/**
 * O mapa do reino, desenhado num canvas.
 *
 * ## Por que não reaproveitar a tela de mapa que já existe
 *
 * A do cliente 3D é SVG amarrado ao HTML do `index.html`: cada cidade é um
 * `<g>`, cada estrada é um `<path>`, e o pano de fundo é um canvas por baixo.
 * Ela funciona bem lá e não se desprende de lá — os seletores, as classes e o
 * foco de teclado são todos daquele documento.
 *
 * O que **se** reaproveita é o que decide alguma coisa: `corDoBioma` e
 * `enquadrar` continuam sendo os mesmos, então os dois mapas concordam sobre
 * onde as cidades estão e de que cor é cada pedaço do mundo. Duas cores
 * diferentes para o mesmo pântano seria o tipo de divergência que ninguém
 * reporta e todo mundo estranha.
 *
 * ## Por que o fundo é gerado uma vez
 *
 * Amostrar o bioma custa uma consulta de ruído por pixel. Com 220×220 amostras
 * são quase cinquenta mil chamadas — barato uma vez, caro sessenta vezes por
 * segundo. O mundo não muda, então o fundo vira uma imagem e o quadro seguinte
 * só redesenha cidades, estradas e o alfinete de quem viaja.
 */

/** Quantas amostras de bioma o fundo usa por lado. */
const AMOSTRAS = 220;

export interface Mapa2D {
  /** Redesenha por cima do fundo já pronto. */
  desenhar(
    ctx: CanvasRenderingContext2D,
    largura: number,
    altura: number,
    selecionada?: string | null,
  ): void;
  /** Qual cidade está sob o toque, em pixels de tela. `null` fora de todas. */
  cidadeEm(px: number, py: number, largura: number, altura: number): Settlement | null;
}

export function criarMapa2D(campaign: Campaign): Mapa2D {
  const layout = campaign.world.layout;
  const quadro = enquadrar(layout.settlements.map((s) => s.center));

  // --- fundo, uma vez só ---------------------------------------------------
  const fundo = document.createElement('canvas');
  fundo.width = AMOSTRAS;
  fundo.height = AMOSTRAS;
  const fctx = fundo.getContext('2d')!;
  const passo = quadro.lado / AMOSTRAS;
  for (let j = 0; j < AMOSTRAS; j++) {
    for (let i = 0; i < AMOSTRAS; i++) {
      const x = Math.round(quadro.minX + i * passo);
      const y = Math.round(quadro.minY + j * passo);
      fctx.fillStyle = corDoBioma(campaign.world.generator.biomeAt(x, y));
      fctx.fillRect(i, j, 1, 1);
    }
  }

  const paraTela = (
    tile: { x: number; y: number },
    largura: number,
    altura: number,
  ): { x: number; y: number } => {
    const lado = Math.min(largura, altura);
    const folgaX = (largura - lado) / 2;
    const folgaY = (altura - lado) / 2;
    return {
      x: folgaX + ((tile.x - quadro.minX) / quadro.lado) * lado,
      y: folgaY + ((tile.y - quadro.minY) / quadro.lado) * lado,
    };
  };

  function desenhar(
    ctx: CanvasRenderingContext2D,
    largura: number,
    altura: number,
    selecionada?: string | null,
  ): void {
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#1c799e';
    ctx.fillRect(0, 0, largura, altura);

    const lado = Math.min(largura, altura);
    ctx.drawImage(fundo, (largura - lado) / 2, (altura - lado) / 2, lado, lado);

    // --- estradas ---------------------------------------------------------
    //
    // Traço claro por baixo e escuro por cima: uma linha só, de qualquer cor,
    // some sobre metade dos biomas. Duas resolvem sem precisar escolher uma
    // cor que funcione em pântano e em deserto ao mesmo tempo.
    for (const estrada of layout.roads) {
      const a = layout.byId(estrada.fromId);
      const b = layout.byId(estrada.toId);
      if (!a || !b) continue;
      const p = paraTela(a.center, largura, altura);
      const q = paraTela(b.center, largura, altura);
      ctx.strokeStyle = 'rgba(255, 240, 200, 0.5)';
      ctx.lineWidth = Math.max(3, lado * 0.007);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(70, 45, 25, 0.75)';
      ctx.lineWidth = Math.max(1, lado * 0.003);
      ctx.stroke();
    }

    // --- cidades ----------------------------------------------------------
    const atual = campaign.currentSettlementId;
    const destino = campaign.character.travellingTo;
    for (const s of layout.settlements) {
      const p = paraTela(s.center, largura, altura);
      const r = (s.isCapital ? 0.016 : 0.010) * lado;

      ctx.beginPath();
      ctx.arc(p.x, p.y, r + Math.max(2, lado * 0.004), 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(40, 26, 14, 0.85)';
      ctx.fill();

      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle =
        s.id === atual ? '#ffd98a' : s.id === destino ? '#e86a5a' : '#f4e4c1';
      ctx.fill();

      // A escolhida ganha um anel, e não uma cor: cor já está ocupada por
      // "onde estou" e "para onde vou", e um terceiro tom nesse tamanho de
      // ponto seria indistinguível dos outros dois.
      if (s.id === selecionada) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + Math.max(5, lado * 0.011), 0, Math.PI * 2);
        ctx.strokeStyle = '#fff6e0';
        ctx.lineWidth = Math.max(2, lado * 0.004);
        ctx.stroke();
      }

      // Só as capitais têm nome no mapa. Vinte rótulos num mapa de celular
      // viram uma faixa de texto sobre o mundo, e o satélite o jogador
      // descobre tocando — que é o gesto que ele já vai usar para viajar.
      if (!s.isCapital) continue;
      const fonte = Math.max(11, lado * 0.026);
      ctx.font = `bold ${Math.round(fonte)}px ui-monospace, Menlo, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.lineWidth = Math.max(2, fonte * 0.35);
      ctx.strokeStyle = 'rgba(30, 18, 8, 0.9)';
      ctx.fillStyle = '#fff6e0';
      const ty = p.y - r - fonte * 0.4;
      ctx.strokeText(s.name, p.x, ty);
      ctx.fillText(s.name, p.x, ty);
    }
  }

  function cidadeEm(
    px: number,
    py: number,
    largura: number,
    altura: number,
  ): Settlement | null {
    // O alvo do toque é maior que o desenho: um ponto de sete pixels é
    // impossível de acertar com o dedo, e errar o toque num mapa custa uma
    // viagem para o lugar errado.
    const lado = Math.min(largura, altura);
    const alcance = Math.max(22, lado * 0.035);
    let melhor: Settlement | null = null;
    let menor = alcance;
    for (const s of layout.settlements) {
      const p = paraTela(s.center, largura, altura);
      const d = Math.hypot(p.x - px, p.y - py);
      if (d < menor) {
        menor = d;
        melhor = s;
      }
    }
    return melhor;
  }

  return { desenhar, cidadeEm };
}
