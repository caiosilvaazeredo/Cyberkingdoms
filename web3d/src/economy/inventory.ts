import { isEquippable, isItemId, itemDef } from './item';

/** Modificadores de consumo somados dos itens equipados. */
export interface UpkeepModifiers {
  readonly hunger: number;
  readonly thirst: number;
}

export interface InventoryJson {
  stacks: Record<string, number>;
  equipped: string[];
}

/**
 * Inventário do personagem: quantidades por item e o que está equipado.
 *
 * Porta de `lib/domain/economy/inventory.dart`. As regras de saldo são as
 * mesmas — em particular, `remove` é **tudo ou nada**: ou tira a quantidade
 * inteira, ou não mexe em nada e devolve `false`. Meia remoção deixaria uma
 * compra parcialmente paga.
 */
export class Inventory {
  private readonly stacksMap: Map<string, number>;
  private readonly equippedSet: Set<string>;

  constructor(stacks?: Iterable<[string, number]>, equipped?: Iterable<string>) {
    this.stacksMap = new Map(stacks ?? []);
    this.equippedSet = new Set(equipped ?? []);
  }

  get stacks(): ReadonlyMap<string, number> {
    return this.stacksMap;
  }

  get equipped(): ReadonlySet<string> {
    return this.equippedSet;
  }

  quantityOf(id: string): number {
    return this.stacksMap.get(id) ?? 0;
  }

  has(id: string, quantity = 1): boolean {
    return this.quantityOf(id) >= quantity;
  }

  add(id: string, quantity: number): void {
    if (quantity <= 0) return;
    this.stacksMap.set(id, this.quantityOf(id) + quantity);
  }

  /**
   * Remove `quantity` unidades. Devolve `false` e não altera nada se não
   * houver saldo — os chamadores tratam isso como "transação recusada".
   */
  remove(id: string, quantity: number): boolean {
    if (quantity <= 0) return true;
    const current = this.quantityOf(id);
    if (current < quantity) return false;
    if (current === quantity) {
      this.stacksMap.delete(id);
      // Zerar o estoque desequipa: continuar "usando" uma arma que não se tem
      // mais deixaria poder de ataque fantasma no combate.
      this.equippedSet.delete(id);
    } else {
      this.stacksMap.set(id, current - quantity);
    }
    return true;
  }

  equip(id: string): boolean {
    if (!this.has(id)) return false;
    if (!isEquippable(itemDef(id))) return false;
    this.equippedSet.add(id);
    return true;
  }

  unequip(id: string): void {
    this.equippedSet.delete(id);
  }

  get totalWeight(): number {
    let sum = 0;
    for (const [id, qty] of this.stacksMap) sum += itemDef(id).weight * qty;
    return sum;
  }

  /**
   * Patrimônio a preço-base. Não é o que o mercado pagaria — serve para o
   * placar e para o requisito de patrimônio das quests.
   */
  get estimatedValue(): number {
    let sum = 0;
    for (const [id, qty] of this.stacksMap) sum += itemDef(id).baseValue * qty;
    return sum;
  }

  /**
   * Soma dos modificadores de consumo do que está equipado.
   *
   * Travada em -80%: sem o teto, empilhar equipamento zeraria a sobrevivência,
   * que é o sistema central do GDD.
   */
  get upkeepModifiers(): UpkeepModifiers {
    let hunger = 0;
    let thirst = 0;
    for (const id of this.equippedSet) {
      const def = itemDef(id);
      hunger += def.hungerUpkeepModifier;
      thirst += def.thirstUpkeepModifier;
    }
    const clamp = (v: number) => Math.min(0, Math.max(-0.8, v));
    return { hunger: clamp(hunger), thirst: clamp(thirst) };
  }

  get attackPower(): number {
    let sum = 0;
    for (const id of this.equippedSet) sum += itemDef(id).attackPower;
    return sum;
  }

  get defensePower(): number {
    let sum = 0;
    for (const id of this.equippedSet) sum += itemDef(id).defensePower;
    return sum;
  }

  /** Itens ilegais carregados. Ser pego com eles numa capital é crime. */
  get contraband(): string[] {
    return [...this.stacksMap.keys()].filter((id) => !itemDef(id).legal);
  }

  clone(): Inventory {
    return new Inventory(this.stacksMap, this.equippedSet);
  }

  toJson(): InventoryJson {
    return {
      stacks: Object.fromEntries(this.stacksMap),
      equipped: [...this.equippedSet],
    };
  }

  /**
   * Tolera itens desconhecidos: um save antigo com um item que saiu do
   * catálogo carrega sem quebrar, perdendo só aquele stack. Recusar o save
   * inteiro por causa de um item removido apagaria a campanha do jogador.
   */
  static fromJson(json: Partial<InventoryJson> | null | undefined): Inventory {
    const stacks: [string, number][] = [];
    for (const [id, qty] of Object.entries(json?.stacks ?? {})) {
      if (isItemId(id) && Number.isFinite(qty) && qty > 0) {
        stacks.push([id, Math.trunc(qty)]);
      }
    }
    const equipped = (json?.equipped ?? []).filter(isItemId);
    return new Inventory(stacks, equipped);
  }
}
