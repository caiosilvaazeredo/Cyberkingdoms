import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { Campaign } from '../src/campaign/campaign';
import {
  cancelJourney,
  daysOfSupplies,
  planJourney,
  startJourney,
} from '../src/campaign/journey';
import { runDailyTick } from '../src/campaign/dailyTick';
import { TileCoord } from '../src/world/coords';
import { findRoute, nearestSettlement } from '../src/world/travel';
import { corDoBioma, enquadrar, passoDaEscala } from '../src/ui/mapScreen';
import { Biome } from '../src/world/biome';

/**
 * Ir de uma cidade a outra.
 *
 * O reset já sabia **terminar** uma viagem desde o começo do projeto; o que não
 * existia era o começo dela, e por isso as vinte cidades do mapa eram vinte
 * lugares que ninguém visitava. Estes testes cobrem o caminho inteiro: achar a
 * rota, conferir o mantimento, entrar na estrada e chegar.
 */

const campanha = (label = 'contrato-dart-ts'): Campaign =>
  Campaign.create({ id: 'viagem', seedLabel: label, characterName: 'Viajante', now: 0 });

describe('Traçado das estradas', () => {
  it('toda estrada chega ao destino, e nenhuma vagueia', () => {
    // O defeito que este teste prende custou metade do mapa: o desvio de água
    // empurrava a posição sem corrigir o termo de erro do Bresenham, a linha
    // nunca reencontrava o destino e batia no teto de 20 mil passos. Como
    // `travelDays` sai do comprimento, a estrada virava uma viagem de 222 dias
    // — mais do que um personagem sobrevive sem comer.
    for (const label of ['contrato-dart-ts', 'verde', 'krom']) {
      const layout = campanha(label).world.layout;
      for (const road of layout.roads) {
        const a = layout.byId(road.fromId)!;
        const b = layout.byId(road.toId)!;
        const fim = road.path[road.path.length - 1]!;

        expect(fim.x, `${label} ${road.fromId}->${road.toId}`).toBe(b.center.x);
        expect(fim.y, `${label} ${road.fromId}->${road.toId}`).toBe(b.center.y);

        // O caminho é monotônico: cada passo encurta a distância que falta, e
        // por isso não pode ser mais longo que a soma das duas distâncias.
        const teto =
          Math.abs(b.center.x - a.center.x) + Math.abs(b.center.y - a.center.y) + 4;
        expect(road.path.length).toBeLessThanOrEqual(teto);
      }
    }
  });

  it('nenhuma viagem direta é mais longa que um mês', () => {
    // Não é gosto: com 20 e poucos de Fome por dia de estrada, mais de trinta
    // dias sem cidade é uma rota que ninguém consegue percorrer viva.
    for (const label of ['contrato-dart-ts', 'verde', 'krom']) {
      for (const road of campanha(label).world.layout.roads) {
        expect(road.travelDays, `${label} ${road.fromId}->${road.toId}`).toBeLessThan(30);
      }
    }
  });
});

describe('Rota pela malha', () => {
  it('a rota até a própria cidade é vazia e não custa nada', () => {
    const c = campanha();
    const aqui = c.currentSettlementId!;
    const r = findRoute(c.world.layout, aqui, aqui)!;
    expect(r.days).toBe(0);
    expect(r.stops).toEqual([aqui]);
  });

  it('liga qualquer par de cidades, e a rota é uma corrente de estradas', () => {
    const c = campanha();
    const layout = c.world.layout;
    const origem = layout.capitals[0]!.id;

    for (const s of layout.settlements) {
      const r = findRoute(layout, origem, s.id);
      expect(r, `sem rota até ${s.id}`).not.toBeNull();
      if (!r) continue;

      expect(r.stops[0]).toBe(origem);
      expect(r.stops[r.stops.length - 1]).toBe(s.id);
      // Cada par consecutivo tem de ser uma estrada de verdade: uma rota que
      // "pula" de uma cidade a outra sem estrada seria teletransporte.
      let dias = 0;
      for (let i = 0; i + 1 < r.stops.length; i++) {
        const trecho = layout
          .roadsFrom(r.stops[i]!)
          .find((road) => layout.otherEnd(road, r.stops[i]!) === r.stops[i + 1]);
        expect(trecho, `sem estrada ${r.stops[i]}->${r.stops[i + 1]}`).toBeDefined();
        dias += trecho?.travelDays ?? 0;
      }
      expect(r.days).toBe(dias);
    }
  });

  it('escolhe o caminho de menos dias, não o de menos escalas', () => {
    // O peso é dia porque `travelDays` já embute o terreno. Ordenar por número
    // de trechos faria a rota "mais curta" ser a mais demorada.
    const c = campanha();
    const layout = c.world.layout;
    for (const s of layout.settlements) {
      const r = findRoute(layout, layout.capitals[0]!.id, s.id)!;
      for (const vizinho of layout.roadsFrom(s.id)) {
        const outro = layout.otherEnd(vizinho, s.id);
        const via = findRoute(layout, layout.capitals[0]!.id, outro)!;
        expect(r.days).toBeLessThanOrEqual(via.days + vizinho.travelDays);
      }
    }
  });

  it('o perigo da rota é o do pior trecho', () => {
    const c = campanha();
    const layout = c.world.layout;
    const r = findRoute(layout, layout.capitals[0]!.id, layout.satellites[3]!.id)!;
    let pior = 0;
    for (let i = 0; i + 1 < r.stops.length; i++) {
      const trecho = layout
        .roadsFrom(r.stops[i]!)
        .find((road) => layout.otherEnd(road, r.stops[i]!) === r.stops[i + 1])!;
      pior = Math.max(pior, trecho.danger);
    }
    expect(r.danger).toBeCloseTo(pior, 10);
  });

  it('cidade inexistente não devolve rota', () => {
    expect(findRoute(campanha().world.layout, 'cap_0', 'nao_existe')).toBeNull();
  });

  it('a saída é a cidade mais próxima de onde o jogador estiver', () => {
    const c = campanha();
    const alvo = c.world.layout.satellites[2]!;
    const perto = nearestSettlement(
      c.world.layout,
      new TileCoord(alvo.center.x + 3, alvo.center.y - 4),
    );
    expect(perto?.id).toBe(alvo.id);
  });
});

describe('Entrar na estrada', () => {
  it('não viaja para onde já se está', () => {
    const c = campanha();
    const r = planJourney(c, c.currentSettlementId!);
    expect(r.ok).toBe(false);
  });

  it('sai de onde o jogador está, mesmo fora de cidade', () => {
    // Quem saiu a pé e está no descampado não deveria ter de voltar andando
    // até a cidade só para poder pegar a estrada.
    const c = campanha();
    const origem = c.world.layout.byId(c.currentSettlementId!)!;
    c.character.position = new TileCoord(origem.center.x + 400, origem.center.y + 400);
    expect(c.currentSettlementId).toBeNull();

    const destino = c.world.layout.satellites[0]!.id;
    const r = planJourney(c, destino);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.fromId).toBe(nearestSettlement(c.world.layout, c.character.position)?.id);
  });

  it('partir marca destino e dias, sem adiantar o calendário', () => {
    // Quem conta dia é o reset. Adiantar aqui cobraria o primeiro dia duas
    // vezes — uma agora, outra na virada.
    const c = campanha();
    const destino = c.world.layout.satellites[0]!.id;
    const dia = c.day;

    const r = startJourney(c, destino);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(c.character.travellingTo).toBe(destino);
    expect(c.character.travelDaysRemaining).toBe(Math.max(1, r.route.days));
    expect(c.character.isTravelling).toBe(true);
    expect(c.day).toBe(dia);
  });

  it('não começa uma segunda viagem por cima da primeira', () => {
    const c = campanha();
    startJourney(c, c.world.layout.satellites[0]!.id);
    const r = planJourney(c, c.world.layout.satellites[1]!.id);
    expect(r.ok).toBe(false);
  });

  it('o reset entrega o personagem na cidade de destino', () => {
    const c = campanha();
    const destino = c.world.layout.satellites[0]!;
    const r = startJourney(c, destino.id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // Come antes: a viagem é o que mata quem sai sem mantimento, e o que este
    // teste verifica é a chegada, não a fome.
    for (let i = 0; i < r.route.days; i++) {
      c.character.hunger = 100;
      c.character.thirst = 100;
      runDailyTick(c, {});
    }

    expect(c.character.travellingTo).toBeNull();
    expect(c.character.position.x).toBe(destino.center.x);
    expect(c.character.position.y).toBe(destino.center.y);
    expect(c.currentSettlementId).toBe(destino.id);
  });

  it('desistir tira da estrada sem devolver o dia gasto', () => {
    const c = campanha();
    startJourney(c, c.world.layout.satellites[0]!.id);
    cancelJourney(c);
    expect(c.character.isTravelling).toBe(false);
    expect(c.character.travellingTo).toBeNull();
  });
});

describe('Mantimento', () => {
  it('conta os vitais de agora mais o que a mochila repõe', () => {
    const c = campanha();
    const semNada = daysOfSupplies(c);
    expect(semNada).toBeGreaterThan(0);

    c.character.inventory.add('water', 10);
    c.character.inventory.add('streetFood', 10);
    expect(daysOfSupplies(c)).toBeGreaterThan(semNada);
  });

  it('o eixo mais curto manda: água sozinha não sustenta a viagem', () => {
    // Vinte garrafas e nenhuma comida não são vinte dias de estrada. Se o aviso
    // contasse a soma, ele prometeria uma viagem que o reset não entrega.
    const c = campanha();
    c.character.inventory.add('water', 40);
    const soAgua = daysOfSupplies(c);
    c.character.inventory.add('streetFood', 40);
    expect(daysOfSupplies(c)).toBeGreaterThan(soAgua);
  });

  it('sem mantimento, uma viagem longa mata — e é o que o aviso diz', () => {
    const c = campanha();
    const layout = c.world.layout;
    // A cidade mais cara de alcançar a partir daqui.
    const longe = layout.settlements
      .map((s) => ({ s, r: findRoute(layout, c.currentSettlementId!, s.id) }))
      .filter((e) => e.r)
      .sort((a, b) => b.r!.days - a.r!.days)[0]!;

    const aguenta = daysOfSupplies(c);
    if (longe.r!.days <= aguenta) return; // mundo pequeno: nada a provar

    startJourney(c, longe.s.id);
    let morreu = false;
    for (let i = 0; i < longe.r!.days; i++) {
      runDailyTick(c, {});
      if (c.character.dead) {
        morreu = true;
        break;
      }
    }
    expect(morreu).toBe(true);
  });
});

describe('Enquadramento do mapa', () => {
  it('o quadro é quadrado e cabe tudo que foi passado', () => {
    const q = enquadrar([
      { x: -300, y: -100 },
      { x: 500, y: 40 },
      { x: 0, y: 0 },
    ]);
    expect(q.lado).toBeGreaterThan(800);
    expect(q.minX).toBeLessThan(-300);
    expect(q.minY).toBeLessThan(-100);
    expect(q.minX + q.lado).toBeGreaterThan(500);
    expect(q.minY + q.lado).toBeGreaterThan(40);
  });

  it('um mundo achatado fica centrado, não colado numa borda', () => {
    // Sem centralizar o eixo menor, um mapa largo e baixo desenharia todas as
    // cidades encostadas no topo do quadro.
    const q = enquadrar([
      { x: -400, y: -5 },
      { x: 400, y: 5 },
    ]);
    const folgaCima = -5 - q.minY;
    const folgaBaixo = q.minY + q.lado - 5;
    expect(Math.abs(folgaCima - folgaBaixo)).toBeLessThan(1);
  });

  it('a paleta do mapa separa água, mata e descampado', () => {
    // Pintar com a cor do solo puro deixava mata fechada e terra devastada com
    // o mesmo marrom-arroxeado: um mapa em que nada se distingue não informa
    // nada. A mistura é proporcional à densidade de grama.
    const canal = (cor: string, i: number): number =>
      parseInt(cor.slice(1 + i * 2, 3 + i * 2), 16);

    const agua = corDoBioma(Biome.deadWater);
    const mata = corDoBioma(Biome.reclaimedForest);
    const deserto = corDoBioma(Biome.wasteland);

    // Água puxa para o azul; mata, para o verde.
    expect(canal(agua, 2)).toBeGreaterThan(canal(agua, 0));
    expect(canal(mata, 1)).toBeGreaterThan(canal(mata, 0));
    expect(canal(mata, 1)).toBeGreaterThan(canal(mata, 2));
    // E as três precisam ser visivelmente diferentes entre si.
    for (const [a, b] of [
      [agua, mata],
      [mata, deserto],
      [agua, deserto],
    ]) {
      const distancia = [0, 1, 2].reduce(
        (soma, i) => soma + Math.abs(canal(a, i) - canal(b, i)),
        0,
      );
      expect(distancia, `${a} vs ${b}`).toBeGreaterThan(40);
    }
  });

  it('a régua usa número redondo', () => {
    expect(passoDaEscala(1000)).toBe(200);
    expect(passoDaEscala(1300)).toBe(300);
    expect(passoDaEscala(97)).toBe(20);
    // Nunca zero: uma régua de zero metro não mede nada.
    expect(passoDaEscala(1)).toBeGreaterThan(0);
  });
});

describe('Marcação da viagem e da mochila', () => {
  const html = readFileSync(new URL('../classico.html', import.meta.url), 'utf8');

  it('a mochila existe e tem como fechar', () => {
    // Comer e beber não tinham porta de entrada nenhuma: `consume` existia no
    // domínio e nada chamava, então os vitais só desciam.
    expect(html).toContain('id="mochila"');
    expect(html).toContain('id="abrir-mochila"');
    expect(html).toContain('id="fechar-mochila"');
  });

  it('o fundo do mapa não interpola bioma', () => {
    // Alisar inventaria bioma que não existe entre duas amostras vizinhas.
    const bloco = html.slice(html.indexOf('.mapa-fundo'));
    expect(bloco.slice(0, 400)).toContain('image-rendering: pixelated');
  });

  it('os nomes no mapa não recebem toque', () => {
    // Um rótulo que rouba o toque da cidade vizinha é pior que rótulo nenhum.
    const bloco = html.slice(html.indexOf('.mapa-rotulos'));
    expect(bloco.slice(0, 200)).toContain('pointer-events: none');
  });

  it('o botão de viajar respeita o alvo de toque do celular', () => {
    const bloco = html.slice(html.indexOf('.mapa-viajar'));
    expect(bloco.slice(0, 300)).toContain('min-height: var(--toque)');
  });
});
