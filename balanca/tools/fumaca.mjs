/**
 * Teste de fumaça: sobe um navegador de verdade, entra numa partida e olha.
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
await pagina.fill('#nome', 'Fumaça');
await pagina.click('#jogar');

const medidas = [];
for (let volta = 0; volta < 6; volta++) {
  await pagina.waitForTimeout(4000);
  // Anda e ataca de vez em quando, para exercitar previsão, colisão e combate.
  await pagina.keyboard.down(volta % 2 === 0 ? 'KeyD' : 'KeyS');
  await pagina.waitForTimeout(700);
  await pagina.keyboard.up(volta % 2 === 0 ? 'KeyD' : 'KeyS');
  await pagina.mouse.click(900, 380);
  await pagina.keyboard.press('KeyE');

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

console.log(JSON.stringify({ relogioAndou, quadrosPorVolta, comandosPorVolta, erros }, null, 2));
console.log('captura em fumaca.png');

await navegador.close();

// O relógio da partida tem de andar junto com o relógio de parede, e o cliente
// tem de mandar comando. Qualquer uma das duas coisas parada é jogo quebrado.
if (erros.length > 0 || relogioAndou < 15 || comandosPorVolta < 100) {
  console.error('teste de fumaça reprovado');
  process.exit(1);
}
console.log('teste de fumaça aprovado');
