/**
 * Gestos de toque para a câmera orbital.
 *
 * O mouse tem três botões e uma roda; o dedo não tem nenhum dos quatro. O
 * primeiro controle que escrevi usava botão direito para pintar e roda para
 * aproximar — no celular, as duas ações simplesmente não existiam. Este módulo
 * é a tradução:
 *
 * | Gesto | Ação |
 * |---|---|
 * | um dedo arrastando | orbitar, ou pintar se o modo pincel estiver ligado |
 * | dois dedos pinçando | aproximar e afastar |
 * | dois dedos arrastando | deslocar o centro |
 *
 * O modo pincel é um **botão na tela**, não um modificador: não há `shift` num
 * celular, e um toque longo para alternar competiria com o menu de contexto do
 * navegador.
 */

export type GestureKind = 'orbit' | 'paint' | 'pinch' | 'pan';

export interface GestureState {
  readonly kind: GestureKind;
  /** Deslocamento desde o quadro anterior, em pixels de tela. */
  readonly dx: number;
  readonly dy: number;
  /** Razão da distância entre os dedos desde o quadro anterior. 1 = parado. */
  readonly scale: number;
  /** Ponto médio dos dedos, em pixels de tela. */
  readonly x: number;
  readonly y: number;
}

interface Point {
  id: number;
  x: number;
  y: number;
}

export interface GestureHandlers {
  onStart?(state: GestureState): void;
  onMove?(state: GestureState): void;
  onEnd?(): void;
}

/**
 * Interpreta ponteiros como gestos.
 *
 * Funciona igual para dedo, caneta e mouse: `PointerEvent` unifica os três, e
 * tratar mouse por um caminho separado seria manter duas implementações do
 * mesmo controle.
 */
export class GestureRecognizer {
  private readonly points = new Map<number, Point>();
  private lastDistance = 0;
  private lastCenter = { x: 0, y: 0 };
  private active: GestureKind | null = null;

  /** Quando ligado, um dedo pinta em vez de orbitar. */
  paintMode = false;

  constructor(
    private readonly element: HTMLElement,
    private readonly handlers: GestureHandlers,
  ) {
    element.addEventListener('pointerdown', this.down);
    element.addEventListener('pointermove', this.move);
    element.addEventListener('pointerup', this.up);
    element.addEventListener('pointercancel', this.up);
    element.addEventListener('pointerleave', this.up);
    element.addEventListener('contextmenu', this.blockMenu);
    element.addEventListener('wheel', this.wheel, { passive: false });
  }

  dispose(): void {
    this.element.removeEventListener('pointerdown', this.down);
    this.element.removeEventListener('pointermove', this.move);
    this.element.removeEventListener('pointerup', this.up);
    this.element.removeEventListener('pointercancel', this.up);
    this.element.removeEventListener('pointerleave', this.up);
    this.element.removeEventListener('contextmenu', this.blockMenu);
    this.element.removeEventListener('wheel', this.wheel);
  }

  private blockMenu = (event: Event): void => event.preventDefault();

  private down = (event: PointerEvent): void => {
    this.element.setPointerCapture(event.pointerId);
    this.points.set(event.pointerId, {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    });
    this.refreshBaseline();

    // O botão direito do mouse continua pintando: quem está no desktop não
    // deveria ter de procurar o botão de modo.
    const paintingWithMouse = event.button === 2 || event.shiftKey;
    this.active =
      this.points.size >= 2
        ? 'pinch'
        : this.paintMode || paintingWithMouse
          ? 'paint'
          : 'orbit';

    this.handlers.onStart?.({
      kind: this.active,
      dx: 0,
      dy: 0,
      scale: 1,
      x: event.clientX,
      y: event.clientY,
    });
  };

  private move = (event: PointerEvent): void => {
    const point = this.points.get(event.pointerId);
    if (!point || !this.active) return;

    point.x = event.clientX;
    point.y = event.clientY;

    const center = this.center();
    const dx = center.x - this.lastCenter.x;
    const dy = center.y - this.lastCenter.y;

    let scale = 1;
    if (this.points.size >= 2) {
      const distance = this.distance();
      // Guarda contra divisão por zero quando os dois dedos se encostam.
      if (this.lastDistance > 1 && distance > 1) {
        scale = distance / this.lastDistance;
      }
      this.lastDistance = distance;

      // Dois dedos: pinça quando a distância muda, arrasto quando não muda.
      // O limiar evita que o tremor natural da mão vire zoom.
      this.active = Math.abs(scale - 1) > 0.008 ? 'pinch' : 'pan';
    }

    this.lastCenter = center;
    this.handlers.onMove?.({
      kind: this.active,
      dx,
      dy,
      scale,
      x: center.x,
      y: center.y,
    });
  };

  private up = (event: PointerEvent): void => {
    if (!this.points.delete(event.pointerId)) return;
    if (this.element.hasPointerCapture(event.pointerId)) {
      this.element.releasePointerCapture(event.pointerId);
    }

    if (this.points.size === 0) {
      this.active = null;
      this.handlers.onEnd?.();
      return;
    }
    // Levantar um dedo de dois: recomeça a linha de base para o dedo que ficou,
    // senão a câmera dá um salto do tamanho da distância entre eles.
    this.refreshBaseline();
    this.active = this.paintMode ? 'paint' : 'orbit';
  };

  private wheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.handlers.onMove?.({
      kind: 'pinch',
      dx: 0,
      dy: 0,
      // Roda para cima aproxima. O fator mantém o passo suave em trackpads,
      // que mandam dezenas de eventos pequenos.
      scale: Math.exp(-event.deltaY * 0.0016),
      x: event.clientX,
      y: event.clientY,
    });
  };

  private refreshBaseline(): void {
    this.lastCenter = this.center();
    this.lastDistance = this.distance();
  }

  private center(): { x: number; y: number } {
    let x = 0;
    let y = 0;
    for (const p of this.points.values()) {
      x += p.x;
      y += p.y;
    }
    const n = Math.max(1, this.points.size);
    return { x: x / n, y: y / n };
  }

  private distance(): number {
    const list = [...this.points.values()];
    if (list.length < 2) return 0;
    return Math.hypot(list[0]!.x - list[1]!.x, list[0]!.y - list[1]!.y);
  }
}
