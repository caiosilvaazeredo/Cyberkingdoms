import { criarArena, type Arena } from '../shared/arena';
import { ESTOQUE_INICIAL, type Classe } from '../shared/classes';
import type { Estado, Evento, Unidade } from '../shared/estado';
import { MAPA_PADRAO, mapaDe, type IdDoMapa } from '../shared/mapas';
import { MODO_PADRAO, modoDe, type IdDoModo } from '../shared/modos';
import { moverUnidade } from '../shared/partida';
import {
  desempacotar,
  VERSAO_DO_PROTOCOLO,
  type Comando,
  type ConfiguracaoDeSala,
  type DoCliente,
  type DoServidor,
  type FichaDeJogador,
  type VotacaoAberta,
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

/** Para onde esta conexão quer ir. Vazio quer dizer "onde o lobby mandar". */
export interface Destino {
  /** Uma sala que já existe, pelo nome. */
  sala?: string;
  /** Uma sala reservada a este aparelho. */
  privada?: boolean;
  /** Uma sala nova, com estas regras. */
  criar?: ConfiguracaoDeSala;
}

/**
 * A mensagem de entrada, montada à parte da conexão.
 *
 * Separada para poder ser testada sem um WebSocket — e a razão de isso valer a
 * pena é um defeito que aconteceu: `criar` foi acrescentado ao chamador e
 * esquecido aqui, e a sala montada saía como uma sala comum do lobby. O
 * compilador não pegou porque o chamador passa as opções por espalhamento
 * condicional, e propriedade que nasce de um espalhamento não é conferida como
 * excesso. Nada acusou; a pessoa só recebia uma sala diferente da que pediu.
 */
export function mensagemDeEntrada(
  nome: string,
  assistindo: boolean,
  onde: Destino,
): DoCliente & { t: 'entrar' } {
  return {
    t: 'entrar',
    nome,
    versao: VERSAO_DO_PROTOCOLO,
    assistindo,
    ...(onde.sala !== undefined ? { sala: onde.sala } : {}),
    ...(onde.privada ? { privada: true } : {}),
    ...(onde.criar ? { criar: onde.criar } : {}),
  };
}

export class Rede {
  private ws: WebSocket | null = null;
  private readonly url: string;
  private nome = 'Anônimo';

  arena: Arena | null = null;
  estado: Estado | null = null;
  meuId: number | null = null;
  meuTime: Time | null = null;
  sala = '';
  porTime = 0;
  /**
   * O modo e os npcs da sala, ditos uma vez no `bemvindo`.
   *
   * O modo precisa chegar antes do primeiro retrato: é ele que a previsão local
   * consulta, e prever com o modo errado por meia dúzia de quadros faria o
   * boneco pular no exato instante em que a partida começa.
   */
  modo: IdDoModo = MODO_PADRAO;
  botsPorTime = 0;
  /** O mapa desta partida. É dele que a arena local nasce. */
  mapa: IdDoMapa = MAPA_PADRAO;
  /** Verdadeiro entre conectar e escolher o lado. */
  get espectador(): boolean {
    return this.meuId === null && this.arena !== null;
  }
  ping = 0;
  fechado = false;
  motivo: string | null = null;
  readonly elenco = new Map<number, FichaDeJogador>();
  readonly avisos: Aviso[] = [];
  readonly eventosNovos: Evento[] = [];
  /** Bênçãos do clérigo em curso: o desenho toca o efeito sobre o curado. */
  readonly brilhos: { alvo: number; quando: number }[] = [];
  /** A votação do seu time, ou `null`. O painel do time desenha a partir dela. */
  votacao: VotacaoAberta | null = null;
  /** A última frase do time — ordem dada, votação apurada. */
  recadoDoTime: { texto: string; quando: number } | null = null;

  private anterior = new Map<number, Retratada>();
  private atual = new Map<number, Retratada>();
  private recebidoEm = 0;
  private pendentes: Comando[] = [];
  private previsao: Unidade | null = null;
  /** Posição visual suavizada entre os passos fixos da previsão. */
  private visualAnterior: Retratada | null = null;
  private visualAlvo: Retratada | null = null;
  private visualDesde = 0;
  private seq = 0;
  private ultimoAceno = 0;

  constructor(url: string) {
    this.url = url;
  }

  /**
   * @param assistindo quem chega pelo menu entra como plateia e **não ocupa
   * vaga** — a partida atrás do título não pode custar o lugar de um jogador.
   * @param onde para onde ir: uma sala pelo nome (é assim que o segundo, o
   * terceiro e o quarto jogador do mesmo aparelho caem junto do primeiro) ou
   * uma sala privada (o jogo local, em que ninguém de fora entra).
   */
  conectar(nome: string, assistindo = false, onde: Destino = {}): void {
    this.nome = nome;
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify(mensagemDeEntrada(this.nome, assistindo, onde)));
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

  /**
   * Mantém a conexão viva enquanto o jogador só assiste.
   *
   * O servidor derruba quem fica calado vinte segundos, e o espectador não manda
   * comando — sem isto, quem demora para escolher o lado é desconectado
   * justamente enquanto lê a tela de escolha.
   */
  manterVivo(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const agora = performance.now();
    if (agora - this.ultimoAceno < 2000) return;
    this.ultimoAceno = agora;
    this.ws.send(JSON.stringify({ t: 'ping', tempo: agora }));
  }

  /**
   * O líder manda um npc vestir uma classe, ou abre a decisão para o time.
   *
   * O servidor confere se quem mandou é mesmo o líder — o cliente esconder o
   * botão de quem não lidera é conveniência, não segurança.
   */
  mandar(alvo: number, classe: Classe, votar = false): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ t: 'mandar', alvo, classe, ...(votar ? { votar: true } : {}) }));
  }

  /** Vota numa votação aberta. O último voto é o que vale. */
  votarEm(classe: Classe): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ t: 'votar', classe }));
  }

  /**
   * Pede o lado. O servidor responde com `nasceu`, ou recusa com o motivo.
   *
   * O apelido viaja junto porque a conexão foi aberta como plateia, quando o
   * jogador ainda não tinha dito como quer ser chamado.
   */
  escolherTime(time: Time, nome?: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.motivo = null;
    if (nome) this.nome = nome;
    this.ws.send(JSON.stringify({ t: 'escolherTime', time, nome: this.nome }));
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
        this.sala = msg.sala;
        this.porTime = msg.porTime;
        this.modo = modoDe(msg.modo).id;
        this.botsPorTime = msg.botsPorTime;
        this.mapa = mapaDe(msg.mapa).id;
        // Chega como espectador: a unidade só existe depois de escolher o lado,
        // e numa partida nova ela é outra. Zerar aqui evita desenhar o boneco
        // da partida passada por um quadro.
        this.meuId = null;
        this.meuTime = null;
        // A arena nasce da seed. Nenhum tile viaja pela rede.
        this.arena = criarArena(msg.seed, this.mapa);
        this.estado = estadoVazio(this.modo, this.porTime);
        this.previsao = null;
        this.visualAnterior = null;
        this.visualAlvo = null;
        this.pendentes = [];
        return;
      }
      case 'nasceu': {
        this.meuId = msg.voce;
        this.meuTime = msg.time;
        this.previsao = null;
        this.visualAnterior = null;
        this.visualAlvo = null;
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
        if (!this.estado) this.estado = estadoVazio(this.modo, this.porTime);
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
        for (const e of this.estado.eventos) {
          if (e.tipo === 'cura') this.brilhos.push({ alvo: e.alvo, quando: this.recebidoEm });
        }
        // A lista é curta e velha some: um efeito de cura vale um segundo, e
        // guardar mais que isso é vazamento com cara de animação.
        while (this.brilhos.length > 0 && performance.now() - this.brilhos[0]!.quando > 1200) {
          this.brilhos.shift();
        }
        this.reconciliar();
        return;
      }
      case 'votacao':
        this.votacao = msg.v;
        return;
      case 'recadoDoTime':
        this.recadoDoTime = { texto: msg.texto, quando: performance.now() };
        return;
      case 'pong':
        this.ping = Math.round(performance.now() - msg.tempo);
        return;
      case 'recusado':
        this.motivo = msg.motivo;
        // Uma recusa de lado cheio não derruba a conexão: o jogador continua
        // espectador e escolhe o outro lado. Só a recusa de entrada fecha.
        if (this.arena === null) this.fechado = true;
        return;
      default:
        return;
    }
  }

  /** A unidade do jogador, já com a previsão local aplicada. */
  get eu(): Unidade | null {
    return this.previsao;
  }

  // --- o que o desenho pergunta (a interface `OlharLocal`) ------------------
  //
  // Uma conexão sozinha é um sofá de uma pessoa. Implementar isto aqui é o que
  // deixa o menu, o jogo solo e o sofá de quatro passarem pelo mesmo desenho.

  /** Sempre a vaga zero: uma conexão só conhece o próprio jogador. */
  vagaDe(id: number): number | null {
    return id === this.meuId ? 0 : null;
  }

  get quantosLocais(): number {
    return this.meuId === null ? 0 : 1;
  }

  previsaoDe(u: Unidade): Unidade {
    return u.id === this.meuId ? (this.previsao ?? u) : u;
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
    if (!this.visualAlvo) {
      this.visualAnterior = { x: this.previsao.x, y: this.previsao.y };
      this.visualAlvo = { x: this.previsao.x, y: this.previsao.y };
      this.visualDesde = performance.now();
    }

    const c: Comando = { ...comando, seq: ++this.seq };
    this.pendentes.push(c);
    // Fila curta: mais de meio segundo de comandos não confirmados quer dizer
    // que a conexão caiu, e reaplicar trinta comandos velhos só faz o boneco
    // deslizar para longe da verdade.
    if (this.pendentes.length > TICKS_POR_SEGUNDO / 2) this.pendentes.shift();

    if (this.previsao.vivo) moverUnidade(this.arena, this.estado, this.previsao, c, DT);
    this.atualizarPosicaoVisual();
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
    const antes = this.previsao;
    this.previsao = copia;
    // Em condições normais, reaplicar os comandos produz a mesma posição que
    // já estava na tela. Só reiniciamos a transição quando o servidor corrigiu
    // algo perceptível; fazê-lo a cada retrato era a pequena "queda de FPS"
    // sentida ao andar, embora o desenho continuasse rodando a 60 Hz.
    if (!antes || Math.hypot(antes.x - copia.x, antes.y - copia.y) > 1.5) {
      this.atualizarPosicaoVisual();
    }
  }

  /** Leva o desenho até o próximo passo previsto durante um único tick. */
  private atualizarPosicaoVisual(): void {
    if (!this.previsao) return;
    const agora = performance.now();
    const atual = this.posicaoVisual(agora);
    this.visualAnterior = atual;
    this.visualAlvo = { x: this.previsao.x, y: this.previsao.y };
    this.visualDesde = agora;
  }

  private posicaoVisual(agora: number): Retratada {
    if (!this.previsao) return { x: 0, y: 0 };
    const alvo = this.visualAlvo ?? { x: this.previsao.x, y: this.previsao.y };
    const anterior = this.visualAnterior ?? alvo;
    const alfa = Math.max(0, Math.min(1, (agora - this.visualDesde) / (DT * 1000)));
    return {
      x: anterior.x + (alvo.x - anterior.x) * alfa,
      y: anterior.y + (alvo.y - anterior.y) * alfa,
    };
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
    if (u.id === this.meuId && this.previsao) return this.posicaoVisual(agora);
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

  /** O fator de interpolação entre os dois últimos retratos. */
  alfa(agora: number): number {
    return Math.min(1.4, (agora - this.recebidoEm) / INTERVALO_DE_ENVIO);
  }

  avisar(texto: string, cor?: string): void {
    this.avisos.unshift({ texto, quando: performance.now(), ...(cor ? { cor } : {}) });
    if (this.avisos.length > 6) this.avisos.pop();
  }
}

/** Um estado zerado para o `desempacotar` preencher. */
function estadoVazio(modo: IdDoModo, porTime: number): Estado {
  const estoque = {} as Record<Time, Record<Classe, number>>;
  for (const t of TIMES) estoque[t] = { ...ESTOQUE_INICIAL };
  return {
    tick: 0,
    modo,
    porTime,
    fase: 'aquecimento',
    faseEm: 0,
    relogio: 0,
    placar: { azul: 0, vermelho: 0 },
    abates: { azul: 0, vermelho: 0 },
    unidades: [],
    baus: [],
    projeteis: [],
    itens: [],
    jazidas: [],
    animais: [],
    casasDaMoeda: [],
    oficinas: [],
    estoque,
    eventos: [],
    vencedor: null,
    proximoId: 1,
  };
}
