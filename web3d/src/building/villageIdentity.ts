import { allEmblems } from './buildingType';

/**
 * Identidade visual e social do vilarejo.
 *
 * A escolha é cosmética, mas é o que transforma "o terreno" em "o **meu**
 * terreno" — e, no multiplayer, é como os outros jogadores reconhecem alguém no
 * mapa e no livro de ofertas. Num jogo onde a economia é entre pessoas, saber
 * de quem é a oferta vale tanto quanto o preço.
 */

export interface VillageIdentityJson {
  name: string;
  motto: string;
  emblem: string;
  primaryColor: number;
  secondaryColor: number;
}

export const DEFAULT_VILLAGE_NAME = 'Meu Terreno';
export const DEFAULT_PRIMARY = 0xff00e5ff;
export const DEFAULT_SECONDARY = 0xffff2d95;

export class VillageIdentity {
  constructor(
    readonly name: string = DEFAULT_VILLAGE_NAME,
    /** Lema exibido junto ao brasão. Livre, e opcional. */
    readonly motto: string = '',
    readonly emblem: string = 'banner',
    /** Cores em ARGB. Tingem o brasão e as construções sem cor própria. */
    readonly primaryColor: number = DEFAULT_PRIMARY,
    readonly secondaryColor: number = DEFAULT_SECONDARY,
  ) {}

  /**
   * Vilarejo com identidade completa rende reputação.
   *
   * No CyberKingdoms aparência é capital político, e o bônus existe para que
   * nomear o terreno não seja só enfeite. O nome padrão não conta: manter o
   * que o jogo deu não é escolher.
   */
  get statusBonus(): number {
    let bonus = 0;
    if (this.name.trim() !== '' && this.name !== DEFAULT_VILLAGE_NAME) bonus += 1;
    if (this.motto.trim() !== '') bonus += 1;
    return bonus;
  }

  copyWith(patch: Partial<VillageIdentityJson>): VillageIdentity {
    return new VillageIdentity(
      patch.name ?? this.name,
      patch.motto ?? this.motto,
      patch.emblem ?? this.emblem,
      patch.primaryColor ?? this.primaryColor,
      patch.secondaryColor ?? this.secondaryColor,
    );
  }

  toJson(): VillageIdentityJson {
    return {
      name: this.name,
      motto: this.motto,
      emblem: this.emblem,
      primaryColor: this.primaryColor,
      secondaryColor: this.secondaryColor,
    };
  }

  static fromJson(json: Partial<VillageIdentityJson> | null): VillageIdentity {
    const cor = (v: unknown, padrao: number): number => {
      const bruto = Number(v);
      return Number.isFinite(bruto) ? Math.trunc(bruto) : padrao;
    };
    return new VillageIdentity(
      typeof json?.name === 'string' ? json.name : DEFAULT_VILLAGE_NAME,
      typeof json?.motto === 'string' ? json.motto : '',
      parseEmblem(json?.emblem),
      cor(json?.primaryColor, DEFAULT_PRIMARY),
      cor(json?.secondaryColor, DEFAULT_SECONDARY),
    );
  }
}

/** Brasão desconhecido cai no estandarte em vez de derrubar o save. */
export function parseEmblem(id: unknown): string {
  return allEmblems.some((e) => e.id === id) ? (id as string) : 'banner';
}

/**
 * Paleta oferecida ao jogador.
 *
 * Lista curta e curada de propósito: um seletor de cor livre produz terrenos
 * feios e ilegíveis no mapa. Todas as cores aqui têm contraste suficiente sobre
 * o fundo escuro do jogo.
 */
export const villagePalette: readonly { label: string; argb: number }[] = [
  { label: 'Ciano', argb: 0xff00e5ff },
  { label: 'Rosa Shocking', argb: 0xffff2d95 },
  { label: 'Âmbar', argb: 0xffffb300 },
  { label: 'Verde Ácido', argb: 0xff00e676 },
  { label: 'Violeta', argb: 0xffb388ff },
  { label: 'Laranja Tóxico', argb: 0xffff6d00 },
  { label: 'Azul Elétrico', argb: 0xff2979ff },
  { label: 'Vermelho Sangue', argb: 0xffff5252 },
  { label: 'Turquesa', argb: 0xff00bfa5 },
  { label: 'Amarelo Sinal', argb: 0xfffff176 },
  { label: 'Magenta Frio', argb: 0xffe040fb },
  { label: 'Cinza Aço', argb: 0xff90a4ae },
];

export function paletteLabelFor(argb: number): string {
  return villagePalette.find((s) => s.argb === argb)?.label ?? 'Personalizada';
}

/** `#rrggbb` a partir de um ARGB, para o CSS. */
export function cssColor(argb: number): string {
  return `#${(argb & 0xffffff).toString(16).padStart(6, '0')}`;
}
