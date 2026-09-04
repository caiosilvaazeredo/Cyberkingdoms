import { Sala, type Cliente } from './sala';
import type { IdDoMapa } from '../shared/mapas';
import type { IdDoModo } from '../shared/modos';
import type { ConfiguracaoDeSala } from '../shared/protocolo';
import { DT, TICKS_POR_SEGUNDO } from '../shared/regras';

/**
 * O lobby: quantas salas existem, e em qual delas cada pessoa cai.
 *
 * ## A regra que resume o jogo inteiro
 *
 * **Juntar gente.** Quem entra vai para a sala que já tem mais humanos e ainda
 * cabe. Espalhar por salas vazias daria a cada um um servidor particular cheio
 * de bot — que é exatamente o jogo que este não quer ser. Sala nova só nasce
 * quando todas as que existem estão cheias de gente.
 *
 * ## As duas exceções, e por que existem
 *
 * **Sala pedida pelo nome.** Quatro pessoas no mesmo sofá abrem quatro
 * conexões, e "a sala mais cheia de gente" não promete colocá-las juntas — o
 * primeiro jogador pode ser justamente quem lotou a sala. Então quem chega
 * depois pede a sala do anfitrião pelo nome. Ela ainda pode recusar por estar
 * cheia, mas aí a recusa é a verdade, e não um sorteio que separou a turma.
 *
 * **Sala privada.** É o "jogo local": nasce reservada e o lobby nunca manda
 * um estranho para ela. O time se completa com bot, como em qualquer sala com
 * vaga sobrando — a diferença é só quem *não* entra.
 *
 * ## Por que um relógio só para todas as salas
 *
 * Cada sala com o próprio `setInterval` significa N temporizadores disputando o
 * mesmo laço de eventos, e o atraso de um vira o atraso de todos de um jeito
 * difícil de enxergar. Um relógio só, chamando as salas em ordem, deixa o custo
 * de um tick visível num lugar só: se o servidor atrasar, dá para dizer em que
 * sala foi.
 */

export interface SalaNaLista {
  nome: string;
  humanos: number;
  vagas: number;
  modo: IdDoModo;
  /** O mapa fixo da sala, ou `'sorteio'` se ela troca a cada partida. */
  mapa: IdDoMapa | 'sorteio';
  porTime: number;
  /** Npcs fixos por time. Zero quando os bots são o tapa-buraco do lobby. */
  bots: number;
}

export interface PedidoDeEntrada {
  /** Chegou pelo menu, só para ver. Não ocupa vaga. */
  assistindo?: boolean;
  /** Entrar nesta sala pelo nome — é assim que o sofá inteiro cai junto. */
  sala?: string;
  /** Abrir uma sala reservada a este aparelho. Ignorado se `sala` foi pedida. */
  privada?: boolean;
  /**
   * Abrir uma sala **com estas regras** — modo, vagas de gente e npcs por time.
   *
   * Já saneada: quem chama passa o resultado de `salaConfiguravel`, e o lobby
   * confia nela. É a terceira exceção à regra de juntar gente, e a mais
   * explícita das três: uma sala montada existe porque alguém escolheu aquelas
   * regras, e mandar essa pessoa para a sala mais cheia seria ignorar o pedido.
   */
  criar?: Required<ConfiguracaoDeSala>;
}

export interface OpcoesDoLobby {
  /** Quantas salas no máximo. Protege a máquina de um pico de entradas. */
  maxSalas?: number;
  porTime?: number;
  esperaPorJogadores?: number;
  /** Fonte de seeds, injetável para o teste ser reprodutível. */
  seed?: () => number;
}

export class Lobby {
  private readonly salas: Sala[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly maxSalas: number;
  private readonly porTime: number | undefined;
  private readonly espera: number | undefined;
  private readonly seed: () => number;
  private contador = 0;
  /** Ticks acumulados que ainda não foram simulados. */
  private atraso = 0;
  private ultimo = 0;

  constructor(opcoes: OpcoesDoLobby = {}) {
    this.maxSalas = opcoes.maxSalas ?? 8;
    this.porTime = opcoes.porTime;
    this.espera = opcoes.esperaPorJogadores;
    this.seed = opcoes.seed ?? (() => (Math.random() * 0xffffffff) >>> 0);
  }

  get quantidade(): number {
    return this.salas.length;
  }

  /**
   * O que o `/salas` mostra. Sala privada é de quem a abriu e não vai na lista.
   *
   * Leva o modo e os tamanhos porque a lista existe para alguém **escolher**
   * uma sala, e "reino-4 · 3 jogando" não dá base para escolha nenhuma. Com o
   * modo e o formato, a linha responde a pergunta que a pessoa realmente tem:
   * é o jogo que eu quero jogar, e ainda cabe gente?
   */
  get lista(): SalaNaLista[] {
    return this.salas
      .filter((s) => !s.privada)
      .map((s) => ({
        nome: s.nome,
        humanos: s.humanos,
        vagas: s.vagas,
        modo: s.modo,
        mapa: s.escolhaDeMapa,
        porTime: s.porTime,
        bots: s.botsFixos ?? 0,
      }));
  }

  /**
   * Coloca o cliente na sala mais cheia de gente que ainda tem vaga.
   *
   * Quem chega **assistindo** vai para a sala mais movimentada, cheia ou não: o
   * menu quer mostrar a partida com mais gente, que é a mais interessante de
   * ver, e plateia não tira o lugar de ninguém.
   *
   * O segundo parâmetro aceita `true` como atalho para "só assistindo", que é
   * de longe o caso mais comum e o que o menu usa.
   */
  acolher(cliente: Cliente, pedido: PedidoDeEntrada | boolean = {}): Sala | null {
    const p: PedidoDeEntrada = typeof pedido === 'boolean' ? { assistindo: pedido } : pedido;
    const assistindo = p.assistindo === true;

    if (p.sala !== undefined) {
      const pedida = this.salas.find((s) => s.nome === p.sala);
      if (!pedida) {
        // Acontece de verdade: a sala do anfitrião pode ter acabado enquanto o
        // segundo jogador do sofá abria a conexão. Dizer isso é melhor do que
        // espalhar a turma por salas diferentes sem avisar.
        cliente.enviar({ t: 'recusado', motivo: 'a sala do anfitrião não existe mais' });
        return null;
      }
      if (!pedida.entrar(cliente, assistindo)) return null;
      return pedida;
    }

    // Sala montada: as regras vieram de quem está entrando.
    if (p.criar) {
      const feita = this.abrirSala(p.criar.privada, p.criar);
      if (!feita) {
        cliente.enviar({ t: 'recusado', motivo: 'o servidor está cheio — tente daqui a pouco' });
        return null;
      }
      return feita.entrar(cliente, assistindo) ? feita : null;
    }

    const nova = p.privada === true ? this.abrirSala(true) : null;
    if (p.privada === true && !nova) {
      cliente.enviar({ t: 'recusado', motivo: 'o servidor está cheio — tente o jogo online' });
      return null;
    }
    const candidatas = nova
      ? [nova]
      : this.salas
          .filter((s) => !s.privada && (assistindo || !s.cheiaDeGente))
          .sort((a, b) => b.humanos - a.humanos);
    const escolhida = candidatas[0] ?? this.abrirSala();
    if (!escolhida) {
      cliente.enviar({ t: 'recusado', motivo: 'todas as salas cheias' });
      return null;
    }
    if (!escolhida.entrar(cliente, assistindo)) return null;
    return escolhida;
  }

  private abrirSala(privada = false, feita?: Required<ConfiguracaoDeSala>): Sala | null {
    if (this.salas.length >= this.maxSalas) return null;
    const sala = new Sala({
      nome: `${feita ? 'mesa' : privada ? 'sofá' : 'reino'}-${++this.contador}`,
      seed: this.seed(),
      privada,
      // A configuração do anfitrião vence os padrões do lobby. Ela vem depois na
      // ordem de propósito: é a última palavra.
      ...(feita
        ? {
            modo: feita.modo,
            mapa: feita.mapa,
            porTime: feita.porTime,
            botsPorTime: feita.bots,
            campanha: feita.campanha,
          }
        : {}),
      ...(this.porTime !== undefined && !feita ? { porTime: this.porTime } : {}),
      // A espera existe para dar tempo de os amigos de alguém chegarem pela
      // rede. Na sala do sofá não vem ninguém pela rede: os amigos já estão na
      // sala, e segurar doze segundos de tela parada seria esperar por
      // ninguém.
      ...(privada
        ? { esperaPorJogadores: 0 }
        : this.espera !== undefined
          ? { esperaPorJogadores: this.espera }
          : {}),
    });
    this.salas.push(sala);
    return sala;
  }

  /**
   * Simula um tick de cada sala com gente, e recolhe as vazias.
   *
   * Sala sem humano é desmontada na hora: o estado dela não vale nada — a
   * próxima pessoa a entrar quer uma partida do começo, não o meio de uma
   * partida que doze bots jogaram sozinhos.
   */
  passo(): void {
    for (const sala of [...this.salas]) {
      if (sala.humanos === 0) {
        this.salas.splice(this.salas.indexOf(sala), 1);
        continue;
      }
      sala.passo();
    }
  }

  /**
   * Consome tempo real e roda os ticks que couberem nele.
   *
   * Devolve quantos rodou, que é o que torna o relógio testável sem esperar em
   * tempo real.
   */
  avancar(segundos: number): number {
    this.atraso += segundos;
    // Teto de cinco ticks: se a máquina travou por dois segundos, adiantar
    // sessenta de uma vez teleportaria todo mundo. Melhor perder tempo de jogo
    // do que perder a coerência do que aconteceu.
    let quantos = 0;
    while (this.atraso >= DT && quantos < 5) {
      this.passo();
      this.atraso -= DT;
      quantos++;
    }
    if (quantos === 5) this.atraso = 0;
    return quantos;
  }

  /**
   * Liga o relógio.
   *
   * ## Por que o temporizador dispara mais rápido que o tick
   *
   * O passo do jogo é 33,33 ms, e `setInterval` só aceita milissegundos
   * inteiros: pedir `1000/30` agenda 33 ms. Trinta e três é **menos** que o
   * passo, então cada disparo acumularia 0,033 s de um passo que exige 0,0333 —
   * e nunca fecharia. O jogo rodaria a meia velocidade, com o relógio da
   * partida andando na metade do relógio de parede, e nada no código pareceria
   * errado.
   *
   * A saída é desacoplar as duas coisas: o temporizador dispara mais rápido do
   * que o necessário e quem manda é o acumulador de tempo real. Com 16 ms, cada
   * disparo entrega meio passo, e os passos saem na hora certa.
   */
  ligar(): void {
    if (this.timer) return;
    this.ultimo = Date.now();
    this.timer = setInterval(() => {
      const agora = Date.now();
      const passado = (agora - this.ultimo) / 1000;
      this.ultimo = agora;
      this.avancar(passado);
    }, Math.max(4, Math.floor(1000 / TICKS_POR_SEGUNDO / 2)));
  }

  desligar(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}
