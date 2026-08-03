import type { TileCoord } from './coords';
import type { WorldLayout } from './layout';
import type { Settlement } from './settlement';

/**
 * Rotas pela malha viária: quantos dias custa ir de uma cidade a outra.
 *
 * ## Por que existe uma busca, e não a linha reta
 *
 * As estradas ligam vinte cidades em vinte e uma arestas — longe de todas com
 * todas. Ir de um satélite do norte a um do sul passa por duas ou três
 * capitais, e é justamente esse desvio que dá sentido à posição de cada cidade
 * no mapa. Medir em linha reta apagaria a malha: a geografia viraria enfeite e
 * a capital no meio do caminho deixaria de valer alguma coisa.
 *
 * ## Por que o peso é dia, e não distância
 *
 * `travelDays` já embute o terreno — um trecho de pântano custa mais dia por
 * tile que a mesma distância no descampado. Reordenar por comprimento faria a
 * rota "mais curta" ser a mais demorada, que é o pior tipo de conselho para
 * quem paga a viagem em fome e sede.
 *
 * O desempate é pelo perigo: entre dois caminhos de quatro dias, o jogador
 * quer o que não passa pela estrada de emboscada — e essa preferência tem de
 * ser o padrão, porque é a escolha que ele faria se visse as duas.
 */

export interface TravelRoute {
  /** Cidades pelo caminho, da origem ao destino, ambas incluídas. */
  readonly stops: readonly string[];
  /** Soma dos dias de trânsito. */
  readonly days: number;
  /** O pior trecho da rota, de 0 a 1. É por ele que o risco se mede. */
  readonly danger: number;
}

/**
 * Menor rota em dias entre duas cidades, ou `null` quando não há caminho.
 *
 * `null` é um resultado legítimo: nada garante que a malha gerada seja conexa,
 * e uma ilha de satélites sem ligação com o resto é um mundo válido — só não é
 * um mundo onde dá para chegar de estrada.
 */
export function findRoute(
  layout: WorldLayout,
  fromId: string,
  toId: string,
): TravelRoute | null {
  if (fromId === toId) return { stops: [fromId], days: 0, danger: 0 };
  if (!layout.byId(fromId) || !layout.byId(toId)) return null;

  interface Marca {
    readonly days: number;
    readonly danger: number;
    readonly anterior: string | null;
  }

  const melhor = new Map<string, Marca>([[fromId, { days: 0, danger: 0, anterior: null }]]);
  const fechados = new Set<string>();

  // Dijkstra com fila linear. Vinte nós não justificam um heap: a varredura é
  // O(n²) sobre vinte, e um heap seria mais código para o mesmo resultado.
  for (;;) {
    let atual: string | null = null;
    let atualMarca: Marca | null = null;
    for (const [id, marca] of melhor) {
      if (fechados.has(id)) continue;
      if (
        !atualMarca ||
        marca.days < atualMarca.days ||
        (marca.days === atualMarca.days && marca.danger < atualMarca.danger)
      ) {
        atual = id;
        atualMarca = marca;
      }
    }
    if (!atual || !atualMarca) break;
    if (atual === toId) break;
    fechados.add(atual);

    for (const road of layout.roadsFrom(atual)) {
      const vizinho = layout.otherEnd(road, atual);
      if (fechados.has(vizinho)) continue;
      const days = atualMarca.days + road.travelDays;
      const danger = Math.max(atualMarca.danger, road.danger);
      const anterior = melhor.get(vizinho);
      if (
        !anterior ||
        days < anterior.days ||
        (days === anterior.days && danger < anterior.danger)
      ) {
        melhor.set(vizinho, { days, danger, anterior: atual });
      }
    }
  }

  const destino = melhor.get(toId);
  if (!destino) return null;

  const stops: string[] = [];
  for (let id: string | null = toId; id !== null; id = melhor.get(id)?.anterior ?? null) {
    stops.unshift(id);
  }
  return { stops, days: destino.days, danger: destino.danger };
}

/**
 * A cidade mais próxima de um ponto qualquer.
 *
 * Serve para viajar de onde o jogador estiver: quem saiu a pé e está no meio do
 * descampado não deveria ter de voltar andando até a cidade só para poder pegar
 * a estrada. A saída é o nó mais próximo da malha, e a interface diz qual é —
 * exigir retorno seria atrito sem nada em troca.
 */
export function nearestSettlement(layout: WorldLayout, tile: TileCoord): Settlement | null {
  let melhor: Settlement | null = null;
  let melhorDistancia = Number.POSITIVE_INFINITY;
  for (const s of layout.settlements) {
    const d = Math.hypot(s.center.x - tile.x, s.center.y - tile.y);
    if (d < melhorDistancia) {
      melhorDistancia = d;
      melhor = s;
    }
  }
  return melhor;
}
