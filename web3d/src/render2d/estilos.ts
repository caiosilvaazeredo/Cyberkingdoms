import { allBuildings, type BuildingCategory } from '../building/buildingType';

/**
 * A identidade visual de cada construção, montada com as peças do pacote.
 *
 * ## O problema
 *
 * O catálogo tem 41 construções e o Tiny Swords traz 8 formas de prédio. A
 * primeira ponte foi por categoria, e o resultado foi honesto e ruim: cinco
 * construções de refino viravam o mesmo quartel, e o terreno ficava com cinco
 * silhuetas iguais que só o rótulo distinguia.
 *
 * ## A saída, que é a do próprio pacote
 *
 * O pacote entrega cada prédio em **cinco cores de telhado** — azul, vermelho,
 * amarelo, roxo e preto. São 8 × 5 = 40 combinações para 41 construções, e a
 * pegada corta ainda mais: um prédio de um tile não pode vestir um sprite de
 * três colunas sem invadir o vizinho, o que derruba o teto real para 35.
 *
 * Faltam seis, e é o **anexo** que as cobre: uma segunda construção menor
 * encostada na principal. Nenhuma construção precisou ser cortada do catálogo.
 *
 * A leitura vira, então, quatro camadas:
 *
 * - **forma** — o porte. Casa pequena, casa grande, torre, quartel, mosteiro.
 *   A forma respeita a pegada: uma construção de 1 tile nunca ganha um sprite
 *   de três, que invadiria o vizinho.
 * - **cor do telhado** — a família. Azul é moradia e água, amarelo é terra e
 *   comércio, vermelho é fogo e força, roxo é ofício fino, preto é indústria
 *   suja e coisa proibida.
 * - **anexo** — o conjunto. Portão com guarita, quartel com torre, sede com
 *   casa ao lado. Dois volumes se leem de longe como outra coisa.
 * - **enfeites** — o que aquilo *faz*. Pilha de madeira, monte de minério,
 *   ferramentas no chão, ovelha pastando, fumaça saindo.
 *
 * ## Por que a fumaça e o fogo só aparecem produzindo
 *
 * Chaminé apagada é a forma mais barata de dizer "esta oficina está parada" —
 * mais barata que texto, e legível de longe. Quem desenha decide isso pelo
 * estado real da construção; aqui ficam só a intenção e a peça.
 */

export type Forma =
  | 'House1'
  | 'House2'
  | 'House3'
  | 'Tower'
  | 'Barracks'
  | 'Archery'
  | 'Monastery'
  | 'Castle';

export type Cor = 'blue' | 'red' | 'yellow' | 'purple' | 'black';

export type Enfeite =
  | 'madeira'
  | 'ouro'
  | 'pedra'
  | 'carne'
  | 'ferramenta1'
  | 'ferramenta2'
  | 'ferramenta3'
  | 'ferramenta4'
  | 'pedregulho'
  | 'arbusto'
  | 'toco'
  | 'ovelha';

/** Efeito animado, desenhado só quando a construção está produzindo. */
export type Fx = 'fogo' | 'fumaca';

export interface Estilo {
  readonly forma: Forma;
  readonly cor: Cor;
  /**
   * Uma segunda construção, menor, encostada na principal.
   *
   * É o que resolve a conta que não fecha. Forma × cor dá 40 combinações, e o
   * tamanho da pegada corta quais delas cada construção pode usar: um prédio
   * de um tile não pode vestir um sprite de três colunas sem invadir o
   * vizinho. Contando essa restrição sobram 35 combinações para 41
   * construções.
   *
   * O anexo abre o espaço que faltava, e abre pelo lado certo: um conjunto de
   * dois volumes se lê de longe como outra coisa, enquanto uma diferença só de
   * enfeite se perde no zoom de tela cheia. Também cai bem no que ele
   * representa — portão com guarita, quartel com torre, sede com anexo.
   */
  readonly anexo?: Forma;
  readonly enfeites: readonly Enfeite[];
  readonly fx?: Fx;
}

/** Largura nativa de cada forma, em tiles. Quem desenha usa para não deformar. */
export const LARGURA_DA_FORMA: Record<Forma, number> = {
  House1: 2,
  House2: 2,
  House3: 2,
  Tower: 2,
  Barracks: 3,
  Archery: 3,
  Monastery: 3,
  Castle: 5,
};

/**
 * O elenco completo, construção por construção.
 *
 * A tabela é escrita à mão de propósito. Uma regra automática — hash do id
 * virando cor — daria variedade sem significado: a fundição sairia azul-clara
 * e a moradia, preta. Aqui cada linha é uma decisão sobre o que aquele prédio
 * é, e o teste garante que nenhuma delas colide com outra.
 */
export const ESTILOS: Readonly<Record<string, Estilo>> = {
  // --- moradia -------------------------------------------------------------
  shack: { forma: 'House3', cor: 'yellow', enfeites: ['toco'] },
  capsuleBlock: { forma: 'House1', cor: 'blue', enfeites: [] },
  apartment: { forma: 'House2', cor: 'blue', enfeites: [] },
  penthouse: { forma: 'House1', cor: 'purple', enfeites: ['ouro'] },

  // --- extração: terra, poeira e o que sai do chão -------------------------
  oilDerrick: { forma: 'Tower', cor: 'yellow', enfeites: ['pedra'], fx: 'fumaca' },
  scrapYard: { forma: 'Archery', cor: 'black', enfeites: ['pedregulho', 'ferramenta1'] },
  rareEarthShaft: { forma: 'Barracks', cor: 'purple', enfeites: ['pedra'] },
  hydroponicBay: { forma: 'House2', cor: 'yellow', enfeites: ['arbusto'] },
  bioreactor: { forma: 'Monastery', cor: 'black', enfeites: ['arbusto'], fx: 'fumaca' },
  biomassField: { forma: 'Barracks', cor: 'yellow', enfeites: ['madeira', 'ovelha'] },
  waterReclaimer: { forma: 'House3', cor: 'blue', enfeites: [] },

  // --- refino: fogo e chaminé ----------------------------------------------
  refinery: { forma: 'Barracks', cor: 'black', enfeites: ['pedra'], fx: 'fogo' },
  textileWorkshop: { forma: 'House2', cor: 'purple', enfeites: ['ferramenta2'] },
  hardwareWorkshop: { forma: 'House1', cor: 'black', enfeites: ['ferramenta3'], fx: 'fumaca' },
  chemLab: { forma: 'Monastery', cor: 'purple', enfeites: [], fx: 'fumaca' },
  foundry: { forma: 'Barracks', cor: 'red', enfeites: ['pedra'], fx: 'fogo' },

  // --- manufatura: ferramenta no pátio -------------------------------------
  gunsmithy: { forma: 'House2', cor: 'red', enfeites: ['ferramenta4'] },
  droneAssembly: { forma: 'Archery', cor: 'purple', enfeites: ['ferramenta1'] },
  implantClinic: { forma: 'Monastery', cor: 'blue', enfeites: ['ferramenta2'] },
  industrialKitchen: { forma: 'Archery', cor: 'red', enfeites: ['carne'], fx: 'fumaca' },
  tailorShop: { forma: 'House3', cor: 'purple', enfeites: ['ferramenta2'] },

  // --- comércio: ouro à vista ----------------------------------------------
  shopFront: { forma: 'House1', cor: 'yellow', enfeites: ['ouro'] },
  warehouse: { forma: 'Archery', cor: 'yellow', enfeites: ['madeira', 'ouro'] },
  tradingPost: { forma: 'Barracks', cor: 'blue', enfeites: ['ouro'] },
  auctionHouse: { forma: 'Monastery', cor: 'yellow', enfeites: ['ouro', 'carne'] },
  blackMarketStall: { forma: 'House3', cor: 'black', enfeites: ['ouro'] },

  // --- infraestrutura: serviço, não indústria ------------------------------
  generator: { forma: 'Tower', cor: 'red', enfeites: ['ferramenta3'], fx: 'fumaca' },
  waterTower: { forma: 'Tower', cor: 'blue', enfeites: [] },
  commsAntenna: { forma: 'Tower', cor: 'purple', enfeites: [] },
  garage: { forma: 'Archery', cor: 'blue', enfeites: ['ferramenta4'] },
  greenhouse: { forma: 'Monastery', cor: 'red', enfeites: ['arbusto'] },
  wastePlant: { forma: 'House3', cor: 'red', enfeites: ['pedregulho'], fx: 'fumaca' },

  // --- defesa: pedra, e o anexo vira guarita -------------------------------
  perimeterWall: { forma: 'House2', cor: 'black', enfeites: ['pedregulho'] },
  watchtower: { forma: 'Tower', cor: 'black', enfeites: [] },
  armoredGate: { forma: 'House2', cor: 'black', anexo: 'Tower', enfeites: ['pedregulho'] },
  bunker: { forma: 'House3', cor: 'black', anexo: 'Tower', enfeites: ['pedregulho'] },

  // --- cívico: conjuntos, porque instituição ocupa mais que uma casa -------
  plaza: { forma: 'House2', cor: 'blue', anexo: 'House3', enfeites: ['arbusto', 'ouro'] },
  bar: { forma: 'House1', cor: 'red', enfeites: ['carne'] },
  fightPit: { forma: 'Castle', cor: 'red', enfeites: ['pedregulho', 'carne'] },
  militiaHall: { forma: 'Barracks', cor: 'red', anexo: 'Tower', enfeites: ['ferramenta4'] },
  committeeHall: { forma: 'Monastery', cor: 'blue', anexo: 'House1', enfeites: [] },
};

/** Estilo de reserva, por categoria. Só vale para id fora do catálogo. */
const RESERVA: Record<BuildingCategory, Estilo> = {
  housing: { forma: 'House1', cor: 'blue', enfeites: [] },
  extraction: { forma: 'House3', cor: 'yellow', enfeites: ['pedra'] },
  refining: { forma: 'Barracks', cor: 'red', enfeites: [], fx: 'fumaca' },
  manufacturing: { forma: 'House2', cor: 'purple', enfeites: ['ferramenta1'] },
  commerce: { forma: 'House3', cor: 'yellow', enfeites: ['ouro'] },
  infrastructure: { forma: 'Tower', cor: 'black', enfeites: [] },
  defense: { forma: 'Tower', cor: 'red', enfeites: ['pedregulho'] },
  civic: { forma: 'Monastery', cor: 'blue', enfeites: [] },
};

export function estiloDe(buildingId: string, categoria: BuildingCategory): Estilo {
  return ESTILOS[buildingId] ?? RESERVA[categoria];
}

/** Toda cor × forma que o jogo pode pedir. Quem carrega os sprites usa isto. */
export const FORMAS_USADAS: readonly Forma[] = [
  'House1', 'House2', 'House3', 'Tower', 'Barracks', 'Archery', 'Monastery', 'Castle',
];
export const CORES_USADAS: readonly Cor[] = ['blue', 'red', 'yellow', 'purple', 'black'];

/** Ids do catálogo sem estilo próprio. Vazio é o estado correto. */
export function construcoesSemEstilo(): readonly string[] {
  return allBuildings.filter((d) => !ESTILOS[d.id]).map((d) => d.id);
}
