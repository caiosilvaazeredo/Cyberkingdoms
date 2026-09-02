import { linhaLivre, type Arena } from './arena';
import type { Estado, Unidade } from './estado';
import { ALCANCE_DE_VISTA, type Time } from './regras';

/**
 * O que o time enxerga.
 *
 * ## O que o minimapa mostra, e por quê
 *
 * O seu time, sempre — você sabe onde os seus estão porque eles falam com você.
 * O inimigo, só quando **alguém do seu time está vendo**. Um minimapa que mostra
 * o inimigo inteiro o tempo todo transforma o jogo num problema de leitura de
 * radar: o cerco deixa de ser uma coisa que se descobre e passa a ser uma coisa
 * que se lê, e a emboscada some do jogo.
 *
 * ## "Ver" é alcance e linha livre
 *
 * Duas condições, e as duas importam. **Alcance**, porque um companheiro do
 * outro lado do mapa não está vendo ninguém. **Linha livre**, porque o inimigo
 * atrás do lago ou do castelo não está à vista — é a mesma função que os bots já
 * usam para decidir se têm alvo, e usar a mesma faz o minimapa contar a mesma
 * história que a briga.
 *
 * O alcance é fixo e igual para todos. A alternativa seria "o que cabe na tela
 * de cada um", que muda com o monitor e com o zoom — e aí quem joga num monitor
 * grande enxergaria mais inimigos que quem joga no celular, o que é vantagem
 * comprada com dinheiro.
 *
 * ## Onde esta função vive, e onde ela ainda não vive
 *
 * Aqui, em `shared`, porque é **regra** e não desenho: dá para testá-la sem
 * abrir um navegador, e é o mesmo código que o servidor rodaria se um dia o
 * retrato passar a ser recortado por time.
 *
 * Hoje ele não é. O retrato leva todo mundo, e o recorte acontece na hora de
 * desenhar o minimapa — quem abrir o console vê o mapa inteiro. Isto é névoa de
 * **interface**, não de rede: ela existe para o jogo ser melhor, não para ser à
 * prova de trapaça. Trocar isso é mover esta chamada para o servidor e mandar um
 * retrato por time; o resto do código já está no lugar certo para isso.
 */

/**
 * Os ids dos inimigos que o time avista agora.
 *
 * Devolve um conjunto para o desenho perguntar por id sem varrer a lista de
 * novo — o minimapa faz essa pergunta uma vez por inimigo por quadro.
 */
export function avistados(arena: Arena, estado: Estado, time: Time): Set<number> {
  const olhos = estado.unidades.filter((u) => u.time === time && u.vivo);
  const vistos = new Set<number>();
  if (olhos.length === 0) return vistos;

  for (const alvo of estado.unidades) {
    if (alvo.time === time || !alvo.vivo) continue;
    if (olhos.some((o) => vePonto(arena, o, alvo))) vistos.add(alvo.id);
  }
  return vistos;
}

/**
 * Se um ponto qualquer está à vista de alguém do time.
 *
 * Serve para o que não é unidade: a princesa carregada, a princesa caída no
 * chão. A do próprio time é caso à parte e o minimapa mostra sempre — a bússola
 * do jogo já aponta para ela, e escondê-la no minimapa seria esconder no mapa o
 * que a seta na tela mostra.
 */
export function pontoAvistado(
  arena: Arena,
  estado: Estado,
  time: Time,
  ponto: { x: number; y: number },
): boolean {
  return estado.unidades.some((u) => u.time === time && u.vivo && vePonto(arena, u, ponto));
}

/** Alcance primeiro, linha livre depois: a conta barata antes da cara. */
function vePonto(arena: Arena, olho: Unidade, alvo: { x: number; y: number }): boolean {
  const dx = alvo.x - olho.x;
  const dy = alvo.y - olho.y;
  if (dx * dx + dy * dy > ALCANCE_DE_VISTA * ALCANCE_DE_VISTA) return false;
  return linhaLivre(arena, olho.x, olho.y, alvo.x, alvo.y);
}
