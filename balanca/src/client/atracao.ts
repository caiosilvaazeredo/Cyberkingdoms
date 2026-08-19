import type { Estado } from '../shared/estado';
import { TILE, type Time } from '../shared/regras';

/**
 * A câmera do menu: para onde olhar quando ninguém está jogando.
 *
 * ## Por que o menu mostra a partida, e não uma ilustração
 *
 * O jogo é só multiplayer, e a primeira pergunta de quem chega é "tem gente
 * jogando?". Uma arte de fundo não responde; uma partida de verdade correndo
 * atrás do título responde antes de a pessoa perguntar — e ainda ensina o jogo
 * sem tutorial, porque dá para ver a princesa gorda sendo carregada e o cortejo
 * travando na ponte.
 *
 * É o modo atração dos fliperamas, com uma diferença: aqui não é uma gravação.
 * É o servidor, ao vivo, com os bots que estariam jogando de qualquer jeito.
 *
 * ## O que faz uma cena valer a pena
 *
 * A câmera persegue **o que decide a partida**, nesta ordem: a princesa sendo
 * carregada, a princesa caída no chão, o maior encontro entre os dois times e,
 * se ninguém estiver se esbarrando, o centro de massa de quem está de pé. É a
 * mesma ordem de importância que um comentarista usaria — e o encontro exige os
 * dois times de propósito: cinco do mesmo lado juntos é fila para o chapéu, e
 * filmar a fila faz um jogo cheio parecer parado.
 *
 * ## Por que isto é uma função pura
 *
 * Escolher o alvo não desenha nada e não depende do relógio: recebe o estado,
 * devolve um ponto. Assim dá para testar "com a princesa carregada, a câmera
 * segue o cortejo" sem abrir um navegador — que é o tipo de regra que quebra em
 * silêncio quando alguém mexe no desenho.
 */

export interface AlvoDaAtracao {
  x: number;
  y: number;
  /** O que prendeu a atenção. Só o diagnóstico e o teste usam. */
  motivo: 'cortejo' | 'princesa-no-chao' | 'briga' | 'campo' | 'centro';
}

/** Raio em que duas unidades contam como parte do mesmo amontoado. */
const RAIO_DA_BRIGA = 4 * TILE;

export function alvoDaAtracao(
  estado: Estado | null,
  largura: number,
  altura: number,
): AlvoDaAtracao {
  const centro = { x: (largura * TILE) / 2, y: (altura * TILE) / 2, motivo: 'centro' as const };
  if (!estado || estado.unidades.length === 0) return centro;

  const carregada = estado.princesas.find((p) => p.onde === 'carregada');
  if (carregada) return { x: carregada.x, y: carregada.y, motivo: 'cortejo' };

  const caida = estado.princesas.find((p) => p.onde === 'chao');
  if (caida) return { x: caida.x, y: caida.y, motivo: 'princesa-no-chao' };

  // O maior amontoado: para cada unidade viva, quantas outras estão ao redor.
  // É O(n²) sobre doze unidades — quarenta e quatro contas por quadro, menos do
  // que custaria manter uma grade espacial para isto.
  const vivas = estado.unidades.filter((u) => u.vivo);
  let melhor: { x: number; y: number; quantas: number; times: Set<Time> } | null = null;
  for (const u of vivas) {
    const perto = vivas.filter((o) => Math.hypot(o.x - u.x, o.y - u.y) <= RAIO_DA_BRIGA);
    const times = new Set(perto.map((o) => o.time));
    const quantas = perto.length;
    // Empate resolvido pela **mistura**: três de cada lado é briga, seis do
    // mesmo lado é fila para o chapéu.
    const melhorAgora =
      melhor === null ||
      times.size > melhor.times.size ||
      (times.size === melhor.times.size && quantas > melhor.quantas);
    if (melhorAgora) {
      const x = perto.reduce((s, o) => s + o.x, 0) / quantas;
      const y = perto.reduce((s, o) => s + o.y, 0) / quantas;
      melhor = { x, y, quantas, times };
    }
  }
  // Briga é encontro de **times diferentes**. Cinco do mesmo lado juntos é fila
  // para o chapéu no quartel, e ficar filmando a fila é o jeito mais rápido de
  // fazer um jogo cheio parecer parado.
  if (melhor && melhor.quantas >= 2 && melhor.times.size >= 2) {
    return { x: melhor.x, y: melhor.y, motivo: 'briga' };
  }

  // Sem encontro, a câmera abre para onde a partida está acontecendo: o centro
  // de massa de quem está de pé, que puxa naturalmente para o meio do mapa.
  if (vivas.length > 0) {
    return {
      x: vivas.reduce((s, u) => s + u.x, 0) / vivas.length,
      y: vivas.reduce((s, u) => s + u.y, 0) / vivas.length,
      motivo: 'campo',
    };
  }
  return centro;
}

/**
 * Aproxima a câmera do alvo com suavização exponencial.
 *
 * Saltar direto para o novo alvo daria um corte seco a cada morte; seguir com
 * atraso dá o movimento de guindaste que um replay de esporte tem. O fator é
 * corrigido pelo `dt` para que a suavidade não dependa da taxa de quadros — sem
 * isso, a câmera de um monitor de 144 Hz chega três vezes mais rápido que a de
 * um de 60.
 */
export function aproximar(
  atual: { x: number; y: number },
  alvo: { x: number; y: number },
  dt: number,
  meiaVida = 0.6,
): { x: number; y: number } {
  const t = 1 - Math.pow(0.5, dt / meiaVida);
  return {
    x: atual.x + (alvo.x - atual.x) * t,
    y: atual.y + (alvo.y - atual.y) * t,
  };
}
