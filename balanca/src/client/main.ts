import { alvoDaAtracao, aproximar } from './atracao';
import { carregarArte, type Arte } from './arte';
import { dicaDeUso } from './contexto';
import { bussola, criarCamera, desenharMundo, realce, seguir, vistaDe } from './desenho';
import { Entrada } from './entrada';
import { desenharDica, desenharHud, narrar } from './hud';
import { Rede } from './rede';
import { Telas } from './telas';
import { princesaDe } from '../shared/estado';
import { DT } from '../shared/regras';

/**
 * A montagem do cliente: telas, laço de quadro e a ponte entre eles.
 *
 * ## O jogo começa antes de o jogador começar
 *
 * A página conecta ao servidor assim que abre, como **plateia**: carrega a arte,
 * entra numa sala que já está rodando e desenha a partida atrás do menu, com uma
 * câmera que persegue o que interessa. É o modo atração do fliperama — e num
 * jogo só multiplayer ele responde, sem texto, a pergunta que todo mundo faz ao
 * abrir: "tem alguém jogando aí?".
 *
 * Quem assiste **não ocupa vaga**: uma aba esquecida aberta no menu não pode
 * tirar o lugar de quem quer jogar. Só ao escolher um lado é que a pessoa senta
 * à mesa.
 *
 * ## Dois relógios, de propósito
 *
 * O desenho corre no relógio da tela (`requestAnimationFrame`), que é o que o
 * monitor pode entregar. A simulação corre em passo fixo de `DT`, que é o que o
 * servidor entende. Misturar os dois — mandar um comando por quadro — faria o
 * jogador de 144 Hz mandar cinco vezes mais comandos que o de 30 Hz e andar mais
 * rápido que ele, o que é um bug de justiça, não de desempenho.
 *
 * ## Não existe modo de um jogador
 *
 * Sem tela de partida solo, sem treino contra bots — o servidor é o jogo. Se
 * você entrar sozinho, ele arruma companhia; se chegar gente, os bots cedem o
 * lugar.
 */

const tela = document.querySelector<HTMLCanvasElement>('#tela')!;
const ctx = tela.getContext('2d')!;

const entrada = new Entrada(tela);
const camera = criarCamera();
/** Alvo suavizado da câmera do modo atração. */
let olhar = { x: 0, y: 0 };

let arte: Arte | null = null;
let rede: Rede | null = null;
let acumulado = 0;
let anterior = performance.now();
/** Verdadeiro entre apertar "Jogar" e a tela de escolha aparecer. */
let querendoJogar = false;

const telas = new Telas({
  jogar: (nome) => void entrarNaBatalha(nome),
  assistir: () => telas.mostrar('plateia'),
  escolher: (time) => rede?.escolherTime(time, telas.preferencias.nome || 'Anônimo'),
  ajustou: () => {
    // Nada a fazer além de guardar: o laço de quadro lê `telas.preferencias`
    // toda vez que desenha, então o ajuste vale no quadro seguinte.
  },
});

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

/**
 * Abre a conexão de plateia e carrega a arte.
 *
 * Roda ao abrir a página, sem que ninguém peça: é o que faz o menu ter uma
 * partida atrás em vez de um fundo. Falhar aqui não impede nada — o menu
 * continua de pé e a barra diz que o servidor não respondeu.
 */
async function comecarAAssistir(): Promise<void> {
  rede = new Rede(enderecoDoServidor());
  rede.conectar(telas.preferencias.nome || 'Anônimo', true);
  arte = await carregarArte((feitos, total) => {
    if (telas.atual === 'carregando') {
      telas.carregou((feitos / total) * 0.9, `carregando a arte… ${feitos}/${total}`);
    }
  });
}

async function entrarNaBatalha(nome: string): Promise<void> {
  querendoJogar = true;
  if (!arte || !rede || rede.fechado) {
    telas.mostrar('carregando');
    telas.carregou(0.05, 'preparando o reino…');
    if (!arte) arte = await carregarArte();
    if (!rede || rede.fechado) {
      rede = new Rede(enderecoDoServidor());
      rede.conectar(nome, true);
    }
  }
  telas.carregou(0.95, 'procurando uma partida…');
  // Daqui em diante o laço de quadro assume: quando a arena chegar, ele abre a
  // tela de escolha de lado.
}

function voltarAoMenu(motivo: string): void {
  querendoJogar = false;
  telas.mostrar('menu');
  if (motivo) telas.avisar(motivo);
}

/**
 * Espia para diagnóstico, e só isso.
 *
 * Um jogo em rede que parece travado tem três suspeitos — o servidor, a conexão
 * e o próprio laço de quadro — e distinguir os três de fora da página é quase
 * impossível. Este punhado de contadores responde a pergunta em uma linha de
 * console, e não expõe nada que o servidor não tenha mandado.
 */
const espia = { quadros: 0, comandos: 0 };
(window as unknown as { balanca: unknown }).balanca = {
  espia,
  tela: () => telas.atual,
  relogio: () => rede?.estado?.relogio ?? null,
  ping: () => rede?.ping ?? null,
};

function laco(agora: number): void {
  requestAnimationFrame(laco);
  espia.quadros++;
  const dt = Math.min(0.25, (agora - anterior) / 1000);
  anterior = agora;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const largura = tela.width / dpr;
  const altura = tela.height / dpr;
  const ajustes = telas.preferencias;
  entrada.ladoDoManche = ajustes.manche;

  const eu = rede?.eu ?? null;
  const estado = rede?.estado ?? null;

  telas.atualizarEstado({
    ligado: rede !== null && !rede.fechado && rede.arena !== null,
    sala: rede?.sala ?? '',
    jogadores: [...(rede?.elenco.values() ?? [])].filter((f) => !f.bot).length,
    bots: [...(rede?.elenco.values() ?? [])].filter((f) => f.bot).length,
    ping: rede?.ping ?? 0,
    ...(rede?.fechado ? { aviso: rede.motivo ?? 'servidor fora do ar' } : {}),
  });

  // A conexão caiu: quem estava jogando volta ao menu com o motivo; quem só
  // assistia continua no menu, e a barra já está dizendo o que houve.
  if (rede?.fechado && (eu || querendoJogar)) {
    voltarAoMenu(rede.motivo ?? 'a conexão caiu — tente de novo');
    rede = null;
  }

  // Quem apertou "Jogar" e já tem arena vai para a escolha de lado.
  if (querendoJogar && rede?.arena && !eu && telas.atual !== 'escolha') {
    telas.mostrar('escolha');
  }
  if (eu && telas.atual !== 'jogo') {
    querendoJogar = false;
    telas.mostrar('jogo');
  }
  if (rede?.espectador && telas.atual === 'escolha') {
    telas.atualizarEscolha({
      porTime: rede.porTime,
      elenco: [...rede.elenco.values()],
      placar: estado?.placar ?? { azul: 0, vermelho: 0 },
      relogio: estado?.relogio ?? 0,
    });
    if (rede.motivo) telas.avisarNaEscolha(rede.motivo);
  }

  if (!arte || !rede?.arena) {
    ctx.fillStyle = '#14161f';
    ctx.fillRect(0, 0, largura, altura);
    return;
  }

  // --- câmera ------------------------------------------------------------
  //
  // Jogando, ela segue o seu personagem. Sem personagem — menu, plateia,
  // escolha de lado —, ela persegue o que decide a partida, com atraso, como a
  // câmera de um replay de esporte.
  let alvoDaCamera: { x: number; y: number };
  if (eu) {
    alvoDaCamera = eu;
  } else {
    const alvo = alvoDaAtracao(estado, rede.arena.largura, rede.arena.altura);
    if (olhar.x === 0 && olhar.y === 0) olhar = { x: alvo.x, y: alvo.y };
    olhar = aproximar(olhar, alvo, dt);
    alvoDaCamera = olhar;
  }
  seguir(camera, rede.arena, alvoDaCamera, largura, altura, ajustes);
  // Na atração a vista abre um pouco: quem está lendo o menu quer ver a briga
  // inteira, não o cotovelo de um guerreiro.
  if (!eu) camera.zoom *= 0.9;
  const vista = vistaDe(camera, largura, altura);
  const centroNaTela = { x: vista.paraTelaX(alvoDaCamera.x), y: vista.paraTelaY(alvoDaCamera.y) };

  // Passo fixo: um comando por `DT`, nem mais nem menos, independentemente da
  // taxa de quadros. Plateia não manda comando de movimento — manda só o aceno
  // que diz ao servidor que a conexão está viva.
  acumulado += dt;
  let passos = 0;
  while (acumulado >= DT && passos < 5) {
    if (eu && telas.atual === 'jogo') {
      rede.passar(entrada.ler(centroNaTela));
      espia.comandos++;
    }
    acumulado -= DT;
    passos++;
  }
  if (passos === 5) acumulado = 0;
  if (!eu) rede.manterVivo();

  const tempo = agora / 1000;
  desenharMundo(ctx, arte, rede.arena, rede, camera, largura, altura, tempo, ajustes);

  if (estado && eu && estado.princesas.length === 2) {
    const dica = dicaDeUso(rede.arena, estado, eu);
    if (dica?.alvo) realce(ctx, vista, dica.alvo, tempo);
    if (dica) desenharDica(ctx, dica.texto, largura, altura, entrada.usandoToque);

    // A bússola aponta o que decide a partida: a sua princesa. Sem ela, quem
    // está no meio do mapa não sabe para onde correr quando o cortejo começa.
    const minha = princesaDe(estado, eu.time);
    if (minha.onde !== 'salva') bussola(ctx, vista, largura, altura, minha, '#ffd479');
  }

  if (estado) {
    for (const evento of rede.eventosNovos.splice(0)) {
      const linha = narrar(evento, estado, eu?.time ?? null);
      if (linha && ajustes.registro) rede.avisar(linha.texto, linha.cor);
    }
  }
  if (eu) desenharHud(ctx, rede, entrada, largura, altura, tempo, ajustes);
}

void comecarAAssistir();
requestAnimationFrame(laco);
