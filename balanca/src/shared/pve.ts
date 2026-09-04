import { cajadoDe, canhaoDe, covilDe, resolverColisao, tocaDaPresaDe, type Arena } from './arena';
import { CLASSES_COM_CHAPEU, PERFIS_DE_FERA, type Classe, type Fera } from './classes';
import { semeadoPor } from './rng';
import type { IdDoMapa } from './mapas';
import {
  VARIANTES_RARAS_DA_INVASAO,
  type Estado,
  type Invasor,
  type TipoDeGuardiao,
  type Unidade,
  type VarianteDaInvasao,
} from './estado';
import {
  CAJADO_INTERVALO,
  CANHAO_CADENCIA,
  CANHAO_DANO,
  CANHAO_RAIO,
  CANHAO_VELOCIDADE_DA_BOLA,
  DT,
  FERA_DURACAO,
  GUARDIAO_BUFF_DURACAO,
  GUARDIAO_CADENCIA_DE_ATAQUE,
  GUARDIAO_DANO,
  GUARDIAO_INTERVALO,
  GUARDIAO_RAIO_DE_ATAQUE,
  GUARDIAO_VIDA,
  INVASAO_AVISO_ANTES,
  INVASAO_INTERVALO,
  INVASAO_RAIO_DE_AFUGENTAR,
  INVASAO_RAIO_DO_SAQUE,
  INVASAO_RAIO_DO_SAQUE_SLINGSHOT,
  INVASAO_TAMANHO,
  INVASAO_VELOCIDADE,
  PRESA_BUFF_DURACAO,
  PRESA_CADENCIA_DE_ATAQUE,
  PRESA_DANO,
  PRESA_INTERVALO,
  PRESA_RAIO_DE_ATAQUE,
  PRESA_VIDA,
  RAIO_UNIDADE,
  TILE,
  TIMES,
  TOTEM_RAIO_DE_PEGAR,
  TOTEM_INTERVALO,
  XAMA_CARGA_DURACAO,
  perto,
} from './regras';

/**
 * As ameaças e prêmios sem dono de time: a invasão de goblins, o totem do
 * Modo Fera, o canhão de cerco, e o Guardião do Modo Covil.
 *
 * Separado de `partida.ts` porque cada uma é um sistema à parte do resto do
 * tick — nenhuma depende de comando de jogador nem participa da economia —
 * e porque `partida.ts` tinha crescido demais para caber numa leitura só.
 * `tick()` continua chamando as funções daqui na mesma ordem de antes; nada
 * no comportamento muda, só onde o código mora.
 */

// --- a invasão ---------------------------------------------------------------

/**
 * A onda de goblins: nasce perto da própria chapelaria do reino que rouba,
 * anda até ela, e some — roubada ou afugentada.
 *
 * ## Por que perto da chapelaria, e não do lado de fora do mapa
 *
 * Um goblin que precisasse atravessar o castelo inteiro precisaria de
 * caminho de verdade — o mesmo `Navegador` que os bots usam, que vive na
 * sala e não na partida, de propósito: é caro, e a simulação pura não pode
 * depender dele. Nascendo a poucos tiles da própria chapelaria, em terreno
 * que já é pátio limpo (nenhuma decoração nasce perto de estrutura, ver
 * `calcularDecoracao`), uma linha reta com `resolverColisao` — o mesmo
 * empurrão que tira a ovelha de cima de pedra — basta. O aviso de
 * `INVASAO_AVISO_ANTES` segundos é quem devolve o tempo de reação que a
 * distância curta tira.
 *
 * ## Por que afugentar é só chegar perto
 *
 * O goblin não tem vida nem golpe — ele não é alvo do sistema de combate,
 * que só conhece dois times. Se fosse, cada classe precisaria de uma conta
 * de dano contra um terceiro lado que não existe em lugar nenhum do resto do
 * jogo. Chegar perto já é a decisão que importa: parar de fazer o que se
 * estava fazendo para proteger a chapelaria.
 */
export function moverInvasores(arena: Arena, estado: Estado): void {
  estado.proximaInvasaoEm -= DT;

  // O aviso dispara uma vez só, no tick em que o relógio cruza a marca — e
  // não "enquanto está dentro da janela", que dispararia em todo tick dela.
  if (
    estado.proximaInvasaoEm <= INVASAO_AVISO_ANTES &&
    estado.proximaInvasaoEm + DT > INVASAO_AVISO_ANTES
  ) {
    for (const time of TIMES) estado.eventos.push({ tipo: 'invasaoAvisada', time });
  }

  if (estado.proximaInvasaoEm <= 0) {
    estado.proximaInvasaoEm += INVASAO_INTERVALO;
    for (const time of TIMES) {
      const chapelaria = arena.estrutura('chapelaria', time);
      // O lado de fora: o mesmo lado que o anexo da obra e o guarda da
      // tesouraria usam no desenho, só para não nascer colado na porta.
      const ladoDeFora = time === 'azul' ? -1 : 1;
      // Sorteado uma vez por onda, não por goblin — o mesmo compromisso da
      // fera e do saque: semeado pelo tick e por um número que separa os dois
      // reinos, para dois servidores rodando a mesma partida verem a mesma
      // onda pegar fogo (ou não).
      const dado = semeadoPor(estado.tick, arena.seed * 97 + (time === 'azul' ? 11 : 17));
      const sorteio = dado.nextDouble();
      // Percorre as faixas na ordem da tabela: a primeira cujo teto o
      // sorteio não alcança decide a variante; nenhuma decide, é comum.
      let variante: VarianteDaInvasao = 'comum';
      let teto = 0;
      for (const rara of VARIANTES_RARAS_DA_INVASAO) {
        teto += rara.chance;
        if (sorteio < teto) {
          variante = rara.variante;
          break;
        }
      }
      for (let i = 0; i < INVASAO_TAMANHO; i++) {
        estado.invasores.push({
          id: estado.proximoId++,
          time,
          x: chapelaria.x + ladoDeFora * TILE * 3.5,
          y: chapelaria.y + (i - (INVASAO_TAMANHO - 1) / 2) * TILE,
          variante,
        });
      }
    }
  }

  const restantes: Invasor[] = [];
  for (const inv of estado.invasores) {
    let afugentado = false;
    for (const u of estado.unidades) {
      if (u.vivo && perto(u, inv, INVASAO_RAIO_DE_AFUGENTAR)) {
        afugentado = true;
        break;
      }
    }
    if (afugentado) {
      estado.eventos.push({ tipo: 'invasaoAfugentada', time: inv.time, variante: inv.variante });
      continue;
    }

    const chapelaria = arena.estrutura('chapelaria', inv.time);
    const raioDoSaque =
      inv.variante === 'slingshot' ? INVASAO_RAIO_DO_SAQUE_SLINGSHOT : INVASAO_RAIO_DO_SAQUE;
    if (perto(inv, chapelaria, raioDoSaque)) {
      const estoque = estado.estoque[inv.time];
      const comEstoque = CLASSES_COM_CHAPEU.filter((c) => estoque[c] > 0);
      let roubada: Classe | null = null;
      if (comEstoque.length > 0) {
        // Semeado pelo id do goblin e o tick — o mesmo compromisso do sorteio
        // da ovelha: dois servidores rodando a mesma partida roubam o mesmo
        // chapéu.
        const dado = semeadoPor(inv.id, estado.tick);
        roubada = comEstoque[dado.nextIntBelow(comEstoque.length)]!;
        estoque[roubada]--;
      }
      estado.eventos.push({ tipo: 'invasaoRoubou', time: inv.time, classe: roubada, variante: inv.variante });
      continue;
    }

    const dx = chapelaria.x - inv.x;
    const dy = chapelaria.y - inv.y;
    const d = Math.hypot(dx, dy);
    if (d > 1) {
      const passo = resolverColisao(
        arena,
        inv.x + (dx / d) * INVASAO_VELOCIDADE * DT,
        inv.y + (dy / d) * INVASAO_VELOCIDADE * DT,
        RAIO_UNIDADE * 0.8,
      );
      inv.x = passo.x;
      inv.y = passo.y;
    }
    restantes.push(inv);
  }
  estado.invasores = restantes;
}

// --- o modo fera -------------------------------------------------------------

/**
 * O totem: nasce, espera, e o primeiro que chegar perto vira fera.
 *
 * ## Onde ele nasce
 *
 * Num pasto do meio — o mesmo ponto que já serve de âncora para o porco
 * decorativo no cliente, aqui reaproveitado do lado do servidor: chão que a
 * arena já garante seco e livre de decoração, sem precisar de uma busca
 * nova. Não é o centro geométrico do mapa por causa do mesmo lago que
 * atrapalharia a tartaruga se ela nascesse ali sem cuidado.
 *
 * ## Por que qualquer um pode pegar, dos dois times
 *
 * O totem não escolhe lado — os dois reinos correm pra ele igual. É a
 * mesma decisão de design da invasão, espelhada: lá a ameaça não tem time,
 * aqui o prêmio também não.
 */
export function moverTotem(arena: Arena, estado: Estado): void {
  estado.proximoTotemEm -= DT;
  if (!estado.totem && estado.proximoTotemEm <= 0) {
    const ancora = arena.pastos.find((p) => p.lado === null) ?? arena.pastos[0];
    if (ancora) {
      estado.totem = { id: estado.proximoId++, x: ancora.x, y: ancora.y };
    }
  }
  if (!estado.totem) return;

  for (const u of estado.unidades) {
    if (!u.vivo || u.fera) continue;
    if (!perto(u, estado.totem, TOTEM_RAIO_DE_PEGAR)) continue;

    // Semeado pelo id de quem pegou e o tick — o mesmo compromisso do
    // sorteio da ovelha e do roubo da invasão.
    const dado = semeadoPor(u.id, estado.tick);
    const fera: Fera = dado.nextDouble() < 0.5 ? 'troll' : 'minotauro';
    u.fera = fera;
    u.feraAte = FERA_DURACAO;
    u.vida = PERFIS_DE_FERA[fera].vida;
    estado.eventos.push({ tipo: 'virouFera', unidade: u.id, fera });
    estado.totem = null;
    estado.proximoTotemEm = TOTEM_INTERVALO;
    break;
  }
}

/**
 * O canhão de cerco: vigia o entorno da própria tesouraria e atira em quem
 * do outro time se aproxima demais.
 *
 * Ele mira em quem já está mais perto — não no primeiro que entrou no raio
 * — porque é a leitura que um jogador faria olhando o canhão de fora: atira
 * em quem está mais na cara dele agora, não em quem chegou primeiro.
 */
export function moverCanhoes(arena: Arena, estado: Estado): void {
  for (const canhao of estado.canhoes) {
    canhao.recarga -= DT;
    if (canhao.recarga > 0) continue;

    const posto = canhaoDe(arena, canhao.time);
    let alvo: Unidade | null = null;
    let maisPerto = CANHAO_RAIO;
    for (const u of estado.unidades) {
      if (!u.vivo || u.time === canhao.time) continue;
      const d = Math.hypot(u.x - posto.x, u.y - posto.y);
      if (d > maisPerto) continue;
      maisPerto = d;
      alvo = u;
    }
    if (!alvo) continue;

    const dx = alvo.x - posto.x;
    const dy = alvo.y - posto.y;
    const d = Math.hypot(dx, dy) || 1;
    estado.projeteis.push({
      id: estado.proximoId++,
      tipo: 'bolaDeCanhao',
      time: canhao.time,
      dono: -1,
      x: posto.x,
      y: posto.y,
      vx: (dx / d) * CANHAO_VELOCIDADE_DA_BOLA,
      vy: (dy / d) * CANHAO_VELOCIDADE_DA_BOLA,
      dano: CANHAO_DANO,
      vida: d / CANHAO_VELOCIDADE_DA_BOLA + 0.2,
    });
    canhao.recarga = CANHAO_CADENCIA;
  }
}

// --- o guardião (Modo Covil) -------------------------------------------------

/** O visual do Guardião, por mapa — o mesmo compromisso dos biomas: cada relevo tem a sua cara. */
const GUARDIAO_DO_MAPA: Readonly<Record<IdDoMapa, TipoDeGuardiao>> = {
  corte: 'minotauro',
  planicie: 'panda',
  vau: 'tartaruga',
  arquipelago: 'caveira',
  desfiladeiro: 'minotauro',
};

/** Qual Guardião nasce neste mapa. Exportado para o desenho escolher a folha certa. */
export function tipoDoGuardiaoPara(mapa: IdDoMapa): TipoDeGuardiao {
  return GUARDIAO_DO_MAPA[mapa];
}

/**
 * O Guardião: nasce, bate em quem chega perto, e cai para quem baixar toda
 * a vida dele — dando ao time da queda um tempo de velocidade extra.
 *
 * ## Por que ele tem uma vida própria, e não é um `Animal` maior
 *
 * Um `Animal` foge, pasta e solta minério ao morrer — três comportamentos
 * que o Guardião não tem nenhum. Encaixá-lo ali seria herdar um `if` a mais
 * em cada lugar que já lê `estado.animais` para "achar a ovelha mais
 * perto", só para excluir o chefe da conta. Um tipo à parte, como o totem e
 * o canhão já são, é menos código no total, não mais.
 */
export function moverGuardiao(arena: Arena, estado: Estado): void {
  estado.proximoGuardiaoEm -= DT;
  if (!estado.guardiao && estado.proximoGuardiaoEm <= 0) {
    const local = covilDe(arena);
    const tipo = tipoDoGuardiaoPara(arena.mapa);
    estado.guardiao = {
      id: estado.proximoId++,
      tipo,
      x: local.x,
      y: local.y,
      vida: GUARDIAO_VIDA,
      vidaMaxima: GUARDIAO_VIDA,
      golpeEm: GUARDIAO_CADENCIA_DE_ATAQUE,
    };
    estado.eventos.push({ tipo: 'guardiaoNasceu', tipoDoGuardiao: tipo });
  }

  const g = estado.guardiao;
  if (g) {
    g.golpeEm -= DT;
    if (g.golpeEm <= 0) {
      g.golpeEm = GUARDIAO_CADENCIA_DE_ATAQUE;
      // Não mata — o mesmo compromisso do canhão: dissuade sem virar uma
      // segunda fonte de abate de graça pra quem só ronda o covil.
      for (const u of estado.unidades) {
        if (u.vivo && perto(u, g, GUARDIAO_RAIO_DE_ATAQUE)) {
          u.vida = Math.max(1, u.vida - GUARDIAO_DANO);
        }
      }
    }
  }

  for (const time of TIMES) {
    if (estado.buffDoGuardiao[time] > 0) {
      estado.buffDoGuardiao[time] = Math.max(0, estado.buffDoGuardiao[time] - DT);
    }
  }
}

/** O dano que um jogador causa ao Guardião — chamado dos três caminhos de combate. */
export function ferirGuardiao(estado: Estado, algoz: Unidade, dano: number): void {
  const g = estado.guardiao;
  if (!g) return;
  g.vida -= dano;
  if (g.vida > 0) return;
  estado.guardiao = null;
  estado.proximoGuardiaoEm = GUARDIAO_INTERVALO;
  estado.buffDoGuardiao[algoz.time] = GUARDIAO_BUFF_DURACAO;
  estado.eventos.push({ tipo: 'guardiaoCaiu', time: algoz.time, x: g.x, y: g.y });
}

// --- a presa (Modo Caça) ------------------------------------------------------

/**
 * A Presa: nasce sem parar no meio do mapa, bate em quem chega perto, e cai
 * para quem baixar toda a vida dela — dando ao time da queda um tempo de
 * dano extra.
 *
 * ## Por que ela não tem tipo por bioma, ao contrário do Guardião
 *
 * O Guardião é um chefe único por partida — vale a pena uma tabela de visual
 * por mapa, o mesmo compromisso dos biomas. A Presa nasce de novo a cada
 * `PRESA_INTERVALO`, várias vezes por partida: uma cara só (a aranha) é o
 * que deixa reconhecível de relance, sem exigir que quem joga aprenda quatro
 * bichos diferentes para uma mecânica que já é rápida por natureza.
 *
 * ## Por que não existe evento de nascimento
 *
 * O Guardião nasce uma vez a cada `GUARDIAO_INTERVALO` (90s) — vale avisar.
 * A Presa nasce a cada `PRESA_INTERVALO` (45s), o dobro da frequência: um
 * evento a cada nascimento viraria log constante no HUD sem ajudar ninguém a
 * decidir nada. A queda continua avisando — é ela que dá o buff.
 */
export function moverPresa(arena: Arena, estado: Estado): void {
  estado.proximaPresaEm -= DT;
  if (!estado.presa && estado.proximaPresaEm <= 0) {
    const local = tocaDaPresaDe(arena);
    estado.presa = {
      id: estado.proximoId++,
      x: local.x,
      y: local.y,
      vida: PRESA_VIDA,
      vidaMaxima: PRESA_VIDA,
      mordeEm: PRESA_CADENCIA_DE_ATAQUE,
    };
  }

  const p = estado.presa;
  if (p) {
    p.mordeEm -= DT;
    if (p.mordeEm <= 0) {
      p.mordeEm = PRESA_CADENCIA_DE_ATAQUE;
      // Não mata — o mesmo compromisso do Guardião e do canhão.
      for (const u of estado.unidades) {
        if (u.vivo && perto(u, p, PRESA_RAIO_DE_ATAQUE)) {
          u.vida = Math.max(1, u.vida - PRESA_DANO);
        }
      }
    }
  }

  for (const time of TIMES) {
    if (estado.buffDaPresa[time] > 0) {
      estado.buffDaPresa[time] = Math.max(0, estado.buffDaPresa[time] - DT);
    }
  }
}

/** O dano que um jogador causa à Presa — chamado dos três caminhos de combate. */
export function ferirPresa(estado: Estado, algoz: Unidade, dano: number): void {
  const p = estado.presa;
  if (!p) return;
  p.vida -= dano;
  if (p.vida > 0) return;
  estado.presa = null;
  estado.proximaPresaEm = PRESA_INTERVALO;
  estado.buffDaPresa[algoz.time] = PRESA_BUFF_DURACAO;
  estado.eventos.push({ tipo: 'presaCaiu', time: algoz.time, x: p.x, y: p.y });
}

// --- o cajado (Modo Xamã) -----------------------------------------------------

/**
 * O cajado: nasce, e o primeiro que chegar perto pega — a mesma mecânica do
 * totem, com um prêmio diferente. Não briga, não tem vida: tocar já basta.
 *
 * ## Por que não é um "combate" como o Guardião e a Presa
 *
 * O cajado não ameaça ninguém — ele é só um prêmio no chão, do mesmo jeito
 * que o totem do Modo Fera é. Dar a ele vida e ataque para reaproveitar o
 * padrão do Guardião seria inventar uma ameaça que o modo não promete: o
 * lema é "quem pega pode transformar", não "quem derrubar o guardião do
 * cajado pode transformar".
 */
export function moverCajado(arena: Arena, estado: Estado): void {
  estado.proximoCajadoEm -= DT;
  if (!estado.cajado && estado.proximoCajadoEm <= 0) {
    const local = cajadoDe(arena);
    estado.cajado = { id: estado.proximoId++, x: local.x, y: local.y };
  }
  if (!estado.cajado) return;

  for (const u of estado.unidades) {
    if (!u.vivo || u.porco > 0) continue;
    if (!perto(u, estado.cajado, TOTEM_RAIO_DE_PEGAR)) continue;

    u.xamaAte = XAMA_CARGA_DURACAO;
    estado.eventos.push({ tipo: 'cajadoPego', unidade: u.id, time: u.time });
    estado.cajado = null;
    estado.proximoCajadoEm = CAJADO_INTERVALO;
    break;
  }
}
