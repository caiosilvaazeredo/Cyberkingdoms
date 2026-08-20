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
  /**
   * A unidade que este cliente controla, ou `null` enquanto ele só assiste.
   *
   * Espectador não é um estado de erro: é por onde todo mundo entra. Quem
   * acabou de conectar está na tela de escolha de time, vendo a partida correr
   * e decidindo de que lado entra.
   */
  unidade: number | null;
  /** O lado escolhido. Sobrevive ao fim da partida e vale na próxima. */
  time: Time | null;
  /**
   * Está só olhando: chegou pelo menu, que mostra a partida ao vivo atrás do
   * título. Quem assiste **não ocupa vaga** — uma aba esquecida aberta não pode
   * tirar o lugar de quem quer jogar. Deixa de assistir ao escolher um lado.
   */
  assistindo: boolean;
  /** Segundos desde a última mensagem recebida. */
  silencio: number;
  enviar(msg: DoServidor): void;
  fechar(): void;
}

/** Espectadores por sala. Plateia também custa banda: um retrato cada. */
const TETO_DE_ESPECTADORES = 24;

export interface OpcoesDaSala {
  nome: string;
  seed: number;
  /**
   * Sala do sofá: o lobby não manda estranhos para cá.
   *
   * A sala não muda de comportamento por ser privada — os bots completam os
   * times do mesmo jeito. O que muda é só quem o lobby deixa entrar, e por isso
   * a marca vive aqui em vez de virar um segundo tipo de sala.
   */
  privada?: boolean;
  porTime?: number;
  /** Segundos antes de completar com bots. Os testes usam zero. */
  esperaPorJogadores?: number;
  /** Relógio injetável, para o teste não depender de `Date.now`. */
  agora?: () => number;
}

export class Sala {
  readonly nome: string;
  readonly privada: boolean;
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
    this.privada = opcoes.privada ?? false;
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

  /**
   * Vagas de **gente**, contando quem já está em campo e quem está escolhendo.
   *
   * Espectador ocupa vaga. Sem isso, vinte pessoas entrariam numa sala de doze,
   * escolheriam o lado e onze seriam recusadas depois de já terem visto a tela
   * de escolha — que é o pior momento possível para dizer "não cabe".
   */
  get vagas(): number {
    const emCampo = this.partida.estado.unidades.filter((u) => !u.bot).length;
    const escolhendo = [...this.clientes.values()].filter(
      (c) => c.unidade === null && !c.assistindo,
    ).length;
    return this.porTime * 2 - emCampo - escolhendo;
  }

  /** Quantos estão só olhando o menu. Diagnóstico e o teto de espectadores. */
  get assistindo(): number {
    return [...this.clientes.values()].filter((c) => c.assistindo).length;
  }

  get cheiaDeGente(): boolean {
    return this.vagas <= 0;
  }

  /** Quantos humanos cada lado tem, para a tela de escolha mostrar. */
  vagasDoTime(time: Time): number {
    return this.porTime - this.contarHumanos(time);
  }

  // --- entrada e saída ----------------------------------------------------

  /**
   * Aceita a conexão como espectador. A unidade só nasce em `escolher`.
   *
   * Quem chega assistindo entra mesmo com a sala cheia de jogadores — é o menu
   * mostrando a partida, e recusar isso deixaria um fundo cinza no lugar do
   * jogo. O teto de espectadores existe porque simular para plateia custa banda:
   * cada um recebe quinze retratos por segundo como qualquer jogador.
   */
  entrar(cliente: Cliente, assistindo = false): boolean {
    if (assistindo && this.assistindo >= TETO_DE_ESPECTADORES) {
      cliente.enviar({ t: 'recusado', motivo: 'plateia cheia' });
      return false;
    }
    if (!assistindo && this.cheiaDeGente) {
      cliente.enviar({ t: 'recusado', motivo: 'sala cheia' });
      return false;
    }
    cliente.unidade = null;
    cliente.time = null;
    cliente.assistindo = assistindo;
    cliente.silencio = 0;
    this.clientes.set(cliente.chave, cliente);
    cliente.enviar({
      t: 'bemvindo',
      seed: this.seed,
      sala: this.nome,
      porTime: this.porTime,
    });
    // O elenco vai na hora: a tela de escolha precisa saber quem já está de que
    // lado antes do primeiro retrato chegar.
    cliente.enviar({ t: 'elenco', jogadores: this.elenco() });
    return true;
  }

  /**
   * O espectador escolhe o lado e entra em campo.
   *
   * O time pedido é respeitado sempre que couber gente nele. Não cabendo, a
   * escolha é recusada com o motivo — e não silenciosamente trocada pelo outro
   * lado, que é a forma mais rápida de alguém achar que o jogo ignorou o clique.
   */
  escolher(chave: string, time: Time): boolean {
    const cliente = this.clientes.get(chave);
    if (!cliente) return false;
    if (cliente.unidade !== null) return false;
    // Escolher um lado é parar de assistir: a partir daqui a pessoa ocupa vaga.
    cliente.assistindo = false;
    if (this.contarHumanos(time) >= this.porTime) {
      cliente.assistindo = true;
      cliente.enviar({ t: 'recusado', motivo: 'esse lado está cheio de gente' });
      return false;
    }
    // O humano tem preferência sobre o bot, e a preferência é imediata: se o
    // time escolhido está lotado de bots, um deles sai agora.
    if (this.contar(time) >= this.porTime) this.dispensarUmBot(time);

    const u = this.partida.entrar({ nome: cliente.nome, bot: false, time });
    cliente.unidade = u.id;
    cliente.time = time;
    this.elencoSujo = true;
    cliente.enviar({ t: 'nasceu', voce: u.id, time });
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
      this.bots.adotar(u.id, time);
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
      c.enviar({ t: 'bemvindo', seed: this.seed, sala: this.nome, porTime: this.porTime });
      // Quem estava jogando volta para o mesmo lado, sem passar pela tela de
      // escolha de novo: trocar de time entre partidas é decisão do jogador,
      // não uma pergunta que o servidor faz a cada dez minutos.
      if (c.time === null) {
        c.unidade = null;
        continue;
      }
      const u = this.partida.entrar({ nome: c.nome, bot: false, time: c.time });
      c.unidade = u.id;
      c.enviar({ t: 'nasceu', voce: u.id, time: c.time });
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
