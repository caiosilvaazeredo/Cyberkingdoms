import { acoesDisponiveis, enfileiravel, liquidar } from './campaign/actions';
import { formatarDuracao, novaAcao } from './campaign/actionQueue';
import { Campaign } from './campaign/campaign';
import { runDailyTick } from './campaign/dailyTick';
import { buildingsAvailableAt } from './building/buildingType';
import { estiloDe } from './render2d/estilos';
import {
  centroDoTerreno,
  prediosDoTerreno,
  retanguloDoTerreno,
  type Predio,
} from './render2d/predios';
import { carregarAssets, criarMundo2D } from './render2d/world2d';
import { criarMapa2D } from './render2d/mapa2d';
import { Autosave } from './campaign/autosave';
import { acampar } from './campaign/camp';
import { daysOfSupplies, planJourney, startJourney } from './campaign/journey';
import type { ContractJson } from './economy/contract';
import { itemDef } from './economy/item';
import { describeCity, type BuyRow } from './ui/cityView';
import { formatCz } from './rules/eb';
import type { Settlement } from './world/settlement';

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

/**
 * A partida: a guardada, se houver, ou uma nova.
 *
 * Sem isto, atualizar a página apagava horas de jogo — e num jogo cujo relógio
 * é o de parede, a aba **vai** ser fechada. `?novo=1` força começar de novo,
 * que é a saída para quem quer outra partida no mesmo mundo.
 */
const autosave = new Autosave(semente);
if (params.get('novo') === '1') {
  autosave.apagar();
  // E some da barra de endereço. Deixar `?novo=1` ali transforma cada F5 num
  // recomeço: o jogador usa uma vez para zerar e perde a partida toda vez que
  // atualiza a página depois disso.
  params.delete('novo');
  const busca = params.toString();
  history.replaceState(null, '', busca ? `?${busca}` : location.pathname);
}

const guardada = autosave.carregar();
const campanha =
  guardada ??
  Campaign.create({
    id: 'tiny',
    seedLabel: semente,
    characterName: params.get('nome') ?? 'Peão',
    now: Date.now(),
  });

// Fechar a aba é o caso comum, não a exceção: guardar o que estava pendente
// aqui é o que faz a diferença entre perder um segundo e perder a sessão.
window.addEventListener('pagehide', () => autosave.descarregar(campanha));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') autosave.descarregar(campanha);
});

const personagem = campanha.character;
const terreno = campanha.plot;
const casa = campanha.world.layout.byId(personagem.homeSettlementId)!;
const areaDoTerreno = retanguloDoTerreno(terreno);

/**
 * A cidade em que o peão está agora.
 *
 * Não é sempre a de casa: depois de uma viagem o jogador acorda em outra
 * capital, e é a feira **dela** que ele vê, com os preços dela. Perguntar à
 * campanha em vez de guardar numa variável evita a classe de defeito em que a
 * tela mostra uma cidade e a compra acontece em outra.
 */
function cidadeAtual(): Settlement {
  const id = campanha.currentSettlementId;
  return (id ? campanha.world.layout.byId(id) : null) ?? casa;
}

/**
 * O que aparece na tela é o que a partida realmente tem.
 *
 * A primeira versão desta página desenhava seis construções escolhidas a dedo,
 * espalhadas num círculo em volta da origem. Ficava bonito e não era o jogo:
 * o terreno do jogador começa **vazio**, fica onde a campanha o reservou —
 * cinco tiles a sudeste do centro da capital — e só ganha prédio quando alguém
 * paga a obra. A vitrine escondia justamente o laço que importa.
 *
 * A lista é recalculada a cada quadro porque o terreno muda durante a partida.
 * É barato: são poucas dezenas de construções, no máximo.
 */
// A capital é castelo; o satélite, uma torre. O telhado segue a vocação da
// cidade, então duas capitais vizinhas não saem iguais no horizonte.
const COR_DA_VOCACAO = {
  petrochemical: 'black',
  foundry: 'red',
  agroBio: 'yellow',
  techHub: 'purple',
  freePort: 'blue',
} as const;

function marcoDaCidade(s: Settlement): Predio {
  return {
    forma: s.isCapital ? 'Castle' : 'Tower',
    cor: COR_DA_VOCACAO[s.vocation],
    enfeites: [],
    x: s.center.x - (s.isCapital ? 2 : 1),
    y: s.center.y - (s.isCapital ? 2 : 1),
    tiles: s.isCapital ? 5 : 2,
    tilesAltura: s.isCapital ? 4 : 2,
    rotulo: s.name,
    escala: 1,
  };
}

// Todos os marcos, e não só o da cidade de agora: andando entre capitais o
// jogador passa perto de satélites, e um deles aparecer do nada ao chegar seria
// pior do que ele já estar lá no horizonte.
const marcos = campanha.world.layout.settlements.map(marcoDaCidade);

function prediosAgora(): readonly Predio[] {
  return [...marcos, ...prediosDoTerreno(terreno)];
}

// Partida nova nasce no terreno; partida guardada retoma onde o personagem
// parou. Reabrir o jogo na porta de casa depois de sete dias de estrada
// desfaria a viagem que o jogador acabou de pagar.
const centro = guardada ? personagem.position : centroDoTerreno(terreno);
const jogador = { x: centro.x, y: centro.y, andando: false };

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
  predios: prediosAgora,
  terreno: areaDoTerreno,
  // O peão nasce no terreno, e a câmera nasce nele: abrir o jogo olhando para
  // o vazio obrigaria o jogador a procurar o próprio personagem.
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
const elTerreno = document.querySelector<HTMLElement>('#hud-terreno')!;
const elAviso = document.querySelector<HTMLElement>('#aviso')!;
const folhaObras = document.querySelector<HTMLElement>('#folha-obras')!;
const listaObras = document.querySelector<HTMLElement>('#lista-obras')!;
const barras = {
  fome: document.querySelector<HTMLElement>('#barra-fome')!,
  sede: document.querySelector<HTMLElement>('#barra-sede')!,
  energia: document.querySelector<HTMLElement>('#barra-energia')!,
};

let assinaturaAcoes = '';
let assinaturaObras = '';

/** Avisos curtos, no lugar de `alert`: um modal congela o jogo por um erro. */
let apagarAviso = 0;
function avisar(texto: string): void {
  elAviso.textContent = texto;
  elAviso.style.opacity = '1';
  window.clearTimeout(apagarAviso);
  apagarAviso = window.setTimeout(() => {
    elAviso.style.opacity = '0';
  }, 3200);
}

/**
 * A célula do terreno em que o peão está pisando.
 *
 * Construir "onde eu estou" é a forma mais direta de escolher um lugar sem
 * inventar um segundo modo de mira: o jogador já anda, e andar já é a mira.
 * Fora do terreno não há célula, e a recusa explica isso.
 */
function celulaSobOsPes(): { x: number; y: number } | null {
  return terreno.gridCellFor({ x: Math.round(jogador.x), y: Math.round(jogador.y) });
}

function construir(tipo: string): void {
  const celula = celulaSobOsPes();
  if (!celula) {
    avisar('Você está fora do terreno. Volte para dentro da divisa.');
    return;
  }
  const check = terreno.canPlace(tipo, celula.x, celula.y, {
    level: personagem.level,
    credits: personagem.credits,
    inventory: personagem.inventory,
  });
  if (!check.valid) {
    avisar(check.reason ?? 'Não dá para construir aqui.');
    return;
  }
  const r = terreno.build(tipo, celula.x, celula.y, {
    level: personagem.level,
    credits: personagem.credits,
    inventory: personagem.inventory,
  });
  if (!r.ok) {
    avisar(r.reason);
    return;
  }
  // O terreno não conhece a carteira — quem paga é o personagem, exatamente
  // como no cliente 3D. Ver `Plot.build`.
  personagem.credits -= r.building.def.creditCost;
  avisar(`${r.building.displayName}: obra de ${r.building.daysRemaining} dia(s).`);
  assinaturaObras = '';
  atualizarHud();
}

/**
 * O catálogo de verdade, filtrado pelo nível de cidadão.
 *
 * São 41 construções e a lista mostra as que o nível permite, com o preço e o
 * que falta. Esconder as caras seria mentir sobre o jogo: saber que existe um
 * galpão de Cz 3 600 é o que dá sentido a juntar dinheiro.
 */
function pintarObras(): void {
  const disponiveis = buildingsAvailableAt(personagem.level);
  const assinatura =
    disponiveis.map((d) => d.id).join('|') +
    `#${personagem.credits}#${terreno.buildings.length}`;
  if (assinatura === assinaturaObras) return;
  assinaturaObras = assinatura;

  listaObras.textContent = '';
  for (const def of disponiveis) {
    const linha = document.createElement('button');
    linha.type = 'button';
    linha.className = 'ts-linha';
    // O material aparece pelo nome do catálogo, e não pelo id: "12× scrap" é
    // como o arquivo de dados escreve, não como o jogo fala.
    const materiais = Object.entries(def.materialCost)
      .map(([id, qtd]) => `${qtd}× ${itemDef(id).name}`)
      .join(', ');
    const podePagar = personagem.credits >= def.creditCost;
    const estilo = estiloDe(def.id, def.category);
    linha.innerHTML =
      `<img src="/tiny/buildings/${estilo.cor}/${estilo.forma}.png" alt="" />` +
      `<span class="ts-linha-texto"><strong>${def.name}</strong>` +
      `<small>${formatCz(def.creditCost)} · ${def.buildDays} d` +
      `${materiais ? ` · ${materiais}` : ''}</small></span>`;
    linha.classList.toggle('sem-caixa', !podePagar);
    linha.addEventListener('click', () => construir(def.id));
    listaObras.appendChild(linha);
  }
}

document.querySelector('#abrir-obras')?.addEventListener('click', () => {
  const abrindo = folhaObras.hidden;
  folhaObras.hidden = !abrindo;
  if (abrindo) {
    assinaturaObras = '';
    pintarObras();
  }
});
document.querySelector('#fechar-obras')?.addEventListener('click', () => {
  folhaObras.hidden = true;
});

// -------------------------------------------------------------- mercado e bolsa
//
// Sem isto, o botão de construir era beco sem saída: um Barraco custa Cz 120 e
// **6 de sucata**, e sucata não cai do céu. O laço só fecha com o mercado
// dentro da tela — trabalhar rende Cz, o Cz compra material e comida, o
// material vira obra. É o mesmo mercado do cliente 3D, com a mesma taxa indo
// para o mesmo cofre; nada aqui é uma segunda economia.

const folhaFeira = document.querySelector<HTMLElement>('#folha-feira')!;
const listaFeira = document.querySelector<HTMLElement>('#lista-feira')!;
const listaBolsa = document.querySelector<HTMLElement>('#lista-bolsa')!;
let assinaturaFeira = '';

function comprar(row: BuyRow): void {
  const aqui = cidadeAtual();
  const gov = campanha.governmentOf(aqui.id);
  const mercado = campanha.marketOf(aqui.id, row.kind);
  if (!mercado) return;
  const r = mercado.quickBuy({
    item: row.item,
    quantity: 1,
    availableCredits: personagem.credits,
    taxRate: gov.taxRate,
  });
  if (!r.ok) {
    avisar(r.reason);
    return;
  }
  // O mercado só mexe no livro de ofertas; crédito, item e cofre são movidos
  // por quem fez o negócio. A taxa sai da venda, não do bolso do comprador.
  personagem.credits -= r.totalPaid;
  personagem.inventory.add(r.item, r.quantity);
  // O lote nasce agora: comida comprada hoje vence daqui a 72 h, e não junto
  // com a que já estava na mochila.
  campanha.pantry.register(r.item, r.quantity, Date.now());
  gov.collectTax(r.tax);
  avisar(`Comprou 1× ${itemDef(r.item).name} por ${formatCz(r.totalPaid)}.`);
  assinaturaFeira = '';
  assinaturaObras = '';
  atualizarHud();
}

function usar(id: string): void {
  const antesFome = personagem.hunger;
  const antesSede = personagem.thirst;
  if (!personagem.consume(id)) {
    avisar(`${itemDef(id).name} não serve para comer nem beber.`);
    return;
  }
  // Sai o lote que vence primeiro: comer o mais velho é o que perde menos.
  campanha.pantry.consume(id, 1, Date.now());
  avisar(
    `${itemDef(id).name}: fome ${antesFome}→${personagem.hunger}, ` +
      `sede ${antesSede}→${personagem.thirst}.`,
  );
  assinaturaFeira = '';
  atualizarHud();
}

function pintarFeira(): void {
  const ficha = describeCity(campanha, cidadeAtual().id);
  const bolsa = [...personagem.inventory.stacks.entries()].filter(([, q]) => q > 0);
  const assinatura =
    (ficha?.buy ?? []).map((r) => `${r.item}:${r.unitPrice}:${r.supply}`).join('|') +
    '#' + bolsa.map(([id, q]) => `${id}:${q}`).join('|') +
    `#${personagem.credits}`;
  if (assinatura === assinaturaFeira) return;
  assinaturaFeira = assinatura;

  listaFeira.textContent = '';
  for (const row of ficha?.buy ?? []) {
    const linha = document.createElement('button');
    linha.type = 'button';
    linha.className = 'ts-linha';
    linha.classList.toggle('sem-caixa', personagem.credits < row.unitPrice);
    linha.innerHTML =
      `<span class="ts-linha-texto"><strong>${row.name}</strong>` +
      `<small>${formatCz(row.unitPrice)} · ${row.supply} un` +
      `${row.bargain ? ' · pechincha' : ''}${row.legal ? '' : ' · ilegal'}</small></span>`;
    linha.addEventListener('click', () => comprar(row));
    listaFeira.appendChild(linha);
  }

  listaBolsa.textContent = '';
  if (bolsa.length === 0) {
    const vazio = document.createElement('p');
    vazio.className = 'ts-dica';
    vazio.textContent = 'Mochila vazia.';
    listaBolsa.appendChild(vazio);
  }
  for (const [id, qtd] of bolsa) {
    const linha = document.createElement('button');
    linha.type = 'button';
    linha.className = 'ts-linha';
    linha.innerHTML =
      `<span class="ts-linha-texto"><strong>${itemDef(id).name}</strong>` +
      `<small>${qtd} un · toque para usar</small></span>`;
    linha.addEventListener('click', () => usar(id));
    listaBolsa.appendChild(linha);
  }
}

document.querySelector('#abrir-feira')?.addEventListener('click', () => {
  const abrindo = folhaFeira.hidden;
  folhaFeira.hidden = !abrindo;
  if (abrindo) {
    assinaturaFeira = '';
    pintarFeira();
  }
});
document.querySelector('#fechar-feira')?.addEventListener('click', () => {
  folhaFeira.hidden = true;
});

// ------------------------------------------------------------------- vagas
//
// O escrow do EB 1.1 §22 estava implementado e inalcançável: regra correta sem
// nenhum lugar onde encontrar uma vaga. Aqui ela aparece com o pagamento já
// lastreado — aceitar reserva 100% no caixa do contratante, então o que está
// na lista é obrigação, e não anúncio.

const folhaVagas = document.querySelector<HTMLElement>('#folha-vagas')!;
const listaVagas = document.querySelector<HTMLElement>('#lista-vagas')!;
const contratoAtual = document.querySelector<HTMLElement>('#contrato-atual')!;
let assinaturaVagas = '';

function aceitarVaga(contrato: ContractJson): void {
  const r = campanha.contracts.aceitar({
    contract: contrato,
    worker: personagem,
    workerCertificates: personagem.certificates,
    now: Date.now(),
  });
  if (!r.ok) {
    avisar(r.reason);
    return;
  }

  // O contrato é **executado**, não comprado: entra na fila como jornada, e a
  // entrega acontece quando as horas passam. Ver o caso `contract` em
  // `campaign/actions.ts`.
  campanha.queue.enqueue(
    novaAcao({
      kind: 'contract',
      label: contrato.title,
      hours: contrato.durationHours,
      payload: { contractId: contrato.id },
    }),
    Date.now(),
  );
  avisar(
    `Aceito: ${contrato.title} · ${contrato.durationHours} h por ${formatCz(contrato.payment)}.`,
  );
  assinaturaVagas = '';
  assinaturaAcoes = '';
  atualizarHud();
}

function romperVaga(contrato: ContractJson): void {
  const r = campanha.contracts.romper({
    contract: contrato,
    worker: personagem,
    culpado: 'worker',
  });
  if (!r.ok) {
    avisar(r.reason);
    return;
  }
  // A jornada some da fila junto: manter a ação de um contrato rompido faria
  // a entrega ser tentada num vínculo que já não existe.
  const naFila = campanha.queue.items.find((a) => a.kind === 'contract');
  if (naFila) campanha.queue.cancel(naFila.id);
  avisar(
    r.multa > 0
      ? `Contrato rompido. Multa de ${formatCz(r.multa)} e −2 de credibilidade.`
      : 'Contrato rompido. −2 de credibilidade.',
  );
  assinaturaVagas = '';
  assinaturaAcoes = '';
  atualizarHud();
}

function pintarVagas(): void {
  const aqui = cidadeAtual();
  const emExecucao = campanha.contracts.emExecucao(personagem.id);
  const vagas = emExecucao
    ? []
    : campanha.contracts.abertasEm(aqui, campanha.seed, campanha.day, Date.now());

  const assinatura =
    `${aqui.id}#${campanha.day}#${emExecucao?.id ?? ''}#` +
    vagas.map((v) => v.id).join('|') + `#${personagem.credibility}`;
  if (assinatura === assinaturaVagas) return;
  assinaturaVagas = assinatura;

  contratoAtual.textContent = '';
  if (emExecucao) {
    const casa = campanha.contracts.contratanteDe(emExecucao);
    const estado = campanha.queue.progress(Date.now());
    const restante = estado.current?.kind === 'contract'
      ? `Faltam ${formatarDuracao(estado.remainingMs)}.`
      : 'Na fila.';
    contratoAtual.innerHTML =
      `<strong>${emExecucao.title}</strong>` +
      `<small>${casa?.name ?? '—'} · ${formatCz(emExecucao.payment)} por ` +
      `${emExecucao.durationHours} h · ${restante}</small>` +
      `<small>Romper custa ${formatCz(Math.round(emExecucao.payment * emExecucao.penaltyRate))} ` +
      'e −2 de credibilidade.</small>' +
      '<button id="romper" class="ts-botao vermelho" type="button">ROMPER</button>';
    contratoAtual
      .querySelector('#romper')
      ?.addEventListener('click', () => romperVaga(emExecucao));
  }

  listaVagas.textContent = '';
  if (!emExecucao && vagas.length === 0) {
    const vazio = document.createElement('p');
    vazio.className = 'ts-dica';
    vazio.textContent = 'Nenhuma vaga aberta hoje. Volte amanhã.';
    listaVagas.appendChild(vazio);
  }
  for (const vaga of vagas) {
    const casa = campanha.contracts.contratanteDe(vaga);
    const linha = document.createElement('button');
    linha.type = 'button';
    linha.className = 'ts-linha';
    const extras: string[] = [];
    if (vaga.bonusRate > 0) {
      extras.push(`bônus até ${formatCz(Math.round(vaga.payment * vaga.bonusRate))}`);
    }
    if (vaga.penaltyRate > 0) {
      extras.push(`multa ${Math.round(vaga.penaltyRate * 100)}%`);
    }
    linha.innerHTML =
      `<span class="ts-linha-texto"><strong>${vaga.title}</strong>` +
      `<small>${casa?.name ?? '—'} · ${formatCz(vaga.payment)} por ${vaga.durationHours} h` +
      `${extras.length > 0 ? ` · ${extras.join(' · ')}` : ''}</small></span>`;
    linha.addEventListener('click', () => aceitarVaga(vaga));
    listaVagas.appendChild(linha);
  }
}

document.querySelector('#abrir-vagas')?.addEventListener('click', () => {
  const abrindo = folhaVagas.hidden;
  folhaVagas.hidden = !abrindo;
  if (abrindo) {
    assinaturaVagas = '';
    pintarVagas();
  }
});
document.querySelector('#fechar-vagas')?.addEventListener('click', () => {
  folhaVagas.hidden = true;
});

// ------------------------------------------------------------------- o mapa
//
// Sem ele o jogo tem uma cidade só. O domínio de viagem já existe e já é
// testado — rota por Dijkstra, dias, perigo e o aviso de mantimentos —, e o que
// faltava era a tela. Ela é canvas, e não SVG: o mapa do cliente 3D está preso
// ao HTML dele, e o que importa reaproveitar não é a marcação, é a **decisão**
// — `corDoBioma` e `enquadrar` são os mesmos nos dois, então os dois mapas
// concordam sobre onde as cidades ficam e de que cor é cada pedaço do mundo.

const folhaMapa = document.querySelector<HTMLElement>('#folha-mapa')!;
const telaMapa = document.querySelector<HTMLCanvasElement>('#tela-mapa')!;
const ctxMapa = telaMapa.getContext('2d')!;
const fichaViagem = document.querySelector<HTMLElement>('#ficha-viagem')!;
const mapa = criarMapa2D(campanha);
let escolhida: Settlement | null = null;

function desenharMapa(): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = telaMapa.clientWidth;
  const h = telaMapa.clientHeight;
  if (w === 0 || h === 0) return;
  telaMapa.width = Math.floor(w * dpr);
  telaMapa.height = Math.floor(h * dpr);
  mapa.desenhar(ctxMapa, telaMapa.width, telaMapa.height, escolhida?.id ?? null);
}

function pintarFichaViagem(): void {
  if (personagem.isTravelling) {
    const destino = personagem.travellingTo
      ? campanha.world.layout.byId(personagem.travellingTo)
      : null;
    fichaViagem.innerHTML =
      `<strong>Na estrada para ${destino?.name ?? '—'}</strong>` +
      `<small>Faltam ${personagem.travelDaysRemaining} dia(s). ` +
      'Cada DORMIR anda um dia.</small>';
    return;
  }
  if (!escolhida) {
    fichaViagem.innerHTML = '<small>Toque numa cidade para ver a estrada.</small>';
    return;
  }

  const plano = planJourney(campanha, escolhida.id);
  if (!plano.ok) {
    fichaViagem.innerHTML =
      `<strong>${escolhida.name}</strong><small>${plano.reason}</small>`;
    return;
  }

  // O custo aparece **antes** do toque. Um botão que só revela o preço depois
  // é o mesmo que um botão sem preço — e aqui o preço pode ser a vida do
  // personagem, porque não há mercado no meio do caminho.
  const dias = plano.route.days;
  const aguenta = daysOfSupplies(campanha);
  const perigo = Math.round(plano.route.danger * 100);
  const faltando = aguenta < dias;
  fichaViagem.innerHTML =
    `<strong>${escolhida.name} · ${escolhida.vocationDef.label}</strong>` +
    `<small>${dias} dia(s) de estrada · perigo ${perigo}%</small>` +
    `<small class="${faltando ? 'alerta' : ''}">` +
    `Mantimentos para ${aguenta} dia(s)${faltando ? ' — você não chega vivo.' : '.'}</small>` +
    '<button id="partir" class="ts-botao" type="button">PARTIR</button>';

  fichaViagem.querySelector('#partir')?.addEventListener('click', () => {
    const r = startJourney(campanha, escolhida!.id);
    if (!r.ok) {
      avisar(r.reason);
      return;
    }
    folhaMapa.hidden = true;
    avisar(`Na estrada para ${escolhida!.name}: ${personagem.travelDaysRemaining} dia(s).`);
    atualizarHud();
  });
}

telaMapa.addEventListener('click', (e) => {
  const r = telaMapa.getBoundingClientRect();
  const dpr = telaMapa.width / r.width;
  escolhida = mapa.cidadeEm(
    (e.clientX - r.left) * dpr,
    (e.clientY - r.top) * dpr,
    telaMapa.width,
    telaMapa.height,
  );
  desenharMapa();
  pintarFichaViagem();
});

document.querySelector('#abrir-mapa')?.addEventListener('click', () => {
  const abrindo = folhaMapa.hidden;
  folhaMapa.hidden = !abrindo;
  if (!abrindo) return;
  escolhida = null;
  // O canvas só tem tamanho depois de aparecer: medir antes devolve zero, e o
  // mapa sairia em branco no primeiro toque.
  requestAnimationFrame(() => {
    desenharMapa();
    pintarFichaViagem();
  });
});
document.querySelector('#fechar-mapa')?.addEventListener('click', () => {
  folhaMapa.hidden = true;
});

/**
 * Leva o peão para onde o reset moveu o personagem.
 *
 * Quem move o personagem é o reset — é ele que conclui a viagem no último dia.
 * A comparação é contra a posição de **antes do tique**, e não contra onde o
 * peão está: o personagem fica no centro da capital enquanto o peão anda pelo
 * terreno, cinco tiles a sudeste, e comparar com o peão fazia todo DORMIR
 * arrancá-lo da própria terra — inclusive para fora da divisa, onde construir
 * é recusado.
 */
function acompanharPersonagem(antes: { x: number; y: number }): void {
  const p = personagem.position;
  if (antes.x === p.x && antes.y === p.y) return;
  jogador.x = p.x;
  jogador.y = p.y;
  mundo.camera.x = p.x;
  mundo.camera.y = p.y;
}

/**
 * Encerrar o dia.
 *
 * Obra, manutenção e produção andam no reset diário — é `runDailyTick` quem
 * desconta os dias que faltam. Sem um botão, a única forma de ver um galpão
 * ficar pronto seria esperar 24 h de relógio de parede, o que não é ritmo de
 * jogo: é castigo. É a mesma decisão que o cliente 3D já tinha tomado.
 */
document.querySelector('#dormir')?.addEventListener('click', () => {
  const antes = campanha.currentSettlementId;
  const ondeEstava = { x: personagem.position.x, y: personagem.position.y };
  const acampou = acampar(campanha);
  const relatorio = runDailyTick(campanha);
  acompanharPersonagem(ondeEstava);

  // Chegar é notícia melhor que o primeiro evento do dia. O reset conclui a
  // viagem no último dia, então é aqui que a chegada aparece.
  const agora = campanha.currentSettlementId;
  if (agora !== antes && !personagem.isTravelling) {
    const chegou = cidadeAtual();
    avisar(`Chegou em ${chegou.name} · ${chegou.vocationDef.label}.`);
  } else if (acampou.length > 0) {
    avisar(`Acampou na estrada · consumiu ${acampou.join(', ')}.`);
  } else {
    const primeiro = relatorio.events[0];
    avisar(`Dia ${relatorio.day} encerrado${primeiro ? ` · ${primeiro}` : ''}.`);
  }
  assinaturaObras = '';
  assinaturaFeira = '';
  if (!folhaMapa.hidden) {
    desenharMapa();
    pintarFichaViagem();
  }
  atualizarHud();
});

function atualizarHud(): void {
  const c = personagem;
  elCz.textContent = formatCz(c.credits);
  elDia.textContent = `Dia ${campanha.day}`;
  const aqui = cidadeAtual();
  elCidade.textContent = personagem.isTravelling
    ? `Estrada · ${personagem.travelDaysRemaining} dia(s)`
    : `${aqui.name} · ${aqui.vocationDef.label}`;

  const obras = terreno.buildings.filter((b) => !b.isReady).length;
  elTerreno.textContent =
    `${terreno.identity.name} · ${terreno.buildings.length}/${terreno.tileCount}` +
    (obras > 0 ? ` · ${obras} em obra` : '');
  if (!folhaObras.hidden) pintarObras();
  if (!folhaFeira.hidden) pintarFeira();
  if (!folhaVagas.hidden) pintarVagas();

  // O preenchimento mede o miolo da barra, e não a caixa inteira: as duas
  // tampas de madeira ocupam borda e não podem ser cobertas.
  const preencher = (el: HTMLElement, valor: number): void => {
    el.style.width = `calc((100% - 8px) * ${Math.max(0, Math.min(100, valor)) / 100})`;
  };
  preencher(barras.fome, c.hunger);
  preencher(barras.sede, c.thirst);
  preencher(barras.energia, c.energy);

  // Toda mudança de estado passa por aqui — compra, obra, fila, viagem —, o
  // que faz deste o único lugar que precisa pedir gravação.
  autosave.marcar(campanha);

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
    `seed "${semente}" · ${cidadeAtual().name} · ${terreno.buildings.length} construções · tile 64px`;
  setInterval(() => {
    diagnostico.textContent =
      `seed "${semente}" · ${cidadeAtual().name} · ${mundo.tilesDesenhados} tiles · ` +
      `${mundo.decoracoes} decorações · tile 64px`;
  }, 1000);
}
(window as unknown as { __pronto: boolean }).__pronto = true;
// A campanha fica exposta para o teste de tela: sem isso, verificar a obra
// exigiria jogar sete jornadas de trabalho dentro do navegador só para chegar
// aos Cz 120 do Barraco. É a mesma porta que o Modo Dev abre no cliente 3D.
(window as unknown as { __campanha: Campaign }).__campanha = campanha;
