import { AGUA, PONTE, type Arena } from '../shared/arena';
import type { Animal, Unidade } from '../shared/estado';
import type { IdDoMapa } from '../shared/mapas';
import { TILE } from './tileset';

/**
 * A vida selvagem puramente decorativa: onde cada bicho está agora.
 *
 * Nenhuma destas posições é estado — nada aqui é mandado pelo servidor, nada
 * é previsto. Cada função é pura em `(arena, tempo)`: duas telas olhando o
 * mesmo instante do mesmo mundo veem o mesmo bicho no mesmo lugar, sem gastar
 * um byte de rede.
 *
 * Separado de `desenho.ts` porque este arquivo só faz aritmética — nenhuma
 * função aqui toca um `CanvasRenderingContext2D`. `desenho.ts` continua dono
 * do "como desenhar"; este é só o "onde".
 */

/** Interpola a ovelha entre os dois últimos retratos. */
export function posicaoDoAnimal(a: Animal, alfa: number): { x: number; y: number } {
  return {
    x: a.destinoX + (a.x - a.destinoX) * alfa,
    y: a.destinoY + (a.y - a.destinoY) * alfa,
  };
}

/**
 * Um passeio circular decorativo em torno de uma âncora fixa da arena.
 *
 * A base de todo bicho de clima (porco, tartaruga, urso, abelhão): nenhum
 * deles é física ou estado, é só este relógio — `Math.sin`/`Math.cos` do
 * tempo de parede, deslocado por uma fase própria de cada bicho e de cada
 * arena. Duas telas olhando o mesmo instante veem o mesmo bicho no mesmo
 * lugar, sem gastar um byte de rede.
 */
export function passeioCircular(
  ancora: { x: number; y: number },
  tempo: number,
  fase: number,
  raio: number,
  velocidade: number,
  achatamento: number,
): { x: number; y: number; paraEsquerda: boolean } {
  const angulo = tempo * velocidade + fase;
  const dx = Math.cos(angulo) * raio;
  return {
    x: ancora.x + dx,
    y: ancora.y + Math.sin(angulo * 1.7) * raio * achatamento,
    paraEsquerda: -Math.sin(angulo) < 0,
  };
}

/**
 * O quanto um bicho arisco se afasta de quem chegou perto.
 *
 * Não é fuga de verdade — não há para onde fugir, o passeio circular traria
 * o bicho de volta no instante seguinte de qualquer jeito. É o flinch que
 * falta hoje: "eu te vi chegando", um empurrão que cresce conforme a unidade
 * viva mais próxima se aproxima e some no raio de alerta. Pura em (posição
 * do bicho, unidades), do mesmo jeito que o resto deste arquivo — zero rede,
 * zero estado próprio, as duas telas concordam sozinhas.
 */
const RAIO_DE_ALERTA = 2.4 * TILE;
const EMPURRAO_DE_ALERTA = TILE * 0.85;

function empurraoDeAlerta(
  pos: { x: number; y: number },
  unidades: readonly Pick<Unidade, 'x' | 'y' | 'vivo'>[] | undefined,
): { x: number; y: number } {
  if (!unidades) return { x: 0, y: 0 };
  let maisPerto: { dx: number; dy: number; d: number } | null = null;
  for (const u of unidades) {
    if (!u.vivo) continue;
    const dx = pos.x - u.x;
    const dy = pos.y - u.y;
    const d = Math.hypot(dx, dy);
    if (d < RAIO_DE_ALERTA && (!maisPerto || d < maisPerto.d)) maisPerto = { dx, dy, d };
  }
  if (!maisPerto) return { x: 0, y: 0 };
  // Quanto mais perto, mais forte — e nunca divide por zero: duas unidades
  // não ocupam o mesmo pixel, mas um bicho preso na própria âncora podia.
  const forca = (1 - maisPerto.d / RAIO_DE_ALERTA) * EMPURRAO_DE_ALERTA;
  const d = Math.max(0.001, maisPerto.d);
  return { x: (maisPerto.dx / d) * forca, y: (maisPerto.dy / d) * forca };
}

export function posicaoDoPorco(
  arena: Arena,
  tempo: number,
  unidades?: readonly Pick<Unidade, 'x' | 'y' | 'vivo'>[],
): { x: number; y: number; paraEsquerda: boolean; montado: boolean } {
  // Ancorado num pasto do meio — chão já garantido seco e limpo de decoração
  // — e não no centro geométrico do mapa, que em vários relevos cai dentro
  // d'água (ver `aguaCentralDe`, que é para lá que a tartaruga vai). Sem
  // pasto nenhum, o que não deveria acontecer em nenhum mapa da lista, ele
  // some em vez de nadar.
  const ancora = arena.pastos.find((p) => p.lado === null) ?? arena.pastos[0];
  if (!ancora) return { x: -9999, y: -9999, paraEsquerda: false, montado: false };

  const fase = (arena.seed % 1000) * 0.01;
  const passeio = passeioCircular(ancora, tempo, fase, 2.2 * TILE, 0.25, 0.6);
  const empurrao = empurraoDeAlerta(passeio, unidades);
  return {
    x: passeio.x + empurrao.x,
    y: passeio.y + empurrao.y,
    paraEsquerda: empurrao.x !== 0 ? empurrao.x < 0 : passeio.paraEsquerda,
    // Uma em vinte: raro o bastante para ser notícia quando alguém vê, comum
    // o bastante para não virar lenda urbana de "ninguém nunca viu isso".
    montado: Math.abs(arena.seed) % 20 === 0,
  };
}

/**
 * A água mais perto do centro do mapa — a lagoa, o rio, o fosso, o que for.
 *
 * Uma busca em anéis a partir do centro geométrico, e não a suposição de que
 * o centro **é** água: só o Corte e a Planície desenham `elipse` ali; Vau e
 * Arquipélago molham o meio do campo de outros jeitos, e ainda assim perto
 * do centro. O raio para em oito tiles de propósito — o suficiente para os
 * quatro mapas com água central de verdade, curto o bastante para o
 * Desfiladeiro (que não tem: só uma ponte por castelo, nada no meio) não
 * achar uma poça perdida do outro lado do mapa e colar a tartaruga lá. Sem
 * água por perto, a tartaruga simplesmente não aparece nesse mapa — o mesmo
 * "some em vez de nadar" do porco. O resultado é cacheado por arena: refazer
 * este anel a cada quadro seria o único ponto quente desta tela inteira sem
 * necessidade nenhuma, já que a arena não muda de forma no meio da partida.
 */
const RAIO_DA_BUSCA_DE_AGUA = 8;

const CACHE_AGUA_CENTRAL = new WeakMap<Arena, { x: number; y: number } | null>();

function aguaCentralDe(arena: Arena): { x: number; y: number } | null {
  const cache = CACHE_AGUA_CENTRAL.get(arena);
  if (cache !== undefined) return cache;

  const ctx0 = Math.floor(arena.largura / 2);
  const cty0 = Math.floor(arena.altura / 2);
  let achado: { x: number; y: number } | null = null;
  for (let r = 0; r <= RAIO_DA_BUSCA_DE_AGUA && !achado; r++) {
    for (let dy = -r; dy <= r && !achado; dy++) {
      for (let dx = -r; dx <= r && !achado; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const tx = ctx0 + dx;
        const ty = cty0 + dy;
        if (arena.tile(tx, ty) === AGUA) achado = { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
      }
    }
  }
  CACHE_AGUA_CENTRAL.set(arena, achado);
  return achado;
}

export function posicaoDaTartaruga(
  arena: Arena,
  tempo: number,
): { x: number; y: number; paraEsquerda: boolean } | null {
  const ancora = aguaCentralDe(arena);
  if (!ancora) return null;
  const fase = (arena.seed % 700) * 0.013;
  // Devagar — é uma tartaruga — e num raio pequeno: a lagoa central não tem
  // o mesmo tamanho em todo mapa, e um raio grande a mandaria pisar em
  // terra firme na Planície, que tem duas lagoas pequenas em vez de uma.
  return passeioCircular(ancora, tempo, fase, 1.3 * TILE, 0.1, 0.5);
}

/**
 * O tubarão: só no Vau e no Arquipélago.
 *
 * Os outros três mapas têm água central — o fosso arredondado do Corte, o
 * lago da Planície — mas é água de decoração, não a extensão de verdade que
 * só esses dois desenham. Restringir por `arena.mapa`, e não por achar água
 * grande o bastante, é a diferença entre "estes dois mapas têm um tubarão"
 * (a intenção) e "todo mapa cuja lagoa passar de um certo tamanho ganha um
 * tubarão de graça" (um acidente de medição que quebraria no próximo mapa
 * novo). Raio maior e mais rápido que a tartaruga — é um predador, não um
 * bicho que toma sol.
 */
export function posicaoDoTubarao(
  arena: Arena,
  tempo: number,
): { x: number; y: number; paraEsquerda: boolean } | null {
  if (arena.mapa !== 'vau' && arena.mapa !== 'arquipelago') return null;
  const ancora = aguaCentralDe(arena);
  if (!ancora) return null;
  const fase = (arena.seed % 900) * 0.011 + 1.5;
  // A água dos dois mapas é um canal estreito, cortado por pontes a poucos
  // tiles da âncora — o rio do Vau tem só duas colunas de largura, e o fosso
  // do Arquipélago não é mais largo, com uma travessia bem perto do centro
  // que `aguaCentralDe` acha. O raio pequeno é medido, não estético: 0,5 de
  // tile já bate numa ponte ou na margem antes de completar a volta —
  // conferido tile a tile nos dois mapas, não só de olho.
  return passeioCircular(ancora, tempo, fase, 0.4 * TILE, 0.35, 0.6);
}

/**
 * O cavalo-marinho: a mesma água do tubarão, só no Arquipélago — o Vau fica
 * só com o predador, porque um cavalo-marinho pastando ao lado de um
 * tubarão de patrulha lia estranho. Mesmo raio medido do tubarão, fase
 * diferente para os dois não nascerem grudados, e bem mais devagar: é
 * decoração parada, não um predador de ronda.
 */
export function posicaoDoCavaloMarinho(
  arena: Arena,
  tempo: number,
): { x: number; y: number; paraEsquerda: boolean } | null {
  if (arena.mapa !== 'arquipelago') return null;
  const ancora = aguaCentralDe(arena);
  if (!ancora) return null;
  const fase = (arena.seed % 600) * 0.017 + 4;
  return passeioCircular(ancora, tempo, fase, 0.4 * TILE, 0.12, 0.6);
}

/**
 * O barco: parado na mesma água, balançando no lugar — a folha do pacote já
 * é o balanço, não precisa de `passeioCircular` em cima. Estático como a
 * vila de gnomos, e pela mesma razão, cacheado por arena.
 */
const CACHE_BARCO = new WeakMap<Arena, { x: number; y: number } | null>();

export function posicaoDoBarco(arena: Arena): { x: number; y: number } | null {
  if (arena.mapa !== 'arquipelago') return null;
  const cache = CACHE_BARCO.get(arena);
  if (cache !== undefined) return cache;
  const ancora = aguaCentralDe(arena);
  const achado = ancora ? { x: ancora.x + TILE * 0.3, y: ancora.y - TILE * 0.3 } : null;
  CACHE_BARCO.set(arena, achado);
  return achado;
}

/**
 * A âncora do urso e do abelhão: uma árvore do meio do campo.
 *
 * O deslocamento tira os dois de cima da própria árvore — sem ele, o bicho
 * nasceria dentro do tronco, que já é decoração sólida e bloqueia passagem.
 */
function ancoraDoMato(arena: Arena): { x: number; y: number } | null {
  const j = arena.jazidas.find((j) => j.tipo === 'arvore' && j.lado === null) ?? null;
  return j ? { x: j.x + TILE * 1.4, y: j.y } : null;
}

/**
 * A vila de gnomos: cenário de fundo perto da árvore do meio, longe o
 * bastante para não disputar o mesmo pedaço de tela do urso e do abelhão,
 * que rondam a própria árvore.
 *
 * É estática — não depende de `tempo` — e por isso cacheada por arena, do
 * mesmo jeito que `aguaCentralDe`: a conta não muda no meio da partida, e
 * refazê-la a cada quadro seria trabalho jogado fora. A busca em candidatos,
 * e não um deslocamento fixo, é a mesma garantia do canhão: um deslocamento
 * fixo que cai em chão seco num mapa pode cair em cima de uma pedra no
 * próximo.
 */
const CACHE_VILA_DE_GNOMOS = new WeakMap<Arena, { x: number; y: number } | null>();

export function posicaoDaVilaDeGnomos(arena: Arena): { x: number; y: number } | null {
  const cache = CACHE_VILA_DE_GNOMOS.get(arena);
  if (cache !== undefined) return cache;

  const ancora = ancoraDoMato(arena);
  let achado: { x: number; y: number } | null = null;
  if (ancora) {
    const tx0 = Math.floor(ancora.x / TILE);
    const ty0 = Math.floor(ancora.y / TILE);
    const candidatos: readonly (readonly [number, number])[] = [
      [tx0 + 3, ty0 - 2],
      [tx0 - 3, ty0 - 2],
      [tx0 + 3, ty0 + 2],
      [tx0 - 3, ty0 + 2],
      [tx0, ty0 - 3],
      [tx0, ty0 + 3],
      [tx0 + 4, ty0],
      [tx0 - 4, ty0],
    ];
    for (const [tx, ty] of candidatos) {
      if (arena.ehChao(tx, ty) && !arena.bloqueado(tx, ty) && arena.tile(tx, ty) !== PONTE) {
        achado = { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 };
        break;
      }
    }
  }
  CACHE_VILA_DE_GNOMOS.set(arena, achado);
  return achado;
}

/**
 * Quais bichos de mato rondam a árvore do meio, por relevo.
 *
 * Urso e abelhão são bicho de campo aberto — Corte e Planície, os dois
 * relevos de grama. Vau e Desfiladeiro são travessia de água e passagem de
 * pedra: cobra sozinha combina com os dois, sem o urso que pertence à
 * campina. O Arquipélago já tem a própria fauna — tartaruga, tubarão,
 * cavalo-marinho — e não precisa de nenhum bicho de mata para se
 * diferenciar do resto da lista.
 */
const BICHOS_DE_MATO_DO_MAPA: Readonly<Record<IdDoMapa, readonly ('urso' | 'abelhao' | 'cobra')[]>> = {
  corte: ['urso', 'abelhao'],
  planicie: ['urso', 'abelhao'],
  cidadela: ['urso', 'abelhao'],
  vau: ['cobra'],
  desfiladeiro: ['cobra'],
  pantano: ['cobra'],
  arquipelago: [],
  encruzilhada: ['urso', 'abelhao'],
};

export function posicaoDoUrso(
  arena: Arena,
  tempo: number,
  unidades?: readonly Pick<Unidade, 'x' | 'y' | 'vivo'>[],
): { x: number; y: number; paraEsquerda: boolean } | null {
  if (!BICHOS_DE_MATO_DO_MAPA[arena.mapa].includes('urso')) return null;
  const ancora = ancoraDoMato(arena);
  if (!ancora) return null;
  const fase = (arena.seed % 500) * 0.017;
  const passeio = passeioCircular(ancora, tempo, fase, 1.6 * TILE, 0.18, 0.5);
  const empurrao = empurraoDeAlerta(passeio, unidades);
  return {
    x: passeio.x + empurrao.x,
    y: passeio.y + empurrao.y,
    paraEsquerda: empurrao.x !== 0 ? empurrao.x < 0 : passeio.paraEsquerda,
  };
}

export function posicaoDoAbelhao(
  arena: Arena,
  tempo: number,
): { x: number; y: number; paraEsquerda: boolean } | null {
  if (!BICHOS_DE_MATO_DO_MAPA[arena.mapa].includes('abelhao')) return null;
  const ancora = ancoraDoMato(arena);
  if (!ancora) return null;
  // Fase própria — mesma âncora do urso, mas deslocada, para o par não
  // nascer colado como se fossem um bicho só.
  const fase = (arena.seed % 300) * 0.021 + 3;
  return passeioCircular(ancora, tempo, fase, 0.9 * TILE, 0.9, 0.7);
}

/**
 * A cobra: a mesma árvore do meio do urso e do abelhão, uma terceira fase —
 * rasteira, devagar, num raio curto o bastante para nunca sair da sombra
 * dela.
 */
export function posicaoDaCobra(
  arena: Arena,
  tempo: number,
  unidades?: readonly Pick<Unidade, 'x' | 'y' | 'vivo'>[],
): { x: number; y: number; paraEsquerda: boolean } | null {
  if (!BICHOS_DE_MATO_DO_MAPA[arena.mapa].includes('cobra')) return null;
  const ancora = ancoraDoMato(arena);
  if (!ancora) return null;
  const fase = (arena.seed % 400) * 0.019 + 6;
  const passeio = passeioCircular(ancora, tempo, fase, 0.7 * TILE, 0.12, 0.35);
  const empurrao = empurraoDeAlerta(passeio, unidades);
  return {
    x: passeio.x + empurrao.x,
    y: passeio.y + empurrao.y,
    paraEsquerda: empurrao.x !== 0 ? empurrao.x < 0 : passeio.paraEsquerda,
  };
}

/**
 * O lagarto: ancorado na jazida de ouro do meio do campo — pedra ao sol —,
 * do mesmo jeito que a tartaruga ancora na água central. Sem jazida de ouro
 * no meio (não deveria faltar em nenhum mapa da lista), ele simplesmente
 * não aparece.
 */
export function posicaoDoLagarto(
  arena: Arena,
  tempo: number,
  unidades?: readonly Pick<Unidade, 'x' | 'y' | 'vivo'>[],
): { x: number; y: number; paraEsquerda: boolean } | null {
  const j = arena.jazidas.find((j) => j.tipo === 'ouro' && j.lado === null) ?? null;
  if (!j) return null;
  const ancora = { x: j.x + TILE * 1.3, y: j.y + TILE * 0.4 };
  const fase = (arena.seed % 600) * 0.023;
  // Rápido e nervoso — o lagarto para, dispara, para de novo — é o que a
  // velocidade alta e o raio curto dão de graça só com o seno. O empurrão de
  // alerta é o mesmo dos outros bichos, mas nele se nota mais: é o único que
  // já corria por conta própria.
  const passeio = passeioCircular(ancora, tempo, fase, 0.8 * TILE, 0.7, 0.4);
  const empurrao = empurraoDeAlerta(passeio, unidades);
  return {
    x: passeio.x + empurrao.x,
    y: passeio.y + empurrao.y,
    paraEsquerda: empurrao.x !== 0 ? empurrao.x < 0 : passeio.paraEsquerda,
  };
}
