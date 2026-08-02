/**
 * O limite da vila do jogador.
 *
 * ## Por que existe um limite, num mundo infinito
 *
 * O mundo é gerado por função pura e não acaba nunca — mas o *jogo* acaba na
 * borda da vila. Fora dela o jogador não constrói, não trabalha e não guarda
 * nada; a viagem entre cidades é uma decisão da tela de cidade, com custo de
 * Fome e Sede e risco de emboscada, e não uma caminhada.
 *
 * Deixar a câmera sair livremente ensinava a coisa errada: o jogador atravessa
 * dez minutos de mato achando que vai chegar a algum lugar. O limite é honesto
 * — mostra que existe algo do outro lado, diz o nome, e explica como se vai.
 *
 * ## Como o limite se apresenta
 *
 * Três camadas, da mais sutil à mais explícita:
 *
 * 1. **Cinza.** Fora do limite o terreno perde cor. Continua desenhado — sumir
 *    criaria a borda no vazio que a visão de cima existe para esconder —, mas
 *    lê como "não é seu".
 * 2. **Parede macia.** A câmera desacelera perto da borda e para nela, em vez
 *    de bater. Trava seca parece defeito; freio parece regra.
 * 3. **Aviso.** Ao encostar, aparece o nome do destino e como chegar lá.
 */

export interface VillageBounds {
  /** Centro da vila em coordenadas de mundo. */
  readonly centerX: number;
  readonly centerZ: number;
  /** Raio livre, em metros. Dentro dele nada muda. */
  readonly radius: number;
  /** Nome da metrópole a que a vila pertence. */
  readonly settlementName: string;
  /** Para onde se vai ao sair — o vizinho mais próximo. */
  readonly neighbourName: string;
}

/**
 * Largura da faixa de transição, em metros.
 *
 * O cinza entra ao longo dela em vez de num degrau: uma linha dura no chão
 * pareceria falha de render, e a transição gradual lê como distância.
 */
export const FADE_WIDTH = 18;

/**
 * Quanto o ponto está fora, de 0 (dentro) a 1 (no limite ou além).
 *
 * É o mesmo número usado pelo cinza do terreno e pelo freio da câmera, de
 * propósito: se fossem dois cálculos, o aviso apareceria num lugar e a cor
 * mudaria em outro.
 */
export function outsideRatio(
  bounds: VillageBounds,
  x: number,
  z: number,
): number {
  const distance = Math.hypot(x - bounds.centerX, z - bounds.centerZ);
  if (distance <= bounds.radius) return 0;
  return Math.min(1, (distance - bounds.radius) / FADE_WIDTH);
}

/** `true` quando o ponto passou do limite útil. */
export function isBlocked(bounds: VillageBounds, x: number, z: number): boolean {
  return outsideRatio(bounds, x, z) >= 1;
}

/**
 * Puxa um ponto para dentro do limite.
 *
 * Devolve o ponto sobre a borda, na mesma direção do centro — a câmera desliza
 * ao longo do limite em vez de travar de vez. Empurrar de volta para o centro
 * daria um solavanco a cada quadro contra a parede.
 */
export function clampToBounds(
  bounds: VillageBounds,
  x: number,
  z: number,
): { x: number; z: number } {
  const dx = x - bounds.centerX;
  const dz = z - bounds.centerZ;
  const distance = Math.hypot(dx, dz);
  const limit = bounds.radius + FADE_WIDTH;
  if (distance <= limit || distance === 0) return { x, z };

  const k = limit / distance;
  return { x: bounds.centerX + dx * k, z: bounds.centerZ + dz * k };
}

/** Texto do aviso mostrado ao encostar no limite. */
export function blockedMessage(bounds: VillageBounds): string {
  return `Acesso a ${bounds.neighbourName}`;
}

export function blockedHint(bounds: VillageBounds): string {
  return (
    `Você está no limite de ${bounds.settlementName}. ` +
    'Viajar custa Fome e Sede, e a estrada tem risco — a viagem se organiza ' +
    'na tela da cidade, não a pé.'
  );
}
