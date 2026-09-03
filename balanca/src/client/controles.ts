import type { LeituraDeEntrada } from './entrada';

/**
 * Quem controla quem, quando há quatro pessoas e um aparelho só.
 *
 * ## O problema que este arquivo resolve
 *
 * Um jogo de sofá não tem "o jogador" — tem quatro, e o teclado é **um**. Sem
 * uma noção explícita de *fonte de controle*, a segunda pessoa a sentar
 * herdaria o WASD da primeira e as duas andariam grudadas. Aqui cada fonte é
 * uma coisa nomeada — o WASD, as setas, o controle nº 2 — que uma vaga da
 * cabine reivindica e ninguém mais pode usar.
 *
 * ## Mirar sem mouse
 *
 * O mouse é da pessoa que está no WASD, e ponto: não existe segundo cursor. As
 * outras fontes miram pelo **rumo**, isto é, para onde a pessoa andou por
 * último. Quem tem controle com analógico direito mira com ele, como manda o
 * costume; quem não tem ataca para onde está indo.
 *
 * Isso muda o jogo de propósito: no sofá, recuar atirando exige um controle. É
 * o mesmo acordo que qualquer beat-'em-up de quatro faz, e é melhor do que
 * fingir que dá para mirar com o teclado numérico.
 *
 * ## Por que a leitura é função pura
 *
 * `lerTeclado` e `lerControle` recebem um retrato (teclas apertadas, eixos do
 * controle) e devolvem o comando. Nada de `document`, nada de
 * `navigator.getGamepads`. É o que permite testar "as setas andam para a
 * esquerda" e "sem analógico direito, o golpe sai para onde a pessoa anda" sem
 * abrir um navegador — regras que, no meio de um `addEventListener`, quebram em
 * silêncio.
 */

export type IdDeFonte = `teclado:${'wasd' | 'setas'}` | `controle:${number}`;

/** Quantas pessoas cabem num aparelho. É o limite do sofá, não do servidor. */
export const MAXIMO_LOCAL = 4;

export interface EsquemaDeTeclado {
  id: IdDeFonte;
  rotulo: string;
  /** Como a cabine anuncia o botão de entrar: "Espaço", "Enter". */
  comoEntrar: string;
  esquerda: readonly string[];
  direita: readonly string[];
  cima: readonly string[];
  baixo: readonly string[];
  atacar: readonly string[];
  usar: readonly string[];
  entrar: readonly string[];
  /** Se a mira acompanha o cursor. Só o esquema do WASD tem mouse. */
  comMouse: boolean;
}

/**
 * Os dois esquemas de teclado.
 *
 * O primeiro é o de sempre — WASD, mouse, clique — porque quem joga sozinho não
 * pode pagar o preço do modo de quatro. O segundo mora do outro lado do
 * teclado, longe o bastante para dois pares de mãos não se esbarrarem, e usa as
 * teclas que existem em qualquer teclado (as setas e as duas ao lado do ponto),
 * e não o bloco numérico, que metade dos notebooks não tem.
 */
export const ESQUEMAS: readonly EsquemaDeTeclado[] = [
  {
    id: 'teclado:wasd',
    rotulo: 'Teclado WASD + mouse',
    comoEntrar: 'Espaço',
    esquerda: ['KeyA'],
    direita: ['KeyD'],
    cima: ['KeyW'],
    baixo: ['KeyS'],
    atacar: ['KeyF', 'KeyJ'],
    usar: ['KeyE'],
    entrar: ['Space'],
    comMouse: true,
  },
  {
    id: 'teclado:setas',
    rotulo: 'Teclado setas',
    comoEntrar: 'Enter',
    esquerda: ['ArrowLeft'],
    direita: ['ArrowRight'],
    cima: ['ArrowUp'],
    baixo: ['ArrowDown'],
    atacar: ['Period', 'NumpadDecimal'],
    usar: ['Comma', 'Numpad0'],
    entrar: ['Enter', 'NumpadEnter'],
    comMouse: false,
  },
];

/** O retrato de um controle, do jeito que a Gamepad API entrega. */
export interface RetratoDeControle {
  indice: number;
  eixos: readonly number[];
  botoes: readonly boolean[];
}

/**
 * Zona morta do analógico.
 *
 * Controle usado descansa fora do zero: sem esta faixa, um personagem largado
 * anda sozinho para o canto da tela a partida inteira, e a pessoa jura que o
 * jogo está com bug.
 */
const ZONA_MORTA = 0.28;

/** Botão de ação no leiaute padrão: 0 é o de baixo (A), 2 é o da esquerda (X). */
const BOTAO_ENTRAR = 0;
const BOTAO_USAR = 0;
const BOTOES_DE_ATAQUE = [2, 7, 5];

export interface Rumo {
  x: number;
  y: number;
}

/**
 * Traduz teclas em comando.
 *
 * @param mira posição do cursor e do personagem na tela, para o esquema que tem
 * mouse. Os outros ignoram e miram pelo rumo.
 * @param rumo para onde a pessoa andou por último, já normalizado.
 */
export function lerTeclado(
  esquema: EsquemaDeTeclado,
  teclas: ReadonlySet<string>,
  rumo: Rumo,
  mira: { cursor: { x: number; y: number }; centro: { x: number; y: number } } | null,
  atacandoComMouse = false,
): LeituraDeEntrada {
  const tem = (codigos: readonly string[]): boolean => codigos.some((c) => teclas.has(c));
  let mx = 0;
  let my = 0;
  if (tem(esquema.esquerda)) mx -= 1;
  if (tem(esquema.direita)) mx += 1;
  if (tem(esquema.cima)) my -= 1;
  if (tem(esquema.baixo)) my += 1;

  let ax = 0;
  let ay = 0;
  if (esquema.comMouse && mira) {
    const dx = mira.cursor.x - mira.centro.x;
    const dy = mira.cursor.y - mira.centro.y;
    const d = Math.hypot(dx, dy);
    if (d > 12) {
      ax = dx / d;
      ay = dy / d;
    }
  } else {
    ax = rumo.x;
    ay = rumo.y;
  }

  return {
    mx,
    my,
    ax,
    ay,
    atacar: tem(esquema.atacar) || (esquema.comMouse && atacandoComMouse),
    usar: tem(esquema.usar),
  };
}

/**
 * Traduz um controle em comando.
 *
 * O analógico direito manda na mira quando é empurrado; solto, a mira volta
 * para o rumo. Trocar entre os dois no meio do movimento é o que faz o
 * arqueiro de controle conseguir recuar atirando sem que o de teclado precise
 * de um segundo mouse.
 */
export function lerControle(pad: RetratoDeControle, rumo: Rumo): LeituraDeEntrada {
  const eixo = (i: number): number => {
    const v = pad.eixos[i] ?? 0;
    return Math.abs(v) < ZONA_MORTA ? 0 : v;
  };
  const mx = eixo(0);
  const my = eixo(1);
  const dx = eixo(2);
  const dy = eixo(3);
  const mirando = Math.hypot(dx, dy);
  const [ax, ay] = mirando > 0 ? [dx / mirando, dy / mirando] : [rumo.x, rumo.y];

  // O direcional digital, quando existe, entra como se fosse o analógico: é
  // por ele que quase todo mundo joga jogo de pixel.
  const cruz = {
    cima: pad.botoes[12] === true,
    baixo: pad.botoes[13] === true,
    esquerda: pad.botoes[14] === true,
    direita: pad.botoes[15] === true,
  };
  const cruzX = (cruz.direita ? 1 : 0) - (cruz.esquerda ? 1 : 0);
  const cruzY = (cruz.baixo ? 1 : 0) - (cruz.cima ? 1 : 0);

  return {
    mx: cruzX !== 0 ? cruzX : mx,
    my: cruzY !== 0 ? cruzY : my,
    ax: ax ?? 0,
    ay: ay ?? 0,
    atacar: BOTOES_DE_ATAQUE.some((b) => pad.botoes[b] === true),
    usar: pad.botoes[BOTAO_USAR] === true,
  };
}

/** Verdadeiro quando este controle está pedindo para entrar na partida. */
export function controleQuerEntrar(pad: RetratoDeControle): boolean {
  return pad.botoes[BOTAO_ENTRAR] === true;
}

/**
 * Atualiza o rumo com o movimento deste quadro.
 *
 * Guardar o rumo é o que dá memória à mira sem mouse: parado, o personagem
 * continua olhando para onde estava indo, em vez de zerar a mira e atacar para
 * lugar nenhum — que é como o servidor trata `ax = ay = 0`.
 */
export function atualizarRumo(rumo: Rumo, mx: number, my: number): Rumo {
  const d = Math.hypot(mx, my);
  if (d < 0.2) return rumo;
  return { x: mx / d, y: my / d };
}

/**
 * Os controles ligados agora, do jeito que a leitura pura espera.
 *
 * A Gamepad API devolve buracos no vetor (um controle desconectado vira `null`
 * sem encolher a lista), e o índice **é** a identidade da fonte: manter o
 * índice original é o que impede o jogador 3 de virar o jogador 2 quando o 1
 * tira o cabo da tomada no meio da partida.
 */
export function controlesLigados(): RetratoDeControle[] {
  const api = typeof navigator !== 'undefined' ? navigator.getGamepads?.() : null;
  if (!api) return [];
  const lista: RetratoDeControle[] = [];
  for (let i = 0; i < api.length; i++) {
    const pad = api[i];
    if (!pad || !pad.connected) continue;
    lista.push({
      indice: pad.index,
      eixos: [...pad.axes],
      botoes: pad.buttons.map((b) => b.pressed),
    });
  }
  return lista;
}

/** O nome que aparece na vaga da cabine. */
export function rotuloDaFonte(id: IdDeFonte): string {
  const esquema = ESQUEMAS.find((e) => e.id === id);
  if (esquema) return esquema.rotulo;
  return `Controle ${Number(id.split(':')[1] ?? 0) + 1}`;
}

export interface FonteLivre {
  fonte: IdDeFonte;
  rotulo: string;
  comoEntrar: string;
}

/** As fontes ligadas que ainda não são de ninguém. */
export function fontesLivres(
  pads: readonly RetratoDeControle[],
  ocupadas: ReadonlySet<IdDeFonte>,
): FonteLivre[] {
  const livres: FonteLivre[] = ESQUEMAS.filter((e) => !ocupadas.has(e.id)).map((e) => ({
    fonte: e.id,
    rotulo: e.rotulo,
    comoEntrar: e.comoEntrar,
  }));
  for (const pad of pads) {
    const id: IdDeFonte = `controle:${pad.indice}`;
    if (ocupadas.has(id)) continue;
    livres.push({ fonte: id, rotulo: rotuloDaFonte(id), comoEntrar: 'botão A' });
  }
  return livres;
}

/**
 * O porteiro da cabine: quem acabou de pedir para entrar.
 *
 * ## Por que "acabou de", e não "está"
 *
 * O botão que abre a cabine e o botão de entrar nela podem ser o mesmo dedo. Se
 * a pessoa confirma o apelido com `Enter` e a cabine abre no quadro seguinte
 * com o `Enter` ainda afundado, um teste de "está apertado" sentaria alguém
 * sozinho, sem que ninguém tenha pedido. Guardar quem já estava apertando no
 * quadro anterior transforma a pergunta em "houve uma **nova** apertada", que é
 * o que a pessoa entende por apertar um botão.
 *
 * Uma fonte por quadro, de propósito: dois pedidos no mesmo quadro seriam duas
 * vagas ocupadas por uma tecla só num teclado onde alguém apoiou a mão.
 */
export class Porteiro {
  private apertando = new Set<IdDeFonte>();

  quemEntrou(
    teclas: ReadonlySet<string>,
    pads: readonly RetratoDeControle[],
    ocupadas: ReadonlySet<IdDeFonte>,
  ): IdDeFonte | null {
    const agora = pedindo(teclas, pads);
    let novo: IdDeFonte | null = null;
    for (const id of agora) {
      if (this.apertando.has(id) || ocupadas.has(id)) continue;
      novo ??= id;
    }
    this.apertando = agora;
    return novo;
  }

  /**
   * Prepara o porteiro para a cabine que está abrindo.
   *
   * Guarda **o que já está apertado agora** como se fosse do quadro anterior.
   * É isso que faz o `Enter` que confirmou o apelido não virar, no quadro
   * seguinte, um jogador sentado sem que ninguém tenha pedido.
   */
  armar(teclas: ReadonlySet<string>, pads: readonly RetratoDeControle[]): void {
    this.apertando = pedindo(teclas, pads);
  }
}

/** As fontes cujo botão de entrar está afundado neste instante. */
function pedindo(
  teclas: ReadonlySet<string>,
  pads: readonly RetratoDeControle[],
): Set<IdDeFonte> {
  const conjunto = new Set<IdDeFonte>();
  for (const esquema of ESQUEMAS) {
    if (esquema.entrar.some((c) => teclas.has(c))) conjunto.add(esquema.id);
  }
  for (const pad of pads) {
    if (controleQuerEntrar(pad)) conjunto.add(`controle:${pad.indice}`);
  }
  return conjunto;
}
