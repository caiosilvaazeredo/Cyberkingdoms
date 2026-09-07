import type { TipoDeEstrutura, TipoDeJazida } from './arena';

import ARQUIPELAGO_JSON from './mapas-dados/arquipelago.json';
import CIDADELA_JSON from './mapas-dados/cidadela.json';
import CORTE_JSON from './mapas-dados/corte.json';
import DESFILADEIRO_JSON from './mapas-dados/desfiladeiro.json';
import ENCRUZILHADA_JSON from './mapas-dados/encruzilhada.json';
import PANTANO_JSON from './mapas-dados/pantano.json';
import PLANICIE_JSON from './mapas-dados/planicie.json';
import VAU_JSON from './mapas-dados/vau.json';

/**
 * Os campos de batalha, como **dado** — a Fase 0 da engine.
 *
 * ## O que mudou, e por que agora é o momento
 *
 * Até aqui cada mapa era uma função TypeScript: `relevo(p)` desenhava água e
 * ponte chamando o pincel em laços escritos à mão. Isso funcionava, mas
 * fechava a porta para qualquer coisa fora do compilador — um editor visual
 * não pode gerar `for (let ty = 6; ty <= 27; ty++) p.agua(16, ty)`, só pode
 * gerar dado.
 *
 * Este arquivo agora só define o **schema**: o tipo `EsquemaDeMapa`, os poucos
 * gestos de terreno que um mapa deste jogo já demonstrou precisar (linha reta,
 * ponte, elipse — nunca mais que isso, nos oito mapas que existem), e o
 * intérprete `aplicarRelevo` que os executa contra o `Pincel`. Os mapas em si
 * viraram arquivo — `mapas-dados/*.json` —, e um editor (fase 1) escreve esse
 * mesmo formato.
 *
 * ## Por que só a metade azul continua sendo escrita
 *
 * Cada mapa desenha a metade esquerda e a coluna do eixo; o vermelho é o
 * espelho, montado por `criarArena`. É a mesma regra de sempre, e vale ainda
 * mais agora: com JSON, duas listas de coordenadas que alguém tem de manter
 * iguais na mão seriam ainda mais fáceis de deixar divergir do que duas
 * chamadas de função lado a lado.
 *
 * ## Por que ainda é `import` de JSON, e não `fetch` em disco
 *
 * A fase 0 prova que o **formato** aguenta os oito mapas que já existem — não
 * resolve ainda "o editor grava um mapa novo e o jogo o vê sem rebuild". Um
 * `import` de JSON já tira o mapa do código (é editável por fora, por
 * ferramenta, sem tocar em TypeScript) e continua **síncrono**, que é o que
 * mantém os 350 e tantos testes existentes — e o cliente e o servidor —
 * funcionando sem qualquer mudança na forma como consultam um mapa. Trocar
 * isso por leitura de disco em tempo de execução é trabalho real (o cliente
 * empacotado pelo Vite não lê o disco do servidor — precisaria buscar por
 * HTTP, e toda consulta hoje síncrona a `mapaDe`/`MAPAS` viraria assíncrona em
 * cascata) e fica para quando o editor (fase 1) de fato precisar salvar um
 * mapa que ninguém escreveu à mão — não antes.
 */

export type IdDoMapa =
  | 'corte'
  | 'vau'
  | 'desfiladeiro'
  | 'arquipelago'
  | 'planicie'
  | 'encruzilhada'
  | 'pantano'
  | 'cidadela';

/**
 * Os gestos de terreno que um mapa pode pedir.
 *
 * Três operações bastaram para os oito mapas que já existem, e não por
 * coincidência: um campo deste jogo só precisa dizer "aqui é fosso ou rio"
 * (`linha`), "aqui se atravessa" (`pontes`) e "aqui é lago" (`elipse`). Um
 * editor visual gera exatamente isto a partir de cliques — nunca um laço.
 */
export type OperacaoDeRelevo =
  /**
   * Um traço reto de água, de um tile ao outro. `eixo: 'vertical'` fixa a
   * coluna (`fixo`) e varre linhas de `de` a `ate`; `'horizontal'` fixa a
   * linha e varre colunas. É o fosso do castelo e o rio do meio dos oito
   * mapas atuais — sempre um traço reto, nunca uma diagonal.
   */
  | { readonly tipo: 'linha'; readonly eixo: 'vertical' | 'horizontal'; readonly fixo: number; readonly de: number; readonly ate: number }
  /** Pontes num traço de água já desenhado. Não desenha o traço sozinha —
   * vem sempre depois de uma `linha` na mesma coluna. */
  | { readonly tipo: 'pontes'; readonly coluna: number; readonly linhas: readonly number[] }
  /** Um lago. `cx`/`cy` aceitam meio tile — é o que centra um lago no eixo de
   * simetria do mapa, que cai exatamente entre dois tiles. */
  | { readonly tipo: 'elipse'; readonly cx: number; readonly cy: number; readonly rx: number; readonly ry: number }
  /**
   * Tiles soltos de água ou ponte, um a um — `[tx, ty][]`.
   *
   * Os três gestos acima bastam para desenhar um mapa à mão, com régua e
   * compasso; ninguém pinta assim. O editor visual (fase 1) pinta tile por
   * tile e exporta a lista exata do que foi clicado — sem tentar adivinhar
   * se aquilo formava uma linha reta ou uma elipse. As duas formas convivem:
   * um mapa pode ter `linha`/`elipse` desenhados à mão e `tiles` por cima,
   * pintados depois no editor.
   */
  | { readonly tipo: 'tiles'; readonly material: 'agua' | 'ponte'; readonly pontos: readonly (readonly [number, number])[] };

/**
 * Um mapa, exatamente como um arquivo `mapas-dados/*.json` o descreve.
 *
 * Todo campo é dado — número, string, tupla — e nada aqui é função. É o que
 * faz este tipo servir de contrato tanto para o TypeScript quanto para
 * qualquer ferramenta (editor, validador, script) que um dia gerar ou ler
 * este JSON sem saber nada de TypeScript.
 */
export interface EsquemaDeMapa {
  readonly id: string;
  readonly nome: string;
  readonly largura: number;
  readonly altura: number;
  readonly lema: string;
  /** As duas espécies de árvore deste relevo — sempre um par, nunca as
   * quatro do pacote. Ver a nota em `arena.ts`. */
  readonly especiesDeArvore: readonly [number, number];
  readonly relevo: readonly OperacaoDeRelevo[];
  readonly planta: Readonly<Record<TipoDeEstrutura, readonly [number, number]>>;
  readonly jazidasDoLado: readonly (readonly [number, number, TipoDeJazida])[];
  readonly jazidasDoMeio: readonly (readonly [number, number, TipoDeJazida])[];
  readonly pastosDoLado: readonly (readonly [number, number])[];
  readonly pastosDoMeio: readonly (readonly [number, number])[];
  readonly portoes: readonly {
    readonly coluna: number;
    readonly de: number;
    readonly ate: number;
    readonly passagens: readonly number[];
  }[];
  readonly foraDoSorteio?: boolean;
}

/**
 * O desenhista do relevo.
 *
 * Escreve sempre nos dois lados. `agua` e `ponte` recebem a coluna do lado
 * azul; quem cuida do espelho é quem construiu o pincel.
 */
export interface Pincel {
  readonly largura: number;
  readonly altura: number;
  agua(tx: number, ty: number): void;
  ponte(tx: number, ty: number): void;
  /** Devolve o chão ao que era, para abrir passagem num traço já desenhado. */
  chao(tx: number, ty: number): void;
}

/** Um mapa depois de carregado — o mesmo `EsquemaDeMapa`, com `id` resolvido
 * para o tipo fechado que o resto do jogo indexa. */
export type Mapa = Omit<EsquemaDeMapa, 'id'> & { readonly id: IdDoMapa };

/**
 * Executa as operações de relevo de um mapa contra o pincel de `criarArena`.
 *
 * Um `switch` e não um objeto de funções por operação: são três casos, e o
 * `noFallthroughCasesInSwitch` do projeto já pega o dia em que uma quarta
 * operação for adicionada ao tipo e esquecida aqui.
 */
export function aplicarRelevo(p: Pincel, ops: readonly OperacaoDeRelevo[]): void {
  for (const op of ops) {
    switch (op.tipo) {
      case 'linha':
        for (let i = op.de; i <= op.ate; i++) {
          if (op.eixo === 'vertical') p.agua(op.fixo, i);
          else p.agua(i, op.fixo);
        }
        break;
      case 'pontes':
        for (const linha of op.linhas) p.ponte(op.coluna, linha);
        break;
      case 'elipse':
        elipse(p, op.cx, op.cy, op.rx, op.ry);
        break;
      case 'tiles':
        for (const [tx, ty] of op.pontos) {
          if (op.material === 'agua') p.agua(tx, ty);
          else p.ponte(tx, ty);
        }
        break;
    }
  }
}

/** Uma elipse de água, para o pincel. */
function elipse(p: Pincel, cx: number, cy: number, rx: number, ry: number): void {
  for (let ty = Math.floor(cy - ry); ty <= Math.ceil(cy + ry); ty++) {
    for (let tx = Math.floor(cx - rx); tx <= Math.ceil(cx); tx++) {
      const dx = (tx - cx) / rx;
      const dy = (ty - cy) / ry;
      if (dx * dx + dy * dy <= 1) p.agua(tx, ty);
    }
  }
}

/**
 * Quantas unidades por time este campo comporta — gente e npc somados.
 *
 * A conta é de **densidade**, calibrada pelo que já se conhecia: seis por lado
 * no Corte são doze unidades em dois mil e quarenta tiles, e oito por lado — o
 * teto antigo, escolhido a olho e que se mostrou bom — dão cento e seis tiles
 * por unidade. É esse número que virou a régua.
 */
const TILES_POR_UNIDADE = 110;

export function porTimeMaximo(mapa: Mapa): number {
  return Math.max(1, Math.floor((mapa.largura * mapa.altura) / (2 * TILES_POR_UNIDADE)));
}

// --- a tabela ---------------------------------------------------------------
//
// Cada import acima é um `EsquemaDeMapa` (o JSON tem exatamente essa forma).
// `id` chega como `string` do JSON; aqui ele é reafirmado como `IdDoMapa`
// porque estes oito arquivos são conhecidos — é a mesma garantia que os
// objetos escritos à mão davam antes, só que verificada uma vez, aqui, em vez
// de em cada um dos oito literais.

// O JSON chega com `string[]`/`string` onde o schema promete tupla e União
// literal — é o preço de o TypeScript não estreitar literais de um módulo
// JSON. O `as EsquemaDeMapa` aqui é o único lugar do arquivo que confia nisso
// sem checar, e é seguro porque os oito arquivos em `mapas-dados/` são
// escritos por nós, não dado de fora — o mesmo padrão de confiança que
// `Mapa`/`Pincel` já tinham quando eram literais TypeScript.
function comId<I extends IdDoMapa>(bruto: unknown, id: I): Mapa {
  return { ...(bruto as EsquemaDeMapa), id };
}

export const MAPAS: Readonly<Record<IdDoMapa, Mapa>> = {
  corte: comId(CORTE_JSON, 'corte'),
  vau: comId(VAU_JSON, 'vau'),
  desfiladeiro: comId(DESFILADEIRO_JSON, 'desfiladeiro'),
  arquipelago: comId(ARQUIPELAGO_JSON, 'arquipelago'),
  planicie: comId(PLANICIE_JSON, 'planicie'),
  encruzilhada: comId(ENCRUZILHADA_JSON, 'encruzilhada'),
  pantano: comId(PANTANO_JSON, 'pantano'),
  cidadela: comId(CIDADELA_JSON, 'cidadela'),
};

export const MAPA_PADRAO: IdDoMapa = 'corte';

/** A lista, na ordem em que a tela mostra. */
export const IDS_DOS_MAPAS: readonly IdDoMapa[] = [
  'corte',
  'vau',
  'desfiladeiro',
  'arquipelago',
  'planicie',
  'encruzilhada',
  'pantano',
  'cidadela',
];

/**
 * O mapa de um id vindo de fora.
 *
 * Tolerante pelo mesmo motivo de `modoDe`: o id chega pela rede, e um nome
 * desconhecido cai no padrão em vez de derrubar a sala.
 */
export function mapaDe(id: unknown): Mapa {
  return typeof id === 'string' && id in MAPAS ? MAPAS[id as IdDoMapa] : MAPAS[MAPA_PADRAO];
}

/**
 * Os mapas que entram na roda do sorteio — todos, menos os marcados
 * `foraDoSorteio`. Usada tanto por `mapaSorteado` (o que pode sair) quanto
 * por `totalPorTime('sorteio')` em protocolo.ts (o teto que vale para
 * qualquer um deles): as duas listas têm de ser a mesma, ou uma sala que
 * sorteou o teto de um mapa acabaria sorteando outro que ela nunca prometeu.
 */
export const IDS_SORTEAVEIS: readonly IdDoMapa[] = IDS_DOS_MAPAS.filter(
  (id) => !MAPAS[id].foraDoSorteio,
);

/**
 * Sorteia um mapa a partir da seed da partida.
 *
 * Determinístico de propósito: a seed já decide o mato e a partida inteira, e
 * fazer o mapa depender de `Math.random` seria a única coisa do jogo que o
 * servidor não conseguiria reproduzir ao investigar um defeito.
 */
export function mapaSorteado(seed: number): IdDoMapa {
  const i = (seed >>> 0) % IDS_SORTEAVEIS.length;
  return IDS_SORTEAVEIS[i]!;
}
