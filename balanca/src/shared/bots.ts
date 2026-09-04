import { CLASSES_COM_CHAPEU, perfil, type Classe } from './classes';
import { bauDe, unidade, type Estado, type Unidade } from './estado';
import type { Arena } from './arena';
import { MODO_PADRAO, modoDe, type IdDoModo } from './modos';
import type { Navegador } from './navegacao';
import type { Partida } from './partida';
import { enxerga } from './partida';
import type { Comando } from './protocolo';
import {
  ALCANCE_DE_AJUDA,
  ALCANCE_DE_COLETA,
  CUSTO_DO_NIVEL,
  DT,
  NIVEL_MAXIMO,
  custoDaObraDe,
  pesoMaximoDe,
  carregadoresPara,
  outroTime,
  type Time,
} from './regras';

/**
 * Os bots, que existem para que a partida comece sem esperar por doze pessoas.
 *
 * ## O que um bot é, aqui
 *
 * Um bot é um jogador que o servidor controla: mesma unidade, mesmas regras,
 * mesmo `Comando`. Ele não enxerga o estado por baixo do pano nem ignora o
 * fosso — anda pelo mesmo campo de distância, mira com o mesmo vetor, apanha
 * do mesmo jeito. Isso não é escrúpulo: um bot que trapaceia é um bot que não
 * dá para balancear, porque a dificuldade dele deixa de ser feita das mesmas
 * peças que a do jogador.
 *
 * ## Três papéis, e o resto é reação
 *
 * Cozinheiro sustenta a balança, atacante empurra o resgate, defensor segura a
 * cofre. Sobre isso vêm as urgências, que valem para qualquer papel: quem
 * está carregando o baú vai para casa, quem vê o baú do próprio time
 * no chão corre para pegá-la, e quem vê o cortejo travado por falta de escolta
 * larga o que estava fazendo e vai empurrar.
 *
 * A urgência vem antes do papel porque é assim que um time humano joga: ninguém
 * continua colhendo trigo enquanto o baú passa carregado na frente.
 *
 * ## Por que o bot demora a atirar
 *
 * Um bot que mira por vetor acerta sempre, e um arqueiro que acerta sempre é
 * insuportável. `ESPERA_PARA_MIRAR` dá ao alvo o tempo de reação que uma pessoa
 * gastaria — é o que transforma "impossível de flanquear" em "dá para chegar
 * perto se você for rápido".
 */

export type Papel = 'cozinheiro' | 'atacante' | 'defensor';

/**
 * Como o time se divide, por modo. Seis bots percorrem o rodízio em ciclo.
 *
 * Isto existe porque um bot que ignora a condição de vitória do modo é um bot
 * que não joga aquele modo — e foi o que a medição mostrou. No **Obra**, em que
 * vence quem terminar a chapelaria, o rodízio clássico põe **um** bot por time
 * na economia, e a obra empacava no nível dois: as três partidas medidas saíram
 * idênticas às do modo clássico, decididas por resgate, com a vitória do modo
 * nunca disparando. No **Abate**, em que só a briga conta, dois dos seis
 * ficavam cunhando uma bolsa que não decide nada.
 *
 * O rodízio não é uma estratégia ótima e não pretende ser: é a divisão de
 * trabalho que faz o time perseguir o objetivo **daquele** modo em vez do
 * objetivo de outro.
 */
const RODIZIO_CLASSICO: readonly Papel[] = ['atacante', 'cozinheiro', 'defensor'];
const RODIZIOS: Partial<Record<IdDoModo, readonly Papel[]>> = {
  // Metade do time na picareta: sem isso a obra não sai do lugar.
  obra: ['cozinheiro', 'atacante', 'cozinheiro', 'defensor'],
  // Ninguém Casa da Moeda: no Abate a bolsa não vale ponto nenhum.
  abate: ['atacante', 'atacante', 'defensor'],
};

const rodizioDe = (modo: IdDoModo): readonly Papel[] => RODIZIOS[modo] ?? RODIZIO_CLASSICO;

/**
 * Os ofícios, na ordem em que um time deve preenchê-los.
 *
 * O **primeiro** cozinheiro de cada time é saqueador e não muda mais: minério é a
 * única entrada do bolsa, e a bolsa é o que move a balança — se ninguém caçar por
 * princípio, o time perde o diferencial do jogo enquanto constrói uma obra
 * bonita. Do segundo em diante o ofício é escolhido pela falta: madeira ou ouro,
 * o que estiver travando o próximo nível.
 */
const OFICIOS: readonly Classe[] = ['saqueador', 'lenhador', 'minerador'];

/** Segundos entre ver o alvo e conseguir atirar nele. */
const ESPERA_PARA_MIRAR = 0.3;

/** Vida abaixo desta fração manda o bot comer a bolsa em vez de entregá-lo. */
const VIDA_PARA_COMER = 0.35;

/** Distância a partir da qual o totem do Modo Fera deixa de valer o desvio. */
const RAIO_DE_INTERESSE_NO_TOTEM = 700;

/** Distância a partir da qual o Guardião do Modo Covil deixa de valer o desvio. */
const RAIO_DE_INTERESSE_NO_GUARDIAO = 900;

/** Distância a partir da qual a Presa do Modo Caça deixa de valer o desvio — menor que o Guardião: ela nasce o dobro das vezes e recompensa menos. */
const RAIO_DE_INTERESSE_NA_PRESA = 650;

interface Memoria {
  papel: Papel;
  /** A classe que este bot quer vestir. `null` para quem briga. */
  oficio: Classe | null;
  /**
   * O temperamento deste bot, de 0 a 1.
   *
   * Existe para quebrar o passo. Sem ele, dois times de bots num mapa espelhado
   * tomam decisões idênticas no mesmo tick e a partida vira uma coreografia:
   * os dois baús saem do cofre juntas, os dois cortejos travam juntos,
   * e o placar termina zero a zero por construção. Um número derivado do id —
   * determinístico, sem sorteio — dá a cada um a sua pressa e o seu recuo, e o
   * empate volta a ser uma coisa que acontece, não uma consequência da simetria.
   */
  tempero: number;
  /** Segundos com o alvo atual na mira. */
  mirando: number;
  alvo: number | null;
  /** Ticks restantes segurando o botão de usar. */
  usarPor: number;
  /** Segundos até poder apertar usar de novo. Evita martelar a chapelaria. */
  esperaDoUsar: number;
  /**
   * O ofício veio de uma ordem do time, e não da conta do próprio bot.
   *
   * Separado de `fixo` porque as duas coisas dizem respeito a momentos
   * diferentes: `fixo` impede a revisão automática, e isto manda o bot **ir
   * buscar** o chapéu mesmo não sendo da economia.
   */
  ordenado: boolean;
  /** Segundos até rever o ofício. Dá inércia à troca de chapéu. */
  esperaDoOficio: number;
  /** Ofício que não se revê. É o saqueador de plantão de cada time. */
  fixo: boolean;
}

export class Bots {
  private readonly memorias = new Map<number, Memoria>();
  private readonly cozinheiros = new Map<Time, number>();
  /**
   * Onde cada time está no rodízio. **Por time**, e não um contador só.
   *
   * Com um contador global e os bots entrando alternados — azul, vermelho,
   * azul... — a paridade decide a composição: um rodízio de tamanho par dá
   * todos os papéis das posições pares a um time e os das ímpares ao outro. O
   * rodízio clássico tem três posições e por acaso escapava disso; o do modo
   * Obra tem quatro, e o azul saía com **os três cozinheiros**, terminava a
   * chapelaria em noventa segundos e vencia as três partidas medidas.
   *
   * Contando por time, cada um percorre o mesmo ciclo desde o começo, e a
   * composição deixa de depender da ordem em que o servidor chamou os bots.
   */
  private readonly proximoPapel = new Map<Time, number>();

  constructor(
    private readonly arena: Arena,
    private readonly navegador: Navegador,
  ) {}

  /**
   * @param modo o que decide a partida, e por isso o que decide a divisão de
   * trabalho do time. Ver `RODIZIOS`.
   */
  adotar(id: number, time: Time, modo: IdDoModo = MODO_PADRAO, papel?: Papel): Papel {
    const rodizio = rodizioDe(modo);
    const passo = this.proximoPapel.get(time) ?? 0;
    this.proximoPapel.set(time, passo + 1);
    const escolhido = papel ?? rodizio[passo % rodizio.length]!;
    let oficio: Classe | null = null;
    let fixo = false;
    if (escolhido === 'cozinheiro') {
      const quantos = this.cozinheiros.get(time) ?? 0;
      this.cozinheiros.set(time, quantos + 1);
      oficio = OFICIOS[Math.min(quantos, OFICIOS.length - 1)]!;
      // O saqueador do time é fixo — minério é a única entrada do bolsa, e sem ele o
      // time perde o diferencial do jogo enquanto constrói uma obra bonita.
      //
      // No Obra não: ali a bolsa não decide nada, e um saqueador fixo é justamente
      // o bot que faltava na jazida. Todos trocam de ofício conforme a falta.
      fixo = quantos === 0 && !modoDe(modo).vitoriaPorObra;
    }
    this.memorias.set(id, vazia(escolhido, id, oficio, fixo));
    return escolhido;
  }

  /**
   * O time mandou este npc vestir uma classe.
   *
   * A ordem **fixa** o ofício: sem isso, o bot que revê a escolha a cada doze
   * segundos trocaria o arco pela picareta assim que a obra sentisse falta de
   * ouro, e o líder veria a ordem dele ser desfeita sozinha. Uma ordem do time
   * vale mais que a heurística do bot — é a pessoa que sabe por que quer um
   * arqueiro naquela ponte.
   *
   * Quem obedece é o `planoDoCozinheiro`, que já sabe ir à chapelaria buscar o
   * chapéu do ofício. Um bot atacante que recebe ordem vira, para efeito de
   * chapéu, alguém com um ofício a cumprir — e volta a atacar assim que estiver
   * vestido, porque o papel dele não mudou.
   */
  mandarVestir(id: number, classe: Classe): void {
    const m = this.memorias.get(id);
    if (!m) return;
    m.oficio = classe;
    m.fixo = true;
    m.ordenado = true;
    m.esperaDoOficio = 0;
  }

  esquecer(id: number): void {
    this.memorias.delete(id);
  }

  papelDe(id: number): Papel | null {
    return this.memorias.get(id)?.papel ?? null;
  }

  /** Escreve o comando de cada bot vivo. Chamar uma vez por tick. */
  pensar(partida: Partida): void {
    for (const u of partida.estado.unidades) {
      if (!u.bot) continue;
      const memoria = this.memorias.get(u.id) ?? vazia(this.adotar(u.id, u.time), u.id, null, false);
      this.memorias.set(u.id, memoria);
      partida.comandar(u.id, this.decidir(partida.estado, u, memoria));
    }
  }

  private decidir(estado: Estado, u: Unidade, m: Memoria): Comando {
    const parado: Comando = { seq: 0, mx: 0, my: 0, ax: 0, ay: 0, atacar: false, usar: false };
    if (!u.vivo || estado.fase === 'fim') {
      m.usarPor = 0;
      return parado;
    }
    m.esperaDoUsar = Math.max(0, m.esperaDoUsar - DT);

    const plano = this.planejar(estado, u, m);
    const cmd: Comando = { ...parado };

    if (plano.destino) {
      const d = this.navegador.direcao(u.x, u.y, plano.destino.x, plano.destino.y);
      if (d) {
        cmd.mx = d.x;
        cmd.my = d.y;
      }
      // Chegou: para de empurrar o destino para não ficar tremendo em cima
      // dele, que é o que faz um bot parecer quebrado mesmo fazendo tudo certo.
      if (Math.hypot(plano.destino.x - u.x, plano.destino.y - u.y) < plano.folga) {
        cmd.mx = 0;
        cmd.my = 0;
      }
    }

    const combate = this.combater(estado, u, m);
    if (combate) {
      cmd.ax = combate.ax;
      cmd.ay = combate.ay;
      cmd.atacar = combate.atacar;
      if (combate.recuar && plano.podeRecuar) {
        cmd.mx = -combate.ax;
        cmd.my = -combate.ay;
      }
    }

    // Chegou no que queria usar: para de andar. Sem isto o bot passa reto
    // apertando o botão, e no caso da colheita — que o servidor cancela a
    // qualquer passo — ele recomeça o trigo para sempre sem nunca terminar.
    if (plano.usar) {
      cmd.mx = 0;
      cmd.my = 0;
    }

    // Colhendo: fica parado e não aperta de novo, porque apertar reiniciaria a
    // colheita do zero. Atacar continua permitido — se alguém chegar perto, o
    // trigo pode esperar.
    if (u.colhendoId !== null) {
      cmd.mx = 0;
      cmd.my = 0;
      return { ...cmd, usar: false };
    }

    // O `usar` é de borda no servidor: precisa descer antes de subir de novo.
    // Segurar por dois ticks é o suficiente para o comando não se perder entre
    // um tick e outro, e curto o bastante para não repetir a ação sem querer.
    if (m.usarPor > 0) {
      cmd.usar = true;
      m.usarPor--;
    } else if (plano.usar && m.esperaDoUsar <= 0) {
      cmd.usar = true;
      m.usarPor = 1;
      // O intervalo entre dois usos também é temperado: é o que faz dois
      // cozinheiros espelhados deixarem de entregar o depósito no mesmo tick, e a
      // balança sair do meio em vez de se anular a cada tick.
      m.esperaDoUsar = 0.35 + m.tempero * 0.4;
    }
    return cmd;
  }

  /** Para onde ir e se aperta o botão de contexto ao chegar. */
  private planejar(
    estado: Estado,
    u: Unidade,
    m: Memoria,
  ): { destino: { x: number; y: number } | null; usar: boolean; folga: number; podeRecuar: boolean } {
    const meu = u.time;
    const inimigo = outroTime(meu);
    const minha = bauDe(estado, meu);
    const refem = bauDe(estado, inimigo);
    const ir = (
      destino: { x: number; y: number } | null,
      usar = false,
      folga = 0,
      podeRecuar = false,
    ): { destino: { x: number; y: number } | null; usar: boolean; folga: number; podeRecuar: boolean } => ({
      destino,
      usar,
      folga,
      podeRecuar,
    });

    // --- urgências, válidas para qualquer papel ---------------------------

    if (u.carga === 'bau') {
      const tesouraria = this.arena.estrutura('tesouraria', meu);
      return ir(tesouraria, this.chegou(u, tesouraria, ALCANCE_DE_COLETA * 0.7));
    }

    if (minha.onde === 'carregado' && minha.portador !== u.id) {
      const portador = unidade(estado, minha.portador);
      if (portador) {
        const faltaAjuda = minha.ajudantes + 1 < carregadoresPara(minha.peso, estado.porTime);
        if (faltaAjuda || m.papel !== 'cozinheiro') {
          // Encostar no cortejo é o que destrava o peso. A folga é a metade do
          // alcance de ajuda para o bot não ficar na borda, onde uma passada em
          // falso já derruba a conta de carregadores.
          return ir(portador, false, ALCANCE_DE_AJUDA * 0.5, true);
        }
      }
    }

    if (minha.onde === 'chao') {
      return ir(minha, this.chegou(u, minha, ALCANCE_DE_COLETA * 0.8), 0, false);
    }

    // A ordem do time entra **aqui**: depois do que o próprio npc está
    // segurando, antes de perseguir o ladrão da refém.
    //
    // A posição foi medida, não escolhida no papel. Embaixo da perseguição, uma
    // ordem dada com a refém sendo levada embora simplesmente não acontecia —
    // e é exatamente nesse momento que o líder quer mandar alguém buscar um
    // arco. A perseguição é uma preferência, não uma emergência: há outros bots
    // e há gente para ela, e quem deu a ordem está vendo o campo inteiro.
    //
    // O que continua vindo antes são as duas coisas que o npc tem nas mãos:
    // carregar o baú e socorrer a própria, caída ou em cortejo. Trocar de
    // chapéu no meio disso perderia a partida para obedecer a um clique.
    if (
      m.ordenado &&
      m.oficio !== null &&
      u.classe !== m.oficio &&
      u.carga === 'nada' &&
      estado.estoque[meu][m.oficio] > 0
    ) {
      const chapelaria = this.arena.estrutura('chapelaria', meu);
      return ir(chapelaria, this.chegou(u, chapelaria, ALCANCE_DE_COLETA * 0.7));
    }

    // O inimigo está levando a refém embora: todo mundo que não é cozinheiro
    // vira defensor por um instante.
    if (refem.onde === 'carregado' && m.papel !== 'cozinheiro') {
      const ladrao = unidade(estado, refem.portador);
      if (ladrao) return ir(ladrao, false, 0, false);
    }

    // A invasão de goblins ameaça a própria chapelaria: chegar perto já
    // afugenta a onda inteira, então vale a mesma interrupção rápida que a
    // perseguição da refém — todo mundo que não é cozinheiro larga o que
    // estava fazendo por um instante. Sem isto, um time só de bots nunca
    // reage à onda, e ela sempre rouba um chapéu quando ninguém joga.
    if (m.papel !== 'cozinheiro') {
      const invasor = estado.invasores.find((i) => i.time === meu);
      if (invasor) return ir(invasor, false, 0, false);
    }

    // Um chapéu no chão a dois passos vale mais que qualquer plano — ainda mais
    // se for do inimigo, que fica sem ele.
    const chapeu = estado.itens.find(
      (i) =>
        i.tipo === 'chapeu' &&
        u.classe === 'aldeao' &&
        m.papel !== 'cozinheiro' &&
        Math.hypot(i.x - u.x, i.y - u.y) < 320,
    );
    if (chapeu) return ir(chapeu, this.chegou(u, chapeu, ALCANCE_DE_COLETA * 0.8));

    if (u.carga === 'bolsa' && u.vida < perfil(u.classe).vida * VIDA_PARA_COMER) {
      return ir(null, true);
    }

    // O totem do Modo Fera: vale desviar se estiver por perto, não vale
    // atravessar o mapa atrás dele — sem o raio, todo bot do time
    // convergiria pro mesmo ponto a cada minuto e meio, largando o papel.
    if (estado.totem && m.papel !== 'cozinheiro') {
      const totem = estado.totem;
      if (Math.hypot(totem.x - u.x, totem.y - u.y) < RAIO_DE_INTERESSE_NO_TOTEM) {
        return ir(totem, false, 0, false);
      }
    }

    // O Guardião do Modo Covil: raio maior que o do totem — ele nasce bem
    // mais raro e recompensa o time inteiro, não só quem chega primeiro, e
    // por isso vale um desvio maior. `combater` mira nele sozinho quando o
    // bot já está perto o bastante (ver `guardiaoNaMira`).
    if (estado.guardiao && m.papel !== 'cozinheiro') {
      const g = estado.guardiao;
      if (Math.hypot(g.x - u.x, g.y - u.y) < RAIO_DE_INTERESSE_NO_GUARDIAO) {
        return ir(g, false, 0, true);
      }
    }

    // A Presa do Modo Caça: mesma lógica do Guardião, raio menor — ver o
    // comentário de `RAIO_DE_INTERESSE_NA_PRESA`.
    if (estado.presa && m.papel !== 'cozinheiro') {
      const presa = estado.presa;
      if (Math.hypot(presa.x - u.x, presa.y - u.y) < RAIO_DE_INTERESSE_NA_PRESA) {
        return ir(presa, false, 0, true);
      }
    }

    // --- papel ------------------------------------------------------------

    if (m.papel === 'cozinheiro') return this.planoDoCozinheiro(estado, u, m, ir);

    if (u.classe === 'aldeao' && this.temChapeu(estado, u)) {
      const chapelaria = this.arena.estrutura('chapelaria', meu);
      return ir(chapelaria, this.chegou(u, chapelaria, ALCANCE_DE_COLETA * 0.7));
    }

    if (m.papel === 'defensor') {
      const cofre = this.arena.estrutura('cofre', meu);
      const invasor = this.inimigoMaisPertoDe(estado, u, cofre, 600 + m.tempero * 260);
      if (invasor) return ir(invasor, false, 0, true);
      return ir(cofre, false, 110 + m.tempero * 90, true);
    }

    // Atacante: o alvo é o cofre inimigo, onde dorme o baú deste time.
    if (minha.onde === 'cofre') {
      return ir(minha, this.chegou(u, minha, ALCANCE_DE_COLETA * 0.8), 0, true);
    }
    return ir(this.arena.estrutura('cofre', inimigo), false, 120, true);
  }

  /**
   * O ofício que o time está pedindo agora.
   *
   * A conta é a ordem das urgências do jogo: sem minério não há bolsa, e sem bolsa a
   * balança não se move; com a Casa da Moeda abastecida, o que falta é o material que
   * está travando o próximo nível da obra. É o que permite dois cozinheiros
   * cobrirem três cadeias — eles trocam de chapéu conforme a falta.
   */
  private oficioNecessario(estado: Estado, u: Unidade): Classe {
    const oficina = estado.oficinas.find((o) => o.time === u.time);
    if (oficina && oficina.nivel < NIVEL_MAXIMO) {
      const base = CUSTO_DO_NIVEL[oficina.nivel + 1]!;
      const custo = {
        madeira: custoDaObraDe(base.madeira, estado.porTime),
        ouro: custoDaObraDe(base.ouro, estado.porTime),
      };
      // O material mais atrasado primeiro: a obra exige os dois, então insistir
      // no que já está sobrando é trabalho que não vira nível.
      const faltaMadeira = custo.madeira - oficina.madeira;
      const faltaOuro = custo.ouro - oficina.ouro;
      if (faltaMadeira > 0 || faltaOuro > 0) {
        return faltaMadeira >= faltaOuro ? 'lenhador' : 'minerador';
      }
    }
    // Obra pronta: o resto do time vira minério, que é o que move a balança.
    const casaDaMoeda = estado.casasDaMoeda.find((c) => c.time === u.time);
    if (casaDaMoeda && casaDaMoeda.bolsas === 0) return 'saqueador';
    return 'saqueador';
  }

  private planoDoCozinheiro(
    estado: Estado,
    u: Unidade,
    m: Memoria,
    ir: (
      destino: { x: number; y: number } | null,
      usar?: boolean,
      folga?: number,
      podeRecuar?: boolean,
    ) => { destino: { x: number; y: number } | null; usar: boolean; folga: number; podeRecuar: boolean },
  ) {
    const meu = u.time;
    const casaDaMoeda = this.arena.estrutura('casaDaMoeda', meu);
    const cofre = this.arena.estrutura('cofre', meu);
    const refem = bauDe(estado, outroTime(meu));

    // Carga no chão perto é o trabalho mais barato do mapa: o minério que o
    // saqueador acabou de derrubar, a madeira que caiu de quem morreu. Sem isto o
    // bot mata a ovelha e vai atrás da próxima, deixando o minério apodrecer.
    if (u.carga === 'nada') {
      const largada = estado.itens
        .filter((i) => i.tipo !== 'chapeu' && Math.hypot(i.x - u.x, i.y - u.y) < 420)
        .sort(
          (a, b) => Math.hypot(a.x - u.x, a.y - u.y) - Math.hypot(b.x - u.x, b.y - u.y),
        )[0];
      if (largada) return ir(largada, this.chegou(u, largada, ALCANCE_DE_COLETA * 0.8));
    }

    // O ofício é revisto conforme a falta do time, com um pouco de inércia para
    // o bot não passar a partida trocando de chapéu.
    m.esperaDoOficio -= DT;
    if (!m.fixo && m.esperaDoOficio <= 0 && u.carga === 'nada') {
      m.oficio = this.oficioNecessario(estado, u);
      m.esperaDoOficio = 12;
    }

    // Primeiro a ferramenta: um saqueador sem faca leva o dobro do tempo para
    // derrubar um bicho, e um lenhador sem machado é um aldeão com pressa.
    if (
      u.carga === 'nada' &&
      m.oficio !== null &&
      u.classe !== m.oficio &&
      estado.estoque[meu][m.oficio] > 0
    ) {
      const chapelaria = this.arena.estrutura('chapelaria', meu);
      return ir(chapelaria, this.chegou(u, chapelaria, ALCANCE_DE_COLETA * 0.7));
    }

    if (u.carga === 'minerio') return ir(casaDaMoeda, this.chegou(u, casaDaMoeda, ALCANCE_DE_COLETA * 0.7));
    if (u.carga === 'madeira' || u.carga === 'ouro') {
      const chapelaria = this.arena.estrutura('chapelaria', meu);
      return ir(chapelaria, this.chegou(u, chapelaria, ALCANCE_DE_COLETA * 0.7));
    }
    if (u.carga === 'bolsa') return ir(cofre, this.chegou(u, cofre, ALCANCE_DE_COLETA * 0.7));

    const minhaCasa = estado.casasDaMoeda.find((c) => c.time === meu)!;
    // Só vale buscar bolsa se a balança ainda tem para onde ir. No talo, o depósito
    // não move nada, e o aldeão volta a ser mais útil colhendo.
    if (minhaCasa.bolsas > 0 && refem.peso < pesoMaximoDe(estado.porTime)) {
      return ir(casaDaMoeda, this.chegou(u, casaDaMoeda, ALCANCE_DE_COLETA * 0.7));
    }

    // O alvo do ofício mais perto **pelo caminho**, não em linha reta: o lago do
    // meio faz uma jazida do outro lado parecer perto e ficar longe.
    const oficio = perfil(u.classe).oficio;

    if (oficio === 'minerio' || oficio === null) {
      const bicho = this.animalMaisPerto(estado, u);
      if (bicho) return ir(bicho, false, 0, false);
    }

    let melhor: { x: number; y: number } | null = null;
    let menor = Infinity;
    for (const j of this.arena.jazidas) {
      // Cada ofício vai à jazida dele. O aldeão, que faz tudo devagar, aceita
      // qualquer uma — é o que o mantém útil enquanto espera por um chapéu.
      if (oficio === 'madeira' && j.tipo !== 'arvore') continue;
      if (oficio === 'ouro' && j.tipo !== 'ouro') continue;
      const dela = estado.jazidas.find((x) => x.id === j.id);
      if (!dela?.cheia) continue;
      if (dela.ocupadaPor !== null && dela.ocupadaPor !== u.id) continue;
      const d = this.navegador.distancia(u.x, u.y, j.x, j.y);
      if (d < menor) {
        menor = d;
        melhor = j;
      }
    }
    if (!melhor) return ir(casaDaMoeda, false, 120);
    return ir(melhor, this.chegou(u, melhor, ALCANCE_DE_COLETA * 0.7));
  }

  /** Mira, e a decisão de puxar o gatilho. */
  private combater(
    estado: Estado,
    u: Unidade,
    m: Memoria,
  ): { ax: number; ay: number; atacar: boolean; recuar: boolean } | null {
    const p = perfil(u.classe);

    if (p.ataque === 'cura') {
      const ferido = estado.unidades.find(
        (o) =>
          o.vivo &&
          o.time === u.time &&
          o.id !== u.id &&
          o.vida < perfil(o.classe).vida * 0.9 &&
          Math.hypot(o.x - u.x, o.y - u.y) <= p.alcance,
      );
      if (!ferido) return null;
      const d = Math.hypot(ferido.x - u.x, ferido.y - u.y) || 1;
      return { ax: (ferido.x - u.x) / d, ay: (ferido.y - u.y) / d, atacar: true, recuar: false };
    }

    // Quem carrega o baú não ataca: a mão está ocupada, e mirar só faria
    // o bot parar de andar para nada.
    if (u.carga === 'bau') return null;

    const alvo =
      this.alvoDeAtaque(estado, u, p.alcance) ??
      this.bichoNaMira(estado, u, m, p.alcance) ??
      this.guardiaoNaMira(estado, u, p.alcance) ??
      this.presaNaMira(estado, u, p.alcance);
    if (!alvo) {
      m.alvo = null;
      m.mirando = 0;
      return null;
    }
    if (m.alvo !== alvo.id) {
      m.alvo = alvo.id;
      m.mirando = 0;
    }
    m.mirando += DT;

    const dx = alvo.x - u.x;
    const dy = alvo.y - u.y;
    const d = Math.hypot(dx, dy) || 1;
    const corpoACorpo = p.ataque === 'corpo';
    return {
      ax: dx / d,
      ay: dy / d,
      atacar: m.mirando >= ESPERA_PARA_MIRAR * (0.7 + m.tempero * 0.8) && d <= p.alcance,
      // O de longe recua quando deixam chegar perto; o de perto nunca recua.
      recuar: !corpoACorpo && d < p.alcance * (0.28 + m.tempero * 0.18),
    };
  }

  private alvoDeAtaque(estado: Estado, u: Unidade, alcance: number): Unidade | null {
    let melhor: Unidade | null = null;
    let melhorNota = -Infinity;
    for (const o of estado.unidades) {
      if (!o.vivo || o.time === u.time) continue;
      const d = Math.hypot(o.x - u.x, o.y - u.y);
      if (d > alcance) continue;
      if (!enxerga(this.arena, u, o)) continue;
      // Quem está carregando o baú é sempre o alvo: matá-lo derruba o
      // resgate inteiro, e nenhum outro abate vale tanto.
      const nota = (o.carga === 'bau' ? 10000 : 0) + (alcance - d);
      if (nota > melhorNota) {
        melhorNota = nota;
        melhor = o;
      }
    }
    return melhor;
  }

  /**
   * O bicho ao alcance, para quem vive de minério.
   *
   * Caçar é a única coleta do jogo que se faz atacando, então ela precisa
   * entrar pelo mesmo caminho do combate — sem isto o bot chega na ovelha, para
   * na frente dela e espera por uma barra de progresso que não existe.
   */
  private bichoNaMira(
    estado: Estado,
    u: Unidade,
    m: Memoria,
    alcance: number,
  ): { id: number; x: number; y: number; carga: string } | null {
    if (u.carga !== 'nada') return null;
    const saqueador = perfil(u.classe).oficio === 'minerio' || m.oficio === 'saqueador';
    if (!saqueador) return null;
    for (const a of estado.animais) {
      if (!a.vivo) continue;
      if (Math.hypot(a.x - u.x, a.y - u.y) > alcance) continue;
      // O id do bicho e o da unidade vivem em contadores diferentes; o negativo
      // evita que a memória de mira confunda uma ovelha com um jogador.
      return { id: -1000 - a.id, x: a.x, y: a.y, carga: 'nada' };
    }
    return null;
  }

  /**
   * O Guardião do Modo Covil, quando um bot já chegou perto o bastante para
   * bater nele. `planejar` é quem decide ir até lá; isto é só o "e agora que
   * cheguei, ataco" — o mesmo papel que `bichoNaMira` tem para a ovelha.
   */
  private guardiaoNaMira(
    estado: Estado,
    u: Unidade,
    alcance: number,
  ): { id: number; x: number; y: number; carga: string } | null {
    const g = estado.guardiao;
    if (!g || u.carga !== 'nada') return null;
    if (Math.hypot(g.x - u.x, g.y - u.y) > alcance) return null;
    // Id negativo, na faixa própria do Guardião — não pode colidir com o do
    // bicho (-1000-id) nem com o de unidade nenhuma.
    return { id: -2000 - g.id, x: g.x, y: g.y, carga: 'nada' };
  }

  /** A Presa do Modo Caça, quando um bot já chegou perto o bastante para bater nela — mesmo papel de `guardiaoNaMira`. */
  private presaNaMira(
    estado: Estado,
    u: Unidade,
    alcance: number,
  ): { id: number; x: number; y: number; carga: string } | null {
    const p = estado.presa;
    if (!p || u.carga !== 'nada') return null;
    if (Math.hypot(p.x - u.x, p.y - u.y) > alcance) return null;
    // Faixa própria da Presa, na mesma família de ids negativos do Guardião.
    return { id: -3000 - p.id, x: p.x, y: p.y, carga: 'nada' };
  }

  /** O bicho mais perto que ainda está de pé. O saqueador vive disso. */
  private animalMaisPerto(estado: Estado, u: Unidade): { x: number; y: number } | null {
    let melhor: { x: number; y: number } | null = null;
    let menor = Infinity;
    for (const a of estado.animais) {
      if (!a.vivo) continue;
      const d = this.navegador.distancia(u.x, u.y, a.x, a.y);
      if (d < menor) {
        menor = d;
        melhor = a;
      }
    }
    return melhor;
  }

  private inimigoMaisPertoDe(
    estado: Estado,
    u: Unidade,
    ponto: { x: number; y: number },
    raio: number,
  ): Unidade | null {
    let melhor: Unidade | null = null;
    let menor = raio;
    for (const o of estado.unidades) {
      if (!o.vivo || o.time === u.time) continue;
      const d = Math.hypot(o.x - ponto.x, o.y - ponto.y);
      if (d < menor) {
        menor = d;
        melhor = o;
      }
    }
    return melhor;
  }

  private temChapeu(estado: Estado, u: Unidade): boolean {
    return CLASSES_COM_CHAPEU.some((c) => estado.estoque[u.time][c] > 0);
  }

  private chegou(u: Unidade, alvo: { x: number; y: number }, raio: number): boolean {
    return Math.hypot(alvo.x - u.x, alvo.y - u.y) <= raio;
  }
}

const vazia = (papel: Papel, id: number, oficio: Classe | null, fixo: boolean): Memoria => ({
  ordenado: false,
  papel,
  oficio,
  fixo,
  // Hash do id, e não sorteio: o mesmo bot tem sempre o mesmo temperamento, o
  // que mantém a partida reproduzível a partir da seed e da lista de entradas.
  tempero: ((Math.imul(id, 2654435761) >>> 0) % 1000) / 1000,
  mirando: 0,
  alvo: null,
  usarPor: 0,
  esperaDoUsar: 0,
  esperaDoOficio: 0,
});
