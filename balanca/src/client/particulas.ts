import { perfil } from '../shared/classes';
import type { Estado, Evento } from '../shared/estado';
import { TILE, type Time } from '../shared/regras';
import { quadro, quadroDaVez, type Animacao, type Arte } from './arte';
import type { Vista } from './desenho';

/**
 * Os efeitos que dizem que alguma coisa **aconteceu**.
 *
 * ## O problema que isto resolve
 *
 * O jogo mudava de estado sem avisar. Um aldeão virava arqueiro e o único sinal
 * era o boneco trocar de folha entre dois quadros — quem estava olhando para
 * outro canto da tela não via nada, e quem estava olhando para o próprio boneco
 * via um piscar. A transformação é o segundo diferencial do jogo inteiro
 * (chapéu dá classe, chapéu cai, chapéu se rouba) e não tinha nenhum gesto.
 *
 * Agora tem: um estouro dourado no lugar, do tamanho do que aconteceu.
 *
 * ## Por que os efeitos nascem de eventos, e não do desenho
 *
 * A tentação era o desenho comparar o retrato de agora com o anterior e disparar
 * um efeito quando a classe mudasse. Funcionaria, e mentiria em dois casos: um
 * pacote perdido junta duas trocas num quadro só (um efeito para duas), e a
 * previsão local pode desfazer o que ela mesma previu (um efeito para nenhuma).
 *
 * O servidor já manda a lista do que aconteceu naquele tick — `estado.eventos`,
 * que o mural de abates já lia. Um efeito por evento é a única contagem que
 * bate com a verdade, e é de graça.
 *
 * ## O tempo é de parede, e a simulação não sabe que isto existe
 *
 * Cada efeito guarda o instante em que nasceu e morre sozinho quando a folha
 * acaba. Nada aqui volta para a simulação, nada aqui é previsto, e um quadro
 * perdido não deixa um efeito preso na tela para sempre.
 */

/**
 * Quantos efeitos podem estar vivos ao mesmo tempo.
 *
 * Cento e sessenta porque a poeira dos pés sozinha enche o campo: sessenta e
 * quatro bonecos correndo soltam um bafo a cada quarto de segundo, e cada bafo
 * dura meio. O teto é uma rede de segurança, não um orçamento — quando ele
 * estoura, o mais velho sai, que é o menos visível.
 */
const TETO = 160;

/** Segundos entre dois bafos de poeira do mesmo boneco. */
const INTERVALO_DA_POEIRA = 0.26;

/** Quanto um boneco precisa andar, por segundo, para levantar poeira. */
const ANDANDO = 40;

interface Efeito {
  folha: Animacao;
  x: number;
  y: number;
  escala: number;
  /** Em segundos de relógio de parede. */
  nasceu: number;
  /** Segundos extras no último quadro, depois da folha acabar de tocar. */
  segura: number;
}

/**
 * O que cada acontecimento vira na tela.
 *
 * É uma tabela e não uma escada de `if` pelo mesmo motivo dos modos e dos
 * mapas: quem acrescentar um evento amanhã escreve uma linha aqui, e quem lê o
 * arquivo vê a lista inteira de uma vez em vez de caçá-la dentro de uma função.
 */
type Receita = {
  folha: keyof Arte['efeitos'];
  escala: number;
  /** Deslocamento vertical, em unidades de mundo. */
  acima: number;
  /**
   * Segundos extras parado no último quadro, depois da folha acabar. A
   * maioria dos efeitos é um clarão — toca e some; um resquício de batalha
   * precisa ficar no chão um tempo depois de caído, não sumir no instante
   * em que a queda termina.
   */
  segura?: number;
};

const RECEITAS = {
  /** A troca de classe: o efeito grande, porque é a mudança que mais importa. */
  chapeu: { folha: 'estouro', escala: 0.62, acima: 26 },
  /**
   * O roubo do chapéu do inimigo: o golpe do ladrão do Enemy Pack, e não o
   * mesmo estouro genérico da troca comum — roubar é notícia, e a receita já
   * dizia isso pelo tamanho; agora diz pelo gesto também.
   */
  roubo: { folha: 'furto', escala: 1.05, acima: 26 },
  abate: { folha: 'poeirada', escala: 0.9, acima: 6 },
  /** O bafo sob os pés de quem corre. Pequeno e no chão, ou vira fumaça. */
  passo: { folha: 'poeira', escala: 0.42, acima: -6 },
  /** O respingo de quem entra na água — na ponte, o pé raspa a beira. */
  respingo: { folha: 'agua', escala: 0.5, acima: -4 },
  deposito: { folha: 'labareda', escala: 1.1, acima: 18 },
  resgate: { folha: 'estouro', escala: 1.1, acima: 20 },
  obra: { folha: 'labareda', escala: 1.4, acima: 34 },
  saque: { folha: 'poeira', escala: 0.8, acima: 4 },
  /** A onda rara do Torch Goblin, quando chega: a chapelaria pega fogo. */
  incendio: { folha: 'labareda', escala: 1.9, acima: 30 },
  /**
   * O resquício de batalha: nasce quando o **último** goblin de uma onda é
   * afugentado, não a cada um — senão a chapelaria vira um cemitério a cada
   * onda de cinco. Fica caído no chão por um tempo depois da queda, e
   * some sozinho.
   */
  trollCaido: { folha: 'trollCaido', escala: 1.15, acima: 8, segura: 6 },
} as const satisfies Record<string, Receita>;

/**
 * Um dizer que sobe e some — o nome da classe nova, sobre a cabeça de quem a
 * vestiu.
 *
 * O estouro diz *que* mudou; o dizer diz *para o quê*. Sem ele, a troca de
 * chapéu num campo com sessenta e quatro pessoas é um clarão a mais no meio de
 * outros vinte, e quem estava correndo para pedir um clérigo não fica sabendo
 * que já tem um.
 */
interface Dizer {
  texto: string;
  cor: string;
  x: number;
  y: number;
  nasceu: number;
}

/** Quanto tempo um dizer fica na tela, em segundos. */
const DURACAO_DO_DIZER = 1.6;

export class Particulas {
  private efeitos: Efeito[] = [];
  private dizeres: Dizer[] = [];
  /**
   * O tick do último retrato já traduzido em efeitos.
   *
   * O mesmo retrato é desenhado em vários quadros — o jogo roda a sessenta e o
   * servidor manda quinze por segundo. Sem esta marca, os eventos de um tick
   * virariam quatro estouros em vez de um.
   */
  private ultimoTick = -1;
  /** Onde cada boneco estava no quadro anterior, para saber quem corre. */
  private readonly ondeEstavam = new Map<number, { x: number; y: number }>();
  private readonly ultimaPoeira = new Map<number, number>();

  /** Lê o que aconteceu neste retrato e acende o que for de acender. */
  colher(estado: Estado, arte: Arte, agora: number): void {
    if (estado.tick === this.ultimoTick) return;
    this.ultimoTick = estado.tick;
    for (const e of estado.eventos) this.doEvento(e, estado, arte, agora);
  }

  /** Um efeito solto, para o que não é evento do servidor. */
  acender(arte: Arte, nome: keyof typeof RECEITAS, x: number, y: number, agora: number): void {
    const r: Receita = RECEITAS[nome];
    if (this.efeitos.length >= TETO) this.efeitos.shift();
    this.efeitos.push({
      folha: arte.efeitos[r.folha],
      x,
      y: y - r.acima,
      escala: r.escala,
      nasceu: agora,
      segura: r.segura ?? 0,
    });
  }

  private doEvento(e: Evento, estado: Estado, arte: Arte, agora: number): void {
    // A posição vem do retrato, viva ou morta: o abate acontece no instante em
    // que a unidade cai, e é ali que a poeira sobe.
    const onde = (id: number): { x: number; y: number } | null =>
      estado.unidades.find((x) => x.id === id) ?? null;
    switch (e.tipo) {
      case 'chapeu': {
        const p = onde(e.unidade);
        if (!p) return;
        this.acender(arte, e.roubado ? 'roubo' : 'chapeu', p.x, p.y, agora);
        this.dizer(
          e.roubado ? `roubou ${perfil(e.classe).nome}` : perfil(e.classe).nome,
          e.roubado ? '#ff9c8f' : '#ffd479',
          p.x,
          p.y,
          agora,
        );
        return;
      }
      case 'abate': {
        const p = onde(e.vitima);
        if (p) this.acender(arte, 'abate', p.x, p.y, agora);
        return;
      }
      case 'deposito': {
        // No baú, e não em quem entregou: o que mudou foi o peso do refém.
        const bau = estado.baus.find((b) => b.time === e.bau);
        if (bau) this.acender(arte, 'deposito', bau.x, bau.y, agora);
        return;
      }
      case 'resgate': {
        const p = onde(e.unidade);
        if (p) this.acender(arte, 'resgate', p.x, p.y, agora);
        return;
      }
      case 'saque': {
        const p = onde(e.unidade);
        if (p) this.acender(arte, 'saque', p.x, p.y, agora);
        return;
      }
      default:
        return;
    }
  }

  /**
   * A poeira sob os pés de quem corre, e o respingo de quem pisa na beira.
   *
   * ## Por que isto não sai de um evento
   *
   * Andar não é um acontecimento: é o estado normal de todo mundo o tempo todo.
   * Mandar um evento por passo pelo protocolo seria pagar banda para dizer o
   * óbvio. Então este é o único efeito que o cliente decide sozinho, olhando a
   * posição de agora contra a do quadro anterior.
   *
   * ## Só quem está na tela
   *
   * A lista de unidades tem o mapa inteiro; a poeira de quem está a sessenta
   * tiles daqui não é vista por ninguém e custa o mesmo que a de quem está na
   * frente. Quem chama passa o retângulo da câmera, e o resto é descartado antes
   * de virar efeito.
   */
  pisadas(
    estado: Estado,
    arte: Arte,
    agora: number,
    naTela: (x: number, y: number) => boolean,
    naAgua: (x: number, y: number) => boolean,
  ): void {
    for (const u of estado.unidades) {
      if (!u.vivo) continue;
      const antes = this.ondeEstavam.get(u.id);
      this.ondeEstavam.set(u.id, { x: u.x, y: u.y });
      if (!antes || !naTela(u.x, u.y)) continue;

      const desde = this.ultimaPoeira.get(u.id) ?? 0;
      if (agora - desde < INTERVALO_DA_POEIRA) continue;
      // A velocidade sai da diferença entre dois retratos, e o retrato vem a
      // quinze por segundo: o intervalo da poeira é mais longo que isso de
      // propósito, para o cálculo nunca depender de um quadro sem novidade.
      const passou = Math.hypot(u.x - antes.x, u.y - antes.y) / Math.max(0.001, agora - desde);
      if (passou < ANDANDO) continue;

      this.ultimaPoeira.set(u.id, agora);
      this.acender(arte, naAgua(u.x, u.y) ? 'respingo' : 'passo', u.x, u.y, agora);
    }
  }

  /** Um dizer que sobe do ponto e some. */
  dizer(texto: string, cor: string, x: number, y: number, agora: number): void {
    if (this.dizeres.length >= TETO) this.dizeres.shift();
    this.dizeres.push({ texto, cor, x, y, nasceu: agora });
  }

  /** O estouro da obra sobe da chapelaria, que não é uma unidade. */
  obraSubiu(arte: Arte, x: number, y: number, agora: number, time: Time, nivel: number): void {
    this.acender(arte, 'obra', x, y, agora);
    this.dizer(
      `obra ${'I'.repeat(nivel)}`,
      time === 'azul' ? '#8fc0ff' : '#ff9c8f',
      x,
      y - TILE,
      agora,
    );
  }

  /**
   * Desenha o que ainda está vivo e esquece o resto.
   *
   * Os efeitos entram na mesma ordem de Y do resto do mundo — passada por quem
   * chama — para o estouro de quem está atrás de uma torre não aparecer na
   * frente dela.
   */
  desenhar(ctx: CanvasRenderingContext2D, v: Vista, escalaDaTela: number, agora: number): void {
    const vivos: Efeito[] = [];
    for (const f of this.efeitos) {
      const t = agora - f.nasceu;
      const duracao = f.folha.quadros / f.folha.fps;
      const duracaoTotal = duracao + f.segura;
      if (t >= duracaoTotal) continue;
      vivos.push(f);
      // Passado o fim da folha, `quadroDaVez` já prende sozinho no último
      // quadro — é só não parar de chamá-lo enquanto durar a espera.
      const i = quadroDaVez(f.folha, t / duracao);
      // No último segundo da espera, some aos poucos em vez de piscar: um
      // resquício de batalha que desaparece de um quadro para o outro lê
      // como falha de desenho, não como o tempo levando o rastro embora.
      const restante = duracaoTotal - t;
      if (restante < 1) ctx.globalAlpha = Math.max(0, restante);
      quadro(
        ctx,
        f.folha,
        i,
        v.paraTelaX(f.x),
        v.paraTelaY(f.y),
        escalaDaTela * f.escala,
        'centro',
      );
      if (restante < 1) ctx.globalAlpha = 1;
    }
    this.efeitos = vivos;
  }

  /**
   * Os dizeres, por cima de tudo.
   *
   * Vêm depois do mundo inteiro e **não** entram na ordem de Y: um texto de
   * meio segundo escondido atrás de uma torre é um texto que não foi lido, e o
   * ponto dele é ser lido.
   */
  desenharDizeres(ctx: CanvasRenderingContext2D, v: Vista, escala: number, agora: number): void {
    const vivos: Dizer[] = [];
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.font = `700 ${Math.max(11, Math.round(13 * escala))}px "Trebuchet MS", system-ui, sans-serif`;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    for (const d of this.dizeres) {
      const t = (agora - d.nasceu) / DURACAO_DO_DIZER;
      if (t >= 1) continue;
      vivos.push(d);
      // Sobe trinta pixels de mundo ao longo da vida e apaga no último terço:
      // some sozinho sem nunca piscar.
      const x = v.paraTelaX(d.x);
      const y = v.paraTelaY(d.y) - (34 + t * 30) * escala;
      ctx.globalAlpha = t < 0.66 ? 1 : (1 - t) / 0.34;
      ctx.strokeText(d.texto, x, y);
      ctx.fillStyle = d.cor;
      ctx.fillText(d.texto, x, y);
    }
    ctx.restore();
    this.dizeres = vivos;
  }

  /** Some com tudo. Serve para a troca de partida não herdar a anterior. */
  limpar(): void {
    this.efeitos = [];
    this.dizeres = [];
    this.ondeEstavam.clear();
    this.ultimaPoeira.clear();
    this.ultimoTick = -1;
  }
}

