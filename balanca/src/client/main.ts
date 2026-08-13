import { carregarArte, type Arte } from './arte';
import { dicaDeUso } from './contexto';
import { bussola, criarCamera, desenharMundo, realce, seguir, vistaDe } from './desenho';
import { Entrada } from './entrada';
import { desenharDica, desenharHud, narrar } from './hud';
import { Rede } from './rede';
import { Telas } from './telas';
import { princesaDe } from '../shared/estado';
import { DT, TILE } from '../shared/regras';

/**
 * A montagem do cliente: telas, laço de quadro e a ponte entre eles.
 *
 * ## Dois relógios, de propósito
 *
 * O desenho corre no relógio da tela (`requestAnimationFrame`), que é o que o
 * monitor pode entregar. A simulação corre em passo fixo de `DT`, que é o que o
 * servidor entende. Misturar os dois — mandar um comando por quadro — faria o
 * jogador de 144 Hz mandar cinco vezes mais comandos que o de 30 Hz e andar mais
 * rápido que ele, o que é um bug de justiça, não de desempenho.
 *
 * ## Quatro telas, uma partida
 *
 * Menu → espera → escolha de lado → jogo. A escolha de lado não interrompe nada:
 * o `canvas` continua desenhando a partida por baixo dela, com a câmera no meio
 * do mapa, porque quem está escolhendo precisa ver onde vai entrar.
 *
 * ## Não existe modo de um jogador
 *
 * Sem tela de partida solo, sem treino contra bots — o servidor é o jogo. Se
 * você entrar sozinho, ele arruma companhia; se chegar gente, os bots cedem o
 * lugar. É a mesma partida em todos os casos, e é isso que faz o "multiplayer"
 * não ser um modo entre outros.
 */

const tela = document.querySelector<HTMLCanvasElement>('#tela')!;
const ctx = tela.getContext('2d')!;

const entrada = new Entrada(tela);
const camera = criarCamera();

let arte: Arte | null = null;
let rede: Rede | null = null;
let acumulado = 0;
let anterior = performance.now();
let carregandoArte = false;

const telas = new Telas({
  jogar: (nome) => void entrarNaBatalha(nome),
  escolher: (time) => rede?.escolherTime(time),
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

async function entrarNaBatalha(nome: string): Promise<void> {
  telas.mostrar('carregando');
  if (!arte && !carregandoArte) {
    carregandoArte = true;
    telas.carregou(0, 'carregando a arte…');
    arte = await carregarArte((feitos, total) => {
      telas.carregou((feitos / total) * 0.9, `carregando a arte… ${feitos}/${total}`);
    });
    carregandoArte = false;
  }
  telas.carregou(0.95, 'procurando uma partida…');
  rede = new Rede(enderecoDoServidor());
  rede.conectar(nome);
}

function voltarAoMenu(motivo: string): void {
  rede?.desconectar();
  rede = null;
  telas.mostrar('menu');
  telas.avisar(motivo);
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

  if (!rede || !arte) return;
  if (rede.fechado) {
    voltarAoMenu(rede.motivo ?? 'a conexão caiu — tente de novo');
    return;
  }

  const eu = rede.eu;
  const estado = rede.estado;

  // Espectador: a câmera fica no meio do mapa e a tela de escolha aparece por
  // cima da partida em curso.
  if (rede.arena && rede.espectador) {
    if (telas.atual !== 'escolha') telas.mostrar('escolha');
    telas.atualizarEscolha({
      porTime: rede.porTime,
      elenco: [...rede.elenco.values()],
      placar: estado?.placar ?? { azul: 0, vermelho: 0 },
      relogio: estado?.relogio ?? 0,
    });
    if (rede.motivo) telas.avisar(rede.motivo);
  } else if (rede.arena && eu && telas.atual !== 'jogo') {
    telas.mostrar('jogo');
  }

  const centroDoMapa = rede.arena
    ? { x: (rede.arena.largura * TILE) / 2, y: (rede.arena.altura * TILE) / 2 }
    : { x: 0, y: 0 };
  const alvoDaCamera = eu ?? centroDoMapa;
  if (rede.arena) seguir(camera, rede.arena, alvoDaCamera, largura, altura, ajustes);
  const vista = vistaDe(camera, largura, altura);
  const centroNaTela = { x: vista.paraTelaX(alvoDaCamera.x), y: vista.paraTelaY(alvoDaCamera.y) };

  // Passo fixo: um comando por `DT`, nem mais nem menos, independentemente da
  // taxa de quadros. Espectador não manda comando de movimento — mas manda o
  // pacote, que é o que diz ao servidor que a conexão está viva.
  acumulado += dt;
  let passos = 0;
  while (acumulado >= DT && passos < 5) {
    if (eu) {
      rede.passar(entrada.ler(centroNaTela));
      espia.comandos++;
    }
    acumulado -= DT;
    passos++;
  }
  if (passos === 5) acumulado = 0;
  if (!eu) rede.manterVivo();

  const tempo = agora / 1000;
  if (!rede.arena) {
    ctx.fillStyle = '#14161f';
    ctx.fillRect(0, 0, largura, altura);
    return;
  }
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

requestAnimationFrame(laco);
