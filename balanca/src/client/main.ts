import { canhaoDe, GRAMA } from '../shared/arena';
import { MAPA_PADRAO } from '../shared/mapas';
import { MODO_PADRAO } from '../shared/modos';
import { TILE } from '../shared/regras';
import { alvoDaAtracao, aproximar } from './atracao';
import { carregarArte, type Arte } from './arte';
import { dicaDeUso } from './contexto';
import {
  Porteiro,
  controlesLigados,
  fontesLivres,
  type IdDeFonte,
} from './controles';
import {
  bussola,
  criarCamera,
  desenharMundo,
  enquadrarGrupo,
  realce,
  seguir,
  vistaDe,
  COR_DA_VAGA,
} from './desenho';
import { Entrada } from './entrada';
import { desenharDica, desenharHud, narrar } from './hud';
import { Rede } from './rede';
import { PainelDaEquipe } from './equipe';
import { Minimapa } from './minimapa';
import { Particulas } from './particulas';
import { criarFiel, desenharVitrine, moverFiel } from './vitrine';
import { Sofa, type Porta } from './sofa';
import type { ConfiguracaoDeSala } from '../shared/protocolo';
import { Telas, type SalaAberta } from './telas';
import { bauDe, type Unidade, type VarianteDaInvasao } from '../shared/estado';
import { DT, type Time } from '../shared/regras';

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
 * ## Uma página, até quatro pessoas
 *
 * O jogo é de sofá além de ser de rede: cabem quatro num aparelho, cada uma com
 * o seu controle ou o seu canto do teclado, todas no mesmo time. Quem cuida
 * disso é o `Sofa`, e o que este arquivo faz é ligar as pontas — ouvir os
 * botões na cabine, mandar um comando por pessoa por passo, e enquadrar a
 * câmera de modo que os quatro caibam na tela.
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
 * Sem tela de partida solo, sem treino contra bots — o servidor é o jogo. O
 * "jogo local" é uma sala reservada ao aparelho, não uma simulação à parte: se
 * você entrar sozinho, ele arruma companhia; se chegar gente, os bots cedem o
 * lugar.
 */

const tela = document.querySelector<HTMLCanvasElement>('#tela')!;
const ctx = tela.getContext('2d')!;

const entrada = new Entrada(tela);
const porteiro = new Porteiro();
const camera = criarCamera();
const minimapa = new Minimapa();
const particulas = new Particulas();
const fiel = criarFiel();
/** Alvo suavizado da câmera do modo atração. */
let olhar = { x: 0, y: 0 };

let arte: Arte | null = null;
let rede: Rede | null = null;
let sofa: Sofa | null = null;
let acumulado = 0;
let anterior = performance.now();
/** Verdadeiro entre apertar "Jogar" e a partida começar. */
let querendoJogar = false;
/** A conexão de plateia está numa sala reservada, aberta para um jogo local. */
let salaReservada = false;

/**
 * O painel do time. Fala com a **anfitriã** do sofá — ver `atualizarPainelDaEquipe`.
 */
const painelDaEquipe = new PainelDaEquipe(document.querySelector<HTMLElement>('#equipe')!, {
  mandar: (alvo, classe, votar) => sofa?.jogadores[0]?.rede.mandar(alvo, classe, votar),
  votar: (classe) => sofa?.jogadores[0]?.rede.votarEm(classe),
});

const telas: Telas = new Telas({
  jogar: (porta, criar) => void montarOSofa(porta, criar),
  listarSalas: () => listarSalas(),
  assistir: (): void => telas.mostrar('plateia'),
  escolher: (time) => sofa?.escolherTime(time),
  desistir: () => desfazerOSofa(),
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

/**
 * Prepara a cabine: garante arte, garante a sala certa, e abre o sofá.
 *
 * Só o jogo **online** reaproveita a conexão de plateia. Ela já está numa sala
 * pública cheia de gente, que é exatamente onde ele quer entrar.
 *
 * As outras três portas querem outra sala — uma reservada ao aparelho, uma
 * montada com regras próprias, ou uma escolhida na lista — e ir a outra sala
 * exige outra conexão: a que existe já disse ao servidor onde queria estar, e
 * isso não se desdiz.
 */
async function montarOSofa(porta: Porta, criar?: ConfiguracaoDeSala): Promise<void> {
  querendoJogar = true;
  if (!arte) {
    telas.mostrar('carregando');
    telas.carregou(0.05, 'preparando o reino…');
    arte = await carregarArte();
  }

  const convite = telas.salaDoConvite;
  const precisaDeSalaNova = porta !== 'online' || !rede || rede.fechado;
  if (precisaDeSalaNova) {
    telas.mostrar('carregando');
    telas.carregou(0.5, RECADO_DA_PORTA[porta]);
    rede?.desconectar();
    rede = new Rede(enderecoDoServidor());
    rede.conectar(telas.preferencias.nome || 'Anônimo', true, {
      ...(porta === 'local' ? { privada: true } : {}),
      ...(porta === 'montada' && criar ? { criar } : {}),
      ...(porta === 'convidada' && convite ? { sala: convite } : {}),
    });
    // Toda sala que não é a pública do lobby precisa ser desfeita ao voltar ao
    // menu: lá o menu tem de mostrar de novo uma partida com gente, e não a
    // sala que estas linhas acabaram de abrir.
    salaReservada = porta !== 'online';
  }

  sofa = new Sofa(enderecoDoServidor(), rede!);
  porteiro.armar(entrada.teclasApertadas, controlesLigados());
  // A cabine só abre com a arena na mão: sem ela não há sala para as outras
  // conexões pedirem pelo nome, e sentar cedo demais espalharia a turma.
  if (rede!.arena) telas.mostrar('cabine');
}

/** O que a tela de espera diz, por porta. */
const RECADO_DA_PORTA: Record<Porta, string> = {
  local: 'abrindo a sala de vocês…',
  online: 'procurando uma partida…',
  montada: 'montando a sala com as suas regras…',
  convidada: 'entrando na sala escolhida…',
};

/**
 * Pergunta ao servidor quais salas estão abertas.
 *
 * Erro de rede não é tratado aqui: quem chamou é a tela, e é ela que sabe o que
 * escrever no lugar da lista. Engolir a falha e devolver uma lista vazia diria
 * "não há salas" quando a verdade é "não consegui perguntar" — duas coisas
 * diferentes para quem está esperando os amigos abrirem uma.
 */
async function listarSalas(): Promise<SalaAberta[]> {
  const base = location.port === '5173' ? `http://${location.hostname}:8787` : '';
  const resposta = await fetch(`${base}/salas`, { cache: 'no-store' });
  if (!resposta.ok) throw new Error(`servidor respondeu ${resposta.status}`);
  const corpo = (await resposta.json()) as { salas?: SalaAberta[] };
  return corpo.salas ?? [];
}

function desfazerOSofa(): void {
  querendoJogar = false;
  sofa?.levantar();
  sofa = null;
  // Desistir de um jogo local devolve o menu à sala pública. A sala reservada
  // que ficou para trás tem bot jogando para ninguém, e o menu voltaria a
  // mostrar exatamente aquilo que a atração existe para não mostrar: um jogo
  // sem gente.
  if (salaReservada) {
    salaReservada = false;
    rede?.desconectar();
    rede = new Rede(enderecoDoServidor());
    rede.conectar(telas.preferencias.nome || 'Anônimo', true);
  }
}

function voltarAoMenu(motivo: string): void {
  desfazerOSofa();
  telas.mostrar('menu');
  if (motivo) telas.avisar(motivo);
}

/** O nome de cada vaga. A primeira é de quem configurou o apelido. */
function nomeDaVaga(vaga: number): string {
  const base = telas.preferencias.nome.trim() || 'Anônimo';
  return vaga === 0 ? base : `Jogador ${vaga + 1}`;
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
  totem: () => rede?.estado?.totem ?? null,
  guardiao: () => rede?.estado?.guardiao ?? null,
  presa: () => rede?.estado?.presa ?? null,
  cajado: () => rede?.estado?.cajado ?? null,
  euXamaAte: () => sofa?.jogadores[0]?.rede.eu?.xamaAte ?? null,
  canhao: (time: Time) => (rede?.arena ? canhaoDe(rede.arena, time) : null),
  euEstou: () => (sofa?.jogadores[0]?.rede.eu ? { x: sofa.jogadores[0].rede.eu.x, y: sofa.jogadores[0].rede.eu.y } : null),
  ping: () => rede?.ping ?? null,
  sala: () => rede?.sala ?? null,
  sofa: () =>
    sofa?.jogadores.map((j) => ({
      vaga: j.vaga,
      fonte: j.fonte,
      nome: j.nome,
      id: j.rede.meuId,
      time: j.rede.eu?.time ?? null,
    })) ?? [],
};

/**
 * Qual partícula cada variante rara acende ao roubar — a comum não entra
 * aqui porque a dela só acende com chapéu de verdade em mãos, uma condição
 * que as raras não têm (a tocha e a bolota acendem mesmo de estoque vazio).
 */
const RECEITA_DA_VARIANTE_RARA: Readonly<
  Partial<Record<VarianteDaInvasao, 'incendio' | 'saqueDeLonge'>>
> = {
  tocha: 'incendio',
  slingshot: 'saqueDeLonge',
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

  const estado = rede?.estado ?? null;
  // Quem está em campo, deste aparelho, em ordem de vaga. É a lista que decide
  // câmera, HUD e se a partida já começou para o sofá. O par carrega a vaga
  // junto porque um jogador morto e outro que ainda não nasceu deixam buracos:
  // usar a posição na lista como número da vaga trocaria a cor de todo mundo.
  const emCampo: { vaga: number; unidade: Unidade }[] = [];
  for (const j of sofa?.jogadores ?? []) {
    if (j.rede.eu) emCampo.push({ vaga: j.vaga, unidade: j.rede.eu });
  }

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
  if (rede?.fechado && (emCampo.length > 0 || querendoJogar)) {
    voltarAoMenu(rede.motivo ?? 'a conexão caiu — tente de novo');
    rede = null;
  }

  // A cabine estava esperando a arena da sala nova para poder abrir.
  if (querendoJogar && sofa && rede?.arena && telas.atual === 'carregando') {
    telas.mostrar('cabine');
  }
  if (telas.montandoOSofa && sofa) atenderACabine(sofa);

  if (telas.atual === 'escolha' && sofa) {
    telas.atualizarEscolha({
      porTime: rede?.porTime ?? 0,
      elenco: [...(rede?.elenco.values() ?? [])],
      placar: estado?.placar ?? { azul: 0, vermelho: 0 },
      relogio: estado?.relogio ?? 0,
      quantosLocais: sofa.quantosLocais,
      modo: rede?.modo ?? MODO_PADRAO,
      mapa: rede?.mapa ?? MAPA_PADRAO,
    });
    const recusa = sofa.recusa;
    if (recusa) {
      // Sofá partido: uns entraram, outros não. Quem ficou de fora desce, e o
      // jogo começa com quem coube — travar a tela para todos seria pior.
      const deixados = sofa.dispensarRecusados();
      telas.avisarNaEscolha(
        deixados > 0 ? `${deixados} de vocês não coube neste lado: ${recusa}` : recusa,
      );
    }
  }
  if (sofa?.todosEmCampo && telas.atual !== 'jogo') {
    querendoJogar = false;
    telas.mostrar('jogo');
  }

  if (!arte || !rede?.arena) {
    ctx.fillStyle = '#14161f';
    ctx.fillRect(0, 0, largura, altura);
    return;
  }

  // --- câmera ------------------------------------------------------------
  //
  // Jogando, ela enquadra **todo mundo do sofá** e abre o quanto for preciso
  // para caber. Sem ninguém em campo — menu, plateia, cabine, escolha de lado
  // —, ela persegue o que decide a partida, com atraso, como a câmera de um
  // replay de esporte.
  const posicoes = emCampo.map((p) => sofa!.posicaoDe(p.unidade, agora));
  let foraDeQuadro: number[] = [];
  if (emCampo.length > 0) {
    foraDeQuadro = enquadrarGrupo(camera, rede.arena, posicoes, largura, altura, ajustes);
  } else {
    const alvo = alvoDaAtracao(estado, rede.arena.largura, rede.arena.altura);
    if (olhar.x === 0 && olhar.y === 0) olhar = { x: alvo.x, y: alvo.y };
    olhar = aproximar(olhar, alvo, dt);
    seguir(camera, rede.arena, olhar, largura, altura, ajustes);
    // Na atração a vista abre um pouco: quem está lendo o menu quer ver a briga
    // inteira, não o cotovelo de um guerreiro.
    camera.zoom *= 0.9;
  }
  const vista = vistaDe(camera, largura, altura);

  // Passo fixo: um comando por `DT`, nem mais nem menos, independentemente da
  // taxa de quadros. Plateia não manda comando de movimento — manda só o aceno
  // que diz ao servidor que a conexão está viva.
  acumulado += dt;
  let passos = 0;
  const centros = new Map<number, { x: number; y: number }>();
  for (const [i, p] of emCampo.entries()) {
    const pos = posicoes[i]!;
    centros.set(p.vaga, { x: vista.paraTelaX(pos.x), y: vista.paraTelaY(pos.y) });
  }
  while (acumulado >= DT && passos < 5) {
    if (sofa && telas.atual === 'jogo') {
      sofa.passar(entrada, centros);
      espia.comandos++;
    }
    acumulado -= DT;
    passos++;
  }
  if (passos === 5) acumulado = 0;
  // Fora da partida, todas as conexões precisam acenar para não serem
  // derrubadas enquanto alguém lê a tela de escolha.
  if (telas.atual !== 'jogo') {
    rede.manterVivo();
    for (const j of sofa?.jogadores ?? []) j.rede.manterVivo();
  }

  const tempo = agora / 1000;
  // Os efeitos são colhidos **antes** de desenhar, para o estouro de uma troca
  // de chapéu aparecer no mesmo quadro em que o boneco já mudou de folha.
  const arena = rede.arena;
  if (estado && arena) {
    particulas.colher(estado, arte, tempo);
    // A poeira dos pés é do cliente e só vale para quem está na tela: a
    // câmera é conhecida aqui, e é aqui que ela vira o corte.
    const meiaL = largura / 2 / camera.zoom + TILE;
    const meiaA = altura / 2 / camera.zoom + TILE;
    particulas.pisadas(
      estado,
      arte,
      tempo,
      (x, y) => Math.abs(x - camera.x) < meiaL && Math.abs(y - camera.y) < meiaA,
      (x, y) => arena.tile(Math.floor(x / TILE), Math.floor(y / TILE)) !== GRAMA,
    );
  }
  desenharMundo(
    ctx,
    arte,
    rede.arena,
    sofa ?? rede,
    camera,
    largura,
    altura,
    tempo,
    ajustes,
    particulas,
  );

  const eu = emCampo[0]?.unidade ?? null;
  if (estado && eu && estado.baus.length === 2) {
    const dica = dicaDeUso(rede.arena, estado, eu);
    if (dica?.alvo) realce(ctx, vista, dica.alvo, tempo);
    if (dica) desenharDica(ctx, dica.texto, largura, altura, entrada.usandoToque);

    // A bússola aponta o que decide a partida: a seu baú. Sem ela, quem
    // está no meio do mapa não sabe para onde correr quando o cortejo começa.
    const minha = bauDe(estado, eu.time);
    if (minha.onde !== 'resgatado') bussola(ctx, vista, largura, altura, minha, '#ffd479');
  }
  // Quem do sofá saiu de quadro ganha uma seta na cor da sua vaga: a câmera já
  // abriu o que podia, e daqui em diante é mais honesto apontar do que
  // encolher o jogo até ninguém enxergar nada.
  for (const i of foraDeQuadro) {
    const vaga = emCampo[i]!.vaga;
    bussola(ctx, vista, largura, altura, posicoes[i]!, COR_DA_VAGA[vaga % COR_DA_VAGA.length]!);
  }

  if (estado) {
    // Um time por tick, não um por goblin — quando o time inteiro é
    // afugentado no mesmo tick (o normal: todo mundo converge para a mesma
    // chapelaria), cada goblin dispara o próprio evento, e um `Set` é o que
    // impede cinco resquícios empilhados no lugar de um.
    const ondaRepelida = new Set<Time>();
    for (const evento of rede.eventosNovos.splice(0)) {
      const linha = narrar(evento, estado, eu?.time ?? null);
      if (linha && ajustes.registro) rede.avisar(linha.texto, linha.cor, linha.icone);
      // A obra é o único acontecimento cujo lugar não é uma unidade: ela sobe
      // no prédio, e é lá que o estouro tem de nascer.
      if (evento.tipo === 'nivel') {
        const chapelaria = rede.arena.estrutura('chapelaria', evento.time);
        particulas.obraSubiu(arte, chapelaria.x, chapelaria.y, tempo, evento.time, evento.nivel);
      }
      // O roubo e a fuga também não são de uma unidade — são da chapelaria
      // que perdeu (ou não) o chapéu. Reaproveita as folhas do furto e do
      // saque: são o mesmo gesto, só que na porta do prédio em vez de em
      // cima de gente.
      if (evento.tipo === 'invasaoRoubou') {
        const chapelaria = rede.arena.estrutura('chapelaria', evento.time);
        // A tocha e a bolota acendem mesmo quando o estoque estava vazio —
        // é a onda chegando que faz a cena, não o que ela consegue levar.
        const receitaRara = RECEITA_DA_VARIANTE_RARA[evento.variante];
        if (receitaRara) {
          particulas.acender(arte, receitaRara, chapelaria.x, chapelaria.y, tempo);
        } else if (evento.classe !== null) {
          particulas.acender(arte, 'roubo', chapelaria.x, chapelaria.y, tempo);
        }
      }
      if (evento.tipo === 'guardiaoCaiu') {
        particulas.acender(arte, 'guardiaoCaiu', evento.x, evento.y, tempo);
      }
      if (evento.tipo === 'presaCaiu') {
        particulas.acender(arte, 'presaCaiu', evento.x, evento.y, tempo);
      }
      if (evento.tipo === 'invasaoAfugentada') {
        const chapelaria = rede.arena.estrutura('chapelaria', evento.time);
        particulas.acender(arte, 'saque', chapelaria.x, chapelaria.y, tempo);
        if (!estado.invasores.some((inv) => inv.time === evento.time)) {
          ondaRepelida.add(evento.time);
        }
      }
    }
    for (const time of ondaRepelida) {
      const chapelaria = rede.arena.estrutura('chapelaria', time);
      particulas.acender(arte, 'trollCaido', chapelaria.x, chapelaria.y, tempo);
    }
  }
  if (emCampo.length > 0) {
    desenharHud(ctx, rede, emCampo, entrada, largura, altura, tempo, ajustes, arte);
    // O minimapa é desenhado daqui, e não de dentro do HUD, porque precisa da
    // câmera: o retângulo do que está na tela é metade do que ele serve, e a
    // câmera é coisa deste arquivo.
    if (ajustes.minimapa && rede.estado) {
      minimapa.desenhar(ctx, rede.arena, rede.estado, emCampo[0]!.unidade.time, {
        x: camera.x,
        y: camera.y,
        largura: largura / camera.zoom,
        altura: altura / camera.zoom,
      }, largura);
    }
  }

  // A balança do menu vem por último: ela é desenho por cima de tudo, e só
  // existe enquanto ninguém está jogando.
  if (telas.atual === 'menu') {
    moverFiel(fiel, estado, dt);
    const coluna = document.querySelector<HTMLElement>('#menu .coluna');
    desenharVitrine(
      ctx,
      fiel,
      estado,
      largura,
      altura,
      coluna?.getBoundingClientRect().width ?? 0,
      tempo,
    );
  }

  atualizarPainelDaEquipe(rede, emCampo, telas.atual === 'jogo', agora);
}

/**
 * O painel do time, ligado só durante a partida.
 *
 * A anfitriã é quem manda e quem recebe a votação: com quatro pessoas no mesmo
 * aparelho, quatro conexões receberiam quatro cópias da mesma urna e quatro
 * cliques abririam quatro votações. Uma tela, uma voz — a da primeira vaga.
 */
function atualizarPainelDaEquipe(
  rede: Rede,
  emCampo: readonly { vaga: number; unidade: Unidade }[],
  emJogo: boolean,
  agora: number,
): void {
  if (!emJogo || emCampo.length === 0) {
    painelDaEquipe.esconder();
    return;
  }
  const primeira = emCampo[0]!.unidade;
  const minhaFicha = rede.elenco.get(primeira.id);
  const recadoNovo =
    rede.recadoDoTime && agora - rede.recadoDoTime.quando < 8000 ? rede.recadoDoTime.texto : null;

  painelDaEquipe.atualizar({
    time: primeira.time,
    estado: rede.estado,
    elenco: [...rede.elenco.values()],
    meus: emCampo.map((c) => c.unidade.id),
    souLider: minhaFicha?.lider === true,
    votacao: rede.votacao,
    recado: recadoNovo,
  });
}

/**
 * Ouve os controles enquanto a cabine está aberta.
 *
 * Roda por quadro porque a lista de controles muda por fora: quem chega com o
 * controle na mão e o pluga no meio da tela precisa ver a vaga abrir na hora.
 */
function atenderACabine(sofa: Sofa): void {
  const pads = controlesLigados();
  const ocupadas = new Set<IdDeFonte>(sofa.jogadores.map((j) => j.fonte));
  const novo = porteiro.quemEntrou(entrada.teclasApertadas, pads, ocupadas);
  if (novo) {
    const jogador = sofa.sentar(novo, nomeDaVaga(sofa.quantosLocais));
    if (jogador) ocupadas.add(jogador.fonte);
  }
  telas.atualizarCabine({
    sentados: sofa.jogadores.map((j) => ({ vaga: j.vaga, nome: j.nome, fonte: j.fonte })),
    livres: fontesLivres(pads, ocupadas),
  });
}

void comecarAAssistir();
requestAnimationFrame(laco);
