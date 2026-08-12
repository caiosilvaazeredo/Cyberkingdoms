import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { PerspectiveCamera } from 'three';

import { CityCamera, defaultLimits } from '../src/render/cityCamera';
import {
  FADE_WIDTH,
  blockedHint,
  blockedMessage,
  clampToBounds,
  isBlocked,
  outsideRatio,
} from '../src/render/villageBounds';
import { QualityGovernor, budgetFor, grassOptionsFor, guessTier } from '../src/render/quality';

/**
 * O jogo é mobile-first, e continuou sendo depois da troca de motor.
 *
 * Estes testes cobrem a parte da decisão mobile que é lógica pura. O resto —
 * tamanho de alvo de toque, área segura, teclado virtual — está no CSS e só a
 * captura em viewport de celular verifica.
 */
describe('Orçamento de render por aparelho', () => {
  it('aparelho fraco recebe menos lâminas e menos resolução', () => {
    const baixo = budgetFor('baixo');
    const alto = budgetFor('alto');

    expect(baixo.maxBlades).toBeLessThan(alto.maxBlades);
    expect(baixo.pixelRatio).toBeLessThan(alto.pixelRatio);
    expect(baixo.terrainSegments).toBeLessThan(alto.terrainSegments);
  });

  it('mesmo no orçamento mínimo o campo continua sendo um campo', () => {
    // Abaixo de umas dezenas de milhares de lâminas dá para contar as folhas,
    // e o renderizador instanciado perde o motivo de existir. É melhor mostrar
    // menos mundo do que mostrar mundo pelado.
    const baixo = budgetFor('baixo');
    const porMetro = baixo.maxBlades / (baixo.patchSize * baixo.patchSize);
    expect(porMetro).toBeGreaterThan(8);
  });

  it('a densidade pedida deixa o teto ser quem manda', () => {
    // O teto representa o orçamento do aparelho. Se a densidade por metro
    // quadrado fosse o limite efetivo, mudar de classe não mudaria nada.
    for (const tier of ['baixo', 'medio', 'alto'] as const) {
      const budget = budgetFor(tier);
      const options = grassOptionsFor(budget);
      const tentativas =
        options.patchSize * options.patchSize * options.bladesPerSquareMeter;
      expect(tentativas, tier).toBeGreaterThan(options.maxBlades);
    }
  });

  it('a heurística inicial não chuta alto num aparelho de toque fraco', () => {
    const fraco = {
      hardwareConcurrency: 4,
      deviceMemory: 2,
    } as unknown as Navigator;
    expect(guessTier(fraco)).toBe('baixo');
  });
});

describe('Governador de qualidade', () => {
  /** Alimenta o governador com `seconds` de quadros a um FPS constante. */
  function feed(governor: QualityGovernor, fps: number, seconds: number): void {
    const delta = 1 / fps;
    for (let t = 0; t < seconds; t += delta) governor.sample(delta);
  }

  it('cai de classe depois de meio segundo ruim', () => {
    // Engasgo o jogador sente na hora; a reação tem de ser rápida.
    const governor = new QualityGovernor('alto');
    feed(governor, 30, 1);
    expect(governor.tier).toBe('medio');
  });

  it('não sobe de classe por um sopro de bom desempenho', () => {
    // Subir custa refazer a grama. Subir cedo demais transformaria o remédio
    // na doença.
    const governor = new QualityGovernor('baixo');
    feed(governor, 60, 1);
    expect(governor.tier).toBe('baixo');
  });

  it('sobe depois de vários segundos estáveis', () => {
    const governor = new QualityGovernor('baixo');
    feed(governor, 60, 6);
    expect(governor.tier).toBe('medio');
  });

  it('a faixa morta impede a oscilação de classe', () => {
    // Um aparelho parado em 50 FPS não pode ficar trocando de classe a cada
    // segundo: cada troca reconstrói o campo inteiro.
    const governor = new QualityGovernor('medio');
    feed(governor, 50, 12);
    expect(governor.tier).toBe('medio');
  });

  it('nunca passa dos extremos', () => {
    const chao = new QualityGovernor('baixo');
    feed(chao, 12, 6);
    expect(chao.tier).toBe('baixo');

    const teto = new QualityGovernor('alto');
    feed(teto, 120, 40);
    expect(teto.tier).toBe('alto');
  });

  it('ignora quadros absurdos de aba oculta', () => {
    // Voltar de segundo plano entrega um delta de minutos. Tratar isso como
    // desempenho ruim derrubaria a qualidade de um aparelho que está bem.
    const governor = new QualityGovernor('alto');
    for (let i = 0; i < 20; i++) governor.sample(30);
    expect(governor.tier).toBe('alto');
  });

  it('avisa quem precisa reconstruir a cena', () => {
    const trocas: string[] = [];
    const governor = new QualityGovernor('alto', (tier) => trocas.push(tier));
    feed(governor, 20, 2);
    expect(trocas).toContain('medio');
  });
});

describe('Câmera de construtor de cidade', () => {
  const flat = () => 0;

  function make(): CityCamera {
    const camera = new PerspectiveCamera(58, 0.5, 0.1, 900);
    return new CityCamera(camera, flat);
  }

  it('arrastar move o alvo, não gira em volta dele', () => {
    // É a diferença entre uma câmera orbital e a de um tycoon: o ponto sob o
    // dedo continua sob o dedo.
    const view = make();
    const antes = view.target.clone();
    view.pan(120, 0, 800);
    view.apply();
    expect(view.target.distanceTo(antes)).toBeGreaterThan(0);
  });

  /**
   * Onde o ponto do chão aparece na tela, em unidades de tela.
   *
   * `x` cresce para a direita e `y` para baixo, como no DOM — é a única forma
   * de comparar o gesto com o resultado sem depender de qual eixo do mundo é
   * qual. A câmera olha o alvo de `target + horizontal·(sin yaw, cos yaw)`,
   * então "para longe" no mundo é `(−sin yaw, −cos yaw)` e sobe na tela.
   */
  function naTela(view: CityCamera, x: number, z: number) {
    const dx = x - view.target.x;
    const dz = z - view.target.z;
    const cos = Math.cos(view.yaw);
    const sin = Math.sin(view.yaw);
    return {
      x: dx * cos - dz * sin,
      // Para longe da câmera é para cima: o sinal negativo põe o resultado no
      // mesmo sentido do eixo Y da tela.
      y: dx * sin + dz * cos,
    };
  }

  it('o chão segue o dedo nos dois eixos', () => {
    // O defeito que este teste prende: o eixo horizontal arrastava o chão sob o
    // dedo e o vertical fazia o contrário. Puxar para baixo empurrava o mundo
    // para cima, e o jogo parecia ter o controle invertido — porque tinha, em
    // metade dos eixos.
    for (const yaw of [0, 0.7, 1.9, -2.4]) {
      const view = make();
      view.yaw = yaw;
      view.apply();

      // Um ponto fixo do chão, à frente do alvo.
      const alvoX = view.target.x + 12;
      const alvoZ = view.target.z - 7;
      const antes = naTela(view, alvoX, alvoZ);

      // Dedo para a direita e para baixo.
      view.pan(60, 40, 800);
      const depois = naTela(view, alvoX, alvoZ);

      expect(depois.x - antes.x, `yaw ${yaw}: eixo X`).toBeGreaterThan(0);
      expect(depois.y - antes.y, `yaw ${yaw}: eixo Y`).toBeGreaterThan(0);
    }
  });

  it('para a frente é para cima na tela, em qualquer giro', () => {
    // O mesmo sinal trocado fazia o W andar de ré. Girar a cena não pode mudar
    // o que a tecla significa: "frente" é sempre para longe de quem olha.
    for (const yaw of [0, 0.7, 1.9, -2.4]) {
      const view = make();
      view.yaw = yaw;
      view.apply();

      const alvoX = view.target.x;
      const alvoZ = view.target.z;
      view.move(0, 10);
      // O ponto que ficou para trás desce na tela: o alvo avançou.
      expect(naTela(view, alvoX, alvoZ).y, `yaw ${yaw}`).toBeGreaterThan(0);

      const lado = make();
      lado.yaw = yaw;
      lado.move(10, 0);
      expect(naTela(lado, alvoX, alvoZ).x, `yaw ${yaw}: direita`).toBeLessThan(0);
    }
  });

  it('o arrasto rende mais longe do que perto', () => {
    // Com fator fixo, arrastar de perto atravessa o mapa e arrastar de longe
    // não sai do lugar.
    const perto = make();
    perto.distance = 15;
    const a = perto.target.clone();
    perto.pan(100, 0, 800);
    const dPerto = perto.target.distanceTo(a);

    const longe = make();
    longe.distance = 150;
    const b = longe.target.clone();
    longe.pan(100, 0, 800);
    expect(longe.target.distanceTo(b)).toBeGreaterThan(dPerto);
  });

  it('nunca olha baixo o bastante para mostrar o horizonte', () => {
    // Ver o horizonte é ver a borda do trecho carregado — o mundo ganha fim
    // visível, e a ilusão de mapa infinito acaba.
    const view = make();
    view.tiltBy(-99);
    view.distance = view.limits.minDistance;
    expect(view.pitch).toBeGreaterThan(1.1);
  });

  it('afastar nunca abaixa a câmera', () => {
    // O acoplamento zoom -> inclinação sobrou pouco depois que a faixa virou
    // top-down (1,18 a 1,45 rad): numa tela alta o extra de retrato já
    // encosta no teto nas duas pontas. O que ainda precisa valer é a direção —
    // afastar jamais pode rebaixar a câmera e trazer o horizonte de volta.
    const view = make();
    view.distance = view.limits.minDistance;
    const perto = view.pitch;
    view.distance = view.limits.maxDistance;
    expect(view.pitch).toBeGreaterThanOrEqual(perto);
  });

  it('a inclinação respeita os limites em qualquer entrada', () => {
    const view = make();
    view.tiltBy(-99);
    expect(view.pitch).toBeGreaterThanOrEqual(view.limits.minPitch);
    view.tiltBy(99);
    expect(view.pitch).toBeLessThanOrEqual(view.limits.maxPitch);
  });

  it('o zoom respeita os limites', () => {
    const view = make();
    for (let i = 0; i < 50; i++) view.zoomBy(2);
    expect(view.distance).toBe(view.limits.minDistance);
    for (let i = 0; i < 50; i++) view.zoomBy(0.5);
    expect(view.distance).toBe(view.limits.maxDistance);
  });

  it('a câmera nunca entra no morro', () => {
    // Sem a trava, aproximar numa encosta enfia a câmera dentro do terreno e a
    // tela fica preta — um jeito rápido de o jogo parecer quebrado.
    const morro = new PerspectiveCamera(58, 1, 0.1, 900);
    const view = new CityCamera(morro, () => 40);
    view.distance = view.limits.minDistance;
    view.tiltBy(-99);
    view.apply();
    expect(morro.position.y).toBeGreaterThan(40);
  });
});

describe('Limite da vila', () => {
  const bounds = {
    centerX: 0,
    centerZ: 0,
    radius: 46,
    settlementName: 'Aurora',
    neighbourName: 'Krom Central',
  };

  it('dentro do raio nada muda', () => {
    expect(outsideRatio(bounds, 0, 0)).toBe(0);
    expect(outsideRatio(bounds, 40, 0)).toBe(0);
    expect(isBlocked(bounds, 20, 20)).toBe(false);
  });

  it('a transição é gradual, não um degrau', () => {
    // Linha dura no chão pareceria falha de render.
    const meio = outsideRatio(bounds, bounds.radius + FADE_WIDTH / 2, 0);
    expect(meio).toBeGreaterThan(0);
    expect(meio).toBeLessThan(1);
  });

  it('além da faixa está bloqueado', () => {
    expect(isBlocked(bounds, bounds.radius + FADE_WIDTH + 10, 0)).toBe(true);
  });

  it('o freio desliza pela borda em vez de empurrar ao centro', () => {
    // Empurrar de volta ao centro daria um solavanco a cada quadro contra a
    // parede; deslizar mantém o movimento lateral funcionando.
    const fora = clampToBounds(bounds, 300, 0);
    expect(Math.hypot(fora.x, fora.z)).toBeCloseTo(bounds.radius + FADE_WIDTH, 4);
    expect(fora.z).toBe(0);
    // Direção preservada.
    const diagonal = clampToBounds(bounds, 300, 300);
    expect(diagonal.x).toBeCloseTo(diagonal.z, 4);
  });

  it('o aviso nomeia o destino', () => {
    expect(blockedMessage(bounds)).toContain('Krom Central');
    expect(blockedHint(bounds)).toContain('Aurora');
  });
});

describe('Limites de zoom', () => {
  it('a faixa acompanha o tamanho da vila', () => {
    // Afastar além de enquadrar a vila só mostra o cinza de fora do limite: o
    // mapa vira decoração e a escala se perde.
    const l = defaultLimits;
    expect(l.minDistance).toBeGreaterThanOrEqual(12);
    expect(l.maxDistance).toBeLessThanOrEqual(130);
    expect(l.maxDistance / l.minDistance).toBeLessThan(10);
  });
});

describe('Regras de visibilidade das telas', () => {
  it('a folha de estilo esconde o atributo hidden com !important', () => {
    // Regressão real: `.tela { display: flex }` vencia a regra
    // `[hidden] { display: none }` do navegador, e as quatro telas apareciam
    // empilhadas numa página rolável. O atributo estava certo o tempo todo —
    // um teste que perguntasse `elemento.hidden` teria passado.
    const css = readFileSync(
      new URL('../classico.html', import.meta.url),
      'utf8',
    );
    expect(css).toMatch(/\[hidden\]\s*\{\s*display:\s*none\s*!important/);
  });

  it('nenhuma regra de .tela declara display sem cobrir o hidden', () => {
    // Guarda contra a mesma pegadinha voltando por outro seletor.
    const css = readFileSync(
      new URL('../classico.html', import.meta.url),
      'utf8',
    );
    const importante = css.indexOf('[hidden]');
    const telaDisplay = css.indexOf('.tela {');
    expect(importante).toBeGreaterThan(-1);
    expect(importante).toBeLessThan(telaDisplay);
  });
});

describe('Barra de recursos e ponteiro', () => {
  const html = (): string =>
    readFileSync(new URL('../classico.html', import.meta.url), 'utf8');

  it('dinheiro, dia, vitais e obras têm lugar fixo no HUD', () => {
    // Nenhum dos quatro aparecia em lugar nenhum: o jogador escolhia uma
    // construção sem saber se tinha crédito, via a obra começar sem saber
    // quando acabava, e passava fome sem sinal.
    const css = html();
    for (const id of ['rec-creditos', 'rec-dia', 'rec-vitais', 'rec-obras']) {
      expect(css).toContain(`id="${id}"`);
    }
  });

  it('a meta atual, o trabalho do dia e o diário têm lugar no HUD', () => {
    // O jogo é economia e sobrevivência antes de ser construção: sem escolher
    // trabalho não há salário, e sem o diário o reset acontece invisível.
    const css = html();
    for (const id of ['quests', 'lista-trabalho', 'diario', 'abrir-trabalho']) {
      expect(css).toContain(`id="${id}"`);
    }
  });

  it('a barra recua o painel em tela larga, e a regra vem depois da base', () => {
    // Mesma especificidade: quem vem por último vence. Escrita antes, a regra
    // perdia em silêncio e o indicador de obras ficava atrás do painel.
    const css = html();
    const base = css.indexOf('#recursos {');
    const recuo = css.indexOf('#recursos { right: calc(');
    expect(base).toBeGreaterThan(-1);
    expect(recuo).toBeGreaterThan(base);
  });

  it('o catálogo tem o próprio fechar', () => {
    // Ele é `fixed` no rodapé com z-index acima do painel: aberto, cobria o
    // botão que o abriu, e só dava para sair escolhendo uma construção.
    expect(html()).toContain('id="fechar-catalogo"');
  });

  it('os cursores do jogo cobrem os quatro estados', () => {
    const css = html();
    expect(css).toMatch(/#viewport\s*\{\s*cursor:\s*url\('ui\/cursor\/hand_open/);
    expect(css).toContain('body.arrastando');
    expect(css).toContain('body.construindo');
    expect(css).toContain('body.sobre-construcao');
  });

  it('o ponto quente do cursor não fica no canto', () => {
    // Com `0 0` o cursor mira 16 px acima e à esquerda de onde parece mirar, e
    // numa grade de 4 m isso é uma célula inteira de erro.
    const css = html();
    const usos = [...css.matchAll(/cursor:\s*url\('ui\/cursor\/[a-z_]+\.png'\)\s+(\d+)\s+(\d+)/g)];
    expect(usos.length).toBeGreaterThanOrEqual(4);
    for (const [, x, y] of usos) {
      expect(Number(x) + Number(y)).toBeGreaterThan(0);
    }
  });
});

describe('Mapa, mundos e carreira no HUD', () => {
  const html = (): string =>
    readFileSync(new URL('../classico.html', import.meta.url), 'utf8');

  it('o mapa e a qualificação têm porta de entrada', () => {
    const css = html();
    expect(css).toContain('id="abrir-mapa"');
    expect(css).toContain('id="lista-cursos"');
  });

  it('a ficha da construção aparece no catálogo do jogo', () => {
    // Sem ela o catálogo diz quanto custa e não diz para quê, e com 41 peças
    // isso é escolher pelo preço.
    expect(html()).toContain('id="ficha-construcao"');
  });
});
