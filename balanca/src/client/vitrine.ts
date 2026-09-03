import type { Estado } from '../shared/estado';
import { TIMES, pesoMaximoDe, pesoMinimoDe, type Time } from '../shared/regras';
import { desenharBau } from './desenho';

/**
 * A balança do menu: a mecânica do jogo, pendurada por cima da partida.
 *
 * ## Por que ela existe
 *
 * O menu tinha o nome do jogo e cinco botões. Nada ali dizia o que o jogo **é**
 * — e o que ele é não é resgate, que todo mundo já viu, e sim a balança: uma
 * grandeza conservada repartida entre dois reféns. Explicar isso em texto no
 * menu seria um parágrafo que ninguém lê.
 *
 * Então a balança está desenhada, com um baú pendurado em cada prato, e ela
 * **pende**. Quem chega vê o fiel escorregar antes de apertar qualquer coisa e
 * já sabe a regra: encheu de um lado, aliviou do outro.
 *
 * ## E ela é de verdade
 *
 * Não é animação decorativa. Atrás do menu roda uma partida de bots — a mesma
 * que serve de papel de parede — e é o peso **daquela** partida que inclina o
 * fiel. Um menu que mostrasse uma balança falsa oscilando por conta própria
 * seria uma promessa; esta é um retrato.
 *
 * Sem partida ainda (os primeiros segundos, antes do primeiro retrato) ela fica
 * equilibrada, que é como toda partida começa. Nada de valor inventado para o
 * desenho não ficar vazio.
 *
 * ## Onde ela fica
 *
 * À direita da coluna de botões, no espaço que sobra — e some quando não sobra.
 * Numa tela estreita a coluna ocupa tudo, e uma balança por baixo dos botões
 * seria enfeite competindo com a única coisa que a pessoa foi ali fazer.
 */

/** Abaixo desta largura o menu é só a coluna, e a balança não é desenhada. */
const LARGURA_MINIMA = 900;

/** Quanto o fiel se inclina no talo, em radianos. */
const INCLINACAO = 0.32;

export interface Fiel {
  /** O ângulo desenhado agora, que persegue o do estado. Ver `mover`. */
  angulo: number;
}

export function criarFiel(): Fiel {
  return { angulo: 0 };
}

/**
 * Aproxima o ângulo desenhado do ângulo real.
 *
 * A balança de verdade dá saltos: uma bolsa move doze de uma vez, e o retrato
 * chega a quinze por segundo. Copiar o valor faria o fiel pular de degrau em
 * degrau. Perseguir suaviza sem mentir — o destino continua sendo o número do
 * servidor, e o desenho só demora um instante para chegar lá.
 */
export function moverFiel(fiel: Fiel, estado: Estado | null, dt: number): void {
  const alvo = anguloDaBalanca(estado);
  const passo = Math.min(1, dt * 3);
  fiel.angulo += (alvo - fiel.angulo) * passo;
}

/**
 * O ângulo do fiel, exportado para ter teste.
 *
 * O risco aqui não é a conta: é **inverter os pratos**. O prato azul carrega o
 * refém que o azul guarda, que é o baú vermelho, e trocar os dois faria o menu
 * pender ao contrário do jogo — ninguém perceberia até jogar uma partida e
 * comparar com a barra do alto. É o tipo de erro que só um teste pega.
 */
export function anguloDaBalanca(estado: Estado | null): number {
  if (!estado || estado.baus.length < 2) return 0;
  // O prato azul carrega o refém que o azul guarda, que é o baú **vermelho**.
  // Trocar os dois aqui inverteria o menu em relação ao jogo, e ninguém
  // perceberia até jogar.
  const peso: Record<Time, number> = { azul: 0, vermelho: 0 };
  for (const b of estado.baus) peso[b.time] = b.peso;
  const piso = pesoMinimoDe(estado.porTime);
  const faixa = pesoMaximoDe(estado.porTime) - piso;
  if (faixa <= 0) return 0;
  const azulGuarda = (peso.vermelho - piso) / faixa;
  const vermelhoGuarda = (peso.azul - piso) / faixa;
  // O sinal: `rotate` positivo gira no sentido do relógio, e o prato azul está
  // à **esquerda** — então ângulo positivo **levanta** o azul. Quem guarda o
  // refém mais pesado tem de descer, e por isso a subtração vai ao contrário do
  // que a leitura ingênua pediria. A primeira versão estava invertida, e nada
  // na tela acusava: o menu pendia ao contrário do jogo, e só uma partida
  // comparada com a barra do alto revelaria.
  return (vermelhoGuarda - azulGuarda) * INCLINACAO;
}

/**
 * Desenha a balança e os dois baús pendurados.
 *
 * @param larguraDaColuna o quanto da esquerda a coluna de botões toma. A
 * balança se centra no que sobra, e não na tela: centrada na tela ela ficaria
 * meio escondida atrás dos botões justamente nas larguras intermediárias.
 */
export function desenharVitrine(
  ctx: CanvasRenderingContext2D,
  fiel: Fiel,
  estado: Estado | null,
  largura: number,
  altura: number,
  larguraDaColuna: number,
  tempo: number,
): void {
  if (largura < LARGURA_MINIMA) return;

  const sobra = largura - larguraDaColuna;
  const cx = larguraDaColuna + sobra / 2;
  const cy = altura * 0.34;
  const escala = Math.min(1.2, Math.max(0.7, sobra / 900));
  const braco = 112 * escala;
  const corda = 54 * escala;

  ctx.save();

  // O painel por trás.
  //
  // A primeira versão era um degradê suave, e não funcionou: por cima de uma
  // partida cheia de casa, árvore e boneco, meia sombra some. A balança lia como
  // cenário — dois baús no chão e uma viga atravessada, que é exatamente o que
  // ela **não** é.
  //
  // Sólido, com a mesma cor e o mesmo canto arredondado dos painéis do HUD, ela
  // passa a ser obviamente do menu. O jogo já tem essa linguagem; usar outra
  // aqui seria inventar uma segunda para dizer a mesma coisa.
  const pL = braco * 2 + 96 * escala;
  const pA = 250 * escala;
  const px = cx - pL / 2;
  const py = cy - 74 * escala;
  const raio = 16 * escala;
  ctx.beginPath();
  ctx.moveTo(px + raio, py);
  ctx.arcTo(px + pL, py, px + pL, py + pA, raio);
  ctx.arcTo(px + pL, py + pA, px, py + pA, raio);
  ctx.arcTo(px, py + pA, px, py, raio);
  ctx.arcTo(px, py, px + pL, py, raio);
  ctx.closePath();
  ctx.fillStyle = 'rgba(12, 14, 20, 0.93)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(201, 162, 39, 0.35)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.translate(cx, cy);

  // O gancho de onde a balança pende. No desenho do menu ela está **pendurada**,
  // e não escorada num mastro que vem do chão — foi assim na primeira versão, e
  // uma viga saindo do chão no meio de um campo parece andaime.
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 7 * escala;
  ctx.beginPath();
  ctx.moveTo(0, -46 * escala);
  ctx.lineTo(0, 0);
  ctx.stroke();
  ctx.strokeStyle = '#8a6a2f';
  ctx.lineWidth = 3.5 * escala;
  ctx.beginPath();
  ctx.moveTo(0, -46 * escala);
  ctx.lineTo(0, 0);
  ctx.stroke();
  ctx.fillStyle = '#c9a227';
  ctx.beginPath();
  ctx.arc(0, -50 * escala, 6 * escala, 0, Math.PI * 2);
  ctx.fill();

  ctx.rotate(fiel.angulo);

  // O braço: escuro por baixo, dourado por cima. Duas passadas em vez de uma
  // linha com contorno porque `stroke` sobre `stroke` dá o mesmo resultado por
  // metade do código, e a barra é só uma barra.
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 10 * escala;
  ctx.beginPath();
  ctx.moveTo(-braco, 0);
  ctx.lineTo(braco, 0);
  ctx.stroke();
  ctx.strokeStyle = '#c9a227';
  ctx.lineWidth = 5 * escala;
  ctx.beginPath();
  ctx.moveTo(-braco, 0);
  ctx.lineTo(braco, 0);
  ctx.stroke();

  ctx.fillStyle = '#f2e6c9';
  ctx.beginPath();
  ctx.arc(0, 0, 6 * escala, 0, Math.PI * 2);
  ctx.fill();

  for (const time of TIMES) {
    const lado = time === 'azul' ? -1 : 1;
    // Cada prato desfaz a rotação do braço: um baú inclinado junto com a barra
    // pareceria estar caindo, e o que ele está é pendurado.
    ctx.save();
    ctx.translate(lado * braco, 0);
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 3 * escala;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, corda);
    ctx.stroke();
    ctx.rotate(-fiel.angulo);

    // O baú de cada prato é o refém que **aquele** reino guarda, e o desenho é
    // o mesmo da partida: se o baú mudar de forma um dia, o menu muda junto.
    const refem = estado?.baus.find((b) => b.time !== time);
    const cheio = refem
      ? (refem.peso - pesoMinimoDe(estado!.porTime)) /
        (pesoMaximoDe(estado!.porTime) - pesoMinimoDe(estado!.porTime))
      : 0.5;
    desenharBau(ctx, 0, corda + 42 * escala, escala * (1 + cheio * 0.6), time, cheio, tempo);
    ctx.restore();
  }
  ctx.restore();

  // A legenda, fora da rotação: o nome da coisa, para quem nunca jogou saber o
  // que está vendo antes de a barra do jogo aparecer com o mesmo nome.
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.round(11 * escala)}px "Trebuchet MS", system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(255, 224, 130, 0.8)';
  // O espaçamento é feito com espaços dentro do texto, e não com
  // `ctx.letterSpacing`: aquela propriedade não entra na medida que o
  // `textAlign: center` usa, e a frase saía deslocada meio caractere.
  ctx.fillText('A  B A L A N Ç A  D O  R E I N O', cx, cy + 156 * escala);
  ctx.restore();
}
