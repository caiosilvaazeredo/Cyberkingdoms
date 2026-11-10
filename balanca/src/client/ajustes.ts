/**
 * As preferências do jogador, e o pouco que elas podem mexer.
 *
 * ## O que entra aqui, e o que não entra
 *
 * Só o que é **do jogador**, não do jogo: quanto do campo ele quer ver, se quer
 * nomes na tela, se o celular dele aguenta desenhar mato. Nada aqui muda uma
 * regra — nenhum ajuste dá vantagem, e é por isso que todos podem viver no
 * `localStorage` sem o servidor ter opinião sobre eles.
 *
 * O campo de visão é o caso limite: ver mais mapa **é** vantagem em muitos
 * jogos. Aqui a faixa é estreita de propósito (de 0,85 a 1,15 do padrão), o
 * suficiente para acomodar tela pequena e vista cansada, e pouco demais para
 * virar estratégia.
 *
 * ## Por que ler e escrever passam por uma função
 *
 * `localStorage` é texto vindo do computador de outra pessoa: pode ter sido
 * escrito por uma versão antiga do jogo, editado à mão, ou não existir. Um
 * `JSON.parse` solto no meio do código de desenho quebra o jogo inteiro por
 * causa de uma vírgula. Aqui cada campo é conferido contra o padrão, e o que
 * não bater é substituído.
 */

export type Visao = 'perto' | 'padrao' | 'longe';
export type Lado = 'esquerda' | 'direita';
/** Qual controle desenhar: teclado/mouse, toque, ou adivinhar pelo aparelho. */
export type Plataforma = 'auto' | 'computador' | 'celular';
export type Orientacao = 'vertical' | 'horizontal';
/** Sprites do pacote ou os modelos voxel de `public/voxel`. */
export type Render = '2d' | '3d';

export interface Ajustes {
  nome: string;
  visao: Visao;
  /**
   * A escolha explícita de controles, antes de entrar na partida.
   *
   * `'auto'` mantém a detecção por hardware (`dispositivoTemToque`) de
   * sempre; `'computador'` e `'celular'` forçam o esquema mesmo quando o
   * aparelho destoa (um celular ligado a teclado, um tablet com mouse). Por
   * pedido explícito: isto só troca **quais controles aparecem** — mapa,
   * regras e todo o resto do jogo são os mesmos nas três opções.
   */
  plataforma: Plataforma;
  /** No celular, se a barra de ações some embaixo (vertical) ou nas laterais
   * (horizontal). Sem efeito quando `plataforma` não é `'celular'`. */
  orientacao: Orientacao;
  /** Nomes sobre a cabeça de cada um. */
  nomes: boolean;
  /** Árvores, arbustos e pedras. Desligar ajuda em celular fraco. */
  mato: boolean;
  /** O registro de abates e depósitos, no canto. */
  registro: boolean;
  /**
   * O minimapa no canto de cima.
   *
   * Desligável porque ele ocupa canto de tela, e em tela pequena o canto é
   * caro. Não é vantagem: ele mostra o que o time já sabe.
   */
  minimapa: boolean;
  /** O cartão de vida e classe, no canto de baixo. */
  cartao: boolean;
  /** De que lado da tela fica o manche, no celular. */
  manche: Lado;
  /**
   * Como o mundo é desenhado.
   *
   * `'3d'` troca os sprites por modelos voxel **onde já existe modelo**; o
   * resto continua sprite. A simulação é a mesma nas duas opções — isto é só
   * o pincel, e por isso mora aqui e não nas regras. `?render=3d` na URL
   * força a opção para uma visita, sem gravar.
   */
  render: Render;
}

export const PADROES: Ajustes = {
  nome: '',
  visao: 'padrao',
  nomes: true,
  mato: true,
  registro: true,
  minimapa: true,
  cartao: true,
  manche: 'esquerda',
  plataforma: 'auto',
  orientacao: 'vertical',
  render: '2d',
};

/** Multiplicador do zoom por nível de visão. */
export const ZOOM_DA_VISAO: Readonly<Record<Visao, number>> = {
  perto: 1.15,
  padrao: 1,
  longe: 0.85,
};

const CHAVE = 'balanca.ajustes';

export function carregarAjustes(guarda: Storage = localStorage): Ajustes {
  try {
    const bruto = guarda.getItem(CHAVE);
    if (!bruto) return { ...PADROES };
    return sanear(JSON.parse(bruto));
  } catch {
    // Texto corrompido, aba privada, cota estourada: o jogo abre com o padrão.
    // Um ajuste perdido é um aborrecimento; uma tela preta é o fim da partida.
    return { ...PADROES };
  }
}

export function salvarAjustes(ajustes: Ajustes, guarda: Storage = localStorage): void {
  try {
    guarda.setItem(CHAVE, JSON.stringify(ajustes));
  } catch {
    // Sem espaço ou sem permissão: os ajustes valem para esta sessão e pronto.
  }
}

/** Confere campo a campo contra o padrão. Nada de fora entra sem passar aqui. */
export function sanear(bruto: unknown): Ajustes {
  const o = (bruto ?? {}) as Partial<Record<keyof Ajustes, unknown>>;
  const booleano = (v: unknown, padrao: boolean): boolean =>
    typeof v === 'boolean' ? v : padrao;
  const entre = <T extends string>(v: unknown, opcoes: readonly T[], padrao: T): T =>
    typeof v === 'string' && (opcoes as readonly string[]).includes(v) ? (v as T) : padrao;

  return {
    nome: typeof o.nome === 'string' ? o.nome.slice(0, 16) : PADROES.nome,
    visao: entre(o.visao, ['perto', 'padrao', 'longe'] as const, PADROES.visao),
    nomes: booleano(o.nomes, PADROES.nomes),
    mato: booleano(o.mato, PADROES.mato),
    registro: booleano(o.registro, PADROES.registro),
    minimapa: booleano(o.minimapa, PADROES.minimapa),
    cartao: booleano(o.cartao, PADROES.cartao),
    manche: entre(o.manche, ['esquerda', 'direita'] as const, PADROES.manche),
    plataforma: entre(o.plataforma, ['auto', 'computador', 'celular'] as const, PADROES.plataforma),
    orientacao: entre(o.orientacao, ['vertical', 'horizontal'] as const, PADROES.orientacao),
    render: entre(o.render, ['2d', '3d'] as const, PADROES.render),
  };
}
