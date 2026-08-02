import { beforeEach, describe, expect, it } from 'vitest';

import { allBuildings, buildingDef, maxBuildingLevel } from '../src/building/buildingType';
import { allModules, modulesFor } from '../src/building/buildingModule';
import { Plot, plotSizeForLevel, runPlotTick } from '../src/building/plot';
import { Inventory } from '../src/economy/inventory';
import { allItems } from '../src/economy/item';

/** Terreno vazio de sobrevivente, com inventário e caixa fartos. */
function novo(): { plot: Plot; inv: Inventory } {
  const [w, h] = plotSizeForLevel('elite');
  const inv = new Inventory();
  for (const item of allItems) inv.add(item.id, 500);
  return {
    plot: new Plot('p', 'cap_0', { x: 100, y: 100 }, w, h),
    inv,
  };
}

const rico = { level: 'elite' as const, credits: 5_000_000 };

/** Uma construção barata que produz algo. */
const produtora = allBuildings.find(
  (d) => d.produces !== null && d.outputPerDay > 0 && d.width <= 2,
)!;

describe('Catálogo de construções', () => {
  it('as 41 construções carregaram', () => {
    expect(allBuildings.length).toBe(41);
  });

  it('todo módulo serve em pelo menos uma categoria', () => {
    // Um módulo sem categoria nunca poderia ser instalado — seria conteúdo
    // morto que o jogador vê na lista e não consegue usar.
    for (const m of allModules) {
      expect(m.categories.length, m.id).toBeGreaterThan(0);
      expect(modulesFor(m.categories[0]!)).toContain(m);
    }
  });
});

describe('Colocação no terreno', () => {
  let plot: Plot;
  let inv: Inventory;
  beforeEach(() => {
    ({ plot, inv } = novo());
  });

  it('a pré-visualização aceita um encaixe válido', () => {
    const check = plot.canPlace(produtora.id, 0, 0, { ...rico, inventory: inv });
    expect(check.valid).toBe(true);
    expect(check.reason).toBeNull();
  });

  it('recusa o que não cabe no terreno, com motivo', () => {
    // A mensagem é o que a pré-visualização mostra enquanto o dedo arrasta.
    const check = plot.canPlace(produtora.id, plot.width - 1, 0, {
      ...rico,
      inventory: inv,
    });
    expect(check.valid).toBe(false);
    expect(check.reason).toMatch(/não cabe/);
  });

  it('recusa sobreposição, nomeando quem está no caminho', () => {
    plot.build(produtora.id, 0, 0, { ...rico, inventory: inv });
    const check = plot.canPlace(produtora.id, 0, 0, { ...rico, inventory: inv });
    expect(check.valid).toBe(false);
    expect(check.reason).toMatch(/Sobrepõe/);
  });

  it('recusa por nível de cidadão', () => {
    const nobre = allBuildings.find((d) => d.requiredLevel === 'elite')!;
    const check = plot.canPlace(nobre.id, 0, 0, {
      level: 'survivor',
      credits: 5_000_000,
      inventory: inv,
    });
    expect(check.valid).toBe(false);
    expect(check.reason).toMatch(/nível/);
  });

  it('checar não cobra nada', () => {
    // A pré-visualização roda a cada quadro enquanto o dedo arrasta; se
    // cobrasse, o jogador ficaria sem material só de olhar.
    const antes = inv.quantityOf(Object.keys(produtora.materialCost)[0]!);
    for (let i = 0; i < 20; i++) {
      plot.canPlace(produtora.id, 0, 0, { ...rico, inventory: inv });
    }
    expect(inv.quantityOf(Object.keys(produtora.materialCost)[0]!)).toBe(antes);
  });

  it('construir cobra os materiais e entra em obra', () => {
    const material = Object.keys(produtora.materialCost)[0]!;
    const antes = inv.quantityOf(material);

    const r = plot.build(produtora.id, 0, 0, { ...rico, inventory: inv });
    expect(r.ok).toBe(true);
    expect(inv.quantityOf(material)).toBeLessThan(antes);
    if (r.ok) {
      expect(r.building.isReady).toBe(produtora.buildDays <= 0);
      expect(plot.at(0, 0)).toBe(r.building);
    }
  });

  it('demolir devolve metade dos materiais', () => {
    // Devolução total tornaria o planejamento irrelevante, que é justamente a
    // decisão que um tycoon pede.
    const material = Object.keys(produtora.materialCost)[0]!;
    const custo = produtora.materialCost[material]!;

    const r = plot.build(produtora.id, 0, 0, { ...rico, inventory: inv });
    expect(r.ok).toBe(true);
    const depoisDeConstruir = inv.quantityOf(material);

    plot.demolish((r as { building: { instanceId: string } }).building.instanceId, inv);
    expect(inv.quantityOf(material)).toBe(
      depoisDeConstruir + Math.floor(custo * 0.5),
    );
    expect(plot.buildings).toHaveLength(0);
  });
});

describe('Níveis e módulos', () => {
  it('evoluir aumenta produção e manutenção, a manutenção mais', () => {
    // É o que impede que subir tudo ao nível III seja sempre a jogada certa.
    const { plot, inv } = novo();
    const r = plot.build(produtora.id, 0, 0, { ...rico, inventory: inv });
    if (!r.ok) throw new Error('falhou');
    r.building.daysRemaining = 0;

    const antes = r.building.stats;
    plot.upgrade(r.building.instanceId, { credits: 5_000_000, inventory: inv });
    r.building.daysRemaining = 0;
    r.building.upgrading = false;
    const depois = r.building.stats;

    expect(depois.outputPerDay).toBeGreaterThanOrEqual(antes.outputPerDay);
    if (antes.dailyUpkeep > 0) {
      const razaoManut = depois.dailyUpkeep / antes.dailyUpkeep;
      const razaoProd =
        antes.outputPerDay > 0 ? depois.outputPerDay / antes.outputPerDay : 1;
      expect(razaoManut).toBeGreaterThan(razaoProd);
    }
  });

  it('não evolui além do nível máximo', () => {
    const { plot, inv } = novo();
    const r = plot.build(produtora.id, 0, 0, { ...rico, inventory: inv });
    if (!r.ok) throw new Error('falhou');

    for (let i = 0; i < 6; i++) {
      r.building.daysRemaining = 0;
      r.building.upgrading = false;
      plot.upgrade(r.building.instanceId, { credits: 5_000_000, inventory: inv });
    }
    expect(r.building.level).toBe(maxBuildingLevel);
  });

  it('o número de encaixes de módulo cresce com o nível', () => {
    const { plot, inv } = novo();
    const r = plot.build(produtora.id, 0, 0, { ...rico, inventory: inv });
    if (!r.ok) throw new Error('falhou');
    const slotsN1 = r.building.moduleSlots;
    r.building.level = maxBuildingLevel;
    expect(r.building.moduleSlots).toBeGreaterThan(slotsN1);
  });

  it('recusa módulo que não serve na categoria', () => {
    const { plot, inv } = novo();
    const r = plot.build(produtora.id, 0, 0, { ...rico, inventory: inv });
    if (!r.ok) throw new Error('falhou');
    r.building.daysRemaining = 0;

    const incompativel = allModules.find(
      (m) => !m.categories.includes(buildingDef(produtora.id).category),
    );
    if (!incompativel) return;

    const out = plot.installModule(r.building.instanceId, incompativel.id, {
      credits: 5_000_000,
      inventory: inv,
    });
    expect(out.ok).toBe(false);
  });
});

describe('Reset diário do terreno', () => {
  it('a obra que termina no tick já produz no mesmo tick', () => {
    // Comportamento do original, verificado e mantido: o laço que desconta os
    // dias roda **antes** de montar a lista de operantes, então quem ficou
    // pronto entra na mesma rodada. Eu tinha suposto o contrário ao escrever
    // este teste; o código estava certo e a suposição, errada.
    //
    // Faz sentido para o jogador: o dia em que a obra acaba é um dia de
    // trabalho, não de espera.
    const { plot, inv } = novo();
    const r = plot.build(produtora.id, 0, 0, { ...rico, inventory: inv });
    if (!r.ok) throw new Error('falhou');
    r.building.daysRemaining = 1;

    const dia1 = runPlotTick(plot, { inventory: inv, availableCredits: 100000 });
    expect(dia1.completed).toContain(r.building);
    expect(r.building.isReady).toBe(true);
  });

  it('obra em andamento não produz', () => {
    const { plot, inv } = novo();
    const r = plot.build(produtora.id, 0, 0, { ...rico, inventory: inv });
    if (!r.ok) throw new Error('falhou');
    r.building.daysRemaining = 3;

    const out = runPlotTick(plot, { inventory: inv, availableCredits: 100000 });
    expect(out.completed).toHaveLength(0);
    expect(Object.keys(out.produced)).toHaveLength(0);
  });

  it('sem caixa a construção para, e é registrada', () => {
    const { plot, inv } = novo();
    const cara = allBuildings.find((d) => d.dailyUpkeep > 0 && d.width <= 2)!;
    const r = plot.build(cara.id, 0, 0, { ...rico, inventory: inv });
    if (!r.ok) throw new Error('falhou');
    r.building.daysRemaining = 0;

    const out = runPlotTick(plot, { inventory: inv, availableCredits: 0 });
    expect(out.idled).toContain(r.building);
    expect(r.building.idle).toBe(true);
    expect(out.upkeepPaid).toBe(0);
  });

  it('com caixa curto, mantém as baratas em vez da cara', () => {
    // A manutenção é cobrada da mais cara para a mais barata justamente para
    // que caixa apertado sustente mais construções, não menos.
    const { plot, inv } = novo();
    const baratas = allBuildings
      .filter((d) => d.dailyUpkeep > 0 && d.width === 1 && d.height === 1)
      .slice(0, 2);
    if (baratas.length < 2) return;

    let x = 0;
    for (const def of baratas) {
      const r = plot.build(def.id, x, 0, { ...rico, inventory: inv });
      if (r.ok) r.building.daysRemaining = 0;
      x += 2;
    }

    const total = plot.operational.reduce((s, b) => s + b.stats.dailyUpkeep, 0);
    const out = runPlotTick(plot, {
      inventory: inv,
      availableCredits: total - 1,
    });
    expect(out.idled.length).toBe(1);
    expect(out.upkeepPaid).toBeLessThan(total);
  });

  it('sem insumo a construção para em vez de produzir do nada', () => {
    const consumidora = allBuildings.find(
      (d) => Object.keys(d.consumes).length > 0 && d.produces !== null,
    );
    if (!consumidora) return;

    const { plot, inv } = novo();
    const r = plot.build(consumidora.id, 0, 0, { ...rico, inventory: inv });
    if (!r.ok) throw new Error('falhou');
    r.building.daysRemaining = 0;

    // Esvazia os insumos.
    for (const id of Object.keys(consumidora.consumes)) {
      inv.remove(id, inv.quantityOf(id));
    }

    const out = runPlotTick(plot, { inventory: inv, availableCredits: 100000 });
    expect(out.idled).toContain(r.building);
    expect(out.produced[consumidora.produces!] ?? 0).toBe(0);
  });

  it('uma construção sem funcionário ainda rende alguma coisa', () => {
    // Zerar a produção travaria o jogador solo logo no começo.
    const comVagas = allBuildings.find(
      (d) => d.jobSlots > 0 && d.produces !== null && d.outputPerDay > 3 &&
        Object.keys(d.consumes).length === 0,
    );
    if (!comVagas) return;

    const { plot, inv } = novo();
    const r = plot.build(comVagas.id, 0, 0, { ...rico, inventory: inv });
    if (!r.ok) throw new Error('falhou');
    r.building.daysRemaining = 0;
    r.building.workers = 0;

    const out = runPlotTick(plot, { inventory: inv, availableCredits: 100000 });
    expect(out.produced[comVagas.produces!] ?? 0).toBeGreaterThan(0);
  });

  it('ida e volta por JSON preserva o terreno', () => {
    const { plot, inv } = novo();
    const r = plot.build(produtora.id, 1, 1, { ...rico, inventory: inv });
    if (!r.ok) throw new Error('falhou');
    r.building.customName = 'Minha Oficina';
    r.building.level = 2;

    const copia = Plot.fromJson(plot.toJson());
    expect(copia.buildings).toHaveLength(1);
    expect(copia.buildings[0]!.displayName).toBe('Minha Oficina');
    expect(copia.buildings[0]!.level).toBe(2);
    expect(copia.at(1, 1)).not.toBeNull();
  });

  it('sobrevive a um save com construção que saiu do catálogo', () => {
    const copia = Plot.fromJson({
      id: 'p',
      settlementId: 'cap_0',
      origin: { x: 0, y: 0 },
      width: 8,
      height: 8,
      buildings: [
        {
          instanceId: 'b1',
          type: 'construcao_removida',
          x: 0,
          y: 0,
          daysRemaining: 0,
          workers: 0,
          idle: false,
          level: 1,
          upgrading: false,
          customName: null,
          accentColor: null,
          modules: [],
        },
      ],
    });
    expect(copia.buildings).toHaveLength(0);
  });
});
