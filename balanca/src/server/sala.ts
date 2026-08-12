import { Bots } from '../shared/bots';
import { Navegador } from '../shared/navegacao';
import { criarPartida, type Partida } from '../shared/partida';
import { empacotar, type Comando, type DoServidor, type FichaDeJogador } from '../shared/protocolo';
import {
  DT,
  ESPERA_POR_JOGADORES,
  MAX_COMANDOS_POR_PACOTE,
  POR_TIME,
  TICKS_POR_ENVIO,
  TIMEOUT_DO_CLIENTE,
  TIMES,
  type Time,
} from '../shared/regras';

/**
 * Uma sala: uma partida rodando, os jogadores conectados e os bots que
 * completam o time.
 *
 * ## O jogo é só multiplayer, e é por isso que existe bot
 *
 * Não há modo de um jogador. Toda partida acontece nesta sala, no servidor, com
 * o mesmo tick para todo mundo — quem entra sozinho não joga um jogo diferente,
 * joga o mesmo jogo com companhia emprestada.
 *
 * A prioridade é gente. A sala **espera** `ESPERA_POR_JOGADORES` segundos antes
 * de chamar o primeiro bot: doze segundos é tempo de os amigos de alguém
 * chegarem, e chamar bot na hora garantiria que ninguém nunca esperasse por
 * ninguém. Passado esse tempo, bots completam os times, porque uma partida de
 * um contra zero não é partida.
 *
 * E, ao contrário do que costuma acontecer, o bot **cede o lugar**: quando uma
 * pessoa entra numa sala cheia de bots, o bot do time que precisa é dispensado
 * na mesma hora. Um humano nunca fica na fila atrás de uma máquina.
 *
 * ## Por que a sala simula mesmo sem ninguém olhando
 *
 * Não simula. Sem nenhum humano conectado, o loop para e a sala é recolhida
 * pelo lobby. Bots jogando sozinhos num servidor vazio é conta de nuvem paga
 * para ninguém ver.
 */

export interface Cliente {
  /** Identidade da conexão, antes de virar unidade. */
  readonly chave: string;
  nome: string;
  /** A unidade que este cliente controla, quando já entrou na partida. */
  unidade: number | null;
  /** Segundos desde a última mensagem recebida. */
  silencio: number;
  enviar(msg: DoServidor): void;
  fechar(): void;
}

export interface OpcoesDaSala {
  nome: string;
  seed: number;
  porTime?: number;
  /** Segundos antes de completar com bots. Os testes usam zero. */
  esperaPorJogadores?: number;
  /** Relógio injetável, para o teste não depender de `Date.now`. */
  agora?: () => number;
}

export class Sala {
  readonly nome: string;
  private partida: Partida;
  private navegador: Navegador;
  private bots: Bots;
  private readonly clientes = new Map<string, Cliente>();
  private readonly porTime: number;
  private readonly espera: number;
  /** Segundos sem lotação humana. É o que dispara o backfill. */
  private esperando = 0;
  private elencoSujo = true;
  private ticksAteEnviar = 0;
  private seed: number;

  constructor(opcoes: OpcoesDaSala) {
    this.nome = opcoes.nome;
    this.seed = opcoes.seed;
    this.porTime = opcoes.porTime ?? POR_TIME;
    this.espera = opcoes.esperaPorJogadores ?? ESPERA_POR_JOGADORES;
    this.partida = criarPartida(this.seed);
    this.navegador = new Navegador(this.partida.arena);
    this.bots = new Bots(this.partida.arena, this.navegador);
  }

  get estado() {
    return this.partida.estado;
  }

  get humanos(): number {
    return this.clientes.size;
  }

  get vagas(): number {
    return this.porTime * 2 - this.partida.estado.unidades.filter((u) => !u.bot).length;
  }

  get cheiaDeGente(): boolean {
    return this.vagas <= 0;
  }

  // --- entrada e saída ----------------------------------------------------

  entrar(cliente: Cliente): boolean {
    if (this.cheiaDeGente) {
      cliente.enviar({ t: 'recusado', motivo: 'sala cheia' });
      return false;
    }
    const time = this.timeParaOProximoHumano();
    // O humano tem preferência sobre o bot, e a preferência é imediata: se o
    // time escolhido está lotado de bots, um deles sai agora.
    if (this.contar(time) >= this.porTime) this.dispensarUmBot(time);

    const u = this.partida.entrar({ nome: cliente.nome, bot: false, time });
    cliente.unidade = u.id;
    cliente.silencio = 0;
    this.clientes.set(cliente.chave, cliente);
    this.elencoSujo = true;
    cliente.enviar({
      t: 'bemvindo',
      voce: u.id,
      seed: this.seed,
      sala: this.nome,
      porTime: this.porTime,
    });
    return true;
  }

  sair(chave: string): void {
    const cliente = this.clientes.get(chave);
    if (!cliente) return;
    if (cliente.unidade !== null) this.partida.sair(cliente.unidade);
    this.clientes.delete(chave);
    this.elencoSujo = true;
  }

  receber(chave: string, comando: Comando): void {
    const cliente = this.clientes.get(chave);
    if (!cliente || cliente.unidade === null) return;
    cliente.silencio = 0;
    this.partida.comandar(cliente.unidade, saneado(comando));
  }

  tocar(chave: string): void {
    const cliente = this.clientes.get(chave);
    if (cliente) cliente.silencio = 0;
  }

  // --- o loop -------------------------------------------------------------

  /** Um tick de simulação. O servidor chama trinta vezes por segundo. */
  passo(): void {
    this.expirarClientes();
    this.cuidarDosBots();
    this.bots.pensar(this.partida);
    this.partida.passo();
    this.reiniciarSeAcabou();

    if (this.elencoSujo) {
      this.transmitir({ t: 'elenco', jogadores: this.elenco() });
      this.elencoSujo = false;
    }
    if (--this.ticksAteEnviar <= 0) {
      this.ticksAteEnviar = TICKS_POR_ENVIO;
      this.transmitir({ t: 'retrato', r: empacotar(this.partida.estado) });
    }
  }

  private expirarClientes(): void {
    for (const [chave, c] of [...this.clientes]) {
      c.silencio += DT;
      if (c.silencio <= TIMEOUT_DO_CLIENTE) continue;
      c.fechar();
      this.sair(chave);
    }
  }

  /**
   * Chama bot quando falta gente, e dispensa bot quando gente chega.
   *
   * A contagem é por time, não por sala: seis contra três com o total certo
   * ainda é uma partida quebrada, e é o erro que aparece quando se conta só o
   * tamanho da sala.
   */
  private cuidarDosBots(): void {
    const faltaHumano = this.vagas > 0;
    this.esperando = faltaHumano ? this.esperando + DT : 0;

    for (const time of TIMES) {
      const total = this.contar(time);
      const humanos = this.contarHumanos(time);

      // Gente demais para os bots que estão em campo: alguém tem de sair.
      if (total > this.porTime) {
        this.dispensarUmBot(time);
        continue;
      }
      if (total >= this.porTime) continue;
      // Ninguém jogando neste servidor: não há partida para completar.
      if (this.clientes.size === 0) continue;
      // Enquanto a espera não venceu, a vaga fica aberta para uma pessoa. A
      // exceção é o time sem nenhum humano: um jogador sozinho contra o vazio
      // não tem jogo nenhum, e esperar por doze segundos ali é só tela parada.
      if (this.esperando < this.espera && humanos > 0) continue;

      const u = this.partida.entrar({ nome: nomeDeBot(this.partida.estado.proximoId), bot: true, time });
      this.bots.adotar(u.id);
      this.elencoSujo = true;
    }
  }

  private dispensarUmBot(time: Time): void {
    // Sai o bot que menos vai fazer falta: nunca o que está com a princesa no
    // colo, e de preferência um que esteja morto — assim ninguém vê alguém
    // sumir no meio do campo.
    const candidatos = this.partida.estado.unidades.filter(
      (u) => u.bot && u.time === time && u.carga !== 'princesa',
    );
    if (candidatos.length === 0) return;
    const escolhido = candidatos.find((u) => !u.vivo) ?? candidatos[0]!;
    this.bots.esquecer(escolhido.id);
    this.partida.sair(escolhido.id);
    this.elencoSujo = true;
  }

  private timeParaOProximoHumano(): Time {
    // Equilibra por **humanos**, não por unidades: um time com cinco bots e um
    // com cinco pessoas têm o mesmo tamanho e não têm o mesmo peso.
    const azul = this.contarHumanos('azul');
    const vermelho = this.contarHumanos('vermelho');
    if (azul !== vermelho) return azul < vermelho ? 'azul' : 'vermelho';
    return this.contar('azul') <= this.contar('vermelho') ? 'azul' : 'vermelho';
  }

  private contar(time: Time): number {
    return this.partida.estado.unidades.filter((u) => u.time === time).length;
  }

  private contarHumanos(time: Time): number {
    return this.partida.estado.unidades.filter((u) => u.time === time && !u.bot).length;
  }

  /**
   * Depois do fim, a sala não morre: monta a próxima partida com quem ficou.
   *
   * Voltar para um menu esvazia servidor. O que segura uma sala viva é o
   * próximo jogo já estar começando quando o placar apaga.
   */
  private reiniciarSeAcabou(): void {
    const estado = this.partida.estado;
    if (estado.fase !== 'fim') return;
    // Deixa o placar final na tela por alguns segundos antes de recomeçar.
    estado.faseEm -= DT;
    if (estado.faseEm > -8) return;

    const antigos = [...this.clientes.values()];
    this.seed = (this.seed * 1103515245 + 12345) >>> 0;
    this.partida = criarPartida(this.seed);
    this.navegador = new Navegador(this.partida.arena);
    this.bots = new Bots(this.partida.arena, this.navegador);
    this.esperando = 0;

    for (const c of antigos) {
      const u = this.partida.entrar({ nome: c.nome, bot: false });
      c.unidade = u.id;
      c.enviar({
        t: 'bemvindo',
        voce: u.id,
        seed: this.seed,
        sala: this.nome,
        porTime: this.porTime,
      });
    }
    this.elencoSujo = true;
  }

  private elenco(): FichaDeJogador[] {
    return this.partida.estado.unidades.map((u) => ({
      id: u.id,
      nome: u.nome,
      time: u.time,
      bot: u.bot,
    }));
  }

  private transmitir(msg: DoServidor): void {
    for (const c of this.clientes.values()) c.enviar(msg);
  }
}

/** Um comando de fora nunca é confiado: tudo é cortado para a faixa válida. */
function saneado(c: Comando): Comando {
  const num = (v: unknown): number => {
    const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
    return Math.max(-1, Math.min(1, n));
  };
  return {
    seq: Math.max(0, Math.min(2 ** 31, Math.trunc(Number(c.seq) || 0))),
    mx: num(c.mx),
    my: num(c.my),
    ax: num(c.ax),
    ay: num(c.ay),
    atacar: c.atacar === true,
    usar: c.usar === true,
  };
}

export { MAX_COMANDOS_POR_PACOTE };

const NOMES_DE_BOT = [
  'Bartolomeu', 'Genoveva', 'Ludovico', 'Filipa', 'Anselmo', 'Berengária',
  'Godofredo', 'Urraca', 'Teobaldo', 'Sancha', 'Rodolfo', 'Ermesinda',
];

function nomeDeBot(n: number): string {
  return NOMES_DE_BOT[n % NOMES_DE_BOT.length]!;
}
