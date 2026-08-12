import { carregarArte, type Arte } from './arte';
import { dicaDeUso } from './contexto';
import {
  bussola,
  criarCamera,
  desenharMundo,
  realce,
  seguir,
  vistaDe,
} from './desenho';
import { Entrada } from './entrada';
import { desenharDica, desenharHud, narrar } from './hud';
import { Rede } from './rede';
import { princesaDe } from '../shared/estado';
import { DT } from '../shared/regras';

/**
 * A montagem do cliente: menu, laço de quadro e a ponte entre eles.
 *
 * ## Dois relógios, de propósito
 *
 * O desenho corre no relógio da tela (`requestAnimationFrame`), que é o que o
 * monitor pode entregar. A simulação corre em passo fixo de `DT`, que é o que
 * o servidor entende. Misturar os dois — mandar um comando por quadro — faria o
 * jogador de 144 Hz mandar cinco vezes mais comandos que o de 30 Hz e andar
 * mais rápido que ele, o que é um bug de justiça, não de desempenho.
 *
 * ## Não existe modo de um jogador
 *
 * O menu tem um botão só: entrar na batalha. Sem tela de partida solo, sem
 * treino contra bots — o servidor é o jogo. Se você entrar sozinho, ele arruma
 * companhia; se chegar gente, os bots cedem o lugar. É a mesma partida em todos
 * os casos, e é isso que faz o "multiplayer" não ser um modo entre outros.
 */

const tela = document.querySelector<HTMLCanvasElement>('#tela')!;
const menu = document.querySelector<HTMLDivElement>('#menu')!;
const campoNome = document.querySelector<HTMLInputElement>('#nome')!;
const botao = document.querySelector<HTMLButtonElement>('#jogar')!;
const recado = document.querySelector<HTMLParagraphElement>('#recado')!;
const ctx = tela.getContext('2d')!;

const entrada = new Entrada(tela);
const camera = criarCamera();

let arte: Arte | null = null;
let rede: Rede | null = null;
let acumulado = 0;
let anterior = performance.now();

function enderecoDoServidor(): string {
  const protocolo = location.protocol === 'https:' ? 'wss:' : 'ws:';
  // Em desenvolvimento o Vite serve na 5173 e o jogo na 8787. Em produção é o
  // mesmo processo, então a porta da página serve.
  const host = location.port === '5173' ? `${location.hostname}:8787` : location.host;
  return `${protocolo}//${host}`;
}

function ajustarTela(): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  tela.width = Math.floor(window.innerWidth * dpr);
  tela.height = Math.floor(window.innerHeight * dpr);
  tela.style.width = `${window.innerWidth}px`;
  tela.style.height = `${window.innerHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', ajustarTela);
ajustarTela();

botao.addEventListener('click', () => void jogar());
campoNome.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') void jogar();
});

async function jogar(): Promise<void> {
  botao.disabled = true;
  recado.textContent = 'carregando a arte…';
  arte ??= await carregarArte();
  recado.textContent = 'procurando uma partida…';
  const nome = campoNome.value.trim() || 'Anônimo';
  localStorage.setItem('balanca.nome', nome);
  rede = new Rede(enderecoDoServidor());
  rede.conectar(nome);
  menu.classList.add('escondido');
}

function voltarAoMenu(motivo: string): void {
  menu.classList.remove('escondido');
  botao.disabled = false;
  recado.textContent = motivo;
  rede?.desconectar();
  rede = null;
}

/**
 * Espia para diagnóstico, e só isso.
 *
 * Um jogo em rede que parece travado tem três suspeitos — o servidor, a
 * conexão e o próprio laço de quadro — e distinguir os três de fora da página é
 * quase impossível. Este punhado de contadores responde a pergunta em uma
 * linha de console, e não expõe nada que o servidor não tenha mandado.
 */
const espia = { quadros: 0, comandos: 0 };
(window as unknown as { balanca: unknown }).balanca = {
  espia,
  relogio: () => rede?.estado?.relogio ?? null,
  ping: () => rede?.ping ?? null,
};

function laco(agora: number): void {
  requestAnimationFrame(laco);
  espia.quadros++;
  const dt = Math.min(0.25, (agora - anterior) / 1000);
  anterior = agora;
  const largura = tela.width / (Math.min(2, window.devicePixelRatio || 1));
  const altura = tela.height / (Math.min(2, window.devicePixelRatio || 1));

  if (!rede || !arte) return;
  if (rede.fechado) {
    voltarAoMenu(rede.motivo ?? 'a conexão caiu — tente de novo');
    return;
  }

  const eu = rede.eu;
  const alvoDaCamera = eu ?? { x: 0, y: 0 };
  if (rede.arena) seguir(camera, rede.arena, alvoDaCamera, largura, altura);
  const vista = vistaDe(camera, largura, altura);
  const centroNaTela = { x: vista.paraTelaX(alvoDaCamera.x), y: vista.paraTelaY(alvoDaCamera.y) };

  // Passo fixo: um comando por `DT`, nem mais nem menos, independentemente da
  // taxa de quadros.
  acumulado += dt;
  let passos = 0;
  while (acumulado >= DT && passos < 5) {
    rede.passar(entrada.ler(centroNaTela));
    espia.comandos++;
    acumulado -= DT;
    passos++;
  }
  if (passos === 5) acumulado = 0;

  const tempo = agora / 1000;
  if (rede.arena) {
    desenharMundo(ctx, arte, rede.arena, rede, camera, largura, altura, tempo);
  } else {
    ctx.fillStyle = '#14161f';
    ctx.fillRect(0, 0, largura, altura);
    ctx.fillStyle = '#f2e6c9';
    ctx.font = '600 18px "Trebuchet MS", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('entrando no reino…', largura / 2, altura / 2);
    return;
  }

  const estado = rede.estado;
  if (estado && eu && estado.princesas.length === 2) {
    const dica = dicaDeUso(rede.arena, estado, eu);
    if (dica?.alvo) realce(ctx, vista, dica.alvo, tempo);
    if (dica) desenharDica(ctx, dica.texto, largura, altura, entrada.usandoToque);

    // A bússola aponta o que decide a partida: a sua princesa, e a refém que o
    // seu time guarda. Sem ela, quem está no meio do mapa não sabe para onde
    // correr quando o cortejo começa.
    const minha = princesaDe(estado, eu.time);
    if (minha.onde !== 'salva') bussola(ctx, vista, largura, altura, minha, '#ffd479');
  }

  if (estado) {
    for (const evento of rede.eventosNovos.splice(0)) {
      const linha = narrar(evento, estado, eu?.time ?? null);
      if (linha) rede.avisar(linha.texto, linha.cor);
    }
  }
  desenharHud(ctx, rede, entrada, largura, altura, tempo);
}

campoNome.value = localStorage.getItem('balanca.nome') ?? '';
requestAnimationFrame(laco);
