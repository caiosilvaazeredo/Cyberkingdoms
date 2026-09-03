/**
 * Teste de fumaça: sobe um navegador de verdade, senta duas pessoas no sofá e
 * entra numa partida.
 *
 * ## O que ele pega que o `vitest` não pega
 *
 * A suíte cobre as regras do jogo com o servidor rodando em memória. Nada ali
 * abre um `canvas`, carrega um PNG ou fala WebSocket — e é justamente aí que
 * moram os defeitos que derrubam o jogo para o jogador: um sprite com o caminho
 * errado, um `getContext` nulo, um erro de tipo que só aparece no navegador.
 * Este roteiro entra no jogo como uma pessoa entraria e reclama se algo
 * escrever no console de erro.
 *
 * ## Por que dois jogadores, e não um
 *
 * O caminho de duas pessoas no mesmo aparelho passa por tudo o que o caminho de
 * uma passa, **e mais**: duas conexões, uma sala pedida pelo nome, dois times
 * que precisam ser o mesmo e dois comandos por passo. Testar com um só deixaria
 * de fora justamente a parte nova.
 *
 * As teclas são seguradas por um instante em vez de tocadas: o laço de quadro
 * lê o teclado a 60 Hz, e um toque instantâneo — que só um roteiro consegue
 * fazer — pode nascer e morrer entre dois quadros.
 *
 * ## Por que ele cutuca a página a cada poucos segundos
 *
 * O Chromium sem tela suspende o `requestAnimationFrame` de uma aba que
 * ninguém está olhando. Deixá-lo parado vinte segundos e tirar a foto no fim
 * mostra um quadro velho — o relógio da partida congelado — e faz parecer que o
 * jogo travou, quando o que dormiu foi o navegador. Uma leitura periódica dos
 * contadores mantém o compositor acordado e ainda serve de medição.
 *
 * ## Uso
 *
 *     npm run build
 *     npm start &
 *     node tools/fumaca.mjs [http://localhost:8787]
 */

import { chromium } from 'playwright';

const endereco = process.argv[2] ?? 'http://localhost:8787';
const CAMINHO_DO_CHROMIUM = process.env.CHROMIUM ?? '/opt/pw-browsers/chromium';

const navegador = await chromium.launch({ executablePath: CAMINHO_DO_CHROMIUM });
const pagina = await navegador.newPage({ viewport: { width: 1280, height: 720 } });

const erros = [];
pagina.on('console', (m) => {
  if (m.type() === 'error') erros.push(m.text());
});
pagina.on('pageerror', (e) => erros.push(String(e)));

await pagina.goto(endereco, { waitUntil: 'networkidle' });

// O menu já mostra uma partida ao vivo atrás do título: espere-a aparecer antes
// de julgar qualquer coisa, senão a captura sai preta e o erro é do teste.
await pagina.waitForFunction(() => window.balanca?.relogio() !== null, { timeout: 30000 });
await pagina.screenshot({ path: 'fumaca-menu.png' });

await pagina.click('button[data-folha="apelido"]');
await pagina.fill('#nome', 'Fumaça');
// Jogo local: sala reservada a este aparelho, sem estranhos entrando no meio do
// teste e mudando o que se está medindo.
await pagina.click('#jogar-local');

await pagina.waitForFunction(() => window.balanca?.tela() === 'cabine', { timeout: 30000 });

/** Segura a tecla o bastante para o laço de quadro enxergar. */
async function apertar(tecla) {
  await pagina.keyboard.down(tecla);
  await pagina.waitForTimeout(140);
  await pagina.keyboard.up(tecla);
  await pagina.waitForTimeout(140);
}

await apertar('Space'); // jogador 1: WASD
await apertar('Enter'); // jogador 2: setas
await pagina.waitForFunction(() => window.balanca?.sofa().length === 2, { timeout: 10000 });
await pagina.screenshot({ path: 'fumaca-cabine.png' });

await pagina.click('#cabine-seguir');
// A escolha de lado aparece por cima da partida; o sofá inteiro entra junto.
await pagina.waitForFunction(() => window.balanca?.tela() === 'escolha', { timeout: 30000 });
await pagina.screenshot({ path: 'fumaca-escolha.png' });
await pagina.click('#confirmar');
await pagina.waitForFunction(() => window.balanca?.tela() === 'jogo', { timeout: 15000 });

// A promessa do sofá: os dois nasceram, e no mesmo reino.
const sofa = await pagina.evaluate(() => window.balanca.sofa());
const sala = await pagina.evaluate(() => window.balanca.sala());
if (sofa.length !== 2 || sofa.some((j) => j.id === null)) {
  console.error('o sofá não entrou inteiro em campo:', sofa);
  process.exit(1);
}
if (new Set(sofa.map((j) => j.time)).size !== 1) {
  console.error('o sofá se dividiu entre os reinos:', sofa);
  process.exit(1);
}

const medidas = [];
for (let volta = 0; volta < 6; volta++) {
  await pagina.waitForTimeout(4000);
  // Os dois andam ao mesmo tempo, cada um no seu canto do teclado: é o que
  // exercita duas previsões, duas reconciliações e a câmera que tem de caber os
  // dois. Se os esquemas se cruzassem, os bonecos andariam grudados.
  const doUm = volta % 2 === 0 ? 'KeyD' : 'KeyS';
  const doDois = volta % 2 === 0 ? 'ArrowLeft' : 'ArrowUp';
  await pagina.keyboard.down(doUm);
  await pagina.keyboard.down(doDois);
  await pagina.waitForTimeout(700);
  await pagina.keyboard.up(doUm);
  await pagina.keyboard.up(doDois);
  await pagina.mouse.click(900, 380);
  await pagina.keyboard.press('KeyE');
  await pagina.keyboard.press('Period');

  medidas.push(
    await pagina.evaluate(() => {
      const b = window.balanca;
      const medida = { relogio: b.relogio(), ping: b.ping(), ...b.espia };
      b.espia.quadros = 0;
      b.espia.comandos = 0;
      return medida;
    }),
  );
}

await pagina.screenshot({ path: 'fumaca.png' });

const ultima = medidas.at(-1);
const primeira = medidas[0];
const relogioAndou = primeira.relogio - ultima.relogio;
const quadrosPorVolta = medidas.slice(1).reduce((s, m) => s + m.quadros, 0) / (medidas.length - 1);
const comandosPorVolta = medidas.slice(1).reduce((s, m) => s + m.comandos, 0) / (medidas.length - 1);

console.log(
  JSON.stringify(
    { sala, sofa, relogioAndou, quadrosPorVolta, comandosPorVolta, erros },
    null,
    2,
  ),
);
console.log('captura em fumaca.png');

await navegador.close();

// O relógio da partida tem de andar junto com o relógio de parede, e o cliente
// tem de mandar comando. Qualquer uma das duas coisas parada é jogo quebrado.
if (erros.length > 0 || relogioAndou < 15 || comandosPorVolta < 100) {
  console.error('teste de fumaça reprovado');
  process.exit(1);
}
console.log('teste de fumaça aprovado');
