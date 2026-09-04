/**
 * Teclado, mouse e dedo — traduzidos para o mesmo comando.
 *
 * ## Um comando, três jeitos de produzi-lo
 *
 * O servidor só entende `mx, my, ax, ay, atacar, usar`. Quem preenche isso pode
 * ser WASD com o mouse mirando, ou dois toques na tela. Manter a tradução aqui,
 * num lugar só, é o que impede o jogo de crescer duas regras de movimento — uma
 * "para desktop" e outra "para celular" — que depois divergem no dia em que
 * alguém mexer só numa.
 *
 * ## Mira por posição, não por tecla
 *
 * O mouse aponta um lugar do mundo, e o vetor de mira é a direção do
 * personagem até ele. No celular, o polegar direito faz o mesmo com um toque.
 * É o que permite recuar atirando — a coisa que separa um arqueiro de um
 * guerreiro devagar.
 *
 * ## Esta classe é o aparelho, não o jogador
 *
 * Desde que quatro pessoas cabem no mesmo aparelho, quem sabe *ler um jogador*
 * é `controles.ts`, com uma função pura por fonte. O que sobrou aqui é o que
 * pertence à página inteira e não a ninguém em particular: as teclas que estão
 * apertadas neste instante, onde está o cursor, os dedos na tela e os
 * retângulos dos botões do HUD. A leitura do primeiro jogador continua saindo
 * daqui por conveniência — é ela que junta teclado, mouse e toque no mesmo
 * comando.
 */

import { ESQUEMAS, lerTeclado } from './controles';

export interface Retangulo {
  x: number;
  y: number;
  largura: number;
  altura: number;
}

export interface LeituraDeEntrada {
  mx: number;
  my: number;
  ax: number;
  ay: number;
  atacar: boolean;
  usar: boolean;
}

/** Raio do manche virtual, em pixels de tela. */
const RAIO_DO_MANCHE = 70;

export class Entrada {
  private readonly teclas = new Set<string>();
  private mouseX = 0;
  private mouseY = 0;
  private mousePressionado = false;
  private toqueDeMover: { id: number; x0: number; y0: number; x: number; y: number } | null = null;
  private toqueDeMirar: { id: number; x: number; y: number } | null = null;
  private toquesEmBotao = new Map<number, string>();
  /** Retângulos dos botões de tela, redesenhados pelo HUD a cada quadro. */
  botoes: Record<string, Retangulo> = {};
  /**
   * Nomes dos botões "recolher-*" tocados desde a última leitura — quem lê
   * (`main.ts`) esvazia a cada quadro. Um toque nesses nomes de `botoes` não
   * vira manche nem mira, e dispara uma vez só, no instante em que o dedo
   * pousa: são botões de alternar, não de segurar, e a mesma tela que os
   * desenha (`hud.ts`) não sabe nada de `ajustes` — só quem lê a fila sabe.
   */
  toquesDeRecolher: string[] = [];
  /**
   * Onde a pessoa clicou ou tocou dentro do minimapa desde a última leitura
   * — em pixels de tela, não de mundo, porque só quem lê (`main.ts`) tem a
   * câmera e a arena para fazer essa conta. `main.ts` esvazia a cada quadro.
   */
  cliquesDeMinimapa: { x: number; y: number }[] = [];
  /**
   * De que lado da tela fica o manche, no celular.
   *
   * Vem dos ajustes e é lido a cada toque em vez de guardado: quem troca a
   * preferência no meio da partida não deveria precisar recarregar a página.
   */
  ladoDoManche: 'esquerda' | 'direita' = 'esquerda';
  placarAberto = false;
  /** Verdadeiro no quadro em que o manche virtual está em uso. */
  get usandoToque(): boolean {
    return this.toqueDeMover !== null || this.toqueDeMirar !== null || this.toquesEmBotao.size > 0;
  }

  get manche(): { x: number; y: number; dx: number; dy: number } | null {
    const t = this.toqueDeMover;
    if (!t) return null;
    return { x: t.x0, y: t.y0, dx: t.x - t.x0, dy: t.y - t.y0 };
  }

  constructor(private readonly tela: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab') {
        e.preventDefault();
        this.placarAberto = true;
      }
      if (e.code === 'Space') e.preventDefault();
      this.teclas.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Tab') this.placarAberto = false;
      this.teclas.delete(e.code);
    });
    window.addEventListener('blur', () => this.teclas.clear());

    tela.addEventListener('mousemove', (e) => {
      const r = tela.getBoundingClientRect();
      this.mouseX = e.clientX - r.left;
      this.mouseY = e.clientY - r.top;
    });
    tela.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.mousePressionado = true;
      if (e.button === 2) this.teclas.add('KeyE');
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mousePressionado = false;
      if (e.button === 2) this.teclas.delete('KeyE');
    });
    tela.addEventListener('contextmenu', (e) => e.preventDefault());
    // O clique nasce e morre no mouse — sem drag, sem alcançar o manche ou
    // os botões de toque, que nem existem para quem usa mouse. O evento
    // nativo `click` já resolve "foi um clique e não um arrasto" sozinho.
    tela.addEventListener('click', (e) => {
      const r = tela.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      if (this.botoes.minimapa && dentro(this.botoes.minimapa, x, y)) {
        this.cliquesDeMinimapa.push({ x, y });
      }
    });

    tela.addEventListener('touchstart', (e) => this.tocar(e), { passive: false });
    tela.addEventListener('touchmove', (e) => this.tocar(e), { passive: false });
    tela.addEventListener('touchend', (e) => this.soltar(e), { passive: false });
    tela.addEventListener('touchcancel', (e) => this.soltar(e), { passive: false });
  }

  private tocar(e: TouchEvent): void {
    e.preventDefault();
    const r = this.tela.getBoundingClientRect();
    for (const t of Array.from(e.changedTouches)) {
      const x = t.clientX - r.left;
      const y = t.clientY - r.top;
      const jaNoBotao = this.toquesEmBotao.get(t.identifier);
      if (jaNoBotao) continue;

      const botao = Object.entries(this.botoes).find(([, b]) => dentro(b, x, y));
      if (botao && !this.toqueDeMover && this.toqueDeMirar?.id !== t.identifier) {
        this.toquesEmBotao.set(t.identifier, botao[0]);
        if (botao[0].startsWith('recolher-')) this.toquesDeRecolher.push(botao[0]);
        if (botao[0] === 'minimapa') this.cliquesDeMinimapa.push({ x, y });
        continue;
      }
      if (this.toqueDeMover?.id === t.identifier) {
        this.toqueDeMover.x = x;
        this.toqueDeMover.y = y;
      } else if (this.toqueDeMirar?.id === t.identifier) {
        this.toqueDeMirar.x = x;
        this.toqueDeMirar.y = y;
      } else if (this.noLadoDoManche(x, r.width) && !this.toqueDeMover) {
        this.toqueDeMover = { id: t.identifier, x0: x, y0: y, x, y };
      } else if (!this.toqueDeMirar) {
        this.toqueDeMirar = { id: t.identifier, x, y };
      }
    }
  }

  private soltar(e: TouchEvent): void {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (this.toqueDeMover?.id === t.identifier) this.toqueDeMover = null;
      if (this.toqueDeMirar?.id === t.identifier) this.toqueDeMirar = null;
      this.toquesEmBotao.delete(t.identifier);
    }
  }

  private noLadoDoManche(x: number, largura: number): boolean {
    return this.ladoDoManche === 'esquerda' ? x < largura / 2 : x >= largura / 2;
  }

  /** As teclas apertadas agora. É daqui que cada esquema tira a sua leitura. */
  get teclasApertadas(): ReadonlySet<string> {
    return this.teclas;
  }

  /** Onde está o cursor, em pixels de tela. */
  get cursor(): { x: number; y: number } {
    return { x: this.mouseX, y: this.mouseY };
  }

  get botaoDoMouse(): boolean {
    return this.mousePressionado;
  }

  /**
   * Lê a intenção do primeiro jogador: teclado, mouse **e** toque juntos.
   *
   * O esquema do WASD sai da tabela compartilhada; o que se acrescenta aqui é a
   * camada do dedo — manche, toque de mira e botões de tela —, que não existe
   * para os outros jogadores porque uma tela de celular não comporta quatro
   * pares de polegares.
   *
   * @param centro onde o personagem está na tela, em pixels — a mira é a
   * direção dele até o cursor, e não a posição do cursor.
   */
  ler(centro: { x: number; y: number }): LeituraDeEntrada {
    const base = lerTeclado(
      ESQUEMAS[0]!,
      this.teclas,
      { x: 0, y: 0 },
      { cursor: this.cursor, centro },
      this.mousePressionado,
    );
    let { mx, my, ax, ay } = base;

    const manche = this.manche;
    if (manche) {
      const t = Math.hypot(manche.dx, manche.dy);
      if (t > 8) {
        const forca = Math.min(1, t / RAIO_DO_MANCHE);
        mx = (manche.dx / t) * forca;
        my = (manche.dy / t) * forca;
      }
    }

    if (this.toqueDeMirar) {
      const dx = this.toqueDeMirar.x - centro.x;
      const dy = this.toqueDeMirar.y - centro.y;
      const d = Math.hypot(dx, dy);
      if (d > 12) {
        ax = dx / d;
        ay = dy / d;
      }
    }

    const botaoApertado = (nome: string): boolean =>
      [...this.toquesEmBotao.values()].includes(nome);

    return {
      mx,
      my,
      ax,
      ay,
      atacar: base.atacar || this.toqueDeMirar !== null || botaoApertado('atacar'),
      // `Espaço` é o botão de entrar da cabine e também o "usar" de sempre: a
      // tecla mais óbvia do teclado merece as duas funções, e elas nunca
      // acontecem na mesma tela.
      usar: base.usar || this.teclas.has('Space') || botaoApertado('usar'),
    };
  }
}

function dentro(r: Retangulo, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.largura && y >= r.y && y <= r.y + r.altura;
}
