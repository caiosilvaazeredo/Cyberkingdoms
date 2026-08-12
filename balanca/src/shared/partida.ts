import { CLASSES_COM_CHAPEU, ESTOQUE_INICIAL, perfil, type Classe } from './classes';
import {
  criarArena,
  linhaLivre,
  resolverColisao,
  type Arena,
  type TipoDeEstrutura,
} from './arena';
import {
  cozinhaDe,
  princesaDe,
  unidade,
  type Estado,
  type Item,
  type Princesa,
  type Unidade,
} from './estado';
import type { Comando } from './protocolo';
import {
  ALCANCE_DE_AJUDA,
  ALCANCE_DE_COLETA,
  ALCANCE_DE_USO,
  AQUECIMENTO,
  BOLOS_NA_COZINHA,
  CHAPEU_VOLTA_EM,
  CURA_DO_BOLO,
  DT,
  DURACAO_DA_PARTIDA,
  EMPURRAO_DA_PRINCESA,
  PAUSA_APOS_PONTO,
  PESO_MAXIMO,
  PESO_MINIMO,
  PESO_POR_BOLO,
  PESO_TOTAL,
  PONTOS_PARA_VENCER,
  PRINCESA_VOLTA_EM,
  RAIO_UNIDADE,
  RENASCIMENTO_BASE,
  RENASCIMENTO_POR_PONTO,
  TEMPO_DE_COLHEITA,
  TEMPO_DE_FORNO,
  TILE,
  TIMES,
  TRIGO_POR_BOLO,
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
 * ## O tick não sorteia nada
 *
 * Nenhuma decisão do tick usa aleatoriedade — nem dano variável, nem chance de
 * errar. Não é purismo: é o que torna um replay possível a partir da seed e da
 * lista de comandos, e o que faz um bug de "às vezes o carregador solta a
 * princesa" ser reproduzível em vez de folclore.
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

export function criarPartida(seed: number): Partida {
  const arena = criarArena(seed);
  const estado = estadoInicial(arena);
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
        vida: perfil('aldeao').vida,
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
        ultimoComando: 0,
      };
      estado.unidades.push(u);
      porNoNascedouro(arena, estado, u);
      return u;
    },
    sair(id) {
      const u = unidade(estado, id);
      if (!u) return;
      soltarTudo(arena, estado, u);
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

function estadoInicial(arena: Arena): Estado {
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
    fase: 'aquecimento',
    faseEm: AQUECIMENTO,
    relogio: DURACAO_DA_PARTIDA,
    placar: { azul: 0, vermelho: 0 },
    unidades: [],
    princesas,
    projeteis: [],
    itens: [],
    trigais: arena.trigais.map((t) => ({
      id: t.id,
      maduro: true,
      cresceEm: 0,
      ocupadoPor: null,
    })),
    cozinhas: TIMES.map((time) => ({ time, trigo: 0, assando: 0, bolos: 1 })),
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

    if (!jogando) continue;

    const apertouUsar = c.usar && !(usarAnterior.get(u.id) ?? false);
    usarAnterior.set(u.id, c.usar);
    if (apertouUsar) usar(arena, estado, u);
    if (c.atacar) atacar(arena, estado, u);
    colher(estado, u, c);
  }

  moverProjeteis(arena, estado);
  if (jogando) {
    cuidarDasPrincesas(arena, estado);
    cozinhar(estado);
    crescerTrigo(estado);
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
  if (u.carga === 'trigo' || u.carga === 'bolo') velocidade *= 0.95;
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
      marcarPonto(arena, estado, u, p);
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
    const maximo = perfil(u.classe).vida;
    if (u.vida < maximo) {
      u.vida = Math.min(maximo, u.vida + CURA_DO_BOLO);
      u.carga = 'nada';
    }
    return;
  }

  if (u.carga === 'trigo') {
    if (estruturaPerto(arena, u, 'cozinha', meu, ALCANCE_DE_COLETA)) {
      cozinhaDe(estado, meu).trigo++;
      u.carga = 'nada';
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

  comecarColheita(arena, estado, u);
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
  if (item.tipo === 'bolo') {
    u.carga = 'bolo';
    return;
  }
  const classe = item.classe!;
  const roubado = item.origem !== null && item.origem !== u.time;
  soltarChapeuNoChao(estado, u);
  trocarClasse(u, classe, false);
  estado.eventos.push({ tipo: 'chapeu', unidade: u.id, classe, roubado });
}

/**
 * Veste o próximo chapéu disponível na chapelaria, em ciclo.
 *
 * Um botão só de novo. Apertar de novo passa para o próximo — quem quer virar
 * mago aperta até chegar no mago, e vê a chapelaria mudar na tela enquanto
 * isso. O chapéu atual volta ao estoque antes da conta, senão o jogador que já
 * é guerreiro nunca conseguiria voltar a ser guerreiro depois de rodar a lista.
 */
function vestirDaChapelaria(estado: Estado, u: Unidade): void {
  const estoque = estado.estoque[u.time];
  const atual = CLASSES_COM_CHAPEU.indexOf(u.classe);
  devolverChapeu(estado, u);
  for (let passo = 1; passo <= CLASSES_COM_CHAPEU.length + 1; passo++) {
    const i = (atual + passo) % (CLASSES_COM_CHAPEU.length + 1);
    if (i === CLASSES_COM_CHAPEU.length) {
      // A volta completa passa pelo aldeão — é a forma de largar o chapéu.
      trocarClasse(u, 'aldeao', true);
      return;
    }
    const classe = CLASSES_COM_CHAPEU[i]!;
    if (estoque[classe] > 0) {
      estoque[classe]--;
      trocarClasse(u, classe, true);
      estado.eventos.push({ tipo: 'chapeu', unidade: u.id, classe, roubado: false });
      return;
    }
  }
}

/**
 * @param cheio quando a troca é na própria chapelaria, a vida enche; quando é
 * um chapéu catado do chão no meio do campo, ela é convertida em proporção —
 * senão morrer e vestir viraria a forma mais rápida de se curar.
 */
function trocarClasse(u: Unidade, classe: Classe, cheio: boolean): void {
  const razao = u.vida / perfil(u.classe).vida;
  u.classe = classe;
  u.vida = cheio ? perfil(classe).vida : Math.max(1, Math.round(perfil(classe).vida * razao));
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

// --- colheita e cozinha ----------------------------------------------------

function comecarColheita(arena: Arena, estado: Estado, u: Unidade): void {
  if (!perfil(u.classe).colhe) return;
  for (const t of arena.trigais) {
    const alvo = estado.trigais.find((x) => x.id === t.id)!;
    if (!alvo.maduro || !perto(u, t, ALCANCE_DE_COLETA)) continue;
    if (alvo.ocupadoPor !== null && alvo.ocupadoPor !== u.id) continue;
    alvo.ocupadoPor = u.id;
    u.colhendoId = t.id;
    u.colheita = 0;
    return;
  }
}

function colher(estado: Estado, u: Unidade, c: Comando): void {
  if (u.colhendoId === null) return;
  const trigal = estado.trigais.find((t) => t.id === u.colhendoId);
  // Andar cancela. Colher é o momento em que o aldeão está indefeso, e é isso
  // que faz a economia do bolo custar posição em vez de custar nada.
  if (!trigal || !trigal.maduro || Math.hypot(c.mx, c.my) > 0.01 || u.carga !== 'nada') {
    if (trigal && trigal.ocupadoPor === u.id) trigal.ocupadoPor = null;
    u.colhendoId = null;
    u.colheita = 0;
    return;
  }
  u.colheita += DT / TEMPO_DE_COLHEITA;
  if (u.colheita < 1) return;
  trigal.maduro = false;
  trigal.cresceEm = 12;
  trigal.ocupadoPor = null;
  u.colhendoId = null;
  u.colheita = 0;
  u.carga = 'trigo';
}

function crescerTrigo(estado: Estado): void {
  for (const t of estado.trigais) {
    if (t.maduro) continue;
    t.cresceEm -= DT;
    if (t.cresceEm <= 0) t.maduro = true;
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
    if (c.trigo >= TRIGO_POR_BOLO && c.bolos < BOLOS_NA_COZINHA) {
      c.trigo -= TRIGO_POR_BOLO;
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

function marcarPonto(arena: Arena, estado: Estado, u: Unidade, p: Princesa): void {
  p.onde = 'salva';
  p.portador = null;
  u.carga = 'nada';
  u.resgates++;
  estado.placar[u.time]++;
  estado.eventos.push({ tipo: 'resgate', unidade: u.id, time: u.time });

  if (estado.placar[u.time] >= PONTOS_PARA_VENCER) {
    terminar(estado, u.time);
    return;
  }
  estado.fase = 'ponto';
  estado.faseEm = PAUSA_APOS_PONTO;
  void arena;
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
  for (const p of estado.princesas) {
    const meio = PESO_TOTAL / 2;
    p.peso = meio + (p.peso - meio) / 2;
    devolverPrincesa(arena, p);
  }
  estado.projeteis = [];
  for (const u of estado.unidades) {
    u.vivo = true;
    u.renasceEm = 0;
    u.vida = perfil(u.classe).vida;
    u.carga = 'nada';
    u.colhendoId = null;
    u.colheita = 0;
    porNoNascedouro(arena, estado, u);
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
  u.golpe = 0.25;
  u.colhendoId = null;

  if (p.ataque === 'cura') {
    curar(estado, u);
    return;
  }
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
      ferir(estado, u, alvo, p.dano);
    }
    return;
  }

  const velocidade = p.ataque === 'flecha' ? 620 : 330;
  estado.projeteis.push({
    id: estado.proximoId++,
    tipo: p.ataque === 'flecha' ? 'flecha' : 'bola',
    time: u.time,
    dono: u.id,
    x: u.x + u.olharX * (RAIO_UNIDADE + 6),
    y: u.y + u.olharY * (RAIO_UNIDADE + 6),
    vx: u.olharX * velocidade,
    vy: u.olharY * velocidade,
    dano: p.dano,
    raioDoEstouro: p.raioDoEstouro,
    vida: p.alcance / velocidade,
  });
  void arena;
}

function curar(estado: Estado, u: Unidade): void {
  const p = perfil(u.classe);
  let alvo: Unidade | null = null;
  let pior = 1;
  for (const o of estado.unidades) {
    if (!o.vivo || o.time !== u.time || o.id === u.id) continue;
    if (!perto(o, u, p.alcance)) continue;
    const razao = o.vida / perfil(o.classe).vida;
    if (razao < pior) {
      pior = razao;
      alvo = o;
    }
  }
  const quem = alvo ?? u;
  quem.vida = Math.min(perfil(quem.classe).vida, quem.vida + p.dano);
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
      for (const alvo of estado.unidades) {
        if (!alvo.vivo || alvo.time === pj.time) continue;
        if (!perto(alvo, pj, RAIO_UNIDADE + 6)) continue;
        const dono = unidade(estado, pj.dono);
        if (pj.raioDoEstouro > 0) estourar(estado, pj, dono);
        else ferir(estado, dono ?? alvo, alvo, pj.dano);
        acabou = true;
        break;
      }
    }

    if (acabou) {
      if (pj.raioDoEstouro > 0 && pj.vida <= 0) estourar(estado, pj, unidade(estado, pj.dono));
      continue;
    }
    sobreviventes.push(pj);
  }
  estado.projeteis = sobreviventes;
}

function estourar(estado: Estado, pj: (typeof estado.projeteis)[number], dono?: Unidade): void {
  for (const alvo of estado.unidades) {
    if (!alvo.vivo || alvo.time === pj.time) continue;
    if (!perto(alvo, pj, pj.raioDoEstouro)) continue;
    ferir(estado, dono ?? alvo, alvo, pj.dano);
  }
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
  if (algoz.id !== alvo.id && algoz.time !== alvo.time) algoz.abates++;
  estado.eventos.push({ tipo: 'abate', algoz: algoz.id, vitima: alvo.id });

  soltarChapeuNoChao(estado, alvo);
  alvo.classe = 'aldeao';
  soltarTudo(null, estado, alvo);
  alvo.renasceEm =
    RENASCIMENTO_BASE + estado.placar[outroTime(alvo.time)] * RENASCIMENTO_POR_PONTO;
}

/** Devolve ao mundo o que a unidade estava segurando. */
function soltarTudo(_arena: Arena | null, estado: Estado, u: Unidade): void {
  if (u.carga === 'princesa') {
    const p = estado.princesas.find((x) => x.portador === u.id);
    if (p) largarPrincesa(estado, p);
  } else if (u.carga === 'bolo') {
    // O bolo cai inteiro e continua valendo. Quem matou o carregador acabou de
    // ganhar uma fatia — se tiver coragem de parar para pegá-la.
    estado.itens.push({
      id: estado.proximoId++,
      tipo: 'bolo',
      classe: null,
      origem: null,
      x: u.x,
      y: u.y,
      voltaEm: CHAPEU_VOLTA_EM,
    });
  }
  u.carga = 'nada';
  if (u.colhendoId !== null) {
    const t = estado.trigais.find((x) => x.id === u.colhendoId);
    if (t && t.ocupadoPor === u.id) t.ocupadoPor = null;
  }
  u.colhendoId = null;
  u.colheita = 0;
}

function reviver(arena: Arena, estado: Estado, u: Unidade): void {
  u.vivo = true;
  u.vida = perfil(u.classe).vida;
  u.renasceEm = 0;
  u.recarga = 0;
  porNoNascedouro(arena, estado, u);
}

/** Se a unidade consegue ver o alvo. Os bots usam; o tick, não. */
export function enxerga(arena: Arena, a: Unidade, b: { x: number; y: number }): boolean {
  return linhaLivre(arena, a.x, a.y, b.x, b.y);
}
