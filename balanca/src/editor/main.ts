import type { TipoDeEstrutura, TipoDeJazida } from '../shared/arena';
import type { EsquemaDeClasse } from '../shared/classes';
import type { EsquemaDeMapa } from '../shared/mapas';
import type { EsquemaDeModo } from '../shared/modos';
import { EditorDeClasses, PERFIS_CONHECIDOS } from './classes';
import { EditorDeMapas, type Ferramenta } from './mapas';
import { EditorDeModos } from './modos';
import { FerramentaDeSprite, baixarComoPng } from './sprites';

function pegar<T extends HTMLElement>(seletor: string): T {
  const el = document.querySelector<T>(seletor);
  if (!el) throw new Error(`elemento ausente: ${seletor}`);
  return el;
}

// --- abas --------------------------------------------------------------

for (const botao of Array.from(document.querySelectorAll<HTMLButtonElement>('nav.abas button'))) {
  botao.addEventListener('click', () => {
    for (const b of Array.from(document.querySelectorAll<HTMLButtonElement>('nav.abas button'))) {
      b.setAttribute('aria-selected', String(b === botao));
    }
    const aba = botao.dataset.aba;
    for (const pagina of Array.from(document.querySelectorAll<HTMLElement>('.pagina'))) {
      pagina.classList.toggle('ativa', pagina.id === `pagina-${aba}`);
    }
  });
}

// --- editor de mapas -----------------------------------------------------

const TILE_PX = 12;
const editor = new EditorDeMapas();
const canvasMapa = pegar<HTMLCanvasElement>('#mapa-canvas');
const ctxMapa = canvasMapa.getContext('2d')!;
const statusMapa = pegar<HTMLElement>('#mapa-status');
const avisosMapa = pegar<HTMLElement>('#mapa-avisos');

const CORES = {
  grama: '#4c7a3d',
  agua: '#2f6fa8',
  ponte: '#8a5a2b',
  grade: 'rgba(255,255,255,0.06)',
  eixo: 'rgba(224, 169, 64, 0.55)',
  estrutura: '#e0a940',
  jazidaOuro: '#f0d060',
  jazidaArvore: '#5fae5f',
  pasto: '#c98fd6',
};

const NOME_DA_ESTRUTURA: Record<TipoDeEstrutura, string> = {
  tesouraria: 'Tesouraria',
  cofre: 'Cofre',
  casaDaMoeda: 'Casa da Moeda',
  chapelaria: 'Chapelaria',
  nascedouro: 'Nascedouro',
};

function redimensionarCanvasMapa(): void {
  canvasMapa.width = editor.largura * TILE_PX;
  canvasMapa.height = editor.altura * TILE_PX;
}

function desenharMapa(): void {
  const { largura, altura } = editor;
  ctxMapa.fillStyle = CORES.grama;
  ctxMapa.fillRect(0, 0, largura * TILE_PX, altura * TILE_PX);

  for (let ty = 0; ty < altura; ty++) {
    for (let tx = 0; tx < largura; tx++) {
      if (editor.ehPonte(tx, ty)) ctxMapa.fillStyle = CORES.ponte;
      else if (editor.ehAgua(tx, ty)) ctxMapa.fillStyle = CORES.agua;
      else continue;
      ctxMapa.fillRect(tx * TILE_PX, ty * TILE_PX, TILE_PX, TILE_PX);
    }
  }

  ctxMapa.strokeStyle = CORES.grade;
  ctxMapa.lineWidth = 1;
  for (let tx = 0; tx <= largura; tx++) {
    ctxMapa.beginPath();
    ctxMapa.moveTo(tx * TILE_PX + 0.5, 0);
    ctxMapa.lineTo(tx * TILE_PX + 0.5, altura * TILE_PX);
    ctxMapa.stroke();
  }
  for (let ty = 0; ty <= altura; ty++) {
    ctxMapa.beginPath();
    ctxMapa.moveTo(0, ty * TILE_PX + 0.5);
    ctxMapa.lineTo(largura * TILE_PX, ty * TILE_PX + 0.5);
    ctxMapa.stroke();
  }

  // O eixo de simetria — tudo que se pinta de um lado nasce também aqui.
  const eixoPx = ((editor.largura - 1) / 2 + 0.5) * TILE_PX;
  ctxMapa.strokeStyle = CORES.eixo;
  ctxMapa.lineWidth = 2;
  ctxMapa.beginPath();
  ctxMapa.moveTo(eixoPx, 0);
  ctxMapa.lineTo(eixoPx, altura * TILE_PX);
  ctxMapa.stroke();

  const ponto = (tx: number, ty: number, cor: string, rotulo: string): void => {
    const cx = (tx + 0.5) * TILE_PX;
    const cy = (ty + 0.5) * TILE_PX;
    ctxMapa.fillStyle = cor;
    ctxMapa.beginPath();
    ctxMapa.arc(cx, cy, TILE_PX * 0.42, 0, Math.PI * 2);
    ctxMapa.fill();
    ctxMapa.strokeStyle = 'rgba(0,0,0,0.6)';
    ctxMapa.lineWidth = 1;
    ctxMapa.stroke();
    if (rotulo) {
      ctxMapa.fillStyle = '#0b0d12';
      ctxMapa.font = `${Math.max(7, TILE_PX * 0.6)}px sans-serif`;
      ctxMapa.textAlign = 'center';
      ctxMapa.textBaseline = 'middle';
      ctxMapa.fillText(rotulo, cx, cy + 0.5);
    }
  };

  for (const [tipo, pos] of Object.entries(editor.planta) as [TipoDeEstrutura, [number, number]][]) {
    if (!pos) continue;
    const [tx, ty] = pos;
    ponto(tx, ty, CORES.estrutura, tipo[0]!.toUpperCase());
    ponto(editor.largura - 1 - tx, ty, CORES.estrutura, tipo[0]!.toUpperCase());
  }
  const corDaJazida = (tipo: TipoDeJazida): string =>
    tipo === 'ouro' ? CORES.jazidaOuro : CORES.jazidaArvore;
  for (const [tx, ty, tipo] of editor.jazidasDoLado) {
    ponto(tx, ty, corDaJazida(tipo), '');
    ponto(editor.largura - 1 - tx, ty, corDaJazida(tipo), '');
  }
  for (const [tx, ty, tipo] of editor.jazidasDoMeio) ponto(tx, ty, corDaJazida(tipo), '');
  for (const [tx, ty] of editor.pastosDoLado) {
    ponto(tx, ty, CORES.pasto, '');
    ponto(editor.largura - 1 - tx, ty, CORES.pasto, '');
  }
  for (const [tx, ty] of editor.pastosDoMeio) ponto(tx, ty, CORES.pasto, '');
}

function pintarAvisos(): void {
  const erros = editor.validar();
  avisosMapa.replaceChildren();
  if (erros.length === 0) {
    const ok = document.createElement('div');
    ok.className = 'aviso ok';
    ok.textContent = 'sem problemas encontrados — pronto para exportar';
    avisosMapa.append(ok);
    return;
  }
  for (const erro of erros) {
    const div = document.createElement('div');
    div.className = 'aviso';
    div.textContent = erro;
    avisosMapa.append(div);
  }
}

function atualizarLegenda(): void {
  const legenda = pegar<HTMLElement>('#mapa-legenda');
  legenda.replaceChildren();
  for (const [tipo, pos] of Object.entries(editor.planta)) {
    const span = document.createElement('span');
    span.textContent = pos ? `${NOME_DA_ESTRUTURA[tipo as TipoDeEstrutura]} ✓` : tipo;
    legenda.append(span);
  }
}

function redesenhar(): void {
  redimensionarCanvasMapa();
  desenharMapa();
  pintarAvisos();
  atualizarLegenda();
}

// --- ferramentas -----------------------------------------------------------

function marcarFerramentaAtiva(botao: HTMLButtonElement): void {
  for (const b of Array.from(document.querySelectorAll<HTMLButtonElement>('.ferramenta'))) {
    b.setAttribute('aria-pressed', String(b === botao));
  }
}

for (const botao of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-ferramenta]'))) {
  botao.addEventListener('click', () => {
    editor.ferramenta = { tipo: 'terreno', terreno: botao.dataset.ferramenta as 'agua' | 'ponte' | 'grama' };
    marcarFerramentaAtiva(botao);
  });
}

const ESTRUTURAS: readonly TipoDeEstrutura[] = [
  'tesouraria',
  'cofre',
  'casaDaMoeda',
  'chapelaria',
  'nascedouro',
];
const caixaEstruturas = pegar<HTMLElement>('#ferramentas-estruturas');
for (const tipo of ESTRUTURAS) {
  const botao = document.createElement('button');
  botao.className = 'ferramenta';
  botao.innerHTML = `<span class="amostra" style="background:${CORES.estrutura}"></span>${NOME_DA_ESTRUTURA[tipo]}`;
  botao.addEventListener('click', () => {
    editor.ferramenta = { tipo: 'estrutura', estrutura: tipo };
    marcarFerramentaAtiva(botao);
  });
  caixaEstruturas.append(botao);
}

const PONTOS: { ferramenta: Ferramenta; nome: string; cor: string }[] = [
  { ferramenta: { tipo: 'jazida', jazida: 'ouro', onde: 'lado' }, nome: 'Ouro (lado)', cor: CORES.jazidaOuro },
  { ferramenta: { tipo: 'jazida', jazida: 'arvore', onde: 'lado' }, nome: 'Árvore (lado)', cor: CORES.jazidaArvore },
  { ferramenta: { tipo: 'pasto', onde: 'lado' }, nome: 'Pasto (lado)', cor: CORES.pasto },
  { ferramenta: { tipo: 'jazida', jazida: 'ouro', onde: 'meio' }, nome: 'Ouro (meio)', cor: CORES.jazidaOuro },
  { ferramenta: { tipo: 'jazida', jazida: 'arvore', onde: 'meio' }, nome: 'Árvore (meio)', cor: CORES.jazidaArvore },
  { ferramenta: { tipo: 'pasto', onde: 'meio' }, nome: 'Pasto (meio)', cor: CORES.pasto },
];
const caixaPontos = pegar<HTMLElement>('#ferramentas-pontos');
for (const p of PONTOS) {
  const botao = document.createElement('button');
  botao.className = 'ferramenta';
  botao.innerHTML = `<span class="amostra" style="background:${p.cor}"></span>${p.nome}`;
  botao.addEventListener('click', () => {
    editor.ferramenta = p.ferramenta;
    marcarFerramentaAtiva(botao);
  });
  caixaPontos.append(botao);
}

// --- interação com o canvas do mapa -----------------------------------------

function tileDoEvento(e: MouseEvent): { tx: number; ty: number } {
  const r = canvasMapa.getBoundingClientRect();
  const tx = Math.floor(((e.clientX - r.left) / r.width) * editor.largura);
  const ty = Math.floor(((e.clientY - r.top) / r.height) * editor.altura);
  return { tx, ty };
}

let pintando = false;
canvasMapa.addEventListener('mousedown', (e) => {
  pintando = true;
  const { tx, ty } = tileDoEvento(e);
  editor.clicar(tx, ty);
  redesenhar();
});
window.addEventListener('mouseup', () => {
  pintando = false;
});
canvasMapa.addEventListener('mousemove', (e) => {
  const { tx, ty } = tileDoEvento(e);
  statusMapa.textContent = `tile: ${tx}, ${ty}`;
  // Arrastar só pinta terreno — construção, jazida e pasto são um ponto por
  // clique, e arrastar um deles apagaria a lista inteira sob o cursor.
  if (pintando && editor.ferramenta.tipo === 'terreno') {
    editor.clicar(tx, ty);
    redesenhar();
  }
});

// --- metadados ---------------------------------------------------------

const campoId = pegar<HTMLInputElement>('#mapa-id');
const campoNome = pegar<HTMLInputElement>('#mapa-nome');
const campoLema = pegar<HTMLInputElement>('#mapa-lema');
const campoLargura = pegar<HTMLInputElement>('#mapa-largura');
const campoAltura = pegar<HTMLInputElement>('#mapa-altura');
const campoEspecies = pegar<HTMLSelectElement>('#mapa-especies');
const campoForaDoSorteio = pegar<HTMLInputElement>('#mapa-fora-sorteio');
const campoBioma = pegar<HTMLSelectElement>('#mapa-bioma');

function sincronizarCamposComEditor(): void {
  campoId.value = editor.id;
  campoNome.value = editor.nome;
  campoLema.value = editor.lema;
  campoLargura.value = String(editor.largura);
  campoAltura.value = String(editor.altura);
  campoEspecies.value = editor.especiesDeArvore.join(',');
  campoForaDoSorteio.checked = editor.foraDoSorteio;
  campoBioma.value = editor.bioma;
}

campoId.addEventListener('input', () => {
  editor.id = campoId.value.trim();
  pintarAvisos();
});
campoNome.addEventListener('input', () => (editor.nome = campoNome.value));
campoLema.addEventListener('input', () => (editor.lema = campoLema.value));
campoEspecies.addEventListener('change', () => {
  const [a, b] = campoEspecies.value.split(',').map(Number);
  editor.especiesDeArvore = [a!, b!];
});
campoForaDoSorteio.addEventListener('change', () => {
  editor.foraDoSorteio = campoForaDoSorteio.checked;
});
campoBioma.addEventListener('change', () => {
  editor.bioma = campoBioma.value === 'ossos' ? 'ossos' : 'padrao';
});
pegar<HTMLButtonElement>('#mapa-redimensionar').addEventListener('click', () => {
  const largura = Math.max(20, Math.min(200, Number(campoLargura.value) || editor.largura));
  const altura = Math.max(20, Math.min(200, Number(campoAltura.value) || editor.altura));
  editor.redimensionar(largura, altura);
  redesenhar();
});

// --- arquivo -------------------------------------------------------------

pegar<HTMLButtonElement>('#mapa-novo').addEventListener('click', () => {
  if (!confirm('Descartar o mapa atual e começar um em branco?')) return;
  editor.limpar();
  sincronizarCamposComEditor();
  redesenhar();
});

pegar<HTMLInputElement>('#mapa-importar').addEventListener('change', async (e) => {
  const arquivo = (e.target as HTMLInputElement).files?.[0];
  if (!arquivo) return;
  const texto = await arquivo.text();
  try {
    const esquema = JSON.parse(texto) as EsquemaDeMapa;
    editor.carregar(esquema);
    sincronizarCamposComEditor();
    redesenhar();
  } catch (err) {
    alert(`não consegui ler este mapa: ${err instanceof Error ? err.message : String(err)}`);
  }
  (e.target as HTMLInputElement).value = '';
});

pegar<HTMLButtonElement>('#mapa-exportar').addEventListener('click', () => {
  const erros = editor.validar();
  if (erros.length > 0 && !confirm(`Este mapa tem ${erros.length} aviso(s). Exportar assim mesmo?`)) {
    return;
  }
  const esquema = editor.paraEsquema();
  const blob = new Blob([JSON.stringify(esquema, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${editor.id || 'mapa'}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
});

sincronizarCamposComEditor();
redesenhar();

// --- editor de modos ---------------------------------------------------

const modo = new EditorDeModos();

const camposDeModo = {
  id: pegar<HTMLInputElement>('#modo-id'),
  nome: pegar<HTMLInputElement>('#modo-nome'),
  lema: pegar<HTMLInputElement>('#modo-lema'),
  pontos: pegar<HTMLInputElement>('#modo-pontos'),
  duracao: pegar<HTMLInputElement>('#modo-duracao'),
  renascimento: pegar<HTMLInputElement>('#modo-renascimento'),
  peso: pegar<HTMLInputElement>('#modo-peso'),
  vitoriaBalanca: pegar<HTMLInputElement>('#modo-vitoria-balanca'),
  vitoriaObra: pegar<HTMLInputElement>('#modo-vitoria-obra'),
  abates: pegar<HTMLInputElement>('#modo-abates'),
  chapeusInfinitos: pegar<HTMLInputElement>('#modo-chapeus-infinitos'),
  animaisVoltam: pegar<HTMLInputElement>('#modo-animais-voltam'),
  guardiao: pegar<HTMLInputElement>('#modo-guardiao'),
  caca: pegar<HTMLInputElement>('#modo-caca'),
  cajado: pegar<HTMLInputElement>('#modo-cajado'),
  fuga: pegar<HTMLInputElement>('#modo-fuga'),
  noite: pegar<HTMLInputElement>('#modo-noite'),
};

function sincronizarCamposComModo(): void {
  camposDeModo.id.value = modo.id;
  camposDeModo.nome.value = modo.nome;
  camposDeModo.lema.value = modo.lema;
  camposDeModo.pontos.value = String(modo.pontosParaVencer);
  camposDeModo.duracao.value = String(modo.duracao);
  camposDeModo.renascimento.value = String(modo.renascimentoBase);
  camposDeModo.peso.value = String(modo.pesoQueVence);
  camposDeModo.vitoriaBalanca.checked = modo.vitoriaPorBalanca;
  camposDeModo.vitoriaObra.checked = modo.vitoriaPorObra;
  camposDeModo.abates.value = modo.abatesParaVencer === null ? '' : String(modo.abatesParaVencer);
  camposDeModo.chapeusInfinitos.checked = modo.chapeusInfinitos;
  camposDeModo.animaisVoltam.checked = modo.animaisVoltam;
  camposDeModo.guardiao.checked = modo.temGuardiao;
  camposDeModo.caca.checked = modo.temCaca;
  camposDeModo.cajado.checked = modo.temCajado;
  camposDeModo.fuga.checked = modo.temFuga;
  camposDeModo.noite.checked = modo.temNoite;
}

function lerCamposDoModo(): void {
  modo.id = camposDeModo.id.value.trim();
  modo.nome = camposDeModo.nome.value;
  modo.lema = camposDeModo.lema.value;
  modo.pontosParaVencer = Math.max(1, Number(camposDeModo.pontos.value) || 1);
  modo.duracao = Math.max(30, Number(camposDeModo.duracao.value) || 30);
  modo.renascimentoBase = Math.max(1, Number(camposDeModo.renascimento.value) || 1);
  modo.pesoQueVence = Math.max(1, Number(camposDeModo.peso.value) || 1);
  modo.vitoriaPorBalanca = camposDeModo.vitoriaBalanca.checked;
  modo.vitoriaPorObra = camposDeModo.vitoriaObra.checked;
  modo.abatesParaVencer = camposDeModo.abates.value.trim() === '' ? null : Number(camposDeModo.abates.value);
  modo.chapeusInfinitos = camposDeModo.chapeusInfinitos.checked;
  modo.animaisVoltam = camposDeModo.animaisVoltam.checked;
  modo.temGuardiao = camposDeModo.guardiao.checked;
  modo.temCaca = camposDeModo.caca.checked;
  modo.temCajado = camposDeModo.cajado.checked;
  modo.temFuga = camposDeModo.fuga.checked;
  modo.temNoite = camposDeModo.noite.checked;
  redesenharModo();
}

/** Atualiza avisos e prévia — chamada a cada tecla. Nunca mexe no DOM dos
 * gatilhos: reconstruir aquilo a cada tecla derrubaria o foco de quem está
 * digitando a mensagem. */
function atualizarPreviaDoModo(): void {
  const avisos = pegar<HTMLElement>('#modo-avisos');
  avisos.replaceChildren();
  const erros = modo.validar();
  if (erros.length === 0) {
    const ok = document.createElement('div');
    ok.className = 'aviso ok';
    ok.textContent = 'sem problemas encontrados — pronto para exportar';
    avisos.append(ok);
  } else {
    for (const erro of erros) {
      const div = document.createElement('div');
      div.className = 'aviso';
      div.textContent = erro;
      avisos.append(div);
    }
  }
  pegar<HTMLElement>('#modo-json').textContent = JSON.stringify(modo.paraEsquema(), null, 2);
}

/** Reconstrói tudo, inclusive as linhas de gatilho — só depois de adicionar,
 * remover, importar ou zerar, nunca a cada tecla. */
function redesenharModo(): void {
  atualizarPreviaDoModo();
  redesenharGatilhos();
}

function redesenharGatilhos(): void {
  const caixa = pegar<HTMLElement>('#modo-gatilhos');
  caixa.replaceChildren();
  modo.gatilhos.forEach((g, i) => {
    const linha = document.createElement('div');
    linha.className = 'linha-campos';
    linha.style.alignItems = 'flex-end';
    linha.style.marginBottom = '6px';

    const campoIntervalo = document.createElement('div');
    campoIntervalo.className = 'campo';
    campoIntervalo.style.flex = '0 0 90px';
    campoIntervalo.innerHTML = '<label>a cada (s)</label>';
    const inputIntervalo = document.createElement('input');
    inputIntervalo.type = 'number';
    inputIntervalo.min = '1';
    inputIntervalo.value = String(g.quando.intervaloSegundos);
    inputIntervalo.addEventListener('input', () => {
      modo.gatilhos[i] = {
        quando: { tipo: 'temporizador', intervaloSegundos: Number(inputIntervalo.value) || 1 },
        entao: modo.gatilhos[i]!.entao,
      };
      atualizarPreviaDoModo();
    });
    campoIntervalo.append(inputIntervalo);

    const campoTexto = document.createElement('div');
    campoTexto.className = 'campo';
    campoTexto.innerHTML = '<label>mensagem</label>';
    const inputTexto = document.createElement('input');
    inputTexto.type = 'text';
    inputTexto.placeholder = 'o campo treme…';
    inputTexto.value = g.entao[0]?.texto ?? '';
    inputTexto.addEventListener('input', () => {
      modo.gatilhos[i] = {
        quando: modo.gatilhos[i]!.quando,
        entao: [{ tipo: 'mensagem', texto: inputTexto.value }],
      };
      atualizarPreviaDoModo();
    });
    campoTexto.append(inputTexto);

    const remover = document.createElement('button');
    remover.className = 'acao secundaria';
    remover.textContent = '✕';
    remover.style.flex = '0 0 auto';
    remover.addEventListener('click', () => {
      modo.removerGatilho(i);
      redesenharModo();
    });

    linha.append(campoIntervalo, campoTexto, remover);
    caixa.append(linha);
  });
}

pegar<HTMLButtonElement>('#modo-gatilho-novo').addEventListener('click', () => {
  modo.adicionarGatilho();
  redesenharModo();
});

for (const campo of Object.values(camposDeModo)) {
  campo.addEventListener('input', lerCamposDoModo);
  campo.addEventListener('change', lerCamposDoModo);
}

pegar<HTMLButtonElement>('#modo-novo').addEventListener('click', () => {
  if (!confirm('Descartar o modo atual e começar um em branco?')) return;
  modo.limpar();
  sincronizarCamposComModo();
  redesenharModo();
});

pegar<HTMLInputElement>('#modo-importar').addEventListener('change', async (e) => {
  const arquivo = (e.target as HTMLInputElement).files?.[0];
  if (!arquivo) return;
  const texto = await arquivo.text();
  try {
    const esquema = JSON.parse(texto) as EsquemaDeModo;
    modo.carregar(esquema);
    sincronizarCamposComModo();
    redesenharModo();
  } catch (err) {
    alert(`não consegui ler este modo: ${err instanceof Error ? err.message : String(err)}`);
  }
  (e.target as HTMLInputElement).value = '';
});

pegar<HTMLButtonElement>('#modo-exportar').addEventListener('click', () => {
  const erros = modo.validar();
  if (erros.length > 0 && !confirm(`Este modo tem ${erros.length} aviso(s). Exportar assim mesmo?`)) {
    return;
  }
  const blob = new Blob([JSON.stringify(modo.paraEsquema(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${modo.id || 'modo'}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
});

sincronizarCamposComModo();
redesenharModo();

// --- editor de classes ---------------------------------------------------

const classes = new EditorDeClasses();

const campoEscolha = pegar<HTMLSelectElement>('#classe-escolha');
for (const id of Object.keys(PERFIS_CONHECIDOS)) {
  const opcao = document.createElement('option');
  opcao.value = id;
  opcao.textContent = PERFIS_CONHECIDOS[id]!.nome;
  campoEscolha.append(opcao);
}

const camposDeClasse = {
  nome: pegar<HTMLInputElement>('#classe-nome'),
  resumo: pegar<HTMLInputElement>('#classe-resumo'),
  vida: pegar<HTMLInputElement>('#classe-vida'),
  velocidade: pegar<HTMLInputElement>('#classe-velocidade'),
  ataque: pegar<HTMLSelectElement>('#classe-ataque'),
  gesto: pegar<HTMLSelectElement>('#classe-gesto'),
  dano: pegar<HTMLInputElement>('#classe-dano'),
  alcance: pegar<HTMLInputElement>('#classe-alcance'),
  cadencia: pegar<HTMLInputElement>('#classe-cadencia'),
  duracaoGolpe: pegar<HTMLInputElement>('#classe-duracao-golpe'),
  danoAnimal: pegar<HTMLInputElement>('#classe-dano-animal'),
  oficio: pegar<HTMLSelectElement>('#classe-oficio'),
  corChapeu: pegar<HTMLInputElement>('#classe-cor-chapeu'),
  corArma: pegar<HTMLInputElement>('#classe-cor-arma'),
};

function sincronizarCamposComClasse(): void {
  const p = classes.perfil;
  camposDeClasse.nome.value = p.nome;
  camposDeClasse.resumo.value = p.resumo;
  camposDeClasse.vida.value = String(p.vida);
  camposDeClasse.velocidade.value = String(p.velocidade);
  camposDeClasse.ataque.value = p.ataque;
  camposDeClasse.gesto.value = p.gesto;
  camposDeClasse.dano.value = String(p.dano);
  camposDeClasse.alcance.value = String(p.alcance);
  camposDeClasse.cadencia.value = String(p.cadencia);
  camposDeClasse.duracaoGolpe.value = String(p.duracaoDoGolpe);
  camposDeClasse.danoAnimal.value = String(p.danoContraAnimal);
  camposDeClasse.oficio.value = p.oficio ?? '';
  camposDeClasse.corChapeu.value = p.tintaDoChapeu;
  camposDeClasse.corArma.value = p.tintaDaArma;
}

function redesenharClasse(): void {
  const avisos = pegar<HTMLElement>('#classe-avisos');
  avisos.replaceChildren();
  const erros = classes.validar();
  if (erros.length === 0) {
    const ok = document.createElement('div');
    ok.className = 'aviso ok';
    ok.textContent = 'sem problemas encontrados — pronto para exportar';
    avisos.append(ok);
  } else {
    for (const erro of erros) {
      const div = document.createElement('div');
      div.className = 'aviso';
      div.textContent = erro;
      avisos.append(div);
    }
  }
  pegar<HTMLElement>('#classe-json').textContent = JSON.stringify(classes.perfil, null, 2);
}

function lerCamposDaClasse(): void {
  classes.perfil = {
    id: classes.perfil.id,
    nome: camposDeClasse.nome.value,
    resumo: camposDeClasse.resumo.value,
    vida: Math.max(1, Number(camposDeClasse.vida.value) || 1),
    velocidade: Math.max(1, Number(camposDeClasse.velocidade.value) || 1),
    ataque: camposDeClasse.ataque.value as EsquemaDeClasse['ataque'],
    gesto: camposDeClasse.gesto.value as EsquemaDeClasse['gesto'],
    dano: Number(camposDeClasse.dano.value) || 0,
    alcance: Math.max(1, Number(camposDeClasse.alcance.value) || 1),
    cadencia: Math.max(0.01, Number(camposDeClasse.cadencia.value) || 0.01),
    duracaoDoGolpe: Math.max(0.01, Number(camposDeClasse.duracaoGolpe.value) || 0.01),
    oficio: (camposDeClasse.oficio.value || null) as EsquemaDeClasse['oficio'],
    danoContraAnimal: Number(camposDeClasse.danoAnimal.value) || 1,
    tintaDoChapeu: camposDeClasse.corChapeu.value,
    tintaDaArma: camposDeClasse.corArma.value,
  };
  redesenharClasse();
}

campoEscolha.addEventListener('change', () => {
  classes.carregar(PERFIS_CONHECIDOS[campoEscolha.value]!);
  sincronizarCamposComClasse();
  redesenharClasse();
});

for (const campo of Object.values(camposDeClasse)) {
  campo.addEventListener('input', lerCamposDaClasse);
  campo.addEventListener('change', lerCamposDaClasse);
}

pegar<HTMLInputElement>('#classe-importar').addEventListener('change', async (e) => {
  const arquivo = (e.target as HTMLInputElement).files?.[0];
  if (!arquivo) return;
  const texto = await arquivo.text();
  try {
    const esquema = JSON.parse(texto) as EsquemaDeClasse;
    classes.carregar(esquema);
    sincronizarCamposComClasse();
    redesenharClasse();
  } catch (err) {
    alert(`não consegui ler esta classe: ${err instanceof Error ? err.message : String(err)}`);
  }
  (e.target as HTMLInputElement).value = '';
});

pegar<HTMLButtonElement>('#classe-exportar').addEventListener('click', () => {
  const erros = classes.validar();
  if (erros.length > 0 && !confirm(`Esta classe tem ${erros.length} aviso(s). Exportar assim mesmo?`)) {
    return;
  }
  const blob = new Blob([JSON.stringify(classes.perfil, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${classes.perfil.id || 'classe'}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
});

sincronizarCamposComClasse();
redesenharClasse();

// --- editor de sprites -----------------------------------------------------

const sprite = new FerramentaDeSprite();
const canvasSprite = pegar<HTMLCanvasElement>('#sprite-canvas');
const ctxSprite = canvasSprite.getContext('2d')!;
const infoSprite = pegar<HTMLElement>('#sprite-info');
const campoLarguraQuadro = pegar<HTMLInputElement>('#sprite-largura');
const campoAlturaQuadro = pegar<HTMLInputElement>('#sprite-altura');
const contagemSprite = pegar<HTMLElement>('#sprite-contagem');
const selecionadosSprite = pegar<HTMLElement>('#sprite-selecionados');
const botaoExportarRecorte = pegar<HTMLButtonElement>('#sprite-exportar-recorte');

function desenharSprite(): void {
  if (!sprite.imagem) {
    canvasSprite.width = 1;
    canvasSprite.height = 1;
    infoSprite.textContent = 'nenhuma imagem carregada';
    return;
  }
  canvasSprite.width = sprite.imagem.width;
  canvasSprite.height = sprite.imagem.height;
  ctxSprite.imageSmoothingEnabled = false;
  ctxSprite.drawImage(sprite.imagem, 0, 0);

  ctxSprite.strokeStyle = 'rgba(255,255,255,0.35)';
  ctxSprite.lineWidth = 1;
  for (let c = 0; c <= sprite.colunas; c++) {
    const x = c * sprite.larguraDoQuadro + 0.5;
    ctxSprite.beginPath();
    ctxSprite.moveTo(x, 0);
    ctxSprite.lineTo(x, sprite.imagem.height);
    ctxSprite.stroke();
  }
  for (let l = 0; l <= sprite.linhas; l++) {
    const y = l * sprite.alturaDoQuadro + 0.5;
    ctxSprite.beginPath();
    ctxSprite.moveTo(0, y);
    ctxSprite.lineTo(sprite.imagem.width, y);
    ctxSprite.stroke();
  }

  sprite.selecionados.forEach((q, i) => {
    const x = q.col * sprite.larguraDoQuadro;
    const y = q.row * sprite.alturaDoQuadro;
    ctxSprite.fillStyle = 'rgba(224, 169, 64, 0.28)';
    ctxSprite.fillRect(x, y, sprite.larguraDoQuadro, sprite.alturaDoQuadro);
    ctxSprite.strokeStyle = '#e0a940';
    ctxSprite.lineWidth = 2;
    ctxSprite.strokeRect(x + 1, y + 1, sprite.larguraDoQuadro - 2, sprite.alturaDoQuadro - 2);
    ctxSprite.fillStyle = '#0b0d12';
    ctxSprite.font = 'bold 14px sans-serif';
    ctxSprite.textAlign = 'left';
    ctxSprite.textBaseline = 'top';
    ctxSprite.fillText(String(i + 1), x + 4, y + 2);
  });

  if (sprite.recorteLivre) {
    const { x, y, largura, altura } = sprite.recorteLivre;
    ctxSprite.strokeStyle = '#4a90d9';
    ctxSprite.lineWidth = 2;
    ctxSprite.setLineDash([6, 4]);
    ctxSprite.strokeRect(x, y, largura, altura);
    ctxSprite.setLineDash([]);
  }

  infoSprite.textContent =
    `${sprite.imagem.width}×${sprite.imagem.height}px · grade ${sprite.colunas}×${sprite.linhas} de ` +
    `${sprite.larguraDoQuadro}×${sprite.alturaDoQuadro}`;
}

function atualizarSelecaoSprite(): void {
  contagemSprite.textContent = String(sprite.selecionados.length);
  selecionadosSprite.replaceChildren();
  sprite.selecionados.forEach((q, i) => {
    const mini = document.createElement('canvas');
    mini.width = 48;
    mini.height = 48;
    const c2 = mini.getContext('2d')!;
    c2.imageSmoothingEnabled = false;
    if (sprite.imagem) {
      c2.drawImage(
        sprite.imagem,
        q.col * sprite.larguraDoQuadro,
        q.row * sprite.alturaDoQuadro,
        sprite.larguraDoQuadro,
        sprite.alturaDoQuadro,
        0,
        0,
        48,
        48,
      );
    }
    mini.title = `quadro ${i + 1} — clique para remover`;
    mini.addEventListener('click', () => {
      sprite.selecionados.splice(i, 1);
      desenharSprite();
      atualizarSelecaoSprite();
    });
    selecionadosSprite.append(mini);
  });
}

pegar<HTMLInputElement>('#sprite-arquivo').addEventListener('change', async (e) => {
  const arquivo = (e.target as HTMLInputElement).files?.[0];
  if (!arquivo) return;
  await sprite.carregar(arquivo);
  desenharSprite();
  atualizarSelecaoSprite();
  botaoExportarRecorte.disabled = true;
});

for (const campo of [campoLarguraQuadro, campoAlturaQuadro]) {
  campo.addEventListener('input', () => {
    sprite.larguraDoQuadro = Math.max(1, Number(campoLarguraQuadro.value) || 1);
    sprite.alturaDoQuadro = Math.max(1, Number(campoAlturaQuadro.value) || 1);
    desenharSprite();
  });
}

let arrastandoRecorte: { x0: number; y0: number } | null = null;
canvasSprite.addEventListener('mousedown', (e) => {
  if (!sprite.imagem) return;
  const r = canvasSprite.getBoundingClientRect();
  const x = ((e.clientX - r.left) / r.width) * canvasSprite.width;
  const y = ((e.clientY - r.top) / r.height) * canvasSprite.height;
  arrastandoRecorte = { x0: x, y0: y };
});
canvasSprite.addEventListener('mousemove', (e) => {
  if (!arrastandoRecorte || !sprite.imagem) return;
  const r = canvasSprite.getBoundingClientRect();
  const x = ((e.clientX - r.left) / r.width) * canvasSprite.width;
  const y = ((e.clientY - r.top) / r.height) * canvasSprite.height;
  sprite.recorteLivre = {
    x: Math.min(arrastandoRecorte.x0, x),
    y: Math.min(arrastandoRecorte.y0, y),
    largura: Math.abs(x - arrastandoRecorte.x0),
    altura: Math.abs(y - arrastandoRecorte.y0),
  };
  desenharSprite();
});
window.addEventListener('mouseup', () => {
  if (!arrastandoRecorte) return;
  arrastandoRecorte = null;
  const r = sprite.recorteLivre;
  botaoExportarRecorte.disabled = !r || r.largura < 2 || r.altura < 2;
});
canvasSprite.addEventListener('click', (e) => {
  // Um clique simples (sem arrastar) alterna o quadro da grade sob o cursor —
  // o mesmo gesto de "cortar e colar" que monta a tira.
  if (!sprite.imagem) return;
  if (sprite.recorteLivre && sprite.recorteLivre.largura >= 2) return;
  const r = canvasSprite.getBoundingClientRect();
  const x = ((e.clientX - r.left) / r.width) * canvasSprite.width;
  const y = ((e.clientY - r.top) / r.height) * canvasSprite.height;
  const col = Math.floor(x / sprite.larguraDoQuadro);
  const row = Math.floor(y / sprite.alturaDoQuadro);
  sprite.alternarQuadro(col, row);
  desenharSprite();
  atualizarSelecaoSprite();
});

pegar<HTMLButtonElement>('#sprite-limpar').addEventListener('click', () => {
  sprite.limparSelecao();
  sprite.recorteLivre = null;
  botaoExportarRecorte.disabled = true;
  desenharSprite();
  atualizarSelecaoSprite();
});

pegar<HTMLButtonElement>('#sprite-exportar-tira').addEventListener('click', () => {
  if (sprite.selecionados.length === 0) {
    alert('Selecione ao menos um quadro na grade antes de exportar.');
    return;
  }
  const nome = prompt('Nome do arquivo (sem extensão) — ex: arqueiro_parado', 'tira') ?? 'tira';
  baixarComoPng(sprite.montarTira(), nome);
});

pegar<HTMLButtonElement>('#sprite-exportar-recorte').addEventListener('click', () => {
  const canvas = sprite.montarRecorteLivre();
  if (!canvas) return;
  const nome = prompt('Nome do arquivo (sem extensão)', 'recorte') ?? 'recorte';
  baixarComoPng(canvas, nome);
});
