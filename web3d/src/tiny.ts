import { acoesDisponiveis, enfileiravel, liquidar } from './campaign/actions';
import { formatarDuracao } from './campaign/actionQueue';
import { Campaign } from './campaign/campaign';
import { buildingDef } from './building/buildingType';
import { carregarAssets, criarMundo2D, type Predio } from './render2d/world2d';
import { formatCz } from './rules/eb';

/**
 * O cliente do CyberKingdoms com a arte do Tiny Swords.
 *
 * ## O que foi refeito, e o que foi mantido
 *
 * Mantido: **tudo que decide alguma coisa**. Geração de mundo, campanha, fila de
 * ocupações, economia, mercado, contratos, perecibilidade — nada disso mudou uma
 * linha. É o mesmo domínio de 305 testes, e é de propósito: arte se troca, regra
 * se conquista.
 *
 * Refeito: a camada que desenha. O mundo era relevo contínuo em três dimensões
 * com grama instanciada; passa a ser uma grade de tiles vista de cima, com
 * sprites. A troca é de projeção, não de motor gráfico: um canvas 2D dá conta
 * disso com folga e custa uma fração da bateria que o WebGL custava num celular.
 *
 * ## Por que o HUD virou madeira e papel
 *
 * O pacote traz botões, papel, fita e barras já desenhados, e usá-los não é
 * economia de trabalho — é coerência. Um painel de vidro escuro em cima de um
 * mundo de pixel art anuncia que a interface e o jogo foram feitos por pessoas
 * diferentes. As barras de Fome, Sede e Energia são as do pacote justamente
 * porque são o elemento que o jogador mais olha.
 */

const canvas = document.querySelector<HTMLCanvasElement>('#tela')!;
const ctx = canvas.getContext('2d')!;

const params = new URLSearchParams(location.search);
const semente = params.get('seed') ?? 'verde';

const campanha = Campaign.create({
  id: 'tiny',
  seedLabel: semente,
  characterName: params.get('nome') ?? 'Peão',
  now: Date.now(),
});

const cidade = campanha.world.layout.byId(campanha.character.homeSettlementId)!;

/**
 * As construções da cidade, no vocabulário visual do pacote.
 *
 * O catálogo do jogo tem 41 construções e o pacote gratuito tem oito prédios.
 * A ponte é por **categoria**, não por item: moradia vira casa, indústria vira
 * quartel, serviço público vira mosteiro ou torre. Mapear um a um daria oito
 * acertos e trinta e três buracos; mapear por categoria dá uma cidade legível
 * onde cada silhueta ainda diz o que aquilo faz.
 */
const PORTA_CATEGORIA: Record<string, readonly string[]> = {
  housing: ['House1', 'House2', 'House3'],
  extraction: ['Archery'],
  refining: ['Barracks'],
  manufacturing: ['Barracks', 'Archery'],
  commerce: ['House1_yellow'],
  infrastructure: ['Tower'],
  defense: ['Tower'],
  civic: ['Monastery'],
};

function spritePara(buildingId: string, indice: number): string {
  const def = buildingDef(buildingId);
  const opcoes = PORTA_CATEGORIA[def.category] ?? ['House1'];
  return opcoes[indice % opcoes.length]!;
}

// A capital ganha o castelo no centro; o resto se arruma em volta da praça.
const predios: Predio[] = [
  { sprite: cidade.isCapital ? 'Castle' : 'House1', x: 0, y: 0, tiles: cidade.isCapital ? 5 : 2 },
];
const doCatalogo = ['shack', 'capsuleBlock', 'apartment', 'hardwareWorkshop', 'textileWorkshop', 'refinery'];
doCatalogo.forEach((id, i) => {
  const angulo = (i / doCatalogo.length) * Math.PI * 2 + 0.6;
  predios.push({
    sprite: spritePara(id, i),
    x: Math.round(Math.cos(angulo) * 7),
    y: Math.round(Math.sin(angulo) * 5) + 3,
    tiles: 2,
    rotulo: buildingDef(id).name,
  });
});

const jogador = { x: 0.5, y: 4, andando: false };

/**
 * Procura a costa mais próxima, em espiral.
 *
 * O autotiling e a espuma só aparecem onde a terra encontra a água, e a capital
 * costuma nascer no interior — sem isto, a peça mais característica do guia
 * ficaria invisível na primeira tela. A busca é em espiral quadrada porque ela
 * varre por distância crescente sem precisar ordenar nada.
 */
function acharCosta(
  gerador: { biomeAt(x: number, y: number): unknown },
  ehAgua: (v: unknown) => boolean,
  raioMax = 220,
): { x: number; y: number } | null {
  for (let r = 4; r < raioMax; r += 4) {
    for (let a = 0; a < 64; a++) {
      const ang = (a / 64) * Math.PI * 2;
      const x = Math.round(Math.cos(ang) * r);
      const y = Math.round(Math.sin(ang) * r);
      if (ehAgua(gerador.biomeAt(x, y))) {
        // Volta dois tiles para a terra: o objetivo é enquadrar a praia, e não
        // o meio do mar.
        return { x: Math.round(x * 0.94), y: Math.round(y * 0.94) };
      }
    }
  }
  return null;
}

const assets = await carregarAssets();

const { Biome } = await import('./world/biome');
const costa =
  params.get('costa') === '1'
    ? acharCosta(campanha.world.generator, (b) => b === Biome.deadWater)
    : null;
if (costa) {
  jogador.x = costa.x;
  jogador.y = costa.y;
}
const mundo = criarMundo2D({
  world: campanha.world.generator,
  assets,
  predios,
  // O peão nasce na praça, e a câmera nasce nele: abrir o jogo olhando para o
  // vazio obrigaria o jogador a procurar o próprio personagem.
  camera: {
    x: Number(params.get('cx') ?? jogador.x),
    y: Number(params.get('cy') ?? jogador.y),
    zoom: 1,
  },
  jogador: () => jogador,
});

// ------------------------------------------------------------------ controles
const teclas = new Set<string>();
window.addEventListener('keydown', (e) => {
  teclas.add(e.key.toLowerCase());
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(e.key.toLowerCase())) {
    e.preventDefault();
  }
});
window.addEventListener('keyup', (e) => teclas.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => teclas.clear());

let arrastando = false;
let ultimoPonteiro = { x: 0, y: 0 };
canvas.addEventListener('pointerdown', (e) => {
  arrastando = true;
  ultimoPonteiro = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener('pointermove', (e) => {
  if (!arrastando) return;
  const dx = e.clientX - ultimoPonteiro.x;
  const dy = e.clientY - ultimoPonteiro.y;
  ultimoPonteiro = { x: e.clientX, y: e.clientY };
  // O chão segue o dedo, como no mapa: arrastar para a direita traz o terreno
  // junto. O erro de sinal aqui foi o que já custou um relatório de bug.
  mundo.camera.x -= dx / (64 * mundo.camera.zoom);
  mundo.camera.y -= dy / (64 * mundo.camera.zoom);
});
const soltar = (): void => {
  arrastando = false;
};
canvas.addEventListener('pointerup', soltar);
canvas.addEventListener('pointercancel', soltar);
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const fator = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    mundo.camera.zoom = Math.max(0.35, Math.min(2.4, mundo.camera.zoom * fator));
  },
  { passive: false },
);

// ------------------------------------------------------------------- interface
const elCz = document.querySelector<HTMLElement>('#hud-cz')!;
const elDia = document.querySelector<HTMLElement>('#hud-dia')!;
const elCidade = document.querySelector<HTMLElement>('#hud-cidade')!;
const elOcupacao = document.querySelector<HTMLElement>('#hud-ocupacao')!;
const elAcoes = document.querySelector<HTMLElement>('#hud-acoes')!;
const barras = {
  fome: document.querySelector<HTMLElement>('#barra-fome')!,
  sede: document.querySelector<HTMLElement>('#barra-sede')!,
  energia: document.querySelector<HTMLElement>('#barra-energia')!,
};

let assinaturaAcoes = '';

function atualizarHud(): void {
  const c = campanha.character;
  elCz.textContent = formatCz(c.credits);
  elDia.textContent = `Dia ${campanha.day}`;
  elCidade.textContent = `${cidade.name} · ${cidade.vocationDef.label}`;

  // O preenchimento mede o miolo da barra, e não a caixa inteira: as duas
  // tampas de madeira ocupam borda e não podem ser cobertas.
  const preencher = (el: HTMLElement, valor: number): void => {
    el.style.width = `calc((100% - 8px) * ${Math.max(0, Math.min(100, valor)) / 100})`;
  };
  preencher(barras.fome, c.hunger);
  preencher(barras.sede, c.thirst);
  preencher(barras.energia, c.energy);

  const estado = campanha.queue.progress(Date.now());
  elOcupacao.textContent = estado.current
    ? `${estado.current.label} — faltam ${formatarDuracao(estado.remainingMs)}`
    : 'Ocioso';

  // A lista só é reconstruída quando muda: redesenhar a cada quadro trocaria os
  // botões debaixo do dedo, defeito que já apareceu duas vezes neste projeto.
  const disponiveis = acoesDisponiveis(campanha);
  const assinatura = disponiveis.map((a) => a.id).join('|') + campanha.queue.length;
  if (assinatura === assinaturaAcoes) return;
  assinaturaAcoes = assinatura;

  elAcoes.textContent = '';
  for (const acao of disponiveis.slice(0, 4)) {
    const b = document.createElement('button');
    b.className = 'ts-botao';
    b.type = 'button';
    b.innerHTML =
      `<strong>${acao.label}</strong><span>${acao.horas} h${
        acao.paga > 0 ? ` · ${formatCz(acao.paga)}` : ''
      }</span>`;
    b.addEventListener('click', () => {
      campanha.queue.enqueue(enfileiravel(acao), Date.now());
      assinaturaAcoes = '';
      atualizarHud();
    });
    elAcoes.appendChild(b);
  }
}

// ----------------------------------------------------------------------- laço
function redimensionar(): void {
  // O canvas trabalha na resolução física para o pixel art não borrar; a arte
  // é ampliada por número inteiro sempre que possível, que é o que mantém os
  // pixels quadrados.
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  mundo.camera.zoom = dpr;
}
window.addEventListener('resize', redimensionar);
redimensionar();

let anterior = performance.now();
let acumuladoHud = 0;

function quadro(agora: number): void {
  requestAnimationFrame(quadro);
  const delta = Math.min(0.1, (agora - anterior) / 1000);
  anterior = agora;

  // Movimento do peão. A velocidade é em tiles por segundo, e não em pixels:
  // assim ela não muda quando o jogador aproxima o zoom.
  const velocidade = 4;
  let dx = 0;
  let dy = 0;
  if (teclas.has('w') || teclas.has('arrowup')) dy -= 1;
  if (teclas.has('s') || teclas.has('arrowdown')) dy += 1;
  if (teclas.has('a') || teclas.has('arrowleft')) dx -= 1;
  if (teclas.has('d') || teclas.has('arrowright')) dx += 1;

  jogador.andando = dx !== 0 || dy !== 0;
  if (jogador.andando) {
    const norma = Math.hypot(dx, dy) || 1;
    const nx = jogador.x + (dx / norma) * velocidade * delta;
    const ny = jogador.y + (dy / norma) * velocidade * delta;
    // Água é intransponível: o peão anda, não nada.
    if (mundo.ehTerra(Math.round(nx), Math.round(ny))) {
      jogador.x = nx;
      jogador.y = ny;
    }
    mundo.camera.x = jogador.x;
    mundo.camera.y = jogador.y;
  }

  const tempo = agora / 1000;
  mundo.desenhar(ctx, canvas.width, canvas.height, tempo);

  acumuladoHud += delta;
  if (acumuladoHud > 0.5) {
    acumuladoHud = 0;
    const feitas = campanha.queue.advanceTo(Date.now());
    for (const f of feitas) liquidar(campanha, f);
    atualizarHud();
  }
}

atualizarHud();
requestAnimationFrame(quadro);

const diagnostico = document.querySelector<HTMLElement>('#diagnostico');
if (diagnostico) {
  diagnostico.textContent =
    `seed "${semente}" · ${cidade.name} · ${predios.length} construções · tile 64px`;
  setInterval(() => {
    diagnostico.textContent =
      `seed "${semente}" · ${cidade.name} · ${mundo.tilesDesenhados} tiles · ` +
      `${mundo.decoracoes} decorações · tile 64px`;
  }, 1000);
}
(window as unknown as { __pronto: boolean }).__pronto = true;
