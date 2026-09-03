/**
 * Confere o menu, a cabine e a escolha de lado em vários tamanhos de tela.
 *
 * ## Por que um roteiro, e não o olho
 *
 * Responsividade quebra num tamanho e num só — e é sempre o tamanho em que
 * ninguém abriu. Olhar "no navegador" quer dizer olhar no monitor de quem está
 * programando, que é justamente onde tudo cabe. Este roteiro abre cada tela em
 * cada tamanho, mede o que passou da borda e tira a foto.
 *
 * ## O que ele reprova
 *
 * Três coisas mecânicas, que não dependem de gosto:
 *
 * - **transbordo horizontal**: algo mais largo que a janela. Rolagem lateral num
 *   jogo é sempre defeito.
 * - **ação final fora da tela**: um botão marcado com `data-acao-final` cujo
 *   retângulo caia fora da janela. É o defeito que mais dói, porque a tela
 *   parece certa e o botão que a pessoa veio apertar não está lá.
 *
 *   A marca está no HTML, e não deduzida daqui, porque a diferença é semântica
 *   e não estrutural. "Escolher o lado" é a razão de a cabine existir: escondê-lo
 *   quebra a tela. "Abrir a sala", no meio de um painel com quatro modos
 *   explicados e uma lista embaixo, é o botão de enviar de um formulário longo —
 *   rolar até ele é o que se faz com formulário. Tentar separar os dois por
 *   estrutura ("está dentro de algo que rola?") erra os dois casos, porque os
 *   dois rolam. Quem sabe qual é qual é quem desenhou a tela, então é a tela que
 *   declara.
 * - **alvo pequeno demais**: clicável com menos de 40 px de altura. Dedo não
 *   acerta, e o jogo é de sofá.
 * - **conteúdo cortado**: qualquer caixa cujo conteúdo seja mais largo que ela.
 *   Este é o sorrateiro: tudo está no lugar certo, a tela parece inteira, e só o
 *   fim da palavra sumiu — "Crédito" no lugar de "Créditos".
 *
 * ## Uso
 *
 *     npm run build
 *     npm start &
 *     node tools/tamanhos.mjs [http://localhost:8787]
 */

import { chromium } from 'playwright';

const endereco = process.argv[2] ?? 'http://localhost:8787';
const CAMINHO_DO_CHROMIUM = process.env.CHROMIUM ?? '/opt/pw-browsers/chromium';
const PASTA = process.env.CAPTURAS ?? '.';

/** Tamanhos que existem de verdade, e não múltiplos redondos. */
const TAMANHOS = [
  { nome: 'monitor', width: 1920, height: 1080 },
  { nome: 'notebook', width: 1280, height: 720 },
  { nome: 'tablet', width: 834, height: 1112 },
  { nome: 'celular-deitado', width: 740, height: 360 },
  { nome: 'celular', width: 390, height: 844 },
];

const navegador = await chromium.launch({ executablePath: CAMINHO_DO_CHROMIUM });
const problemas = [];

for (const tamanho of TAMANHOS) {
  const pagina = await navegador.newPage({
    viewport: { width: tamanho.width, height: tamanho.height },
  });
  pagina.on('pageerror', (e) => problemas.push(`${tamanho.nome}: ${e}`));
  pagina.on('console', (m) => {
    if (m.type() === 'error') problemas.push(`${tamanho.nome}: ${m.text()}`);
  });

  await pagina.goto(endereco, { waitUntil: 'networkidle' });
  await pagina.waitForFunction(() => window.balanca?.relogio() !== null, { timeout: 30000 });
  await conferir(pagina, tamanho, 'menu');

  // Os painéis, um a um. São a parte do menu com texto longo — regras, tabela
  // de ajustes, créditos — e por isso a que mais chance tem de estourar numa
  // tela pequena. Ficar de fora do roteiro só porque exige um clique a mais é
  // deixar sem teste justamente o que quebra.
  for (const folha of ['apelido', 'sala', 'regras', 'ajustes', 'creditos']) {
    await pagina.click(`button[data-folha="${folha}"]`);
    await pagina.waitForSelector(`.folha[data-folha="${folha}"]`, { state: 'visible' });
    // O painel de salas busca a lista ao abrir; medir antes de ela chegar seria
    // medir uma caixa vazia, que é justamente a que sempre cabe.
    if (folha === 'sala') await pagina.waitForTimeout(600);
    await conferir(pagina, tamanho, `folha-${folha}`);
  }

  await pagina.click('button[data-folha="apelido"]');
  await pagina.fill('#nome', 'Ana');
  await pagina.click('#jogar-local');
  await pagina.waitForFunction(() => window.balanca?.tela() === 'cabine', { timeout: 30000 });
  for (const tecla of ['Space', 'Enter']) {
    await pagina.keyboard.down(tecla);
    await pagina.waitForTimeout(140);
    await pagina.keyboard.up(tecla);
    await pagina.waitForTimeout(140);
  }
  await conferir(pagina, tamanho, 'cabine');

  await pagina.click('#cabine-seguir');
  await pagina.waitForFunction(() => window.balanca?.tela() === 'escolha', { timeout: 30000 });
  await conferir(pagina, tamanho, 'escolha');

  await pagina.click('#confirmar');
  await pagina.waitForFunction(() => window.balanca?.tela() === 'jogo', { timeout: 20000 });
  await pagina.waitForTimeout(2500);
  await pagina.screenshot({ path: `${PASTA}/tamanho-${tamanho.nome}-jogo.png` });

  await pagina.close();
}

await navegador.close();

if (problemas.length > 0) {
  console.error(problemas.join('\n'));
  console.error(`\n${problemas.length} problema(s) de tamanho`);
  process.exit(1);
}
console.log('todos os tamanhos passaram');

/**
 * Mede a tela aberta e guarda a foto.
 *
 * A medição roda **dentro** da página porque é lá que estão as caixas de
 * verdade: `getBoundingClientRect` já traz o resultado de todo o CSS, inclusive
 * do que quebrou de um jeito que nenhuma regra sozinha explicaria.
 */
async function conferir(pagina, tamanho, tela) {
  await pagina.screenshot({ path: `${PASTA}/tamanho-${tamanho.nome}-${tela}.png` });
  const achados = await pagina.evaluate(() => {
    const L = document.documentElement.clientWidth;
    const A = document.documentElement.clientHeight;
    const fora = [];
    const visivel = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const raiz = [...document.querySelectorAll('section.tela')].find(
      (s) => !s.classList.contains('oculta') && visivel(s),
    );
    if (!raiz) return ['nenhuma tela visível'];

    for (const el of raiz.querySelectorAll('*')) {
      if (!visivel(el)) continue;
      const r = el.getBoundingClientRect();
      const rotulo = `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${el.className || '-'}`;
      // Meio pixel de folga: arredondamento de sub-pixel não é defeito.
      if (r.right > L + 0.5 || r.left < -0.5) fora.push(`transborda: ${rotulo}`);
      // Conteúdo mais largo que a própria caixa. Um pixel de folga porque
      // `scrollWidth` arredonda para cima e acusaria tudo o que encosta na
      // borda. Pega tanto a palavra que não coube no botão quanto a fileira de
      // botões que não coube na coluna — que foi o defeito de verdade.
      if (el.scrollWidth > el.clientWidth + 1) {
        fora.push(`conteúdo cortado ("${(el.textContent ?? '').trim().slice(0, 24)}"): ${rotulo}`);
      }
      const clicavel = el.tagName === 'BUTTON' || el.tagName === 'INPUT';
      if (!clicavel) continue;
      if (el.hasAttribute('data-acao-final') && (r.bottom > A + 0.5 || r.top < -0.5)) {
        fora.push(`ação final fora da tela: ${rotulo}`);
      }
      // Meio pixel de folga, como nas outras medidas. Sem ela, um botão de
      // `min-height: 40px` mede 39,99 conforme a escala do dispositivo e o
      // roteiro reprova em algumas execuções e passa em outras — e um teste que
      // varia sozinho é um teste que as pessoas aprendem a ignorar.
      if (r.height < 39.5) fora.push(`alvo pequeno (${Math.round(r.height)}px): ${rotulo}`);
    }
    // A rolagem lateral da página inteira é o sintoma final de todos eles.
    if (document.documentElement.scrollWidth > L + 0.5) fora.push('a página rola de lado');
    return fora;
  });
  for (const achado of achados) problemas.push(`${tamanho.nome}/${tela}: ${achado}`);
}
