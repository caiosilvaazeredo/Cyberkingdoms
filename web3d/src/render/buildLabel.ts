import * as THREE from 'three';

import { formatDays } from '../campaign/dayClock';

/**
 * A placa de obra que flutua sobre uma construção em andamento.
 *
 * ## Por que sobre a peça, e não no painel
 *
 * O prazo é uma propriedade *daquela* obra. Num painel ele vira uma lista que
 * o jogador precisa casar com o mapa — "3 dias" de qual galpão? Sobre a peça, a
 * pergunta não chega a se formar.
 *
 * ## Por que `Sprite` e não texto em DOM
 *
 * DOM sobre canvas exigiria projetar a posição do mundo para pixel a cada
 * quadro, para cada obra, e ainda assim ficaria fora de ordem com a
 * profundidade — uma placa de uma obra atrás apareceria por cima do galpão da
 * frente. `Sprite` fica dentro da cena, respeita o z-buffer e sempre encara a
 * câmera, inclusive na visão de cima.
 *
 * ## Por que o texto é cache
 *
 * Só existem poucos textos possíveis ("1 dia", "2 dias", …). Desenhar um canvas
 * por obra por quadro seria pintar a mesma coisa dezenas de vezes por segundo;
 * uma textura por texto é o suficiente para o jogo inteiro.
 */

const LARGURA = 256;
const ALTURA = 96;

const cache = new Map<string, THREE.CanvasTexture>();

/** A ampulheta da Kenney, carregada uma vez e redesenhada quando chega. */
let icone: HTMLImageElement | null = null;
let iconePronto = false;
const esperando: THREE.CanvasTexture[] = [];

function carregarIcone(): void {
  if (icone || typeof Image === 'undefined') return;
  icone = new Image();
  icone.onload = () => {
    iconePronto = true;
    // As texturas já criadas foram desenhadas sem o ícone. Em vez de recriá-las
    // — o que soltaria as que estão em uso —, cada uma se redesenha e avisa a
    // GPU. É o mesmo caminho da caixa provisória das construções: mostrar o que
    // dá agora, completar quando chegar.
    for (const t of esperando) {
      pintar(t.image as HTMLCanvasElement, t.userData.texto as string);
      t.needsUpdate = true;
    }
    esperando.length = 0;
  };
  icone.src = 'ui/info/hourglass.png';
}

function pintar(canvas: HTMLCanvasElement, texto: string): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.clearRect(0, 0, LARGURA, ALTURA);

  // Cápsula escura: a placa tem de ler tanto sobre grama clara quanto sobre o
  // telhado de um galpão.
  const r = 26;
  ctx.beginPath();
  ctx.moveTo(r, 6);
  ctx.arcTo(LARGURA - 6, 6, LARGURA - 6, ALTURA - 6, r);
  ctx.arcTo(LARGURA - 6, ALTURA - 6, 6, ALTURA - 6, r);
  ctx.arcTo(6, ALTURA - 6, 6, 6, r);
  ctx.arcTo(6, 6, LARGURA - 6, 6, r);
  ctx.closePath();
  ctx.fillStyle = 'rgba(10, 16, 26, 0.88)';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(140, 240, 200, 0.55)';
  ctx.stroke();

  let textoX = LARGURA / 2;
  if (iconePronto && icone) {
    // O ícone da Kenney é chapa clara com desenho escuro. Invertido, vira
    // desenho claro — que é o que a cápsula pede.
    ctx.save();
    ctx.filter = 'invert(1)';
    ctx.drawImage(icone, 22, 20, 56, 56);
    ctx.restore();
    textoX = 96 + (LARGURA - 96 - 22) / 2;
  }

  ctx.fillStyle = '#d6e4dd';
  ctx.font = 'bold 40px ui-monospace, Menlo, Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(texto, textoX, ALTURA / 2 + 2);
}

function texturaPara(texto: string): THREE.CanvasTexture {
  const pronta = cache.get(texto);
  if (pronta) return pronta;

  carregarIcone();
  const canvas = document.createElement('canvas');
  canvas.width = LARGURA;
  canvas.height = ALTURA;
  pintar(canvas, texto);

  const textura = new THREE.CanvasTexture(canvas);
  textura.userData.texto = texto;
  // O texto é lido de longe e de perto; sem estas duas, ele serrilha ao
  // afastar e borra ao aproximar.
  textura.minFilter = THREE.LinearMipmapLinearFilter;
  textura.generateMipmaps = true;
  textura.anisotropy = 4;

  cache.set(texto, textura);
  if (!iconePronto) esperando.push(textura);
  return textura;
}

export interface BuildLabel {
  readonly sprite: THREE.Sprite;
  /** Troca o texto. Não faz nada se já for o mesmo. */
  setDays(days: number): void;
  dispose(): void;
}

export function createBuildLabel(days: number, width = 3.6): BuildLabel {
  const material = new THREE.SpriteMaterial({
    map: texturaPara(formatDays(days)),
    transparent: true,
    // A placa é informação, não cenário: ela precisa aparecer mesmo com a peça
    // grande na frente, senão a obra do fundo some justamente quando o jogador
    // vai conferir o prazo.
    depthTest: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(width, (width * ALTURA) / LARGURA, 1);
  sprite.renderOrder = 3;

  let atual = days;

  return {
    sprite,
    setDays(novo) {
      if (novo === atual) return;
      atual = novo;
      material.map = texturaPara(formatDays(novo));
      material.needsUpdate = true;
    },
    dispose() {
      // A textura **não** é descartada: ela vive no cache e é compartilhada
      // por toda obra com o mesmo prazo. Descartar aqui apagaria a placa das
      // outras.
      material.dispose();
    },
  };
}
