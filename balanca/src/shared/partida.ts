import {
  CLASSES_COM_CHAPEU,
  ESTOQUE_INICIAL,
  LERDEZA_DO_ALDEAO,
  PERFIS_DE_FERA,
  danoDe,
  perfil,
  vidaMaxima,
  vidaMaximaDe,
  type Classe,
  type Fera,
} from './classes';
import {
  canhaoDe,
  criarArena,
  linhaLivre,
  resolverColisao,
  type Arena,
  type TipoDeEstrutura,
} from './arena';
import { MAPA_PADRAO, mapaDe, type IdDoMapa, type Mapa } from './mapas';
import { MODO_PADRAO, modoDe, type IdDoModo } from './modos';
import {
  CARGA_DO_OFICIO,
  casaDaMoedaDe,
  nivelDe,
  oficinaDe,
  bauDe,
  unidade,
  type Animal,
  type Carga,
  type Estado,
  type Invasor,
  type Item,
  type Bau,
  type Unidade,
} from './estado';
import type { Comando } from './protocolo';
import { DeterministicRandom } from './rng';
import {
  ALCANCE_DE_AJUDA,
  ALCANCE_DE_COLETA,
  ALCANCE_DE_USO,
  ANIMAL_FUGINDO,
  ANIMAL_PANICO,
  ANIMAL_PASTANDO,
  ANIMAL_PASTO,
  ANIMAL_VIDA,
  ANIMAL_VOLTA_EM,
  AQUECIMENTO,
  BOLSAS_NA_CASA,
  MINERIO_POR_BOLSA,
  CHAPEU_VOLTA_EM,
  CURA_DA_BOLSA,
  CUSTO_DO_NIVEL,
  DT,
  EMPURRAO_DO_BAU,
  FERA_DURACAO,
  INVASAO_AVISO_ANTES,
  INVASAO_INTERVALO,
  INVASAO_RAIO_DE_AFUGENTAR,
  INVASAO_RAIO_DO_SAQUE,
  INVASAO_TAMANHO,
  INVASAO_VELOCIDADE,
  JAZIDA_VOLTA_EM,
  NIVEL_MAXIMO,
  PAUSA_APOS_PONTO,
  POR_TIME,
  TOTEM_INTERVALO,
  TOTEM_RAIO_DE_PEGAR,
  chapeusDe,
  custoDaObraDe,
  pesoMaximoDe,
  pesoTotalDe,
  pesoMinimoDe,
  PESO_POR_BOLSA,
  BAU_VOLTA_EM,
  CANHAO_CADENCIA,
  CANHAO_DANO,
  CANHAO_RAIO,
  CANHAO_VELOCIDADE_DA_BOLA,
  RAIO_UNIDADE,
  RENASCIMENTO_POR_PONTO,
  TEMPO_DE_CUNHAGEM,
  TEMPO_DE_TRABALHO,
  TILE,
  TIMES,
  carregadoresPara,
  outroTime,
  velocidadeCarregando,
  type Time,
} from './regras';

/**
 * O tick da partida. É aqui que o jogo acontece.
 *
 * ## Uma cópia da verdade, e ela é do servidor
 *
 * O cliente **prevê** o próprio movimento chamando `moverUnidade` — a mesma
 * função que o servidor chama — e corrige quando o retrato chega. Todo o resto
 * (dano, quem pegou o baú, quem entregou o depósito) só existe depois que o
 * servidor disse que existe. Essa assimetria é deliberada: prever movimento
 * esconde a latência do que o jogador sente na mão, e prever dano só produz
 * mortes que voltam à vida.
 *
 * ## O tick não sorteia nada — nem os bichos
 *
 * Nenhuma decisão usa aleatoriedade de tempo de execução. As ovelhas, que são a
 * única coisa do jogo que anda sozinha, escolhem para onde ir a partir de um
 * gerador semeado pelo id e pelo tick: mesma partida, mesma pastagem. É o que
 * torna um replay possível e um bug reproduzível em vez de folclore.
 *
 * ## A ordem importa
 *
 * Comandos, depois movimento, depois combate, depois carregamento, depois
 * economia, depois vitória. Combate antes de carregamento porque quem morreu
 * neste tick solta o baú **neste** tick; vitória por último porque um
 * ponto marcado depende de tudo que aconteceu antes dele.
 */

export interface OpcoesDeEntrada {
  nome: string;
  bot: boolean;
  /** Deixe vazio para entrar no time com menos gente. */
  time?: Time;
}

export interface Partida {
  readonly arena: Arena;
  readonly estado: Estado;
  entrar(opcoes: OpcoesDeEntrada): Unidade;
  sair(id: number): void;
  comandar(id: number, comando: Comando): void;
  /** Comando corrente de uma unidade. Os bots escrevem aqui. */
  comandoDe(id: number): Comando;
  passo(): void;
}

const COMANDO_PARADO: Comando = {
  seq: 0,
  mx: 0,
  my: 0,
  ax: 0,
  ay: 0,
  atacar: false,
  usar: false,
};

export function criarPartida(
  seed: number,
  modo: IdDoModo = MODO_PADRAO,
  mapa: IdDoMapa = MAPA_PADRAO,
  porTime: number = POR_TIME,
): Partida {
  const arena = criarArena(seed, mapa);
  const estado = estadoInicial(arena, modo, porTime);
  const comandos = new Map<number, Comando>();
  /** Sobe a borda do botão "usar": segurar não repete a ação. */
  const usarAnterior = new Map<number, boolean>();

  const partida: Partida = {
    arena,
    estado,
    entrar(opcoes) {
      const time = opcoes.time ?? timeMaisVazio(estado);
      const u: Unidade = {
        id: estado.proximoId++,
        time,
        nome: opcoes.nome,
        bot: opcoes.bot,
        classe: 'aldeao',
        x: 0,
        y: 0,
        olharX: time === 'azul' ? 1 : -1,
        olharY: 0,
        vida: vidaMaxima('aldeao', nivelDe(estado, time)),
        vivo: true,
        renasceEm: 0,
        recarga: 0,
        golpe: 0,
        carga: 'nada',
        colheita: 0,
        colhendoId: null,
        abates: 0,
        mortes: 0,
        depositos: 0,
        resgates: 0,
        entregas: 0,
        ultimoComando: 0,
        fera: null,
        feraAte: 0,
      };
      estado.unidades.push(u);
      porNoNascedouro(arena, estado, u);
      return u;
    },
    sair(id) {
      const u = unidade(estado, id);
      if (!u) return;
      soltarTudo(estado, u);
      devolverChapeu(estado, u);
      estado.unidades = estado.unidades.filter((x) => x.id !== id);
      comandos.delete(id);
      usarAnterior.delete(id);
    },
    comandar(id, comando) {
      comandos.set(id, comando);
    },
    comandoDe(id) {
      return comandos.get(id) ?? COMANDO_PARADO;
    },
    passo() {
      tick(arena, estado, comandos, usarAnterior);
    },
  };

  return partida;
}

// --- montagem --------------------------------------------------------------

function estadoInicial(arena: Arena, id: IdDoModo, porTime: number): Estado {
  const modo = modoDe(id);
  // O armário cresce com o time: ver `chapeusDe`. Sem isso, trinta e dois por
  // lado dividiriam o armário de seis e o jogo viraria trinta e dois aldeões.
  const estoque = {} as Record<Time, Record<Classe, number>>;
  for (const t of TIMES) {
    estoque[t] = { ...ESTOQUE_INICIAL };
    for (const c of Object.keys(estoque[t]) as Classe[]) {
      if (estoque[t][c] > 0) estoque[t][c] = chapeusDe(estoque[t][c], porTime);
    }
  }

  const baus: Bau[] = TIMES.map((time) => {
    // O baú de um time começa presa no cofre do **outro**. É a
    // premissa do jogo, e está escrita numa linha só para que não haja dois
    // lugares onde ela possa ser invertida.
    const cofre = arena.estrutura('cofre', outroTime(time));
    return {
      time,
      peso: pesoTotalDe(porTime) / 2,
      onde: 'cofre',
      x: cofre.x,
      y: cofre.y,
      portador: null,
      voltaEm: 0,
      ajudantes: 0,
    };
  });

  return {
    tick: 0,
    modo: modo.id,
    porTime,
    fase: 'aquecimento',
    faseEm: AQUECIMENTO,
    relogio: modo.duracao,
    placar: { azul: 0, vermelho: 0 },
    abates: { azul: 0, vermelho: 0 },
    unidades: [],
    baus,
    projeteis: [],
    itens: [],
    jazidas: arena.jazidas.map((j) => ({
      id: j.id,
      cheia: true,
      voltaEm: 0,
      ocupadaPor: null,
    })),
    animais: arena.pastos.map((p) => ({
      id: p.id,
      x: p.x,
      y: p.y,
      vida: ANIMAL_VIDA,
      vivo: true,
      voltaEm: 0,
      destinoX: p.x,
      destinoY: p.y,
      pensaEm: 0,
      fugindo: 0,
    })),
    invasores: [],
    // Metade do intervalo normal: a primeira onda chega mais cedo que as
    // seguintes, porque a partida inteira já esperou o aquecimento antes de
    // este relógio começar a andar.
    proximaInvasaoEm: INVASAO_INTERVALO / 2,
    totem: null,
    proximoTotemEm: TOTEM_INTERVALO / 3,
    casasDaMoeda: TIMES.map((time) => ({ time, minerio: 0, cunhando: 0, bolsas: 1 })),
    oficinas: TIMES.map((time) => ({ time, madeira: 0, ouro: 0, nivel: 1 })),
    canhoes: TIMES.map((time) => ({ time, recarga: CANHAO_CADENCIA / 2 })),
    estoque,
    eventos: [],
    vencedor: null,
    proximoId: 1,
  };
}

function timeMaisVazio(estado: Estado): Time {
  const conta = (t: Time): number => estado.unidades.filter((u) => u.time === t).length;
  // Empate vai para o azul. Alternar por sorteio faria a mesma sequência de
  // entradas produzir times diferentes, e um teste de lotação impossível.
  return conta('azul') <= conta('vermelho') ? 'azul' : 'vermelho';
}

/**
 * Coloca a unidade no nascedouro, espalhando quem já está lá.
 *
 * O leque é por índice, não por sorteio: seis pessoas renascendo no mesmo tick
 * precisam sair em seis lugares distintos, e um sorteio empilharia duas na
 * mesma coordenada de vez em quando.
 */
function porNoNascedouro(arena: Arena, estado: Estado, u: Unidade): void {
  const casa = arena.estrutura('nascedouro', u.time);
  const irmaos = estado.unidades.filter((x) => x.time === u.time);
  const i = Math.max(0, irmaos.indexOf(u));
  const angulo = (i / Math.max(1, irmaos.length)) * Math.PI * 2;
  const raio = 20 + (i % 3) * 26;
  const alvo = resolverColisao(
    arena,
    casa.x + Math.cos(angulo) * raio,
    casa.y + Math.sin(angulo) * raio,
    RAIO_UNIDADE,
  );
  u.x = alvo.x;
  u.y = alvo.y;
}

// --- o tick ----------------------------------------------------------------

function tick(
  arena: Arena,
  estado: Estado,
  comandos: Map<number, Comando>,
  usarAnterior: Map<number, boolean>,
): void {
  estado.tick++;
  estado.eventos = [];

  if (estado.fase === 'fim') return;

  if (estado.fase === 'aquecimento' || estado.fase === 'ponto') {
    estado.faseEm -= DT;
    if (estado.faseEm <= 0) {
      if (estado.fase === 'ponto') recomecarRodada(arena, estado);
      estado.fase = 'jogando';
      estado.faseEm = 0;
    }
  } else {
    estado.relogio = Math.max(0, estado.relogio - DT);
  }

  const jogando = estado.fase === 'jogando';

  for (const u of estado.unidades) {
    const c = comandos.get(u.id) ?? COMANDO_PARADO;
    u.ultimoComando = c.seq;
    u.recarga = Math.max(0, u.recarga - DT);
    u.golpe = Math.max(0, u.golpe - DT);

    if (u.fera) {
      u.feraAte -= DT;
      if (u.feraAte <= 0) {
        u.fera = null;
        // A vida some proporcionalmente ao talo — ninguém guarda os
        // trezentos e tantos pontos do Troll depois de virar gente nova.
        u.vida = Math.min(u.vida, vidaMaxima(u.classe, nivelDe(estado, u.time)));
        estado.eventos.push({ tipo: 'voltouAoNormal', unidade: u.id });
      }
    }

    if (!u.vivo) {
      u.renasceEm -= DT;
      if (u.renasceEm <= 0) reviver(arena, estado, u);
      continue;
    }

    moverUnidade(arena, estado, u, c, DT);

    const apertouUsar = c.usar && !(usarAnterior.get(u.id) ?? false);
    usarAnterior.set(u.id, c.usar);

    // No aquecimento não se joga, mas se escolhe: a chapelaria fica aberta. É
    // exatamente para isso que o aquecimento existe — sem ele, todo mundo
    // começa a partida como aldeão e a primeira briga é decidida por quem
    // correu mais rápido para pegar um chapéu.
    if (!jogando) {
      if (
        apertouUsar &&
        u.carga === 'nada' &&
        estruturaPerto(arena, u, 'chapelaria', u.time)
      ) {
        vestirDaChapelaria(estado, u);
      }
      continue;
    }
    if (apertouUsar) usar(arena, estado, u);
    if (c.atacar) atacar(arena, estado, u);
    trabalhar(arena, estado, u, c);
  }

  moverProjeteis(arena, estado);
  if (jogando) {
    moverAnimais(arena, estado);
    moverInvasores(arena, estado);
    moverTotem(arena, estado);
    moverCanhoes(arena, estado);
    cuidarDosBaus(arena, estado);
    cunhar(estado);
    recomporJazidas(estado);
    envelhecerItens(estado);
    conferirRelogio(estado);
  }
}

/**
 * O movimento, e a única parte da simulação que o cliente também roda.
 *
 * Recebe `estado` porque a velocidade de quem carrega o baú depende do
 * peso dela e da escolta encostada — e essas duas coisas o cliente já tem no
 * último retrato, então a previsão continua batendo.
 */
/**
 * Até onde um time pode andar durante o aquecimento: dentro do próprio
 * castelo, e não o mapa inteiro.
 *
 * ## Por que uma coluna fechada, e não a coordenada exata do gesto
 *
 * O aquecimento existe para escolher chapéu, não para escolher informação. Sem
 * um limite, os cinco segundos de antes do apito virariam corrida até o meio
 * do mapa: quem chega primeiro vê onde o inimigo decidiu ficar, e o apito
 * deixa de ser o início da partida para ser o fim de uma espiada. Fechado, o
 * primeiro passo de todo mundo é o mesmo — dado às cegas, ao mesmo tempo,
 * porque é isso que o apito passa a significar.
 *
 * A fronteira é a **coluna do próprio portão** — o mesmo `portoes[0]` que o
 * teste de arena já usa para garantir que o mapa estrangula onde promete — e
 * não um raio em torno do nascedouro. Um raio cortaria a chapelaria fora do
 * alcance em qualquer mapa onde ela não fica colada ao ninho, e o aquecimento
 * existe **exatamente** para vestir um chapéu antes da partida começar.
 *
 * O Vau não tem portão — é a proposta dele, castelo aberto. Sem gate para
 * ler, a fronteira cai no eixo do espelho, que é a única linha que ainda faz
 * o mesmo sentido dos dois lados: o rio que já divide o mapa ao meio.
 */
function fronteiraDoAquecimento(mapa: Mapa, time: Time): number {
  const portao = mapa.portoes[0];
  const colunaTx = portao ? portao.coluna : (mapa.largura - 1) / 2;
  const colunaMundo = (colunaTx + 0.5) * TILE;
  return time === 'azul' ? colunaMundo : mapa.largura * TILE - colunaMundo;
}

/** Meio tile de folga: perto o bastante da fronteira sem grudar nela. */
const FOLGA_DO_AQUECIMENTO = TILE * 0.6;

export function moverUnidade(
  arena: Arena,
  estado: Estado,
  u: Unidade,
  c: Comando,
  dt: number,
): void {
  let mx = c.mx;
  let my = c.my;
  const tamanho = Math.hypot(mx, my);
  if (tamanho > 1) {
    mx /= tamanho;
    my /= tamanho;
  }

  // A mira manda no olhar; o movimento só decide quando não há mira. É o que
  // deixa o arqueiro recuar sem virar as costas.
  const mira = Math.hypot(c.ax, c.ay);
  if (mira > 0.001) {
    u.olharX = c.ax / mira;
    u.olharY = c.ay / mira;
  } else if (tamanho > 0.001) {
    const n = Math.hypot(mx, my);
    u.olharX = mx / n;
    u.olharY = my / n;
  }

  let velocidade = u.fera ? PERFIS_DE_FERA[u.fera].velocidade : perfil(u.classe).velocidade;
  if (u.carga !== 'nada' && u.carga !== 'bau') velocidade *= 0.95;
  if (u.carga === 'bau') {
    const p = estado.baus.find((x) => x.portador === u.id);
    if (p) {
      velocidade *= velocidadeCarregando(p.peso);
      // Sem a escolta exigida, o cortejo simplesmente não sai do lugar. Deixar
      // andar devagar seria mais gentil e destruiria o sentido do peso: o
      // resgate precisa ser uma decisão do time, não do carregador.
      if (p.ajudantes + 1 < carregadoresPara(p.peso, estado.porTime)) velocidade = 0;
    }
  }

  const novo = resolverColisao(
    arena,
    u.x + mx * velocidade * dt,
    u.y + my * velocidade * dt,
    RAIO_UNIDADE,
  );
  u.x = novo.x;
  u.y = novo.y;

  // A parede fechada do aquecimento. Só nesta fase: no meio da partida (a
  // pausa de `ponto` inclusive) o time já provou que sabe onde é o mapa, e
  // uma parede reaparecendo ali seria um bug, não uma regra.
  if (estado.fase === 'aquecimento') {
    const fronteira = fronteiraDoAquecimento(mapaDe(arena.mapa), u.time);
    const preso =
      u.time === 'azul'
        ? Math.min(u.x, fronteira - FOLGA_DO_AQUECIMENTO)
        : Math.max(u.x, fronteira + FOLGA_DO_AQUECIMENTO);
    if (preso !== u.x) {
      const ajustado = resolverColisao(arena, preso, u.y, RAIO_UNIDADE);
      u.x = ajustado.x;
      u.y = ajustado.y;
    }
  }
}

// --- ação de contexto ------------------------------------------------------

const perto = (a: { x: number; y: number }, b: { x: number; y: number }, r: number): boolean =>
  (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y) <= r * r;

function estruturaPerto(
  arena: Arena,
  u: Unidade,
  tipo: TipoDeEstrutura,
  time: Time,
  alcance = ALCANCE_DE_USO,
): boolean {
  return perto(u, arena.estrutura(tipo, time), alcance);
}

/**
 * O botão de contexto, e a ordem em que ele decide.
 *
 * Um botão só, porque o jogo se joga com uma mão no teclado e a outra no mouse
 * — e porque um menu de verbos no meio de uma briga é como perder a briga. A
 * ordem abaixo é a ordem da urgência: o que está nas mãos primeiro, o que está
 * embaixo dos pés depois.
 */
function usar(arena: Arena, estado: Estado, u: Unidade): void {
  const meu = u.time;
  const inimigo = outroTime(meu);

  if (u.carga === 'bau') {
    const p = estado.baus.find((x) => x.portador === u.id);
    if (!p) {
      u.carga = 'nada';
      return;
    }
    if (estruturaPerto(arena, u, 'tesouraria', meu, ALCANCE_DE_COLETA)) {
      marcarPonto(estado, u, p);
    } else {
      largarBau(estado, p);
      u.carga = 'nada';
    }
    return;
  }

  if (u.carga === 'bolsa') {
    // Entulhar a refém da **sua** cofre é o gesto central do jogo: move a
    // balança nos dois sentidos de uma vez.
    const refem = bauDe(estado, inimigo);
    if (refem.onde === 'cofre' && estruturaPerto(arena, u, 'cofre', meu, ALCANCE_DE_COLETA)) {
      entulhar(estado, u, refem);
      return;
    }
    // Longe do cofre, a bolsa vira o que qualquer bolsa é: comida.
    const maximo = vidaMaximaDe(u.classe, nivelDe(estado, meu), u.fera);
    if (u.vida < maximo) {
      u.vida = Math.min(maximo, u.vida + CURA_DA_BOLSA);
      u.carga = 'nada';
    }
    return;
  }

  if (u.carga === 'minerio') {
    if (estruturaPerto(arena, u, 'casaDaMoeda', meu, ALCANCE_DE_COLETA)) {
      casaDaMoedaDe(estado, meu).minerio++;
      u.carga = 'nada';
      u.entregas++;
    }
    return;
  }

  if (u.carga === 'madeira' || u.carga === 'ouro') {
    if (estruturaPerto(arena, u, 'chapelaria', meu, ALCANCE_DE_COLETA)) {
      entregarNaObra(estado, u, u.carga);
    }
    return;
  }

  // Mãos vazias. Primeiro o que está no chão, que é o que o jogador vê embaixo
  // do próprio personagem.
  const item = itemMaisPerto(estado, u);
  if (item) {
    pegarItem(estado, u, item);
    return;
  }

  // O baú do próprio time, presa lá ou largada no caminho. Ninguém
  // sequestra o baú inimiga de novo: o objetivo é trazer a sua.
  const minha = bauDe(estado, meu);
  if (
    (minha.onde === 'cofre' || minha.onde === 'chao') &&
    perto(u, minha, ALCANCE_DE_COLETA)
  ) {
    pegarBau(estado, u, minha);
    return;
  }

  if (estruturaPerto(arena, u, 'casaDaMoeda', meu)) {
    const casaDaMoeda = casaDaMoedaDe(estado, meu);
    if (casaDaMoeda.bolsas > 0) {
      casaDaMoeda.bolsas--;
      u.carga = 'bolsa';
    }
    return;
  }

  if (estruturaPerto(arena, u, 'chapelaria', meu)) {
    vestirDaChapelaria(estado, u);
    return;
  }

  comecarTrabalho(arena, estado, u);
}

function itemMaisPerto(estado: Estado, u: Unidade): Item | null {
  let melhor: Item | null = null;
  let menor = Infinity;
  for (const i of estado.itens) {
    const d = (i.x - u.x) ** 2 + (i.y - u.y) ** 2;
    if (d < menor && d <= ALCANCE_DE_COLETA ** 2) {
      menor = d;
      melhor = i;
    }
  }
  return melhor;
}

function pegarItem(estado: Estado, u: Unidade, item: Item): void {
  estado.itens = estado.itens.filter((i) => i.id !== item.id);
  if (item.tipo !== 'chapeu') {
    u.carga = item.tipo;
    return;
  }
  const classe = item.classe!;
  const roubado = item.origem !== null && item.origem !== u.time;
  soltarChapeuNoChao(estado, u);
  trocarClasse(estado, u, classe, false);
  estado.eventos.push({ tipo: 'chapeu', unidade: u.id, classe, roubado });
}

/**
 * Veste o próximo chapéu disponível na chapelaria, em ciclo.
 *
 * Um botão só de novo. Apertar de novo passa para o próximo — quem quer virar
 * arqueiro aperta até chegar no arqueiro, e vê a chapelaria mudar na tela
 * enquanto isso. O chapéu atual volta ao estoque antes da conta, senão o
 * jogador que já é guerreiro nunca conseguiria voltar a ser guerreiro depois de
 * rodar a lista inteira.
 */
function vestirDaChapelaria(estado: Estado, u: Unidade): void {
  const estoque = estado.estoque[u.time];
  // Na Chapelaria aberta o estoque não se esgota. É um `||` e não um caminho
  // separado de propósito: o resto da função — rodar a lista, passar pelo
  // aldeão, encher a vida — continua sendo exatamente o mesmo código, e um modo
  // não pode ter um jeito próprio de vestir chapéu que ninguém mais exercita.
  const infinitos = modoDe(estado.modo).chapeusInfinitos;
  const atual = CLASSES_COM_CHAPEU.indexOf(u.classe);
  devolverChapeu(estado, u);
  for (let passo = 1; passo <= CLASSES_COM_CHAPEU.length + 1; passo++) {
    const i = (atual + passo) % (CLASSES_COM_CHAPEU.length + 1);
    if (i === CLASSES_COM_CHAPEU.length) {
      // A volta completa passa pelo aldeão — é a forma de largar o chapéu.
      trocarClasse(estado, u, 'aldeao', true);
      return;
    }
    const classe = CLASSES_COM_CHAPEU[i]!;
    if (infinitos || estoque[classe] > 0) {
      if (!infinitos) estoque[classe]--;
      trocarClasse(estado, u, classe, true);
      // Vestir na própria chapelaria não gera evento: quem roda a lista até
      // achar o chapéu que quer produziria meia dúzia de avisos por troca, e o
      // retrato paga por cada um. Roubo, que é notícia, continua avisando.
      return;
    }
  }
}

/**
 * @param cheio quando a troca é na própria chapelaria, a vida enche; quando é
 * um chapéu catado do chão no meio do campo, ela é convertida em proporção —
 * senão morrer e vestir viraria a forma mais rápida de se curar.
 */
function trocarClasse(estado: Estado, u: Unidade, classe: Classe, cheio: boolean): void {
  const nivel = nivelDe(estado, u.time);
  const razao = u.vida / vidaMaximaDe(u.classe, nivel, u.fera);
  // Vestir chapéu de verdade acaba a fera: o chapéu é uma escolha de
  // classe, e as duas coisas por cima da mesma unidade só confundiriam
  // qual conta de vida vale.
  if (u.fera) {
    u.fera = null;
    estado.eventos.push({ tipo: 'voltouAoNormal', unidade: u.id });
  }
  u.classe = classe;
  const maximo = vidaMaxima(classe, nivel);
  u.vida = cheio ? maximo : Math.max(1, Math.round(maximo * razao));
  u.colhendoId = null;
  u.colheita = 0;
}

function devolverChapeu(estado: Estado, u: Unidade): void {
  if (u.classe === 'aldeao') return;
  estado.estoque[u.time][u.classe]++;
}

/** Larga o chapéu onde a unidade está, para quem passar — inclusive o inimigo. */
function soltarChapeuNoChao(estado: Estado, u: Unidade): void {
  if (u.classe === 'aldeao') return;
  estado.itens.push({
    id: estado.proximoId++,
    tipo: 'chapeu',
    classe: u.classe,
    origem: u.time,
    x: u.x,
    y: u.y,
    voltaEm: CHAPEU_VOLTA_EM,
  });
}

// --- ofícios ---------------------------------------------------------------

/** Segundos de trabalho nesta jazida para esta classe. */
function tempoDeTrabalho(u: Unidade, tipo: 'arvore' | 'ouro'): number {
  const oficio = perfil(u.classe).oficio;
  const combina = (tipo === 'arvore' && oficio === 'madeira') || (tipo === 'ouro' && oficio === 'ouro');
  return combina ? TEMPO_DE_TRABALHO : TEMPO_DE_TRABALHO * LERDEZA_DO_ALDEAO;
}

function comecarTrabalho(arena: Arena, estado: Estado, u: Unidade): void {
  for (const j of arena.jazidas) {
    const alvo = estado.jazidas.find((x) => x.id === j.id)!;
    if (!alvo.cheia || !perto(u, j, ALCANCE_DE_COLETA)) continue;
    if (alvo.ocupadaPor !== null && alvo.ocupadaPor !== u.id) continue;
    alvo.ocupadaPor = u.id;
    u.colhendoId = j.id;
    u.colheita = 0;
    return;
  }
}

function trabalhar(arena: Arena, estado: Estado, u: Unidade, c: Comando): void {
  if (u.colhendoId === null) return;
  const jazida = estado.jazidas.find((j) => j.id === u.colhendoId);
  const daArena = arena.jazidas.find((j) => j.id === u.colhendoId);
  // Andar cancela. Trabalhar é o momento em que o ofício está indefeso, e é
  // isso que faz a economia custar posição em vez de custar nada.
  if (
    !jazida ||
    !daArena ||
    !jazida.cheia ||
    Math.hypot(c.mx, c.my) > 0.01 ||
    u.carga !== 'nada' ||
    !perto(u, daArena, ALCANCE_DE_COLETA * 1.2)
  ) {
    if (jazida && jazida.ocupadaPor === u.id) jazida.ocupadaPor = null;
    u.colhendoId = null;
    u.colheita = 0;
    return;
  }
  u.colheita += DT / tempoDeTrabalho(u, daArena.tipo);
  if (u.colheita < 1) return;
  jazida.cheia = false;
  jazida.voltaEm = JAZIDA_VOLTA_EM;
  jazida.ocupadaPor = null;
  u.colhendoId = null;
  u.colheita = 0;
  u.carga = daArena.tipo === 'arvore' ? 'madeira' : 'ouro';
}

function recomporJazidas(estado: Estado): void {
  for (const j of estado.jazidas) {
    if (j.cheia) continue;
    j.voltaEm -= DT;
    if (j.voltaEm <= 0) j.cheia = true;
  }
}

/**
 * A obra: madeira e ouro entregues na chapelaria sobem o nível do reino.
 *
 * O nível engorda vida e dano de todo o time, e é por isso que o ofício
 * importa numa briga da qual ele não participa. Subir custa os **dois**
 * materiais: um time só de lenhador acumula madeira e não levanta nada.
 */
function entregarNaObra(estado: Estado, u: Unidade, carga: 'madeira' | 'ouro'): void {
  const oficina = oficinaDe(estado, u.time);
  if (carga === 'madeira') oficina.madeira++;
  else oficina.ouro++;
  u.carga = 'nada';
  u.entregas++;

  while (oficina.nivel < NIVEL_MAXIMO) {
    const base = CUSTO_DO_NIVEL[oficina.nivel + 1]!;
    const custo = {
      madeira: custoDaObraDe(base.madeira, estado.porTime),
      ouro: custoDaObraDe(base.ouro, estado.porTime),
    };
    if (oficina.madeira < custo.madeira || oficina.ouro < custo.ouro) break;
    oficina.madeira -= custo.madeira;
    oficina.ouro -= custo.ouro;
    oficina.nivel++;
    estado.eventos.push({ tipo: 'nivel', time: u.time, nivel: oficina.nivel });
    // No modo Obra a chapelaria pronta acaba a partida. A conferência é aqui,
    // no único lugar que sobe nível: procurá-la no tick custaria uma volta por
    // quadro para responder a uma pergunta que só muda quando alguém entrega
    // uma tábua.
    if (modoDe(estado.modo).vitoriaPorObra && oficina.nivel >= NIVEL_MAXIMO) {
      terminar(estado, u.time);
      return;
    }
    // O nível novo vale para quem já está em campo: a vida máxima subiu, e
    // seria cruel deixar o time inteiro com a barra pela metade por isso.
    for (const outro of estado.unidades) {
      if (outro.time !== u.time || !outro.vivo) continue;
      outro.vida = Math.min(vidaMaximaDe(outro.classe, oficina.nivel, outro.fera), outro.vida + 15);
    }
  }
}

function cunhar(estado: Estado): void {
  for (const c of estado.casasDaMoeda) {
    if (c.cunhando > 0) {
      c.cunhando -= DT;
      if (c.cunhando <= 0) {
        c.cunhando = 0;
        c.bolsas = Math.min(BOLSAS_NA_CASA, c.bolsas + 1);
      }
      continue;
    }
    if (c.minerio >= MINERIO_POR_BOLSA && c.bolsas < BOLSAS_NA_CASA) {
      c.minerio -= MINERIO_POR_BOLSA;
      c.cunhando = TEMPO_DE_CUNHAGEM;
    }
  }
}

function envelhecerItens(estado: Estado): void {
  for (const i of estado.itens) i.voltaEm -= DT;
  const expirados = estado.itens.filter((i) => i.voltaEm <= 0);
  for (const i of expirados) {
    // Chapéu esquecido volta para a chapelaria de origem. Sem isso, uma partida
    // longa acaba com o mapa cheio de chapéu e os dois times de aldeão.
    if (i.tipo === 'chapeu' && i.classe && i.origem) estado.estoque[i.origem][i.classe]++;
  }
  estado.itens = estado.itens.filter((i) => i.voltaEm > 0);
}

// --- os bichos -------------------------------------------------------------

/**
 * As ovelhas: pastam, e correm quando apanham.
 *
 * Elas são a única fonte de minério, e minério é a única entrada do bolsa — então
 * este pedaço de código, que parece decoração, é o começo da cadeia que move a
 * balança. O saqueador as derruba em três golpes; qualquer outro leva o dobro do
 * tempo e vira alvo fácil enquanto tenta.
 */
function moverAnimais(arena: Arena, estado: Estado): void {
  // Na Veia Seca o pasto não repõe: o minério do mapa é finito, e e com ele a moeda e o
  // teto da balança. O relógio do bicho morto continua correndo à toa em vez de
  // ganhar um `if` só para ele — é um decremento por bicho e por tick, e o
  // caminho de reposição fica com uma condição só, no lugar onde a regra é.
  const repoe = modoDe(estado.modo).animaisVoltam;
  for (const a of estado.animais) {
    if (!a.vivo) {
      a.voltaEm -= DT;
      if (repoe && a.voltaEm <= 0) reporAnimal(arena, estado, a);
      continue;
    }
    a.fugindo = Math.max(0, a.fugindo - DT);
    a.pensaEm -= DT;
    if (a.pensaEm <= 0) escolherDestino(arena, estado, a);

    const dx = a.destinoX - a.x;
    const dy = a.destinoY - a.y;
    const d = Math.hypot(dx, dy);
    if (d < 6) {
      // Chegou: fica pastando um tempo antes de escolher outro canto.
      a.pensaEm = Math.min(a.pensaEm, a.fugindo > 0 ? 0.2 : 2.5);
      continue;
    }
    const velocidade = a.fugindo > 0 ? ANIMAL_FUGINDO : ANIMAL_PASTANDO;
    const passo = resolverColisao(
      arena,
      a.x + (dx / d) * velocidade * DT,
      a.y + (dy / d) * velocidade * DT,
      RAIO_UNIDADE * 0.8,
    );
    a.x = passo.x;
    a.y = passo.y;
  }
}

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
function moverInvasores(arena: Arena, estado: Estado): void {
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
      for (let i = 0; i < INVASAO_TAMANHO; i++) {
        estado.invasores.push({
          id: estado.proximoId++,
          time,
          x: chapelaria.x + ladoDeFora * TILE * 3.5,
          y: chapelaria.y + (i - (INVASAO_TAMANHO - 1) / 2) * TILE,
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
      estado.eventos.push({ tipo: 'invasaoAfugentada', time: inv.time });
      continue;
    }

    const chapelaria = arena.estrutura('chapelaria', inv.time);
    if (perto(inv, chapelaria, INVASAO_RAIO_DO_SAQUE)) {
      const estoque = estado.estoque[inv.time];
      const comEstoque = CLASSES_COM_CHAPEU.filter((c) => estoque[c] > 0);
      let roubada: Classe | null = null;
      if (comEstoque.length > 0) {
        // Semeado pelo id do goblin e o tick — o mesmo compromisso do sorteio
        // da ovelha: dois servidores rodando a mesma partida roubam o mesmo
        // chapéu.
        const dado = new DeterministicRandom(((inv.id + 1) * 2654435761 + estado.tick) >>> 0);
        roubada = comEstoque[dado.nextIntBelow(comEstoque.length)]!;
        estoque[roubada]--;
      }
      estado.eventos.push({ tipo: 'invasaoRoubou', time: inv.time, classe: roubada });
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
function moverTotem(arena: Arena, estado: Estado): void {
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
    const dado = new DeterministicRandom(((u.id + 1) * 2654435761 + estado.tick) >>> 0);
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
function moverCanhoes(arena: Arena, estado: Estado): void {
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

/**
 * Para onde o bicho vai — com sorteio semeado, não aleatório.
 *
 * A semente junta o id do animal e o tick, então dois servidores rodando a
 * mesma partida veem a mesma ovelha no mesmo lugar. É o mesmo compromisso do
 * resto do tick: nada aqui pode depender do relógio da máquina.
 */
function escolherDestino(arena: Arena, estado: Estado, a: Animal): void {
  const pasto = arena.pastos.find((p) => p.id === a.id);
  const dado = new DeterministicRandom(((a.id + 1) * 2654435761 + estado.tick) >>> 0);
  const angulo = dado.nextDouble() * Math.PI * 2;
  const raio = ANIMAL_PASTO * (0.3 + dado.nextDouble() * 0.7);
  const centroX = a.fugindo > 0 ? a.x : (pasto?.x ?? a.x);
  const centroY = a.fugindo > 0 ? a.y : (pasto?.y ?? a.y);
  const alvo = resolverColisao(
    arena,
    centroX + Math.cos(angulo) * raio,
    centroY + Math.sin(angulo) * raio,
    RAIO_UNIDADE,
  );
  a.destinoX = alvo.x;
  a.destinoY = alvo.y;
  a.pensaEm = a.fugindo > 0 ? 0.6 : 2 + dado.nextDouble() * 3;
}

function reporAnimal(arena: Arena, estado: Estado, a: Animal): void {
  const pasto = arena.pastos.find((p) => p.id === a.id);
  a.vivo = true;
  a.vida = ANIMAL_VIDA;
  a.x = pasto?.x ?? a.x;
  a.y = pasto?.y ?? a.y;
  a.destinoX = a.x;
  a.destinoY = a.y;
  a.fugindo = 0;
  a.pensaEm = 0;
  void estado;
}

function ferirAnimal(estado: Estado, algoz: Unidade, a: Animal, dano: number): void {
  a.vida -= dano * perfil(algoz.classe).danoContraAnimal;
  a.fugindo = ANIMAL_PANICO;
  a.pensaEm = 0;
  if (a.vida > 0) return;
  a.vivo = false;
  a.voltaEm = ANIMAL_VOLTA_EM;
  estado.itens.push({
    id: estado.proximoId++,
    tipo: 'minerio',
    classe: null,
    origem: null,
    x: a.x,
    y: a.y,
    voltaEm: CHAPEU_VOLTA_EM,
  });
  estado.eventos.push({ tipo: 'saque', unidade: algoz.id });
}

// --- a balança -------------------------------------------------------------

/**
 * O depósito, e a conta que dá nome ao jogo.
 *
 * O que a refém ganha, o baú do próprio time perde — exatamente, e no
 * mesmo instante. `delta` é cortado pelas duas pontas antes de qualquer coisa
 * mudar, porque cortar depois quebraria a soma: bastaria uma dos baús
 * bater no limite para o peso total do reino mudar sem que ninguém notasse.
 */
function entulhar(estado: Estado, u: Unidade, refem: Bau): void {
  const minha = bauDe(estado, u.time);
  const teto = pesoMaximoDe(estado.porTime);
  const piso = pesoMinimoDe(estado.porTime);
  const delta = Math.min(PESO_POR_BOLSA, teto - refem.peso, minha.peso - piso);
  if (delta <= 0) return;

  refem.peso += delta;
  minha.peso -= delta;
  u.carga = 'nada';
  u.depositos++;
  estado.eventos.push({ tipo: 'deposito', unidade: u.id, bau: refem.time, peso: refem.peso });

  // No Cofre Cheio, a balança no talo acaba a partida. A conferência é aqui, na
  // única função do jogo que move peso: procurá-la no tick custaria uma volta
  // por quadro para responder a uma pergunta que só muda quando alguém entrega
  // um depósito.
  const modo = modoDe(estado.modo);
  if (modo.vitoriaPorBalanca && minha.peso <= modo.pesoQueVence) {
    terminar(estado, u.time);
    return;
  }

  // O baú não gosta de ser engordada por estranhos, e empurra quem estiver
  // colado nela. Serve ao jogo: impede que o time inteiro fique parado dentro
  // do cofre em cima da refém enquanto o inimigo tenta o resgate.
  for (const outro of estado.unidades) {
    if (!outro.vivo || outro.time === u.time) continue;
    const d = Math.hypot(outro.x - refem.x, outro.y - refem.y);
    if (d > ALCANCE_DE_USO || d < 0.001) continue;
    outro.x += ((outro.x - refem.x) / d) * EMPURRAO_DO_BAU * DT * 4;
    outro.y += ((outro.y - refem.y) / d) * EMPURRAO_DO_BAU * DT * 4;
  }
}

// --- baús -------------------------------------------------------------

function pegarBau(estado: Estado, u: Unidade, p: Bau): void {
  p.onde = 'carregado';
  p.portador = u.id;
  p.voltaEm = 0;
  u.carga = 'bau';
  u.colhendoId = null;
  estado.eventos.push({ tipo: 'pegouBau', unidade: u.id, bau: p.time });
}

function largarBau(estado: Estado, p: Bau): void {
  p.onde = 'chao';
  p.portador = null;
  p.voltaEm = BAU_VOLTA_EM;
  p.ajudantes = 0;
  estado.eventos.push({ tipo: 'largouBau', bau: p.time });
}

function cuidarDosBaus(arena: Arena, estado: Estado): void {
  for (const p of estado.baus) {
    if (p.onde === 'carregado') {
      const portador = unidade(estado, p.portador);
      if (!portador || !portador.vivo || portador.carga !== 'bau') {
        largarBau(estado, p);
        continue;
      }
      p.x = portador.x;
      p.y = portador.y;
      p.ajudantes = estado.unidades.filter(
        (o) =>
          o.id !== portador.id &&
          o.vivo &&
          o.time === p.time &&
          o.carga !== 'bau' &&
          perto(o, portador, ALCANCE_DE_AJUDA),
      ).length;
      continue;
    }
    if (p.onde === 'chao') {
      p.voltaEm -= DT;
      if (p.voltaEm <= 0) devolverBau(arena, p);
    }
  }
}

function devolverBau(arena: Arena, p: Bau): void {
  const cofre = arena.estrutura('cofre', outroTime(p.time));
  p.onde = 'cofre';
  p.x = cofre.x;
  p.y = cofre.y;
  p.portador = null;
  p.voltaEm = 0;
  p.ajudantes = 0;
}

function marcarPonto(estado: Estado, u: Unidade, p: Bau): void {
  p.onde = 'resgatado';
  p.portador = null;
  u.carga = 'nada';
  u.resgates++;
  estado.placar[u.time]++;
  estado.eventos.push({ tipo: 'resgate', unidade: u.id, time: u.time });

  if (estado.placar[u.time] >= modoDe(estado.modo).pontosParaVencer) {
    terminar(estado, u.time);
    return;
  }
  estado.fase = 'ponto';
  estado.faseEm = PAUSA_APOS_PONTO;
}

/**
 * Recomeça a rodada depois de um ponto.
 *
 * A balança **não** volta ao zero: ela relaxa metade do caminho. Zerar apagaria
 * o trabalho de economia do time que dominou a Casa da Moeda, e manter congelaria a
 * partida a favor de quem abriu vantagem. Meio caminho preserva a história sem
 * deixar a bola de neve rolar.
 */
function recomecarRodada(arena: Arena, estado: Estado): void {
  // No Cofre Cheio a balança **não** relaxa, e isso não é uma segunda alavanca: é
  // a primeira funcionando. Uma condição de vitória que outra regra apaga a cada
  // ponto não é condição de vitória nenhuma — medido com bots, o modo terminava
  // idêntico ao clássico nas três seeds testadas, mesmo placar e mesmos pesos, e
  // a barra nunca chegava perto do talo que o modo promete.
  //
  // Sem o relaxamento, a promessa passa a acontecer: numa das mesmas três seeds
  // a partida acaba com a barra no fim (40/160), e nas outras duas o resgate
  // decide. É o que o modo diz ser — dois caminhos, e escolher entre eles é o
  // jogo.
  const relaxa = !modoDe(estado.modo).vitoriaPorBalanca;
  for (const p of estado.baus) {
    const meio = pesoTotalDe(estado.porTime) / 2;
    if (relaxa) p.peso = meio + (p.peso - meio) / 2;
    devolverBau(arena, p);
  }
  estado.projeteis = [];
  for (const u of estado.unidades) {
    u.vivo = true;
    u.renasceEm = 0;
    u.vida = vidaMaxima(u.classe, nivelDe(estado, u.time));
    u.carga = 'nada';
    u.colhendoId = null;
    u.colheita = 0;
    porNoNascedouro(arena, estado, u);
  }
  for (const j of estado.jazidas) {
    j.cheia = true;
    j.voltaEm = 0;
    j.ocupadaPor = null;
  }
}

function conferirRelogio(estado: Estado): void {
  if (estado.relogio > 0) return;
  const { azul, vermelho } = estado.placar;
  if (azul !== vermelho) {
    terminar(estado, azul > vermelho ? 'azul' : 'vermelho');
    return;
  }
  // Empate no placar: ganha quem venceu a balança. O baú mais leve é a do
  // time que entregou mais depósitos, e é o desempate que o jogo inteiro treinou.
  const pesoAzul = bauDe(estado, 'azul').peso;
  const pesoVermelho = bauDe(estado, 'vermelho').peso;
  if (pesoAzul === pesoVermelho) {
    terminar(estado, null);
    return;
  }
  terminar(estado, pesoAzul < pesoVermelho ? 'azul' : 'vermelho');
}

function terminar(estado: Estado, vencedor: Time | null): void {
  estado.fase = 'fim';
  estado.faseEm = 0;
  estado.vencedor = vencedor;
  estado.eventos.push({ tipo: 'fim', vencedor });
}

// --- combate ---------------------------------------------------------------

/** O golpe corpo a corpo: meia-volta à frente, no alcance. Classe ou fera. */
function golpearCorpoATodos(estado: Estado, u: Unidade, alcance: number, dano: number): void {
  for (const alvo of estado.unidades) {
    if (!alvo.vivo || alvo.time === u.time) continue;
    const dx = alvo.x - u.x;
    const dy = alvo.y - u.y;
    const d = Math.hypot(dx, dy);
    if (d > alcance + RAIO_UNIDADE) continue;
    // Meia-volta à frente: bater em quem está nas costas transformaria o
    // corpo a corpo num círculo de dano e apagaria o flanqueamento.
    if (d > 0.001 && (dx / d) * u.olharX + (dy / d) * u.olharY < 0) continue;
    ferir(estado, u, alvo, dano);
  }
  ferirBichosNoAlcance(estado, u, alcance + RAIO_UNIDADE, dano);
}

function atacar(arena: Arena, estado: Estado, u: Unidade): void {
  if (u.recarga > 0 || u.carga === 'bau') return;

  // A fera ignora a classe por baixo — o Troll ataca como Troll, não como o
  // aldeão ou guerreiro que a pessoa era antes de pegar o totem.
  if (u.fera) {
    const fp = PERFIS_DE_FERA[u.fera];
    u.recarga = fp.cadencia;
    u.golpe = fp.duracaoDoGolpe;
    u.colhendoId = null;
    golpearCorpoATodos(estado, u, fp.alcance, fp.dano);
    return;
  }

  const p = perfil(u.classe);
  u.recarga = p.cadencia;
  u.golpe = p.duracaoDoGolpe;
  u.colhendoId = null;

  if (p.ataque === 'cura') {
    curar(estado, u);
    return;
  }

  const dano = danoDe(u.classe, nivelDe(estado, u.time));

  if (p.ataque === 'corpo') {
    golpearCorpoATodos(estado, u, p.alcance, dano);
    return;
  }

  if (p.ataque === 'linha') {
    // A lança fura a fila: quem estiver no corredor à frente apanha, mesmo o
    // segundo e o terceiro. É o que dá ao lanceiro a função de segurar ponte.
    for (const alvo of estado.unidades) {
      if (!alvo.vivo || alvo.time === u.time) continue;
      if (!naLinha(u, alvo, p.alcance)) continue;
      ferir(estado, u, alvo, dano);
    }
    for (const a of estado.animais) {
      if (a.vivo && naLinha(u, a, p.alcance)) ferirAnimal(estado, u, a, dano);
    }
    return;
  }

  const velocidade = 620;
  estado.projeteis.push({
    id: estado.proximoId++,
    tipo: 'flecha',
    time: u.time,
    dono: u.id,
    x: u.x + u.olharX * (RAIO_UNIDADE + 6),
    y: u.y + u.olharY * (RAIO_UNIDADE + 6),
    vx: u.olharX * velocidade,
    vy: u.olharY * velocidade,
    dano,
    vida: p.alcance / velocidade,
  });
  void arena;
}

/** Se o alvo está no corredor à frente da unidade. */
function naLinha(u: Unidade, alvo: { x: number; y: number }, alcance: number): boolean {
  const dx = alvo.x - u.x;
  const dy = alvo.y - u.y;
  const aoLongo = dx * u.olharX + dy * u.olharY;
  if (aoLongo < 0 || aoLongo > alcance + RAIO_UNIDADE) return false;
  const atravessado = Math.abs(dx * u.olharY - dy * u.olharX);
  return atravessado <= RAIO_UNIDADE + 10;
}

function ferirBichosNoAlcance(
  estado: Estado,
  u: Unidade,
  alcance: number,
  dano: number,
): void {
  for (const a of estado.animais) {
    if (!a.vivo) continue;
    const dx = a.x - u.x;
    const dy = a.y - u.y;
    const d = Math.hypot(dx, dy);
    if (d > alcance) continue;
    if (d > 0.001 && (dx / d) * u.olharX + (dy / d) * u.olharY < 0) continue;
    ferirAnimal(estado, u, a, dano);
  }
}

function curar(estado: Estado, u: Unidade): void {
  const p = perfil(u.classe);
  const nivel = nivelDe(estado, u.time);
  let alvo: Unidade | null = null;
  let pior = 1;
  for (const o of estado.unidades) {
    if (!o.vivo || o.time !== u.time || o.id === u.id) continue;
    if (!perto(o, u, p.alcance)) continue;
    const razao = o.vida / vidaMaximaDe(o.classe, nivel, o.fera);
    if (razao < pior) {
      pior = razao;
      alvo = o;
    }
  }
  const quem = alvo ?? u;
  quem.vida = Math.min(vidaMaximaDe(quem.classe, nivel, quem.fera), quem.vida + p.dano);
  estado.eventos.push({ tipo: 'cura', clerigo: u.id, alvo: quem.id });
}

function moverProjeteis(arena: Arena, estado: Estado): void {
  const sobreviventes: typeof estado.projeteis = [];
  for (const pj of estado.projeteis) {
    pj.x += pj.vx * DT;
    pj.y += pj.vy * DT;
    pj.vida -= DT;

    let acabou = pj.vida <= 0;
    if (!acabou && arena.bloqueado(Math.floor(pj.x / TILE), Math.floor(pj.y / TILE))) {
      acabou = true;
    }

    if (!acabou && pj.tipo === 'bolaDeCanhao') {
      // A bala do canhão dói, mas não mata: é dissuasão de estrutura, não um
      // atirador com abate no nome. Deixar em 1 de vida em vez de zero poupa
      // o canhão inteiro de precisar de um `algoz` — não há unidade nenhuma
      // para carregar a culpa de um disparo que ninguém apertou o gatilho.
      for (const alvo of estado.unidades) {
        if (!alvo.vivo || alvo.time === pj.time) continue;
        if (!perto(alvo, pj, RAIO_UNIDADE + 6)) continue;
        alvo.vida = Math.max(1, alvo.vida - pj.dano);
        acabou = true;
        break;
      }
    } else if (!acabou) {
      const dono = unidade(estado, pj.dono);
      for (const alvo of estado.unidades) {
        if (!alvo.vivo || alvo.time === pj.time) continue;
        if (!perto(alvo, pj, RAIO_UNIDADE + 6)) continue;
        ferir(estado, dono ?? alvo, alvo, pj.dano);
        acabou = true;
        break;
      }
      if (!acabou && dono) {
        for (const a of estado.animais) {
          if (!a.vivo || !perto(a, pj, RAIO_UNIDADE + 6)) continue;
          ferirAnimal(estado, dono, a, pj.dano);
          acabou = true;
          break;
        }
      }
    }

    if (acabou) continue;
    sobreviventes.push(pj);
  }
  estado.projeteis = sobreviventes;
}

function ferir(estado: Estado, algoz: Unidade, alvo: Unidade, dano: number): void {
  alvo.vida -= dano;
  if (alvo.vida > 0) return;
  morrer(estado, algoz, alvo);
}

function morrer(estado: Estado, algoz: Unidade, alvo: Unidade): void {
  alvo.vivo = false;
  alvo.vida = 0;
  alvo.mortes++;
  // Cair também acaba a transformação — ninguém renasce Troll. `reviver`
  // já usa `vidaMaxima` puro, sem `fera`, e é este limpo aqui que garante
  // que a conta bate.
  if (alvo.fera) {
    alvo.fera = null;
    estado.eventos.push({ tipo: 'voltouAoNormal', unidade: alvo.id });
  }
  if (algoz.id !== alvo.id && algoz.time !== alvo.time) {
    algoz.abates++;
    // A contagem é do **time**, e não a soma dos abates de quem está em campo:
    // um bot dispensado leva embora os abates dele, e o placar de um modo de
    // combate não pode andar para trás porque alguém saiu da sala.
    estado.abates[algoz.time]++;
  }
  estado.eventos.push({ tipo: 'abate', algoz: algoz.id, vitima: alvo.id });

  const alvoDeAbates = modoDe(estado.modo).abatesParaVencer;
  if (alvoDeAbates !== null && estado.abates[algoz.time] >= alvoDeAbates) {
    terminar(estado, algoz.time);
    return;
  }

  soltarChapeuNoChao(estado, alvo);
  alvo.classe = 'aldeao';
  soltarTudo(estado, alvo);
  alvo.renasceEm =
    modoDe(estado.modo).renascimentoBase +
    estado.placar[outroTime(alvo.time)] * RENASCIMENTO_POR_PONTO;
}

/** Devolve ao mundo o que a unidade estava segurando. */
function soltarTudo(estado: Estado, u: Unidade): void {
  if (u.carga === 'bau') {
    const p = estado.baus.find((x) => x.portador === u.id);
    if (p) largarBau(estado, p);
  } else if (u.carga !== 'nada') {
    // A carga cai inteira e continua valendo. Quem matou o carregador acabou de
    // ganhar uma bolsa — se tiver coragem de parar para pegá-lo.
    estado.itens.push({
      id: estado.proximoId++,
      tipo: u.carga as Exclude<Carga, 'nada' | 'bau'>,
      classe: null,
      origem: null,
      x: u.x,
      y: u.y,
      voltaEm: CHAPEU_VOLTA_EM,
    });
  }
  u.carga = 'nada';
  if (u.colhendoId !== null) {
    const j = estado.jazidas.find((x) => x.id === u.colhendoId);
    if (j && j.ocupadaPor === u.id) j.ocupadaPor = null;
  }
  u.colhendoId = null;
  u.colheita = 0;
}

function reviver(arena: Arena, estado: Estado, u: Unidade): void {
  u.vivo = true;
  u.vida = vidaMaxima(u.classe, nivelDe(estado, u.time));
  u.renasceEm = 0;
  u.recarga = 0;
  porNoNascedouro(arena, estado, u);
}

/** Se a unidade consegue ver o alvo. Os bots usam; o tick, não. */
export function enxerga(arena: Arena, a: Unidade, b: { x: number; y: number }): boolean {
  return linhaLivre(arena, a.x, a.y, b.x, b.y);
}

export { CARGA_DO_OFICIO };
