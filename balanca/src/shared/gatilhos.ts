import type { Estado } from './estado';
import { DT } from './regras';

/**
 * Gatilhos: fase 5 da engine, e a mais contida de propósito.
 *
 * ## O que isto não é
 *
 * Não é um interpretador de script, e não roda nenhum código que alguém
 * escreveu — não há `eval`, não há função vinda de fora. Um modo com
 * `gatilhos` continua sendo só dado: uma condição de um vocabulário fechado
 * (hoje, uma só: "a cada N segundos") e uma ação de outro vocabulário fechado
 * (hoje, uma só: "avisar todo mundo"). O `switch` que os executa, em
 * `aplicarGatilhos`, é exaustivo (`noFallthroughCasesInSwitch`) — a terceira
 * condição ou ação que alguém esquecer de tratar aqui não compila.
 *
 * ## Por que tão pouco
 *
 * O resto da engine (mapas, modos, classes) migrou dado que **já existia**
 * como tabela TypeScript — nenhuma delas inventou um comportamento novo, só
 * tirou do código o que já era número e string. Um gatilho de verdade
 * genérico ("se X então Y", com X e Y abertos) é o oposto: é a única peça
 * desta engine que pode fazer o jogo fazer algo que ele não fazia antes, e é
 * exatamente por isso que o vocabulário começa **mínimo** e cresce por
 * necessidade comprovada, não por especulação — a mesma disciplina que
 * `modos.ts` já documenta ("uma alavanca por modo").
 *
 * ## Por que não precisa de estado guardado
 *
 * "A cada N segundos" não guarda "quando disparou pela última vez": deriva
 * direto de `estado.tick`, que já é determinístico e já viaja no retrato.
 * Guardar um relógio por gatilho precisaria entrar no `Estado`, no protocolo
 * e no save de partida — tudo isso para redizer o que `tick % intervalo`
 * já diz de graça.
 */

export type Condicao = { readonly tipo: 'temporizador'; readonly intervaloSegundos: number };

export type Acao = { readonly tipo: 'mensagem'; readonly texto: string };

export interface Gatilho {
  readonly quando: Condicao;
  readonly entao: readonly Acao[];
}

function condicaoBateu(condicao: Condicao, estado: Estado): boolean {
  switch (condicao.tipo) {
    case 'temporizador': {
      const intervaloEmTicks = Math.max(1, Math.round(condicao.intervaloSegundos / DT));
      return estado.tick > 0 && estado.tick % intervaloEmTicks === 0;
    }
  }
}

function executar(acao: Acao, estado: Estado): void {
  switch (acao.tipo) {
    case 'mensagem':
      estado.eventos.push({ tipo: 'gatilho', texto: acao.texto });
      return;
  }
}

/** Chamada uma vez por tick, com os gatilhos do modo em jogo. */
export function aplicarGatilhos(gatilhos: readonly Gatilho[] | undefined, estado: Estado): void {
  if (!gatilhos) return;
  for (const gatilho of gatilhos) {
    if (!condicaoBateu(gatilho.quando, estado)) continue;
    for (const acao of gatilho.entao) executar(acao, estado);
  }
}
