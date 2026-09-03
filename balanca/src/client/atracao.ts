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
 * sem tutorial, porque dá para ver o baú gorda sendo carregado e o cortejo
 * travando na ponte.
 *
 * É o modo atração dos fliperamas, com uma diferença: aqui não é uma gravação.
 * É o servidor, ao vivo, com os bots que estariam jogando de qualquer jeito.
 *
 * ## O que faz uma cena valer a pena
 *
 * A câmera persegue **o que decide a partida**, nesta ordem: o baú sendo
 * carregado, o baú caído no chão, o maior encontro entre os dois times e,
 * se ninguém estiver se esbarrando, o maior grupo de gente que houver. É a mesma
 * ordem de importância que um comentarista usaria — e o encontro entre times
 * pesa mais de propósito: cinco do mesmo lado juntos é fila para o chapéu, e
 * briga é melhor cena que fila.
 *
 * ## Por que o último recurso é um grupo, e não o centro de massa
 *
 * A primeira versão caía no **centroide de todo mundo** quando não havia briga.
 * Parece razoável e é o pior alvo possível: com os dois times cada um no seu
 * lado do mapa, a média dos dois é o meio — grama vazia. O menu passava minutos
 * filmando um lago sem ninguém, que é exatamente o que este arquivo existe para
 * evitar.
 *
 * Filmar a fila do chapéu é pior que filmar a briga e muito melhor que filmar o
 * vazio: pelo menos há gente andando na tela. Por isso o desempate final é o
 * amontoado mais cheio, misturado ou não.
 *
 * ## Por que isto é uma função pura
 *
 * Escolher o alvo não desenha nada e não depende do relógio: recebe o estado,
 * devolve um ponto. Assim dá para testar "com o baú carregado, a câmera
 * segue o cortejo" sem abrir um navegador — que é o tipo de regra que quebra em
 * silêncio quando alguém mexe no desenho.
 */

export interface AlvoDaAtracao {
  x: number;
  y: number;
  /** O que prendeu a atenção. Só o diagnóstico e o teste usam. */
  motivo: 'cortejo' | 'bau-no-chao' | 'briga' | 'campo' | 'centro';
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

  const carregado = estado.baus.find((p) => p.onde === 'carregado');
  if (carregado) return { x: carregado.x, y: carregado.y, motivo: 'cortejo' };

  const caida = estado.baus.find((p) => p.onde === 'chao');
  if (caida) return { x: caida.x, y: caida.y, motivo: 'bau-no-chao' };

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
  // Briga é encontro de **times diferentes** — a cena que melhor explica o jogo
  // para quem nunca jogou.
  if (melhor && melhor.quantas >= 2 && melhor.times.size >= 2) {
    return { x: melhor.x, y: melhor.y, motivo: 'briga' };
  }

  // Sem briga, a câmera vai para o maior grupo que houver, mesmo que seja a
  // fila do chapéu. Ver gente andando é sempre melhor que ver o meio do mapa
  // vazio — ver o topo deste arquivo.
  if (melhor) return { x: melhor.x, y: melhor.y, motivo: 'campo' };
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
