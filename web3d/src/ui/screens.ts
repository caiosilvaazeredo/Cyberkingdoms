/**
 * Navegação entre telas.
 *
 * ## Por que um roteador, e não `display: none` espalhado
 *
 * O jogo abria direto no mapa. Isso não é só falta de menu — é a arquitetura
 * dizendo que o mapa *é* o jogo, quando ele é uma tela entre várias. Com uma
 * pilha explícita, "voltar" existe de graça, o botão físico do Android faz o
 * que deve, e nenhuma tela precisa saber quem a chamou.
 *
 * As telas são DOM sobre o canvas, não objetos 3D. Menu em três dimensões
 * custa caro, atrasa a abertura e não lê melhor num celular — e o canvas
 * continua ali para servir de plano de fundo vivo quando fizer sentido.
 */

export interface Screen {
  readonly id: string;
  /** Elemento raiz. O roteador cuida de mostrar e esconder. */
  readonly root: HTMLElement;
  /** Chamado toda vez que a tela passa a ser a do topo. */
  onEnter?(): void | Promise<void>;
  /** Chamado ao sair, inclusive quando outra tela é empilhada por cima. */
  onLeave?(): void;
}

export class ScreenRouter {
  private readonly stack: Screen[] = [];
  private readonly registry = new Map<string, Screen>();

  constructor(private readonly host: HTMLElement) {
    // O botão "voltar" do Android chega como `popstate`. Sem tratar, ele fecha
    // o jogo no meio de um submenu — o jeito mais rápido de perder um jogador.
    window.addEventListener('popstate', () => {
      if (this.stack.length > 1) void this.pop();
      else history.pushState(null, '');
    });
    history.pushState(null, '');
  }

  register(screen: Screen): void {
    this.registry.set(screen.id, screen);
    screen.root.hidden = true;
    this.host.appendChild(screen.root);
  }

  get current(): Screen | null {
    return this.stack[this.stack.length - 1] ?? null;
  }

  /** Troca a tela do topo, sem crescer a pilha. */
  async replace(id: string): Promise<void> {
    const top = this.stack.pop();
    if (top) {
      top.onLeave?.();
      top.root.hidden = true;
    }
    await this.push(id);
  }

  /** Empilha uma tela por cima da atual. */
  async push(id: string): Promise<void> {
    const screen = this.registry.get(id);
    if (!screen) throw new Error(`tela desconhecida: "${id}"`);

    const top = this.current;
    if (top) {
      top.onLeave?.();
      top.root.hidden = true;
    }

    this.stack.push(screen);
    screen.root.hidden = false;
    history.pushState(null, '');
    await screen.onEnter?.();
  }

  /** Volta uma tela. Não faz nada se já for a última — o jogo não fecha. */
  async pop(): Promise<void> {
    if (this.stack.length <= 1) return;
    const top = this.stack.pop()!;
    top.onLeave?.();
    top.root.hidden = true;

    const back = this.current;
    if (back) {
      back.root.hidden = false;
      await back.onEnter?.();
    }
  }

  /** Esvazia a pilha e abre `id` como raiz. */
  async reset(id: string): Promise<void> {
    while (this.stack.length > 0) {
      const top = this.stack.pop()!;
      top.onLeave?.();
      top.root.hidden = true;
    }
    await this.push(id);
  }

  get depth(): number {
    return this.stack.length;
  }
}

/** Monta um elemento com classes e conteúdo, para encurtar as telas. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: {
    className?: string;
    text?: string;
    html?: string;
    attrs?: Record<string, string>;
    children?: (HTMLElement | null)[];
  } = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;
  if (options.html !== undefined) node.innerHTML = options.html;
  for (const [k, v] of Object.entries(options.attrs ?? {})) {
    node.setAttribute(k, v);
  }
  for (const child of options.children ?? []) {
    if (child) node.appendChild(child);
  }
  return node;
}
