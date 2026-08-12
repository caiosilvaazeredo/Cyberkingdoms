import { CLASSES_COM_CHAPEU, perfil } from './classes';
import { princesaDe, unidade, type Estado, type Unidade } from './estado';
import type { Arena } from './arena';
import type { Navegador } from './navegacao';
import type { Partida } from './partida';
import { enxerga } from './partida';
import type { Comando } from './protocolo';
import {
  ALCANCE_DE_AJUDA,
  ALCANCE_DE_COLETA,
  DT,
  PESO_MAXIMO,
  carregadoresPara,
  outroTime,
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
 * masmorra. Sobre isso vêm as urgências, que valem para qualquer papel: quem
 * está carregando a princesa vai para casa, quem vê a princesa do próprio time
 * no chão corre para pegá-la, e quem vê o cortejo travado por falta de escolta
 * larga o que estava fazendo e vai empurrar.
 *
 * A urgência vem antes do papel porque é assim que um time humano joga: ninguém
 * continua colhendo trigo enquanto a princesa passa carregada na frente.
 *
 * ## Por que o bot demora a atirar
 *
 * Um bot que mira por vetor acerta sempre, e um arqueiro que acerta sempre é
 * insuportável. `ESPERA_PARA_MIRAR` dá ao alvo o tempo de reação que uma pessoa
 * gastaria — é o que transforma "impossível de flanquear" em "dá para chegar
 * perto se você for rápido".
 */

export type Papel = 'cozinheiro' | 'atacante' | 'defensor';

/** A cara que cada papel dá ao time. Seis bots viram 2/2/2. */
const RODIZIO: readonly Papel[] = ['atacante', 'cozinheiro', 'defensor'];

/** Segundos entre ver o alvo e conseguir atirar nele. */
const ESPERA_PARA_MIRAR = 0.3;

/** Vida abaixo desta fração manda o bot comer o bolo em vez de entregá-lo. */
const VIDA_PARA_COMER = 0.35;

interface Memoria {
  papel: Papel;
  /**
   * O temperamento deste bot, de 0 a 1.
   *
   * Existe para quebrar o passo. Sem ele, dois times de bots num mapa espelhado
   * tomam decisões idênticas no mesmo tick e a partida vira uma coreografia:
   * as duas princesas saem da masmorra juntas, os dois cortejos travam juntos,
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
}

export class Bots {
  private readonly memorias = new Map<number, Memoria>();
  private proximoPapel = 0;

  constructor(
    private readonly arena: Arena,
    private readonly navegador: Navegador,
  ) {}

  adotar(id: number, papel?: Papel): Papel {
    const escolhido = papel ?? RODIZIO[this.proximoPapel++ % RODIZIO.length]!;
    this.memorias.set(id, vazia(escolhido, id));
    return escolhido;
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
      const memoria = this.memorias.get(u.id) ?? vazia(this.adotar(u.id), u.id);
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
      // cozinheiros espelhados deixarem de entregar a fatia no mesmo tick, e a
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
    const minha = princesaDe(estado, meu);
    const refem = princesaDe(estado, inimigo);
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

    if (u.carga === 'princesa') {
      const trono = this.arena.estrutura('trono', meu);
      return ir(trono, this.chegou(u, trono, ALCANCE_DE_COLETA * 0.7));
    }

    if (minha.onde === 'carregada' && minha.portador !== u.id) {
      const portador = unidade(estado, minha.portador);
      if (portador) {
        const faltaAjuda = minha.ajudantes + 1 < carregadoresPara(minha.peso);
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

    // O inimigo está levando a refém embora: todo mundo que não é cozinheiro
    // vira defensor por um instante.
    if (refem.onde === 'carregada' && m.papel !== 'cozinheiro') {
      const ladrao = unidade(estado, refem.portador);
      if (ladrao) return ir(ladrao, false, 0, false);
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

    if (u.carga === 'bolo' && u.vida < perfil(u.classe).vida * VIDA_PARA_COMER) {
      return ir(null, true);
    }

    // --- papel ------------------------------------------------------------

    if (m.papel === 'cozinheiro') return this.planoDoCozinheiro(estado, u, ir);

    if (u.classe === 'aldeao' && this.temChapeu(estado, u)) {
      const chapelaria = this.arena.estrutura('chapelaria', meu);
      return ir(chapelaria, this.chegou(u, chapelaria, ALCANCE_DE_COLETA * 0.7));
    }

    if (m.papel === 'defensor') {
      const jaula = this.arena.estrutura('jaula', meu);
      const invasor = this.inimigoMaisPertoDe(estado, u, jaula, 600 + m.tempero * 260);
      if (invasor) return ir(invasor, false, 0, true);
      return ir(jaula, false, 110 + m.tempero * 90, true);
    }

    // Atacante: o alvo é a masmorra inimiga, onde dorme a princesa deste time.
    if (minha.onde === 'jaula') {
      return ir(minha, this.chegou(u, minha, ALCANCE_DE_COLETA * 0.8), 0, true);
    }
    return ir(this.arena.estrutura('jaula', inimigo), false, 120, true);
  }

  private planoDoCozinheiro(
    estado: Estado,
    u: Unidade,
    ir: (
      destino: { x: number; y: number } | null,
      usar?: boolean,
      folga?: number,
      podeRecuar?: boolean,
    ) => { destino: { x: number; y: number } | null; usar: boolean; folga: number; podeRecuar: boolean },
  ) {
    const meu = u.time;
    const cozinha = this.arena.estrutura('cozinha', meu);
    const jaula = this.arena.estrutura('jaula', meu);
    const refem = princesaDe(estado, outroTime(meu));

    if (u.carga === 'trigo') return ir(cozinha, this.chegou(u, cozinha, ALCANCE_DE_COLETA * 0.7));
    if (u.carga === 'bolo') return ir(jaula, this.chegou(u, jaula, ALCANCE_DE_COLETA * 0.7));

    const minhaCozinha = estado.cozinhas.find((c) => c.time === meu)!;
    // Só vale buscar bolo se a balança ainda tem para onde ir. No talo, a fatia
    // não move nada, e o aldeão volta a ser mais útil colhendo.
    if (minhaCozinha.bolos > 0 && refem.peso < PESO_MAXIMO) {
      return ir(cozinha, this.chegou(u, cozinha, ALCANCE_DE_COLETA * 0.7));
    }

    // O trigal mais perto **pelo caminho**, não em linha reta: o lago do meio
    // faz um trigo do outro lado parecer perto e ficar longe.
    let melhor: { x: number; y: number } | null = null;
    let menor = Infinity;
    for (const t of this.arena.trigais) {
      const estadoDoTrigal = estado.trigais.find((x) => x.id === t.id);
      if (!estadoDoTrigal?.maduro) continue;
      if (estadoDoTrigal.ocupadoPor !== null && estadoDoTrigal.ocupadoPor !== u.id) continue;
      const d = this.navegador.distancia(u.x, u.y, t.x, t.y);
      if (d < menor) {
        menor = d;
        melhor = t;
      }
    }
    if (!melhor) return ir(cozinha, false, 120);
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

    // Quem carrega a princesa não ataca: a mão está ocupada, e mirar só faria
    // o bot parar de andar para nada.
    if (u.carga === 'princesa') return null;

    const alvo = this.alvoDeAtaque(estado, u, p.alcance);
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
      // Quem está carregando a princesa é sempre o alvo: matá-lo derruba o
      // resgate inteiro, e nenhum outro abate vale tanto.
      const nota = (o.carga === 'princesa' ? 10000 : 0) + (alcance - d);
      if (nota > melhorNota) {
        melhorNota = nota;
        melhor = o;
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

const vazia = (papel: Papel, id: number): Memoria => ({
  papel,
  // Hash do id, e não sorteio: o mesmo bot tem sempre o mesmo temperamento, o
  // que mantém a partida reproduzível a partir da seed e da lista de entradas.
  tempero: ((Math.imul(id, 2654435761) >>> 0) % 1000) / 1000,
  mirando: 0,
  alvo: null,
  usarPor: 0,
  esperaDoUsar: 0,
});
