import { criarArena, type Arena } from '../shared/arena';
import { ESTOQUE_INICIAL, type Classe } from '../shared/classes';
import type { Estado, Evento, Unidade } from '../shared/estado';
import { moverUnidade } from '../shared/partida';
import {
  desempacotar,
  VERSAO_DO_PROTOCOLO,
  type Comando,
  type DoServidor,
  type FichaDeJogador,
} from '../shared/protocolo';
import { DT, TICKS_POR_ENVIO, TICKS_POR_SEGUNDO, TIMES, type Time } from '../shared/regras';

/**
 * A conexão, e as duas mentiras que fazem o jogo parecer local.
 *
 * ## Primeira mentira: o seu personagem anda antes de o servidor saber
 *
 * Esperar a confirmação do servidor para andar significa jogar com o atraso da
 * rede na mão — 60 ms num bom dia, e insuportável num ruim. Então o cliente
 * aplica o próprio comando na hora, guarda-o numa fila, e quando o retrato
 * chega faz a conta de novo: parte da posição que o servidor confirmou e
 * **reaplica** os comandos que o servidor ainda não viu.
 *
 * O truque só funciona porque a função de movimento é literalmente a mesma dos
 * dois lados (`moverUnidade`). Uma reimplementação "equivalente" no cliente é o
 * caminho conhecido para o personagem tremer perto das paredes.
 *
 * ## Segunda mentira: os outros aparecem 66 ms no passado
 *
 * Os outros jogadores chegam a quinze retratos por segundo. Desenhá-los na
 * última posição conhecida faria todo mundo andar aos saltos. Então o cliente
 * desenha **entre** os dois últimos retratos, atrasado exatamente um intervalo
 * de envio: movimento contínuo em troca de ver o mundo um sexto de segundo
 * atrás. É o mesmo acordo que todo jogo de tiro faz, e ninguém percebe.
 */

const INTERVALO_DE_ENVIO = (TICKS_POR_ENVIO / TICKS_POR_SEGUNDO) * 1000;

export interface Aviso {
  texto: string;
  /** Momento em que apareceu, em milissegundos. */
  quando: number;
  cor?: string;
}

interface Retratada {
  x: number;
  y: number;
}

export class Rede {
  private ws: WebSocket | null = null;
  private readonly url: string;
  private nome = 'Anônimo';

  arena: Arena | null = null;
  estado: Estado | null = null;
  meuId: number | null = null;
  sala = '';
  ping = 0;
  fechado = false;
  motivo: string | null = null;
  readonly elenco = new Map<number, FichaDeJogador>();
  readonly avisos: Aviso[] = [];
  readonly eventosNovos: Evento[] = [];

  private anterior = new Map<number, Retratada>();
  private atual = new Map<number, Retratada>();
  private recebidoEm = 0;
  private pendentes: Comando[] = [];
  private previsao: Unidade | null = null;
  private seq = 0;

  constructor(url: string) {
    this.url = url;
  }

  conectar(nome: string): void {
    this.nome = nome;
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ t: 'entrar', nome: this.nome, versao: VERSAO_DO_PROTOCOLO }));
      this.pingar();
    };
    ws.onmessage = (ev) => this.receber(JSON.parse(String(ev.data)) as DoServidor);
    ws.onclose = () => {
      this.fechado = true;
    };
    ws.onerror = () => {
      this.motivo ??= 'não deu para falar com o servidor';
    };
  }

  desconectar(): void {
    this.ws?.close();
    this.ws = null;
  }

  private pingar(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ t: 'ping', tempo: performance.now() }));
    setTimeout(() => this.pingar(), 2000);
  }

  private receber(msg: DoServidor): void {
    switch (msg.t) {
      case 'bemvindo': {
        this.meuId = msg.voce;
        this.sala = msg.sala;
        // A arena nasce da seed. Nenhum tile viaja pela rede.
        this.arena = criarArena(msg.seed);
        this.estado = estadoVazio();
        this.previsao = null;
        this.pendentes = [];
        return;
      }
      case 'elenco': {
        this.elenco.clear();
        for (const f of msg.jogadores) this.elenco.set(f.id, f);
        if (this.estado) {
          for (const u of this.estado.unidades) {
            const ficha = this.elenco.get(u.id);
            if (ficha) {
              u.nome = ficha.nome;
              u.bot = ficha.bot;
            }
          }
        }
        return;
      }
      case 'retrato': {
        if (!this.estado) this.estado = estadoVazio();
        this.anterior = this.atual;
        this.atual = new Map();
        desempacotar(msg.r, this.estado);
        for (const u of this.estado.unidades) {
          this.atual.set(u.id, { x: u.x, y: u.y });
          const ficha = this.elenco.get(u.id);
          if (ficha) {
            u.nome = ficha.nome;
            u.bot = ficha.bot;
          }
        }
        this.recebidoEm = performance.now();
        this.eventosNovos.push(...this.estado.eventos);
        this.reconciliar();
        return;
      }
      case 'pong':
        this.ping = Math.round(performance.now() - msg.tempo);
        return;
      case 'recusado':
        this.motivo = msg.motivo;
        this.fechado = true;
        return;
      default:
        return;
    }
  }

  /** A unidade do jogador, já com a previsão local aplicada. */
  get eu(): Unidade | null {
    return this.previsao;
  }

  /** A unidade do jogador como o servidor a viu pela última vez. */
  get euNoServidor(): Unidade | null {
    if (!this.estado || this.meuId === null) return null;
    return this.estado.unidades.find((u) => u.id === this.meuId) ?? null;
  }

  /**
   * Aplica o comando localmente e o envia.
   *
   * Chamada em passo fixo, uma vez por `DT`, e não a cada quadro: a fila de
   * pendentes só faz sentido se cada entrada valer exatamente um passo de
   * simulação. Com passo variável, a reconciliação teria de guardar também a
   * duração de cada comando — e erraria assim mesmo, porque o servidor usa a
   * dele.
   */
  passar(comando: Omit<Comando, 'seq'>): void {
    if (!this.arena || !this.estado) return;
    const servidor = this.euNoServidor;
    if (!servidor) return;
    this.previsao ??= { ...servidor };

    const c: Comando = { ...comando, seq: ++this.seq };
    this.pendentes.push(c);
    // Fila curta: mais de meio segundo de comandos não confirmados quer dizer
    // que a conexão caiu, e reaplicar trinta comandos velhos só faz o boneco
    // deslizar para longe da verdade.
    if (this.pendentes.length > TICKS_POR_SEGUNDO / 2) this.pendentes.shift();

    if (this.previsao.vivo) moverUnidade(this.arena, this.estado, this.previsao, c, DT);
    this.enviar(c);
  }

  private enviar(c: Comando): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ t: 'comando', c }));
  }

  /** Recomeça a previsão da posição confirmada e reaplica o que falta. */
  private reconciliar(): void {
    const servidor = this.euNoServidor;
    if (!servidor || !this.arena || !this.estado) return;
    this.pendentes = this.pendentes.filter((c) => c.seq > servidor.ultimoComando);
    const copia: Unidade = { ...servidor };
    if (copia.vivo) {
      for (const c of this.pendentes) moverUnidade(this.arena, this.estado, copia, c, DT);
    }
    this.previsao = copia;
  }

  /**
   * Onde desenhar uma unidade agora.
   *
   * A sua vem da previsão; as outras, da interpolação entre os dois últimos
   * retratos. `alfa` passa de 1 quando um pacote atrasa: aí a conta vira
   * extrapolação por um instante, o que é melhor que congelar — um boneco
   * parado no meio da corrida chama mais atenção que um que adianta 20 px.
   */
  posicaoDe(u: Unidade, agora: number): { x: number; y: number } {
    if (u.id === this.meuId && this.previsao) return { x: this.previsao.x, y: this.previsao.y };
    const b = this.atual.get(u.id);
    if (!b) return { x: u.x, y: u.y };
    const a = this.anterior.get(u.id) ?? b;
    const alfa = Math.min(1.4, (agora - this.recebidoEm) / INTERVALO_DE_ENVIO);
    return { x: a.x + (b.x - a.x) * alfa, y: a.y + (b.y - a.y) * alfa };
  }

  /** Segundos desde o último retrato. Os projéteis se adiantam por conta. */
  desdeORetrato(agora: number): number {
    return Math.max(0, (agora - this.recebidoEm) / 1000);
  }

  avisar(texto: string, cor?: string): void {
    this.avisos.unshift({ texto, quando: performance.now(), ...(cor ? { cor } : {}) });
    if (this.avisos.length > 6) this.avisos.pop();
  }
}

/** Um estado zerado para o `desempacotar` preencher. */
function estadoVazio(): Estado {
  const estoque = {} as Record<Time, Record<Classe, number>>;
  for (const t of TIMES) estoque[t] = { ...ESTOQUE_INICIAL };
  return {
    tick: 0,
    fase: 'aquecimento',
    faseEm: 0,
    relogio: 0,
    placar: { azul: 0, vermelho: 0 },
    unidades: [],
    princesas: [],
    projeteis: [],
    itens: [],
    trigais: [],
    cozinhas: [],
    estoque,
    eventos: [],
    vencedor: null,
    proximoId: 1,
  };
}
