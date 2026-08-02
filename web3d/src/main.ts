import * as THREE from 'three';

import { DensityField } from './render/density';
import { createGrassField, type GrassField } from './render/grass';
import {
  QualityGovernor,
  grassOptionsFor,
  guessTier,
  patchSizeForView,
} from './render/quality';
import { CityCamera } from './render/cityCamera';
import { createTerrain, type Terrain } from './render/terrain';
import { TILE, createPlotView, type PlotView } from './render/plotView';
import { GestureRecognizer } from './render/touch';
import {
  blockedHint,
  blockedMessage,
  clampToBounds,
  isBlocked,
  type VillageBounds,
} from './render/villageBounds';
import { biomeDef } from './world/biome';
import { plotAreaFor, plotOrigin } from './world/plotArea';
import { WorldGenerator } from './world/worldGen';
import {
  Plot,
  plotSizeForLevel,
  runPlotTick,
  type PlacedBuilding,
} from './building/plot';
import {
  DayClock,
  formatDays,
  formatRemaining,
} from './campaign/dayClock';
import { buildingsAvailableAt, type CitizenLevel } from './building/buildingType';
import { Inventory } from './economy/inventory';
import { allItems } from './economy/item';

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

export interface WorldHandle {
  readonly canvas: HTMLCanvasElement;
}

export function bootWorld(seedLabel: string): WorldHandle {
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
  scene.fog = new THREE.FogExp2(FOG_COLOR, 0.0085);

  const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 900);

  scene.add(new THREE.HemisphereLight(0xd8ecff, 0x4a5236, 1.5));
  const sun = new THREE.DirectionalLight(0xfff2dc, 2.1);
  sun.position.set(60, 90, 40);
  scene.add(sun);

  const world = WorldGenerator.fromLabel(seedLabel);

  // Terreno do jogador. Enquanto a campanha não estiver portada, ele nasce
  // vazio com recursos de teste — o suficiente para a colocação funcionar de
  // verdade, cobrando custo e recusando encaixe inválido.
  // `farmer` e não `elite`: o lote de elite tem 16×16 tiles, ou 64 m de lado, e
  // num celular em retrato a tela inteira cabia dentro da cerca — não dava para
  // ver onde o terreno começava. 10×10 enquadra, e ainda abre 27 das 41
  // construções. O nível de verdade passa a vir da campanha quando ela for
  // portada.
  const nivel: CitizenLevel = 'farmer';
  const [pw, ph] = plotSizeForLevel(nivel);
  const plot = new Plot('p1', 'cap_0', { x: 0, y: 0 }, pw, ph);

  // O lote sai do ponto de rede da origem — ver `world/plotArea.ts` — e impõe
  // o próprio chão, para que nenhum trecho de Água Morta caia dentro do
  // tabuleiro virando mancha pelada num cenário sem relevo.
  const lote = plotOrigin(world);
  const plotArea = plotAreaFor(world, lote.x, lote.z, pw * TILE, ph * TILE);

  const density = new DensityField(world, plotArea);
  let terrain: Terrain | null = null;
  let grass: GrassField | null = null;
  const center = new THREE.Vector2(lote.x, lote.z);
  const seededAt = new THREE.Vector2(lote.x, lote.z);

  const inventario = new Inventory();
  for (const item of allItems) inventario.add(item.id, 300);
  let creditos = 250_000;
  let plotView: PlotView | null = null;
  let selecionada: string | null = null;

  // Limite da vila. Por enquanto o centro é o lote e o nome sai do layout do
  // mundo; quando a campanha estiver portada, isto passa a vir do terreno do
  // jogador e do assentamento vizinho de verdade.
  const bounds: VillageBounds = {
    centerX: lote.x,
    centerZ: lote.z,
    radius: 46,
    settlementName: 'seu vilarejo',
    neighbourName: 'Krom Central',
  };
  let enquadrado = false;
  /** Lado do trecho realmente semeado. Muda com o zoom. */
  let seededPatch = 0;

  /**
   * Se o trecho semeado ainda serve para onde a câmera está.
   *
   * Duas causas independentes: o alvo andou o bastante para o trecho ficar
   * descentrado, ou o zoom mudou o bastante para o trecho ficar curto (ou
   * folgado demais). A margem de 25% no zoom evita ressemear a cada pinçada —
   * refazer o campo é caro, e um zoom nervoso viraria engasgo.
   */
  function precisaResemear(): boolean {
    if (seededPatch <= 0) return true;
    if (center.distanceTo(seededAt) > seededPatch * 0.3) return true;
    const desejado = patchSizeForView(
      governor.budget,
      view.distance,
      camera.fov,
    );
    return Math.abs(desejado - seededPatch) / seededPatch > 0.25;
  }

  const governor = new QualityGovernor(guessTier(), () => {
    applyResolution();
    rebuild();
  });

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
      // A câmera nasce com giro de 0,7 rad, então o lote entra em quadro como
      // losango e quem manda no enquadramento é a **diagonal**, não o lado.
      // Enquadrar pelo lado deixava só a ponta do terreno na tela.
      const fundo = plot.height * TILE * Math.SQRT2 * 1.1;
      view.distance = Math.min(
        view.limits.maxDistance,
        fundo / (2 * Math.tan((camera.fov * Math.PI) / 360)),
      );
      enquadrado = true;
    }

    // O trecho acompanha o zoom: ver `patchSizeForView`.
    const patch = patchSizeForView(budget, view.distance, camera.fov);
    seededPatch = patch;

    if (terrain) {
      scene.remove(terrain.mesh, terrain.water);
      terrain.dispose();
    }
    if (grass) {
      scene.remove(grass.mesh);
      grass.dispose();
    }

    terrain = createTerrain(
      world,
      center.x,
      center.y,
      // Terreno bem maior que o trecho com grama: numa visão de cima quase
      // vertical, a borda da malha entraria em quadro no zoom máximo e
      // apareceria como um precipício no vazio.
      patch * 3.2,
      budget.terrainSegments,
      density.biomes,
      bounds,
      plotArea,
    );
    grass = createGrassField(
      world,
      density,
      center.x,
      center.y,
      { ...grassOptionsFor(budget), patchSize: patch },
      bounds,
    );
    scene.add(terrain.mesh, terrain.water, grass.mesh);

    if (!plotView) {
      plotView = createPlotView(plot, lote.x, lote.z);
      scene.add(plotView.group);
      plotView.sync(plot);
    }
    seededAt.copy(center);
    view.focusOn(center.x, center.y);

    report();
    placeCamera();
  }

  function report(): void {
    const biome = biomeDef(density.biomes.at(center.x, center.y));
    const el = document.querySelector('#readout');
    if (el) {
      el.textContent =
        `${biome.label} · ${(grass?.bladeCount ?? 0).toLocaleString('pt-BR')} lâminas` +
        ` · ${governor.tier}`;
    }
  }

  // ------------------------------------------------------- barra de recursos
  //
  // Dinheiro e prazo decidem toda jogada, e nenhum dos dois aparecia em lugar
  // nenhum: o jogador escolhia uma construção sem saber se tinha crédito, e via
  // uma obra começar sem saber quando ela acabava.
  const calendario = DayClock.start();
  let diaVisto = calendario.day();

  const valorDe = (id: string): HTMLElement | null =>
    document.querySelector<HTMLElement>(`${id} .valor`);
  const elCreditos = valorDe('#rec-creditos');
  const elDia = valorDe('#rec-dia');
  const elReset = valorDe('#rec-reset');
  const boxReset = document.querySelector<HTMLElement>('#rec-reset');
  const elObras = valorDe('#rec-obras');

  function atualizarRecursos(): void {
    if (elCreditos) elCreditos.textContent = creditos.toLocaleString('pt-BR');
    if (elDia) elDia.textContent = `dia ${calendario.day()}`;

    const falta = calendario.remaining();
    if (elReset) elReset.textContent = formatRemaining(falta);
    // Última hora do dia acende o contador. A cor entra só quando há motivo —
    // um HUD sempre vermelho é um HUD que ninguém lê.
    boxReset?.classList.toggle('urgente', falta < 60 * 60 * 1000);

    const obras = plot.buildings.filter((b) => !b.isReady);
    if (elObras) {
      if (obras.length === 0) {
        elObras.textContent = 'sem obras';
      } else {
        const prazo = Math.min(...obras.map((b) => b.daysRemaining));
        elObras.textContent = `${obras.length} · ${formatDays(prazo)}`;
      }
    }
  }

  /** Roda um dia: obras andam, manutenção é cobrada, produção entra. */
  function virarODia(): void {
    const resultado = runPlotTick(plot, {
      inventory: inventario,
      availableCredits: creditos,
    });
    creditos -= resultado.upkeepPaid;
    plotView?.sync(plot);
    atualizarRecursos();

    if (statusEl) {
      const partes: string[] = [`Dia ${calendario.day()}.`];
      if (resultado.completed.length > 0) {
        partes.push(
          `${resultado.completed.map((b) => b.def.name).join(', ')} ficou pronta.`,
        );
      }
      if (resultado.upkeepPaid > 0) {
        partes.push(`Manutenção: ${resultado.upkeepPaid.toLocaleString('pt-BR')} cr.`);
      }
      if (resultado.idled.length > 0) {
        partes.push(`${resultado.idled.length} parada(s) por falta de caixa.`);
      }
      statusEl.textContent = partes.join(' ');
    }
  }

  // ---------------------------------------------------------------- entrada
  const aviso = document.querySelector<HTMLElement>('#aviso');
  const avisoTitulo = document.querySelector<HTMLElement>('#aviso-titulo');
  const avisoTexto = document.querySelector<HTMLElement>('#aviso-texto');
  let avisoVisivel = false;

  function mostrarLimite(visivel: boolean): void {
    if (visivel === avisoVisivel) return;
    avisoVisivel = visivel;
    aviso?.classList.toggle('visivel', visivel);
    if (visivel) {
      if (avisoTitulo) avisoTitulo.textContent = blockedMessage(bounds);
      if (avisoTexto) avisoTexto.textContent = blockedHint(bounds);
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
      level: nivel,
      credits: creditos,
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
      level: nivel,
      credits: creditos,
      inventory: inventario,
    });
    if (!r.ok) {
      if (statusEl) statusEl.textContent = r.reason;
      return false;
    }
    // Os créditos são do personagem, não do terreno — por isso o débito
    // acontece aqui e não dentro de `build`.
    creditos -= r.building.def.creditCost;
    plotView.sync(plot);
    if (statusEl) {
      statusEl.textContent =
        `${r.building.def.name} em obra · ${r.building.daysRemaining} dia(s) · ` +
        `${creditos.toLocaleString('pt-BR')} cr`;
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
        level: nivel,
        credits: creditos,
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
          view.pan(state.dx, state.dy, window.innerHeight);

          // Freio na borda em vez de trava seca: a câmera desliza ao longo do
          // limite. Parede dura parece defeito; freio parece regra.
          const preso = clampToBounds(bounds, view.target.x, view.target.z);
          const bateu =
            preso.x !== view.target.x || preso.z !== view.target.z;
          view.target.x = preso.x;
          view.target.z = preso.z;

          view.apply();
          center.set(view.target.x, view.target.z);
          mostrarLimite(bateu || isBlocked(bounds, center.x, center.y));
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
      mostrarLimite(false);
      if (precisaResemear()) {
        rebuild();
      }
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
    for (const def of buildingsAvailableAt(nivel)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'item-constr';
      b.innerHTML =
        `<strong>${def.name}</strong>` +
        `<span>${def.width}x${def.height} · ${def.creditCost} cr · ${def.buildDays}d</span>`;
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
      });
      listaEl.appendChild(b);
    }
  }
  montarCatalogo();

  document.querySelector('#abrir-catalogo')?.addEventListener('click', () => {
    catalogo?.classList.toggle('aberto');
  });

  document.querySelector('#fechar-catalogo')?.addEventListener('click', () => {
    catalogo?.classList.remove('aberto');
  });

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

    // Velocidade proporcional ao afastamento: de longe cada passo cobre mais
    // chão, senão atravessar a vila afastado leva o dobro do tempo.
    const passo = view.distance * 2.2 * delta;
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

      const preso = clampToBounds(bounds, view.target.x, view.target.z);
      const bateu = preso.x !== view.target.x || preso.z !== view.target.z;
      view.target.x = preso.x;
      view.target.z = preso.z;
      center.set(view.target.x, view.target.z);
      mostrarLimite(bateu);
    }

    if (teclas.has('giraEsq')) view.rotateBy(1.6 * delta);
    if (teclas.has('giraDir')) view.rotateBy(-1.6 * delta);
    if (teclas.has('aproxima')) view.zoomBy(1 + 1.4 * delta);
    if (teclas.has('afasta')) view.zoomBy(1 / (1 + 1.4 * delta));

    view.apply();

    if (precisaResemear()) {
      rebuild();
    }
  }

  // O painel recolhe: numa tela de 360px ele ocuparia metade do mundo.
  const panel = document.querySelector('#painel');
  document.querySelector('#alternar-painel')?.addEventListener('click', () => {
    panel?.classList.toggle('recolhido');
  });

  document.querySelector('#encerrar-dia')?.addEventListener('click', () => {
    calendario.endDay();
    diaVisto = calendario.day();
    virarODia();
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
  const clock = new THREE.Clock();
  let visible = !document.hidden;
  let ultimoHud = 0;

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

    // O relógio de parede pode ter passado mais de um dia — a aba ficou
    // fechada, o aparelho dormiu. `consumeElapsed` devolve **quantas** viradas,
    // e não se virou: aplicar uma só faria o jogador perder dias de produção
    // que o calendário já contou.
    const viradas = calendario.consumeElapsed(diaVisto);
    if (viradas > 0) {
      diaVisto += viradas;
      for (let i = 0; i < viradas; i++) virarODia();
    }
    // Um quadro por segundo já basta para um cronômetro em segundos, e evita
    // reescrever o DOM sessenta vezes por segundo para mudar nada.
    if (clock.getElapsedTime() - ultimoHud > 1) {
      ultimoHud = clock.getElapsedTime();
      atualizarRecursos();
    }

    plotView?.update(clock.getElapsedTime());
    grass?.update(clock.getElapsedTime());
    renderer.render(scene, camera);
  }

  applyResolution();
  rebuild();
  atualizarRecursos();
  frame();

  // Sinal para a captura automatizada saber que a cena está pronta.
  (window as unknown as { __pronto?: boolean }).__pronto = true;

  return { canvas };
}
