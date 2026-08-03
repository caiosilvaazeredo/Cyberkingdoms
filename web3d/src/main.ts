import * as THREE from 'three';

import { DensityField } from './render/density';
import { FOG_DENSITY } from './render/grass';
import { QualityGovernor, guessTier } from './render/quality';
import { CityCamera } from './render/cityCamera';
import {
  CHUNK_METERS,
  createStreamingWorld,
  type StreamingWorld,
} from './render/streaming';
import { TILE, createPlotView, type PlotView } from './render/plotView';
import { GestureRecognizer } from './render/touch';
import type { VillageBounds } from './render/villageBounds';
import { biomeDef } from './world/biome';
import { TileCoord } from './world/coords';
import { plotAreaFor } from './world/plotArea';
import type { PlacedBuilding } from './building/plot';
import { DayClock, formatDays } from './campaign/dayClock';
import type { Campaign } from './campaign/campaign';
import { runDailyTick } from './campaign/dailyTick';
import { QuestLog, objectiveLabel, objectiveProgress } from './campaign/quest';
import { resolveUpkeep, type DailyActivity } from './survival/dailyActivity';
import { workById } from './survival/survival';
import {
  STUDY_UPKEEP,
  allCertificates,
  allProfessions,
  canEnrol,
  canPractise,
  certificateDef,
  dailyWage,
  professionForWork,
  type Certificate,
} from './career/profession';
import {
  allBuildings,
  buildingsAvailableAt,
  type CitizenLevel,
} from './building/buildingType';
import { describeBuilding, shortFacts } from './building/describe';
import { createCityPanel, type CityPanel } from './ui/cityPanel';
import { settings } from './net/settings';

/**
 * O mundo do CyberKingdoms em três dimensões.
 *
 * A geração é a **mesma** do cliente Flutter — mesmo RNG, mesmo ruído, mesmos
 * limiares de bioma, verificado tile a tile em `test/determinism.test.ts`. O
 * que muda é como o mundo é desenhado: lá, sprites isométricos; aqui, relevo
 * contínuo com grama instanciada.
 *
 * **Mobile-first continua valendo depois da troca de motor.** O aparelho de
 * referência é um celular mediano, não um desktop: o orçamento de render se
 * mede sozinho e se ajusta (`render/quality.ts`), os controles são gestos e
 * não atalhos de teclado (`render/touch.ts`), e o laço para quando a aba sai
 * de vista, porque render em segundo plano é bateria queimada por nada.
 */

const FOG_COLOR = 0x8fa6b8;

/**
 * Quantos resets automáticos cabem num quadro.
 *
 * Uma campanha parada por meses acumularia centenas de viradas, e rodá-las de
 * uma vez travaria a aba justamente na volta do jogador. Espalhadas por quadros,
 * ela alcança o presente em alguns segundos com a tela respondendo.
 */
const MAX_TICKS_POR_QUADRO = 3;

/** Teto de velocidade a pé, em metros por segundo. */
const VELOCIDADE_MAX = 14;

/** Vento padrão do campo. Desligá-lo zera a força, não a direção. */
const VENTO_DIRECAO = new THREE.Vector2(1, 0.35);
const VENTO_FORCA = 0.22;

export interface WorldHandle {
  readonly canvas: HTMLCanvasElement;
  readonly campaign: Campaign;
}

export interface BootOptions {
  /** Chamado sempre que o estado muda o bastante para valer um save. */
  readonly onPersist?: (campaign: Campaign) => void;
}

/**
 * Monta a cena para uma campanha já criada.
 *
 * Antes recebia só o rótulo da seed e inventava um personagem com crédito e
 * inventário de teste. Agora o mundo, o terreno, o dinheiro, a fome e as quests
 * são os da campanha de verdade — e o botão de encerrar o dia roda o reset
 * inteiro (`runDailyTick`), não só a produção do terreno.
 */
export function bootWorld(campaign: Campaign, options: BootOptions = {}): WorldHandle {
  const canvas = document.querySelector<HTMLCanvasElement>('#viewport')!;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    // Antialias custa caro em GPU integrada e o campo de grama já é ruidoso o
    // bastante para disfarçar a serrilha. Só nos aparelhos que sobram.
    antialias: guessTier() === 'alto',
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
  });
  renderer.setClearColor(FOG_COLOR);

  const scene = new THREE.Scene();
  // Neblina bem mais leve do que num mundo fechado.
  //
  // 0,0085 escondia metade da cor a cem metros, o que era aceitável quando o
  // jogo cabia num lote de 40 m — ali a neblina só disfarçava a borda do
  // trecho. Num mundo que se atravessa a pé ela virava um véu cinza sobre tudo,
  // e o bioma para onde o jogador estava andando chegava lavado antes de ele
  // chegar. Agora são 15% a cem metros: ainda dá profundidade, e ainda esconde
  // a borda do terreno carregado, sem apagar a paisagem.
  scene.fog = new THREE.FogExp2(FOG_COLOR, FOG_DENSITY);

  const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 900);

  scene.add(new THREE.HemisphereLight(0xd8ecff, 0x4a5236, 1.5));
  const sun = new THREE.DirectionalLight(0xfff2dc, 2.1);
  sun.position.set(60, 90, 40);
  scene.add(sun);

  const world = campaign.world.generator;
  const character = campaign.character;
  const plot = campaign.plot;
  const inventario = character.inventory;

  /**
   * Onde o lote cai no mundo 3D.
   *
   * O terreno é indexado em **tiles de jogo**, e o renderizador em **metros**.
   * Uma célula de construção vale `TILE` metros, então o lote ocupa
   * `width * TILE` metros de mundo a partir da origem que a campanha reservou —
   * dentro da capital, deslocado do centro para não cobrir mercado e governo.
   */
  const larguraMundo = plot.width * TILE;
  const profundidadeMundo = plot.height * TILE;
  const lote = {
    x: plot.origin.x + larguraMundo / 2,
    z: plot.origin.y + profundidadeMundo / 2,
  };

  // O lote impõe o próprio chão, para que nenhum trecho de Água Morta caia
  // dentro do tabuleiro virando mancha pelada num cenário sem relevo.
  const plotArea = plotAreaFor(world, lote.x, lote.z, larguraMundo, profundidadeMundo);

  const density = new DensityField(world, plotArea);
  let mundo: StreamingWorld | null = null;
  const center = new THREE.Vector2(lote.x, lote.z);

  /**
   * Metros andados no dia, para o reset cobrar a viagem.
   *
   * Andar até outra cidade não pode ser de graça só porque o jogador fez a pé
   * em vez de pelo menu. A conversão usa a mesma régua da malha viária —
   * ~90 tiles por dia de viagem — então caminhar o equivalente a uma estrada
   * custa o mesmo que percorrê-la.
   */
  let metrosAndados = 0;

  let plotView: PlotView | null = null;
  let selecionada: string | null = null;

  /**
   * O que o jogador escolheu fazer hoje.
   *
   * `null` é dia ocioso, e ocioso **também** custa: a base de Fome e Sede é
   * cobrada por existir. Guardar a escolha até o reset — em vez de aplicar na
   * hora — é o que permite trocar de ideia durante o dia, que é como o jogo
   * pensa o tempo: o dia é uma decisão, o reset é a consequência.
   */
  let atividadeEscolhida: DailyActivity | null = null;
  const atividadeDoDia = (): DailyActivity => atividadeEscolhida ?? {};

  /**
   * O painel da cidade atual.
   *
   * Declarado aqui e montado lá embaixo porque quem o abre — a chegada numa
   * cidade, em `seguirCamera` — é definido antes das dependências que ele
   * precisa (o painel de trabalho e o de recursos).
   */
  let cidadePainel: CityPanel | null = null;

  /**
   * O nível que vale para encaixar uma construção.
   *
   * No modo Dev, `elite` — senão o catálogo liberaria a refinaria e o encaixe
   * a recusaria em seguida, que é a pior combinação: o jogo oferece e nega.
   */
  const nivelParaConstruir = (): CitizenLevel =>
    prefs.current.devMode ? 'elite' : character.level;

  // Limite da vila: o centro é o lote, e o vizinho é a cidade mais próxima que
  // não é a do jogador — é para ela que o aviso de borda aponta.
  const cidade = campaign.world.layout.byId(plot.settlementId);
  const vizinha = campaign.world.layout.settlements.find(
    (s) => s.id !== plot.settlementId,
  );
  /**
   * O limite da vila deixou de ser parede.
   *
   * Ele existia para conter a câmera no lote e avisar "Acesso a Krom Central".
   * Agora o jogador **anda** até Krom Central, então o limite vira o que
   * sempre deveria ter sido: o contorno do que é dele. O terreno e a grama
   * recebem `null` no lugar dele — cinza no mundo inteiro seria dizer que o
   * mapa todo é dos outros.
   */
  void cidade;
  void vizinha;
  const bounds: VillageBounds | null = null;
  let enquadrado = false;

  /** Onde o mundo foi carregado pela última vez. */
  const carregadoEm = new THREE.Vector2(lote.x, lote.z);

  /**
   * Se vale pedir mais pedaços.
   *
   * Meio pedaço de folga: chamar a cada quadro faria a varredura do conjunto
   * carregado virar custo fixo do laço, e o resultado só muda quando a câmera
   * anda de verdade.
   */
  function precisaCarregar(): boolean {
    return center.distanceTo(carregadoEm) > CHUNK_METERS * 0.5;
  }

  // As preferências valem desde o primeiro quadro, inclusive a de qualidade —
  // é ela que decide o orçamento com que a cena é montada.
  const prefs = settings();
  const governor = new QualityGovernor(
    prefs.current.quality === 'auto' ? guessTier() : prefs.current.quality,
    () => {
      applyResolution();
      rebuild();
    },
  );
  governor.setLocked(prefs.current.quality === 'auto' ? null : prefs.current.quality);

  // Câmera de construtor de cidade: o alvo é um ponto do terreno, o dedo
  // arrasta o chão, e a inclinação sobe junto com o afastamento.
  const view = new CityCamera(camera, (x, z) => world.heightAt(x, z));

  function applyResolution(): void {
    const budget = governor.budget;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, budget.pixelRatio));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }

  const placeCamera = (): void => view.apply();

  function rebuild(): void {
    const budget = governor.budget;

    // O enquadramento inicial mira o **lote**, não o trecho de grama: o que o
    // jogador quer ver ao entrar é o terreno dele. Antes a distância vinha do
    // orçamento de render, e num lote de 40 m a tela inteira caía dentro da
    // cerca — não dava para saber onde o terreno começava ou acabava.
    if (!enquadrado) {
      // Enquadrar o lote é um problema de duas dimensões, e a errada mandava.
      //
      // O campo de visão declarado é o **vertical**; o horizontal sai dele pela
      // proporção da tela. Num celular em retrato a proporção é ~0,46, então a
      // largura visível é menos da metade da altura — e uma conta feita só pela
      // altura deixava a tela inteira dentro da cerca, sem nenhuma borda à
      // vista. Quem decide é o eixo mais apertado, que é o que exige mais
      // distância.
      //
      // A meta é o **lado** do lote, e não a diagonal: com o giro de 0,7 rad o
      // terreno entra como losango, e enquadrar a diagonal inteira num celular
      // empurraria a câmera para o limite do zoom logo na abertura — o vilarejo
      // viraria mapa antes de o jogador ver que é um vilarejo.
      const meta = plot.height * TILE * 1.05;
      const tanV = Math.tan((camera.fov * Math.PI) / 360);
      const aspecto = Number.isFinite(camera.aspect) && camera.aspect > 0
        ? camera.aspect
        : 1;
      const porAltura = meta / (2 * tanV);
      const porLargura = meta / (2 * tanV * aspecto);

      view.distance = Math.min(
        view.limits.maxDistance,
        Math.max(view.limits.minDistance, porAltura, porLargura),
      );
      enquadrado = true;
    }

    // O mundo é carregado em pedaços, conforme a câmera anda — ver
    // `render/streaming.ts`. Trocar de orçamento descarta tudo e refaz, porque
    // o número de lâminas por pedaço muda junto.
    if (!mundo) {
      mundo = createStreamingWorld({
        world,
        density,
        budget,
        bounds,
        plotArea,
        viewDistance: view.distance,
        windDirection: VENTO_DIRECAO,
        windStrength: prefs.current.wind ? VENTO_FORCA : 0,
      });
      scene.add(mundo.group);
    } else {
      mundo.clear();
    }
    // Uma leva de pedaços já na montagem, para o jogador não cair num vazio
    // que se preenche na frente dele.
    for (let i = 0; i < 25; i++) {
      if (!mundo.update(center.x, center.y, { budget, viewDistance: view.distance })) {
        break;
      }
    }

    if (!plotView) {
      plotView = createPlotView(plot, lote.x, lote.z);
      scene.add(plotView.group);
      plotView.sync(plot);
    }
    carregadoEm.copy(center);
    view.focusOn(center.x, center.y);

    report();
    placeCamera();
  }

  function report(): void {
    const biome = biomeDef(density.biomes.at(center.x, center.y));
    const el = document.querySelector<HTMLElement>('#readout');
    if (!el) return;
    el.hidden = !prefs.current.showStats;
    el.textContent =
      `${biome.label} · ${(mundo?.bladeCount ?? 0).toLocaleString('pt-BR')} lâminas` +
      ` · ${mundo?.loadedCount ?? 0} pedaços · ${governor.tier}${governor.isLocked ? ' (fixo)' : ''}`;
  }

  /**
   * Aplica as preferências à cena que já existe.
   *
   * O mundo fica montado enquanto o jogador vai ao menu e volta, então uma
   * mudança feita nas configurações precisa alcançar uma cena viva. Ler as
   * preferências só na montagem faria o ajuste só valer na próxima abertura do
   * jogo — que é o mesmo que não valer.
   */
  function aplicarPreferencias(): void {
    const s = prefs.current;
    // O catálogo muda de tamanho com o modo Dev, então precisa ser refeito.
    montarCatalogo();
    governor.setLocked(s.quality === 'auto' ? null : s.quality);
    mundo?.setWind(VENTO_DIRECAO, s.wind ? VENTO_FORCA : 0);
    report();
  }

  prefs.subscribe(aplicarPreferencias);

  // ------------------------------------------------------- barra de recursos
  //
  // Dinheiro, prazo e vitais decidem toda jogada, e nenhum deles aparecia em
  // lugar nenhum: o jogador escolhia uma construção sem saber se tinha crédito,
  // via uma obra começar sem saber quando acabava, e passava fome sem sinal.
  const valorDe = (id: string): HTMLElement | null =>
    document.querySelector<HTMLElement>(`${id} .valor`);
  const elCreditos = valorDe('#rec-creditos');
  const elDia = valorDe('#rec-dia');
  const elVitais = valorDe('#rec-vitais');
  const boxVitais = document.querySelector<HTMLElement>('#rec-vitais');
  const elObras = valorDe('#rec-obras');
  const questsEl = document.querySelector<HTMLElement>('#quests');
  const diarioEl = document.querySelector<HTMLElement>('#diario');

  function atualizarRecursos(): void {
    if (elCreditos) elCreditos.textContent = character.credits.toLocaleString('pt-BR');
    if (elDia) elDia.textContent = `dia ${campaign.day}`;

    if (elVitais) {
      elVitais.textContent = `${character.hunger}/${character.thirst}`;
    }
    // A cor entra só quando há motivo — um HUD sempre vermelho é um HUD que
    // ninguém lê. O limiar é o mesmo em que a tabela do GDD começa a tirar HP.
    const apertado = Math.min(character.hunger, character.thirst) <= 25;
    boxVitais?.classList.toggle('urgente', apertado);

    const obras = plot.buildings.filter((b) => !b.isReady);
    if (elObras) {
      if (obras.length === 0) {
        elObras.textContent = 'sem obras';
      } else {
        const prazo = Math.min(...obras.map((b) => b.daysRemaining));
        elObras.textContent = `${obras.length} · ${formatDays(prazo)}`;
      }
    }

    atualizarQuests();
  }

  /**
   * A quest atual e o progresso dos objetivos dela.
   *
   * Uma só, e não a lista inteira: dezessete metas num painel de celular viram
   * parede de texto que ninguém lê. A lista completa cabe numa tela própria; o
   * HUD mostra o que fazer agora.
   */
  function atualizarQuests(): void {
    if (!questsEl) return;
    const log = new QuestLog(campaign);
    const atual = log.current;

    if (!atual) {
      questsEl.innerHTML =
        '<strong>Campanha concluída</strong><span>Todas as metas fecharam.</span>';
      return;
    }

    const linhas = atual.objectives
      .map((o) => {
        const { current, target } = objectiveProgress(o, campaign);
        const feito = current >= target;
        return `<span class="${feito ? 'feito' : ''}">${feito ? '✓' : '·'} ${objectiveLabel(o)} (${current}/${target})</span>`;
      })
      .join('');

    questsEl.innerHTML =
      `<strong>${atual.title}</strong>` +
      `<em>${atual.briefing}</em>` +
      linhas +
      `<span class="progresso">${log.completed.length}/${log.completed.length + log.active.length + log.locked.length} concluídas</span>`;
  }

  function atualizarDiario(eventos: readonly string[]): void {
    if (!diarioEl) return;
    diarioEl.innerHTML = eventos.length
      ? eventos.map((e) => `<span>${e}</span>`).join('')
      : '<span>Dia sem novidade.</span>';
  }

  /**
   * Encerra o dia: roda o reset inteiro da campanha.
   *
   * Antes isto rodava só `runPlotTick` — obras e manutenção. Agora passa pelo
   * mesmo `runDailyTick` que o servidor vai rodar: fome, sede, combate de
   * estrada, salário, eleição, promoção e quests. Ter dois caminhos para o
   * mesmo reset seria abrir a porta para a divergência que o jogador explora.
   */
  /**
   * Converte o que foi andado em trechos de viagem.
   *
   * A malha viária usa ~90 tiles por dia de viagem; a caminhada usa a mesma
   * régua, então atravessar a pé o equivalente a uma estrada custa o mesmo que
   * percorrê-la. Sem isso, andar seria o jeito grátis de viajar e o sistema de
   * estradas viraria enfeite.
   */
  function trechosAndados(): number {
    return Math.floor(metrosAndados / 90);
  }

  function virarODia(): void {
    const relatorio = runDailyTick(campaign, {
      ...atividadeDoDia(),
      roadsTravelled: trechosAndados(),
    });
    metrosAndados = 0;
    // A escolha **não** zera: ela é ordem permanente até o jogador trocar.
    // Zerando, ele teria de reabrir o painel de trabalho todo reset só para
    // repetir o mesmo emprego — e emprego que exige reconfirmação diária não é
    // emprego, é tarefa.
    plotView?.sync(plot);
    atualizarRecursos();
    atualizarDiario(relatorio.events);
    // O reset move tesouro, salário e livro de ofertas. Com o painel aberto,
    // o jogador estaria olhando os preços de ontem.
    cidadePainel?.refresh();
    options.onPersist?.(campaign);

    if (statusEl) {
      statusEl.textContent =
        relatorio.events[relatorio.events.length - 1] ?? `Dia ${relatorio.day} fechado.`;
    }
  }

  // ---------------------------------------------------------------- entrada
  const aviso = document.querySelector<HTMLElement>('#aviso');
  const avisoTitulo = document.querySelector<HTMLElement>('#aviso-titulo');
  const avisoTexto = document.querySelector<HTMLElement>('#aviso-texto');
  let avisoVisivel = false;

  /**
   * Onde o jogador está, para anunciar entrada e saída de cidade.
   *
   * O aviso trocou de papel junto com o limite: antes ele dizia "você não pode
   * passar daqui", agora diz "você chegou". A mesma caixa, o oposto da
   * mensagem — e é a diferença entre um mapa cercado e um mapa que se percorre.
   */
  let cidadeAtual: string | null = campaign.currentSettlementId;
  let avisoAte = 0;

  function anunciar(titulo: string, texto: string, segundos = 4): void {
    if (avisoTitulo) avisoTitulo.textContent = titulo;
    if (avisoTexto) avisoTexto.textContent = texto;
    aviso?.classList.add('visivel');
    avisoVisivel = true;
    avisoAte = performance.now() + segundos * 1000;
  }

  function esconderAviso(): void {
    if (!avisoVisivel) return;
    avisoVisivel = false;
    aviso?.classList.remove('visivel');
  }

  /**
   * Segue a câmera com o personagem.
   *
   * A posição do personagem é o que decide em que cidade ele está, que mercado
   * ele vê e que governo paga o salário dele. Deixá-la parada enquanto a câmera
   * atravessa o mapa faria o jogador andar até outra capital e continuar
   * trabalhando na primeira.
   */
  function seguirCamera(): void {
    const antes = character.position;
    const x = Math.round(view.target.x);
    const z = Math.round(view.target.z);
    if (antes.x === x && antes.y === z) return;

    metrosAndados += Math.hypot(x - antes.x, z - antes.y);
    character.position = new TileCoord(x, z);

    const agora = campaign.currentSettlementId;
    if (agora === cidadeAtual) return;

    cidadeAtual = agora;
    sincronizarBotaoCidade();
    if (agora) {
      const s = campaign.world.layout.byId(agora);
      const nova = !campaign.visitedSettlements.has(agora);
      campaign.visitedSettlements.add(agora);
      if (s) {
        anunciar(
          `${nova ? 'Descoberta: ' : ''}${s.name}`,
          `${s.vocationDef.label} · ${s.population.toLocaleString('pt-BR')} habitantes · ` +
            `${s.publicJobSlots} vagas públicas. Toque em ENTRAR para o mercado.`,
        );
      }
      if (nova) options.onPersist?.(campaign);
    } else {
      anunciar('Fora da cidade', 'Estrada aberta. Aqui não há mercado nem governo.', 3);
    }
  }

  const raycaster = new THREE.Raycaster();
  const ponteiro = new THREE.Vector2();
  const planoChao = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const alvo = new THREE.Vector3();
  const statusEl = document.querySelector<HTMLElement>('#status-obra');

  /** Ponto do chão sob um ponto de tela, ou `null`. */
  function chaoEm(clientX: number, clientY: number): THREE.Vector3 | null {
    ponteiro.set(
      (clientX / window.innerWidth) * 2 - 1,
      -(clientY / window.innerHeight) * 2 + 1,
    );
    raycaster.setFromCamera(ponteiro, camera);
    // Intersecção com o plano do chão, e não com a malha de terreno: o plano
    // é exato e não depende da densidade de vértices, e o cenário é liso.
    return raycaster.ray.intersectPlane(planoChao, alvo) ? alvo : null;
  }

  /** Célula da grade sob um ponto de tela, ou `null`. */
  function celulaEm(clientX: number, clientY: number) {
    const p = chaoEm(clientX, clientY);
    if (!p) return null;
    return plotView?.cellAt(p.x, p.z) ?? null;
  }

  function atualizarFantasma(clientX: number, clientY: number): void {
    if (!selecionada || !plotView) return;
    const celula = celulaEm(clientX, clientY);
    if (!celula) {
      plotView.showGhost(null, 0, 0, false);
      if (statusEl) statusEl.textContent = 'Fora do terreno.';
      return;
    }
    const check = plot.canPlace(selecionada, celula.x, celula.y, {
      level: nivelParaConstruir(),
      credits: character.credits,
      inventory: inventario,
    });
    plotView.showGhost(selecionada, celula.x, celula.y, check.valid);
    if (statusEl) {
      statusEl.textContent = check.valid
        ? 'Toque de novo para confirmar.'
        : check.reason ?? '';
    }
  }

  function confirmar(clientX: number, clientY: number): boolean {
    if (!selecionada || !plotView) return false;
    const celula = celulaEm(clientX, clientY);
    if (!celula) return false;

    const def = selecionada;
    const r = plot.build(def, celula.x, celula.y, {
      level: nivelParaConstruir(),
      credits: character.credits,
      inventory: inventario,
    });
    if (!r.ok) {
      if (statusEl) statusEl.textContent = r.reason;
      return false;
    }
    // Os créditos são do personagem, não do terreno — por isso o débito
    // acontece aqui e não dentro de `build`.
    character.credits -= r.building.def.creditCost;
    plotView.sync(plot);
    if (statusEl) {
      statusEl.textContent =
        `${r.building.def.name} em obra · ${r.building.daysRemaining} dia(s) · ` +
        `${character.credits.toLocaleString('pt-BR')} cr`;
    }
    return true;
  }

  // ------------------------------------------------------ ponteiro (hover)
  //
  // No PC não havia retorno nenhum antes de clicar: o mouse passeava sobre o
  // terreno e nada acontecia, então descobrir onde uma peça encaixa exigia
  // tentar. O realce responde no mesmo quadro e diz três coisas de uma vez —
  // que célula está sob o ponteiro, se ela aceita a peça escolhida, e o que
  // já existe ali.
  const inspetor = document.querySelector<HTMLElement>('#inspetor');
  const inspTitulo = document.querySelector<HTMLElement>('#inspetor-titulo');
  const inspLinha = document.querySelector<HTMLElement>('#inspetor-linha');
  const inspPrazo = document.querySelector<HTMLElement>('#inspetor-prazo');

  function mostrarInspetor(b: PlacedBuilding | null): void {
    if (!inspetor) return;
    if (!b) {
      inspetor.hidden = true;
      return;
    }
    inspetor.hidden = false;
    if (inspTitulo) inspTitulo.textContent = `${b.def.name} · nv ${b.level}`;
    if (inspLinha) {
      const estado = b.isReady ? (b.idle ? 'parada' : 'operando') : 'em obra';
      inspLinha.textContent =
        `${estado} · manutenção ${b.stats.dailyUpkeep.toLocaleString('pt-BR')} cr/dia`;
    }
    // Prazo só quando existe prazo. `:empty` esconde a linha no CSS, então uma
    // construção pronta não deixa um espaço vazio no meio do quadro.
    if (inspPrazo) {
      inspPrazo.textContent = b.isReady ? '' : `faltam ${formatDays(b.daysRemaining)}`;
    }
  }

  function aoPassarOPonteiro(clientX: number, clientY: number): void {
    if (!plotView) return;
    const p = chaoEm(clientX, clientY);
    const celula = p ? plotView.cellAt(p.x, p.z) : null;

    if (!celula || !p) {
      plotView.clearHoveredCell();
      plotView.setHovered(null);
      mostrarInspetor(null);
      document.body.classList.remove('sobre-construcao', 'invalido');
      return;
    }

    const sobre = plotView.buildingAt(p.x, p.z);
    plotView.setHovered(sobre?.instanceId ?? null);
    mostrarInspetor(sobre);
    document.body.classList.toggle('sobre-construcao', sobre !== null && !selecionada);

    let valida = true;
    if (selecionada) {
      valida = plot.canPlace(selecionada, celula.x, celula.y, {
        level: nivelParaConstruir(),
        credits: character.credits,
        inventory: inventario,
      }).valid;
      // O fantasma segue o mouse no PC sem exigir arrasto: com o botão do
      // mouse solto não há gesto nenhum, e sem isto a peça só apareceria
      // depois do primeiro clique — que já é o clique que constrói.
      plotView.showGhost(selecionada, celula.x, celula.y, valida);
    }
    document.body.classList.toggle('invalido', Boolean(selecionada) && !valida);
    plotView.setHoveredCell(celula.x, celula.y, valida);
  }

  canvas.addEventListener('pointermove', (event) => {
    // Só ponteiro que paira. Dedo em contato já é gesto, e tratar os dois pelo
    // mesmo caminho faria o realce brigar com o arrasto da câmera.
    if (event.pointerType === 'touch' || event.buttons !== 0) return;
    aoPassarOPonteiro(event.clientX, event.clientY);
  });

  canvas.addEventListener('pointerleave', () => {
    plotView?.clearHoveredCell();
    plotView?.setHovered(null);
    mostrarInspetor(null);
    document.body.classList.remove('sobre-construcao', 'invalido');
  });

  const gestures = new GestureRecognizer(canvas, {
    onStart(state) {
      // A mão fechada só aparece quando o arrasto é da câmera. Com peça
      // escolhida o dedo está mirando, não puxando o chão.
      if (state.kind === 'pan' && !selecionada) {
        document.body.classList.add('arrastando');
      }
      if (state.kind === 'pan' && selecionada) {
        atualizarFantasma(state.x, state.y);
      }
    },
    onMove(state) {
      switch (state.kind) {
        case 'pan': {
          // Com uma construção escolhida, arrastar posiciona o fantasma em vez
          // de mover a câmera: as duas coisas competiriam pelo mesmo dedo.
          if (selecionada) {
            atualizarFantasma(state.x, state.y);
            break;
          }
          // Sinal e velocidade saem das preferências. Invertido, o dedo move a
          // câmera; normal, arrasta o chão sob o dedo.
          const sentido = prefs.current.invertDrag ? -1 : 1;
          const ganho = sentido * prefs.current.cameraSpeed;
          view.pan(state.dx * ganho, state.dy * ganho, window.innerHeight);

          // Sem freio: o mapa é para atravessar. O que segura o jogador não é
          // mais uma parede invisível, é o custo de Fome e Sede que a distância
          // andada cobra no reset.
          view.apply();
          center.set(view.target.x, view.target.z);
          seguirCamera();
          break;
        }

        case 'transform':
          // Pinça, torção e inclinação juntas: é o que a mão faz de verdade.
          if (state.scale !== 1) view.zoomBy(state.scale);
          if (state.rotation !== 0) view.rotateBy(-state.rotation);
          if (state.scale === 1 && state.rotation === 0) {
            view.tiltBy(state.dy * 0.004);
          }
          view.apply();
          break;
      }
    },
    onEnd() {
      document.body.classList.remove('arrastando');
    },
  });
  void gestures;

  // Confirmação por toque simples, separada do arrasto.
  canvas.addEventListener('click', (event) => {
    if (!selecionada) return;
    if (confirmar(event.clientX, event.clientY)) {
      atualizarRecursos();
      // O crédito acabou de mudar, e com ele o que ainda cabe. Reavaliar na
      // hora evita o fantasma verde sobre uma célula que já não dá.
      aoPassarOPonteiro(event.clientX, event.clientY);
    }
  });

  // ------------------------------------------------------- catálogo lateral
  const catalogo = document.querySelector<HTMLElement>('#catalogo');
  const listaEl = document.querySelector<HTMLElement>('#lista-construcoes');

  function montarCatalogo(): void {
    if (!listaEl) return;
    listaEl.textContent = '';

    // No modo Dev o catálogo é o jogo inteiro: a ideia é montar e testar
    // conteúdo, e esperar a progressão para ver uma refinaria transformaria
    // teste de arte numa sessão de horas.
    const disponiveis = prefs.current.devMode
      ? allBuildings
      : buildingsAvailableAt(character.level);

    for (const def of disponiveis) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'item-constr';
      // A descrição entra na lista: o catálogo dizia quanto custa e não dizia
      // para quê, e com 41 construções isso é escolher pelo preço.
      b.innerHTML =
        `<strong>${def.name}</strong>` +
        `<span>${shortFacts(def.id)}</span>` +
        `<em>${def.description}</em>`;
      b.addEventListener('click', () => {
        selecionada = selecionada === def.id ? null : def.id;
        for (const outro of Array.from(listaEl.querySelectorAll('button'))) {
          outro.setAttribute('aria-pressed', String(outro === b && selecionada !== null));
        }
        plotView?.setGridVisible(selecionada !== null);
        // O martelo no lugar da mão: o cursor passa a dizer em que modo o jogo
        // está, sem precisar olhar para o catálogo.
        document.body.classList.toggle('construindo', selecionada !== null);
        if (!selecionada) {
          plotView?.showGhost(null, 0, 0, false);
          document.body.classList.remove('invalido');
        }
        if (statusEl) {
          statusEl.textContent = selecionada
            ? 'Arraste para posicionar, toque para confirmar.'
            : '';
        }
        mostrarFicha(selecionada);
      });
      listaEl.appendChild(b);
    }
  }
  montarCatalogo();

  /**
   * A ficha completa da construção escolhida.
   *
   * Efeito, custo, exigência e progressão nível a nível. Fica no catálogo e não
   * numa tela à parte: a decisão acontece aqui, e informação que exige sair da
   * tela para consultar não é consultada.
   */
  const fichaEl = document.querySelector<HTMLElement>('#ficha-construcao');
  function mostrarFicha(type: string | null): void {
    if (!fichaEl) return;
    if (!type) {
      fichaEl.textContent = '';
      return;
    }
    const f = describeBuilding(type);
    const bloco = (titulo: string, itens: readonly string[]): string =>
      `<strong>${titulo}</strong>${itens.map((t) => `<span>${t}</span>`).join('')}`;
    fichaEl.innerHTML =
      `<em>${f.summary}</em>` +
      bloco('O que faz', f.effects) +
      bloco('O que custa', f.costs) +
      bloco('Exige', f.requirements) +
      bloco('Progressão', f.progression);
  }

  document.querySelector('#abrir-catalogo')?.addEventListener('click', () => {
    catalogo?.classList.toggle('aberto');
  });

  document.querySelector('#fechar-catalogo')?.addEventListener('click', () => {
    catalogo?.classList.remove('aberto');
  });

  // ------------------------------------------------------- trabalho do dia
  //
  // O jogador é um trabalhador antes de ser um construtor: é o trabalho que
  // paga o primeiro barraco. A escolha fica guardada até o reset — o dia é uma
  // decisão, o reset é a consequência — e cada opção mostra o que custa de
  // Fome e Sede, porque no GDD alimentação é decisão econômica e decisão exige
  // informação.
  const trabalhoEl = document.querySelector<HTMLElement>('#lista-trabalho');
  const trabalhoStatus = document.querySelector<HTMLElement>('#status-trabalho');

  function montarTrabalho(): void {
    if (!trabalhoEl) return;
    trabalhoEl.textContent = '';

    const ocioso = document.createElement('button');
    ocioso.type = 'button';
    ocioso.className = 'item-trabalho';
    ocioso.dataset.trabalho = '';
    ocioso.innerHTML =
      '<strong>Descansar</strong><span>Sem produção. Só a base de Fome e Sede.</span>';
    trabalhoEl.appendChild(ocioso);

    const governo = campaign.governmentOf(
      campaign.currentSettlementId ?? plot.settlementId,
    );

    for (const profissao of allProfessions) {
      const opcao = workById(profissao.work);
      const bloqueio = prefs.current.devMode
        ? { ok: true as const }
        : canPractise(profissao, {
            certificates: character.certificates,
            level: character.level,
          });

      const b = document.createElement('button');
      b.type = 'button';
      b.className = bloqueio.ok ? 'item-trabalho' : 'item-trabalho bloqueado';
      b.dataset.trabalho = profissao.work;
      b.disabled = !bloqueio.ok;
      // O motivo do bloqueio aparece na própria vaga: uma opção cinza sem
      // explicação vira mistério, e o jogador não descobre que existe um curso.
      b.innerHTML =
        `<strong>${profissao.label}</strong>` +
        `<span>${grupoLabel(opcao.kind)} · ${dailyWage(profissao, governo.publicWage)} cr/dia · ` +
        `-${opcao.upkeep.hunger} fome · -${opcao.upkeep.thirst} sede</span>` +
        `<em>${bloqueio.ok ? profissao.description : bloqueio.reason}</em>`;
      trabalhoEl.appendChild(b);
    }

    trabalhoEl.addEventListener('click', (evento) => {
      const alvo = (evento.target as HTMLElement).closest<HTMLElement>(
        '.item-trabalho',
      );
      if (!alvo || alvo.hasAttribute('disabled')) return;
      escolherTrabalho(alvo.dataset.trabalho || null);
    });

    montarCursos();
    pintarTrabalho();
  }

  /**
   * A lista de cursos.
   *
   * Fica junto do trabalho de propósito: a decisão é a mesma — abrir mão de
   * dias de salário agora para ganhar mais depois. Numa tela separada, o
   * jogador olharia as vagas bloqueadas e concluiria que o jogo é assim.
   */
  const cursosEl = document.querySelector<HTMLElement>('#lista-cursos');
  function montarCursos(): void {
    if (!cursosEl) return;
    cursosEl.textContent = '';

    if (character.isStudying && character.studyingCertificate) {
      const curso = certificateDef(character.studyingCertificate);
      cursosEl.innerHTML =
        `<p class="curso-andamento">Cursando ${curso.label} — faltam ` +
        `${character.studyDaysRemaining} dia(s). O dia de trabalho vai para o estudo.</p>`;
      return;
    }

    for (const curso of allCertificates) {
      const tem = character.certificates.has(curso.id);
      const check = canEnrol(curso, {
        certificates: character.certificates,
        credits: character.credits,
        attributes: character.attributes,
        studying: character.isStudying,
      });

      const b = document.createElement('button');
      b.type = 'button';
      b.className = tem ? 'item-curso concluido' : 'item-curso';
      b.disabled = tem || !check.ok;
      b.innerHTML =
        `<strong>${curso.label}${tem ? ' ✓' : ''}</strong>` +
        `<span>${
          tem
            ? 'Concluído.'
            : check.ok
              ? `${check.tuition.toLocaleString('pt-BR')} cr · ${check.days} dia(s) de curso`
              : check.reason
        }</span>` +
        `<em>${curso.description}</em>`;
      if (!tem && check.ok) {
        b.addEventListener('click', () => matricular(curso.id));
      }
      cursosEl.appendChild(b);
    }
  }

  function matricular(id: Certificate): void {
    const curso = certificateDef(id);
    const check = canEnrol(curso, {
      certificates: character.certificates,
      credits: character.credits,
      attributes: character.attributes,
      studying: character.isStudying,
    });
    if (!check.ok) return;

    // A matrícula é cobrada na hora e não é devolvida: desistir do curso custa
    // o dinheiro, que é o que impede matricular e cancelar para testar.
    character.credits -= check.tuition;
    character.studyingCertificate = id;
    character.studyDaysRemaining = check.days;
    // Estudar ocupa o dia de trabalho — a escolha de emprego sai de cena.
    atividadeEscolhida = null;

    atualizarRecursos();
    montarCursos();
    pintarTrabalho();
    options.onPersist?.(campaign);
  }

  function grupoLabel(kind: string): string {
    if (kind === 'public') return 'Serviço público (paga salário)';
    if (kind === 'farm') return 'Fazenda';
    return 'Oficina';
  }

  function escolherTrabalho(id: string | null): void {
    if (!id) {
      atividadeEscolhida = null;
    } else {
      const opcao = workById(id);
      // O grupo decide em qual campo a escolha entra, e só um vale por dia: o
      // GDD dá ao jogador uma jornada, não três.
      atividadeEscolhida =
        opcao.kind === 'public'
          ? { publicWork: opcao.id as never }
          : opcao.kind === 'farm'
            ? { farmWork: opcao.id as never }
            : { workshopWork: opcao.id as never };
    }
    pintarTrabalho();
  }

  function pintarTrabalho(): void {
    if (!trabalhoEl) return;
    const atual =
      atividadeEscolhida?.publicWork ??
      atividadeEscolhida?.farmWork ??
      atividadeEscolhida?.workshopWork ??
      '';
    for (const b of Array.from(
      trabalhoEl.querySelectorAll<HTMLElement>('.item-trabalho'),
    )) {
      b.setAttribute('aria-pressed', String((b.dataset.trabalho || '') === atual));
    }
    if (trabalhoStatus) {
      const conta = resolveUpkeep(atividadeDoDia(), {
        hungerModifier: inventario.upkeepModifiers.hunger,
        thirstModifier: inventario.upkeepModifiers.thirst,
        extra: character.isStudying
          ? [{ label: 'Curso', upkeep: STUDY_UPKEEP }]
          : [],
      });
      const profissao = atual ? professionForWork(atual) : null;
      const oQue = character.isStudying
        ? 'curso'
        : (profissao?.label ?? (atual ? workById(atual).label : 'descanso'));
      trabalhoStatus.textContent =
        `Hoje: ${oQue} · custa ${conta.total.hunger} fome e ${conta.total.thirst} sede.`;
    }
  }
  montarTrabalho();

  document.querySelector('#abrir-trabalho')?.addEventListener('click', () => {
    document.querySelector('#trabalho')?.classList.toggle('aberto');
    pintarTrabalho();
  });
  document.querySelector('#fechar-trabalho')?.addEventListener('click', () => {
    document.querySelector('#trabalho')?.classList.remove('aberto');
  });

  // ------------------------------------------------------------- a cidade
  //
  // O painel é criado uma vez e trocado de cidade, em vez de um por cidade: o
  // conteúdo é sempre montado do estado atual da campanha, e vinte painéis
  // guardando preços velhos seriam vinte lugares para dessincronizar.
  cidadePainel = createCityPanel({
    campaign: () => campaign,
    onChange: () => {
      atualizarRecursos();
      options.onPersist?.(campaign);
    },
    // Assumir a vaga na cidade é a **mesma** escolha do painel de trabalho, e
    // não uma segunda: duas fontes de verdade para o dia de trabalho é como se
    // ganha salário de dois empregos ao mesmo tempo.
    onTakeJob: (work) => {
      escolherTrabalho(work);
      atualizarRecursos();
      options.onPersist?.(campaign);
    },
    currentWork: () => atividadeEscolhida?.publicWork ?? null,
  });

  const botaoCidade = document.querySelector<HTMLButtonElement>('#abrir-cidade');
  botaoCidade?.addEventListener('click', () => {
    if (!cidadeAtual) return;
    if (cidadePainel?.isOpen) cidadePainel.close();
    else cidadePainel?.open(cidadeAtual);
  });

  /** Liga o botão só quando há cidade sob os pés, e fecha o painel ao sair. */
  function sincronizarBotaoCidade(): void {
    const s = cidadeAtual ? campaign.world.layout.byId(cidadeAtual) : null;
    if (botaoCidade) {
      botaoCidade.disabled = s === null;
      botaoCidade.textContent = s ? `ENTRAR EM ${s.name.toUpperCase()}` : 'ENTRAR NA CIDADE';
    }
    // Sair da cidade fecha o painel: o mercado é local, e continuar comprando
    // dele a dois quilômetros de distância apagaria a razão de viajar.
    if (!s && cidadePainel?.isOpen) cidadePainel.close();
  }
  sincronizarBotaoCidade();

  // ------------------------------------------------------------ teclado (PC)
  //
  // O jogo é mobile-first, mas isso nunca quis dizer "só no celular": no PC os
  // gestos de dois dedos não existem, e arrastar com o mouse para atravessar a
  // vila inteira é cansativo. Teclado dá o que o dedo dá.
  const teclas = new Set<string>();
  const atalhos: Record<string, string> = {
    w: 'frente', arrowup: 'frente',
    s: 'tras', arrowdown: 'tras',
    a: 'esquerda', arrowleft: 'esquerda',
    d: 'direita', arrowright: 'direita',
    q: 'giraEsq', e: 'giraDir',
    r: 'aproxima', f: 'afasta',
  };

  window.addEventListener('keydown', (event) => {
    // Não sequestra o teclado enquanto o jogador digita a seed.
    if (event.target instanceof HTMLInputElement) return;
    const acao = atalhos[event.key.toLowerCase()];
    if (!acao) return;
    event.preventDefault();
    teclas.add(acao);
  });
  window.addEventListener('keyup', (event) => {
    const acao = atalhos[event.key.toLowerCase()];
    if (acao) teclas.delete(acao);
  });
  // Sem isto, trocar de aba com a tecla pressionada deixa a câmera correndo
  // sozinha para sempre.
  window.addEventListener('blur', () => teclas.clear());

  function moverPorTeclado(delta: number): void {
    if (teclas.size === 0) return;

    // Velocidade proporcional ao afastamento, **com teto**.
    //
    // A regra proporcional foi feita para atravessar um lote: de longe cada
    // passo cobre mais chão. Sem teto, no zoom máximo ela dava 200 metros por
    // segundo — o jogador cruzava dois biomas por segundo, o carregador de
    // pedaços não tinha como acompanhar, e a distância andada deixava de
    // significar qualquer coisa para o custo de viagem. Quatorze metros por
    // segundo é corrida, não teletransporte: dá pouco mais de seis segundos
    // para vencer os 90 metros que valem um trecho de estrada.
    const passo =
      Math.min(view.distance * 2.2, VELOCIDADE_MAX) * delta * prefs.current.cameraSpeed;
    let dx = 0;
    let dz = 0;
    if (teclas.has('frente')) dz -= passo;
    if (teclas.has('tras')) dz += passo;
    if (teclas.has('esquerda')) dx -= passo;
    if (teclas.has('direita')) dx += passo;

    if (dx !== 0 || dz !== 0) {
      const cos = Math.cos(view.yaw);
      const sin = Math.sin(view.yaw);
      view.target.x += dx * cos - dz * sin;
      view.target.z += -dx * sin - dz * cos;

      center.set(view.target.x, view.target.z);
      seguirCamera();
    }

    if (teclas.has('giraEsq')) view.rotateBy(1.6 * delta);
    if (teclas.has('giraDir')) view.rotateBy(-1.6 * delta);
    if (teclas.has('aproxima')) view.zoomBy(1 + 1.4 * delta);
    if (teclas.has('afasta')) view.zoomBy(1 / (1 + 1.4 * delta));

    view.apply();
  }

  // O painel recolhe: numa tela de 360px ele ocuparia metade do mundo.
  const panel = document.querySelector('#painel');
  document.querySelector('#alternar-painel')?.addEventListener('click', () => {
    panel?.classList.toggle('recolhido');
  });

  document.querySelector('#encerrar-dia')?.addEventListener('click', () => {
    virarODia();
  });

  document.querySelector('#abrir-mapa')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('ck:mapa'));
  });

  document.querySelector('#sair')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('ck:sair'));
  });

  // `resize` também dispara ao rodar o aparelho e ao abrir o teclado virtual.
  const onResize = (): void => {
    applyResolution();
    // O enquadramento depende da proporção — a `CityCamera` soma inclinação em
    // telas altas —, então rodar o aparelho precisa reposicionar a câmera, não
    // só redimensionar o buffer.
    placeCamera();
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);

  // ------------------------------------------------------------------ laço
  //
  // O dia vira sozinho a cada 24 h de relógio de parede, ancorado na criação da
  // campanha. Derivar em vez de contar é o que faz a aba fechada na quinta e
  // reaberta no sábado valer dois dias — ver `campaign/dayClock.ts`.
  const calendario = DayClock.start(campaign.createdAt ?? Date.now());

  const clock = new THREE.Clock();
  let visible = !document.hidden;
  let ultimoHud = 0;
  /** `true` enquanto ainda falta pedaço para montar perto da câmera. */
  let carregando = true;
  let ultimoSave = 0;
  const salvoEm = new THREE.Vector2(character.position.x, character.position.y);

  document.addEventListener('visibilitychange', () => {
    visible = !document.hidden;
    // O relógio continua correndo com a aba oculta; sem descartar o acúmulo, o
    // primeiro quadro de volta traz um delta de minutos e a grama dá um salto.
    if (visible) clock.getDelta();
  });

  function frame(): void {
    requestAnimationFrame(frame);
    // Render em segundo plano é bateria queimada por nada — o motivo número um
    // de um jogo web esquentar o celular no bolso.
    if (!visible) return;

    const delta = clock.getDelta();
    governor.sample(delta);
    moverPorTeclado(delta);

    // O mundo se completa em quadros, um pedaço por vez. Montar quatro de uma
    // vez ao cruzar uma diagonal derruba o quadro de forma visível; um por vez
    // é o que faz o carregamento parecer progressivo em vez de travado.
    if (mundo && (precisaCarregar() || carregando)) {
      // Até três por quadro. Um só era pouco quando o jogador anda depressa: o
      // descarte na retaguarda ganhava da carga na dianteira e o mundo
      // encolhia em volta dele. Três é o que cabe num quadro de 16 ms sem que
      // a queda apareça.
      carregando = false;
      for (let i = 0; i < 3; i++) {
        const montou = mundo.update(center.x, center.y, {
          budget: governor.budget,
          viewDistance: view.distance,
        });
        if (!montou) break;
        carregando = true;
      }
      if (!carregando) carregadoEm.copy(center);
    }

    // O aviso de chegada some sozinho: é notícia, não estado.
    if (avisoVisivel && performance.now() > avisoAte) esconderAviso();

    // O relógio de parede pode ter passado mais de um dia — a aba ficou
    // fechada, o aparelho dormiu. A comparação é contra `campaign.day`, que é o
    // que o save guarda: quem encerrou o dia à mão já está adiantado e não leva
    // virada extra, e quem ficou dois dias fora leva as duas. Nada disso exige
    // um contador paralelo.
    const alvo = calendario.day();
    // Teto por quadro: uma campanha parada por meses rodaria centenas de
    // resets num quadro só e travaria a aba. Alcança em alguns segundos.
    let restantes = MAX_TICKS_POR_QUADRO;
    while (campaign.day < alvo && restantes-- > 0) virarODia();
    // Um quadro por segundo já basta para um cronômetro em segundos, e evita
    // reescrever o DOM sessenta vezes por segundo para mudar nada.
    if (clock.getElapsedTime() - ultimoHud > 1) {
      ultimoHud = clock.getElapsedTime();
      atualizarRecursos();
      // O diagnóstico acompanha a caminhada: bioma e pedaços carregados mudam
      // enquanto o jogador anda, e um número congelado dizia que nada estava
      // acontecendo quando muita coisa estava.
      report();

      // Autossalvamento da posição.
      //
      // Andar não é evento — não há um instante óbvio em que "chegou". Sem um
      // salvamento periódico, o jogador atravessava meio mapa, fechava a aba e
      // reaparecia na cidade natal. Dez segundos é raro o bastante para não
      // pesar e frequente o bastante para a perda ser um trecho curto de
      // caminhada, nunca uma viagem inteira.
      if (
        clock.getElapsedTime() - ultimoSave > 10 &&
        (character.position.x !== salvoEm.x || character.position.y !== salvoEm.y)
      ) {
        ultimoSave = clock.getElapsedTime();
        salvoEm.set(character.position.x, character.position.y);
        options.onPersist?.(campaign);
      }
    }

    plotView?.update(clock.getElapsedTime());
    mundo?.animate(clock.getElapsedTime());
    renderer.render(scene, camera);
  }

  applyResolution();
  rebuild();
  atualizarRecursos();
  frame();

  // Sinal para a captura automatizada saber que a cena está pronta.
  (window as unknown as { __pronto?: boolean }).__pronto = true;

  return { canvas, campaign };
}
