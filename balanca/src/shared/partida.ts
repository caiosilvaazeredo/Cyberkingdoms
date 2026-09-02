import {
  CLASSES_COM_CHAPEU,
  ESTOQUE_INICIAL,
  LERDEZA_DO_ALDEAO,
  danoDe,
  perfil,
  vidaMaxima,
  type Classe,
} from './classes';
import {
  criarArena,
  linhaLivre,
  resolverColisao,
  type Arena,
  type TipoDeEstrutura,
} from './arena';
import { MAPA_PADRAO, type IdDoMapa } from './mapas';
import { MODO_PADRAO, modoDe, type IdDoModo } from './modos';
import {
  CARGA_DO_OFICIO,
  cozinhaDe,
  nivelDe,
  oficinaDe,
  princesaDe,
  unidade,
  type Animal,
  type Carga,
  type Estado,
  type Item,
  type Princesa,
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
  BOLOS_NA_COZINHA,
  CARNE_POR_BOLO,
  CHAPEU_VOLTA_EM,
  CURA_DO_BOLO,
  CUSTO_DO_NIVEL,
  DT,
  EMPURRAO_DA_PRINCESA,
  JAZIDA_VOLTA_EM,
  NIVEL_MAXIMO,
  PAUSA_APOS_PONTO,
  PESO_MAXIMO,
  PESO_MINIMO,
  PESO_POR_BOLO,
  PESO_TOTAL,
  PRINCESA_VOLTA_EM,
  RAIO_UNIDADE,
  RENASCIMENTO_POR_PONTO,
  TEMPO_DE_FORNO,
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
 * (dano, quem pegou a princesa, quem entregou a fatia) só existe depois que o
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
 * neste tick solta a princesa **neste** tick; vitória por último porque um
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
): Partida {
  const arena = criarArena(seed, mapa);
  const estado = estadoInicial(arena, modo);
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
        fatias: 0,
        resgates: 0,
        entregas: 0,
        ultimoComando: 0,
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

function estadoInicial(arena: Arena, id: IdDoModo): Estado {
  const modo = modoDe(id);
  const estoque = {} as Record<Time, Record<Classe, number>>;
  for (const t of TIMES) estoque[t] = { ...ESTOQUE_INICIAL };

  const princesas: Princesa[] = TIMES.map((time) => {
    // A princesa de um time começa presa na masmorra do **outro**. É a
    // premissa do jogo, e está escrita numa linha só para que não haja dois
    // lugares onde ela possa ser invertida.
    const jaula = arena.estrutura('jaula', outroTime(time));
    return {
      time,
      peso: PESO_TOTAL / 2,
      onde: 'jaula',
      x: jaula.x,
      y: jaula.y,
      portador: null,
      voltaEm: 0,
      ajudantes: 0,
    };
  });

  return {
    tick: 0,
    modo: modo.id,
    fase: 'aquecimento',
    faseEm: AQUECIMENTO,
    relogio: modo.duracao,
    placar: { azul: 0, vermelho: 0 },
    abates: { azul: 0, vermelho: 0 },
    unidades: [],
    princesas,
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
    cozinhas: TIMES.map((time) => ({ time, carne: 0, assando: 0, bolos: 1 })),
    oficinas: TIMES.map((time) => ({ time, madeira: 0, ouro: 0, nivel: 1 })),
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
    cuidarDasPrincesas(arena, estado);
    cozinhar(estado);
    recomporJazidas(estado);
    envelhecerItens(estado);
    conferirRelogio(estado);
  }
}

/**
 * O movimento, e a única parte da simulação que o cliente também roda.
 *
 * Recebe `estado` porque a velocidade de quem carrega a princesa depende do
 * peso dela e da escolta encostada — e essas duas coisas o cliente já tem no
 * último retrato, então a previsão continua batendo.
 */
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

  let velocidade = perfil(u.classe).velocidade;
  if (u.carga !== 'nada' && u.carga !== 'princesa') velocidade *= 0.95;
  if (u.carga === 'princesa') {
    const p = estado.princesas.find((x) => x.portador === u.id);
    if (p) {
      velocidade *= velocidadeCarregando(p.peso);
      // Sem a escolta exigida, o cortejo simplesmente não sai do lugar. Deixar
      // andar devagar seria mais gentil e destruiria o sentido do peso: o
      // resgate precisa ser uma decisão do time, não do carregador.
      if (p.ajudantes + 1 < carregadoresPara(p.peso)) velocidade = 0;
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

  if (u.carga === 'princesa') {
    const p = estado.princesas.find((x) => x.portador === u.id);
    if (!p) {
      u.carga = 'nada';
      return;
    }
    if (estruturaPerto(arena, u, 'trono', meu, ALCANCE_DE_COLETA)) {
      marcarPonto(estado, u, p);
    } else {
      largarPrincesa(estado, p);
      u.carga = 'nada';
    }
    return;
  }

  if (u.carga === 'bolo') {
    // Alimentar a refém da **sua** masmorra é o gesto central do jogo: move a
    // balança nos dois sentidos de uma vez.
    const refem = princesaDe(estado, inimigo);
    if (refem.onde === 'jaula' && estruturaPerto(arena, u, 'jaula', meu, ALCANCE_DE_COLETA)) {
      alimentar(estado, u, refem);
      return;
    }
    // Longe da masmorra, o bolo vira o que qualquer bolo é: comida.
    const maximo = vidaMaxima(u.classe, nivelDe(estado, meu));
    if (u.vida < maximo) {
      u.vida = Math.min(maximo, u.vida + CURA_DO_BOLO);
      u.carga = 'nada';
    }
    return;
  }

  if (u.carga === 'carne') {
    if (estruturaPerto(arena, u, 'cozinha', meu, ALCANCE_DE_COLETA)) {
      cozinhaDe(estado, meu).carne++;
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

  // A princesa do próprio time, presa lá ou largada no caminho. Ninguém
  // sequestra a princesa inimiga de novo: o objetivo é trazer a sua.
  const minha = princesaDe(estado, meu);
  if (
    (minha.onde === 'jaula' || minha.onde === 'chao') &&
    perto(u, minha, ALCANCE_DE_COLETA)
  ) {
    pegarPrincesa(estado, u, minha);
    return;
  }

  if (estruturaPerto(arena, u, 'cozinha', meu)) {
    const cozinha = cozinhaDe(estado, meu);
    if (cozinha.bolos > 0) {
      cozinha.bolos--;
      u.carga = 'bolo';
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
  const razao = u.vida / vidaMaxima(u.classe, nivel);
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
    const custo = CUSTO_DO_NIVEL[oficina.nivel + 1]!;
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
      outro.vida = Math.min(vidaMaxima(outro.classe, oficina.nivel), outro.vida + 15);
    }
  }
}

function cozinhar(estado: Estado): void {
  for (const c of estado.cozinhas) {
    if (c.assando > 0) {
      c.assando -= DT;
      if (c.assando <= 0) {
        c.assando = 0;
        c.bolos = Math.min(BOLOS_NA_COZINHA, c.bolos + 1);
      }
      continue;
    }
    if (c.carne >= CARNE_POR_BOLO && c.bolos < BOLOS_NA_COZINHA) {
      c.carne -= CARNE_POR_BOLO;
      c.assando = TEMPO_DE_FORNO;
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
 * Elas são a única fonte de carne, e carne é a única entrada do bolo — então
 * este pedaço de código, que parece decoração, é o começo da cadeia que move a
 * balança. O caçador as derruba em três golpes; qualquer outro leva o dobro do
 * tempo e vira alvo fácil enquanto tenta.
 */
function moverAnimais(arena: Arena, estado: Estado): void {
  // Na Fome o pasto não repõe: a carne do mapa é finita, e com ela o bolo e o
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
    tipo: 'carne',
    classe: null,
    origem: null,
    x: a.x,
    y: a.y,
    voltaEm: CHAPEU_VOLTA_EM,
  });
  estado.eventos.push({ tipo: 'caca', unidade: algoz.id });
}

// --- a balança -------------------------------------------------------------

/**
 * A fatia, e a conta que dá nome ao jogo.
 *
 * O que a refém ganha, a princesa do próprio time perde — exatamente, e no
 * mesmo instante. `delta` é cortado pelas duas pontas antes de qualquer coisa
 * mudar, porque cortar depois quebraria a soma: bastaria uma das princesas
 * bater no limite para o peso total do reino mudar sem que ninguém notasse.
 */
function alimentar(estado: Estado, u: Unidade, refem: Princesa): void {
  const minha = princesaDe(estado, u.time);
  const delta = Math.min(PESO_POR_BOLO, PESO_MAXIMO - refem.peso, minha.peso - PESO_MINIMO);
  if (delta <= 0) return;

  refem.peso += delta;
  minha.peso -= delta;
  u.carga = 'nada';
  u.fatias++;
  estado.eventos.push({ tipo: 'fatia', unidade: u.id, princesa: refem.time, peso: refem.peso });

  // No Banquete, a balança no talo acaba a partida. A conferência é aqui, na
  // única função do jogo que move peso: procurá-la no tick custaria uma volta
  // por quadro para responder a uma pergunta que só muda quando alguém entrega
  // uma fatia.
  const modo = modoDe(estado.modo);
  if (modo.vitoriaPorBalanca && minha.peso <= modo.pesoQueVence) {
    terminar(estado, u.time);
    return;
  }

  // A princesa não gosta de ser engordada por estranhos, e empurra quem estiver
  // colado nela. Serve ao jogo: impede que o time inteiro fique parado dentro
  // da masmorra em cima da refém enquanto o inimigo tenta o resgate.
  for (const outro of estado.unidades) {
    if (!outro.vivo || outro.time === u.time) continue;
    const d = Math.hypot(outro.x - refem.x, outro.y - refem.y);
    if (d > ALCANCE_DE_USO || d < 0.001) continue;
    outro.x += ((outro.x - refem.x) / d) * EMPURRAO_DA_PRINCESA * DT * 4;
    outro.y += ((outro.y - refem.y) / d) * EMPURRAO_DA_PRINCESA * DT * 4;
  }
}

// --- princesas -------------------------------------------------------------

function pegarPrincesa(estado: Estado, u: Unidade, p: Princesa): void {
  p.onde = 'carregada';
  p.portador = u.id;
  p.voltaEm = 0;
  u.carga = 'princesa';
  u.colhendoId = null;
  estado.eventos.push({ tipo: 'pegouPrincesa', unidade: u.id, princesa: p.time });
}

function largarPrincesa(estado: Estado, p: Princesa): void {
  p.onde = 'chao';
  p.portador = null;
  p.voltaEm = PRINCESA_VOLTA_EM;
  p.ajudantes = 0;
  estado.eventos.push({ tipo: 'largouPrincesa', princesa: p.time });
}

function cuidarDasPrincesas(arena: Arena, estado: Estado): void {
  for (const p of estado.princesas) {
    if (p.onde === 'carregada') {
      const portador = unidade(estado, p.portador);
      if (!portador || !portador.vivo || portador.carga !== 'princesa') {
        largarPrincesa(estado, p);
        continue;
      }
      p.x = portador.x;
      p.y = portador.y;
      p.ajudantes = estado.unidades.filter(
        (o) =>
          o.id !== portador.id &&
          o.vivo &&
          o.time === p.time &&
          o.carga !== 'princesa' &&
          perto(o, portador, ALCANCE_DE_AJUDA),
      ).length;
      continue;
    }
    if (p.onde === 'chao') {
      p.voltaEm -= DT;
      if (p.voltaEm <= 0) devolverPrincesa(arena, p);
    }
  }
}

function devolverPrincesa(arena: Arena, p: Princesa): void {
  const jaula = arena.estrutura('jaula', outroTime(p.time));
  p.onde = 'jaula';
  p.x = jaula.x;
  p.y = jaula.y;
  p.portador = null;
  p.voltaEm = 0;
  p.ajudantes = 0;
}

function marcarPonto(estado: Estado, u: Unidade, p: Princesa): void {
  p.onde = 'salva';
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
 * o trabalho de economia do time que dominou a cozinha, e manter congelaria a
 * partida a favor de quem abriu vantagem. Meio caminho preserva a história sem
 * deixar a bola de neve rolar.
 */
function recomecarRodada(arena: Arena, estado: Estado): void {
  // No Banquete a balança **não** relaxa, e isso não é uma segunda alavanca: é
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
  for (const p of estado.princesas) {
    const meio = PESO_TOTAL / 2;
    if (relaxa) p.peso = meio + (p.peso - meio) / 2;
    devolverPrincesa(arena, p);
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
  // Empate no placar: ganha quem venceu a balança. A princesa mais leve é a do
  // time que entregou mais fatias, e é o desempate que o jogo inteiro treinou.
  const pesoAzul = princesaDe(estado, 'azul').peso;
  const pesoVermelho = princesaDe(estado, 'vermelho').peso;
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

function atacar(arena: Arena, estado: Estado, u: Unidade): void {
  if (u.recarga > 0 || u.carga === 'princesa') return;
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
    for (const alvo of estado.unidades) {
      if (!alvo.vivo || alvo.time === u.time) continue;
      const dx = alvo.x - u.x;
      const dy = alvo.y - u.y;
      const d = Math.hypot(dx, dy);
      if (d > p.alcance + RAIO_UNIDADE) continue;
      // Meia-volta à frente: bater em quem está nas costas transformaria o
      // corpo a corpo num círculo de dano e apagaria o flanqueamento.
      if (d > 0.001 && (dx / d) * u.olharX + (dy / d) * u.olharY < 0) continue;
      ferir(estado, u, alvo, dano);
    }
    ferirBichosNoAlcance(estado, u, p.alcance + RAIO_UNIDADE, dano);
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
    const razao = o.vida / vidaMaxima(o.classe, nivel);
    if (razao < pior) {
      pior = razao;
      alvo = o;
    }
  }
  const quem = alvo ?? u;
  quem.vida = Math.min(vidaMaxima(quem.classe, nivel), quem.vida + p.dano);
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

    if (!acabou) {
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
  if (u.carga === 'princesa') {
    const p = estado.princesas.find((x) => x.portador === u.id);
    if (p) largarPrincesa(estado, p);
  } else if (u.carga !== 'nada') {
    // A carga cai inteira e continua valendo. Quem matou o carregador acabou de
    // ganhar um bolo — se tiver coragem de parar para pegá-lo.
    estado.itens.push({
      id: estado.proximoId++,
      tipo: u.carga as Exclude<Carga, 'nada' | 'princesa'>,
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
