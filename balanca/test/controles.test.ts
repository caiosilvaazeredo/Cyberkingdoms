import { describe, expect, it } from 'vitest';

import {
  ESQUEMAS,
  Porteiro,
  atualizarRumo,
  fontesLivres,
  lerControle,
  lerTeclado,
  rotuloDaFonte,
} from '../src/client/controles';

/**
 * As quatro pessoas do sofá, e as regras que as mantêm separadas.
 *
 * Este é o tipo de código que quebra em silêncio: dois esquemas de teclado que
 * compartilham uma tecla fazem dois personagens andarem juntos, e ninguém
 * descobre até a segunda pessoa sentar. O teste diz na hora.
 */

const WASD = ESQUEMAS[0]!;
const SETAS = ESQUEMAS[1]!;

/** Um controle parado, com os botões mutáveis para o teste apertar. */
function padZerado(indice = 0): { indice: number; eixos: number[]; botoes: boolean[] } {
  return { indice, eixos: [0, 0, 0, 0], botoes: Array<boolean>(16).fill(false) };
}

describe('os esquemas de teclado', () => {
  it('não dividem tecla nenhuma entre si', () => {
    // Uma tecla em dois esquemas é dois bonecos andando grudados. É o erro que
    // mais dói e o mais fácil de cometer ao acrescentar um atalho.
    const todas = (e: typeof WASD): string[] => [
      ...e.esquerda,
      ...e.direita,
      ...e.cima,
      ...e.baixo,
      ...e.atacar,
      ...e.usar,
      ...e.entrar,
    ];
    const a = new Set(todas(WASD));
    for (const tecla of todas(SETAS)) expect(a.has(tecla)).toBe(false);
  });

  it('anda para onde a tecla manda, em cada esquema', () => {
    const rumo = { x: 1, y: 0 };
    const wasd = lerTeclado(WASD, new Set(['KeyA']), rumo, null);
    expect(wasd.mx).toBe(-1);
    const setas = lerTeclado(SETAS, new Set(['ArrowDown']), rumo, null);
    expect(setas.my).toBe(1);
    // E o WASD não responde às setas, nem o contrário.
    expect(lerTeclado(WASD, new Set(['ArrowDown']), rumo, null).my).toBe(0);
    expect(lerTeclado(SETAS, new Set(['KeyA']), rumo, null).mx).toBe(0);
  });

  it('sem mouse, o golpe sai para onde a pessoa está indo', () => {
    const leitura = lerTeclado(SETAS, new Set(['Period']), { x: 0, y: -1 }, null);
    expect(leitura.atacar).toBe(true);
    expect(leitura.ay).toBe(-1);
  });

  it('com mouse, a mira é a direção do personagem até o cursor', () => {
    const leitura = lerTeclado(
      WASD,
      new Set<string>(),
      { x: 0, y: -1 },
      { cursor: { x: 300, y: 200 }, centro: { x: 200, y: 200 } },
    );
    expect(leitura.ax).toBeCloseTo(1);
    expect(leitura.ay).toBeCloseTo(0);
  });
});

describe('o controle', () => {
  it('ignora o analógico descansado', () => {
    const pad = padZerado();
    pad.eixos = [0.1, -0.12, 0, 0];
    const leitura = lerControle(pad, { x: 1, y: 0 });
    expect(leitura.mx).toBe(0);
    expect(leitura.my).toBe(0);
  });

  it('mira com o analógico direito e volta ao rumo quando ele é solto', () => {
    const pad = padZerado();
    pad.eixos = [0, 0, 0, -1];
    expect(lerControle(pad, { x: 1, y: 0 }).ay).toBeCloseTo(-1);
    pad.eixos = [0, 0, 0, 0];
    expect(lerControle(pad, { x: 1, y: 0 }).ax).toBeCloseTo(1);
  });

  it('aceita o direcional digital como se fosse o analógico', () => {
    const pad = padZerado();
    pad.botoes[14] = true; // esquerda
    expect(lerControle(pad, { x: 1, y: 0 }).mx).toBe(-1);
  });
});

describe('o rumo', () => {
  it('guarda a última direção andada e ignora o repouso', () => {
    let rumo = { x: 1, y: 0 };
    rumo = atualizarRumo(rumo, 0, -1);
    expect(rumo).toEqual({ x: 0, y: -1 });
    // Parado, o personagem continua olhando para onde ia — senão o ataque
    // sairia para lugar nenhum toda vez que alguém solta a tecla.
    rumo = atualizarRumo(rumo, 0, 0);
    expect(rumo).toEqual({ x: 0, y: -1 });
  });
});

describe('o porteiro da cabine', () => {
  it('só deixa entrar quem apertou agora, e não quem já estava apertando', () => {
    const porteiro = new Porteiro();
    // O `Enter` que confirmou o apelido ainda está afundado quando a cabine
    // abre: armar o porteiro com ele impede a vaga fantasma.
    porteiro.armar(new Set(['Enter']), []);
    expect(porteiro.quemEntrou(new Set(['Enter']), [], new Set())).toBeNull();
    expect(porteiro.quemEntrou(new Set<string>(), [], new Set())).toBeNull();
    expect(porteiro.quemEntrou(new Set(['Enter']), [], new Set())).toBe('teclado:setas');
  });

  it('não entrega uma fonte que já é de alguém', () => {
    const porteiro = new Porteiro();
    const ocupadas = new Set(['teclado:wasd' as const]);
    expect(porteiro.quemEntrou(new Set(['Space']), [], ocupadas)).toBeNull();
  });

  it('deixa cada controle entrar pelo botão A, um por vez', () => {
    const porteiro = new Porteiro();
    const um = padZerado(0);
    const dois = padZerado(3);
    um.botoes[0] = true;
    dois.botoes[0] = true;
    // Dois pedidos no mesmo quadro rendem uma vaga, não duas: mão apoiada no
    // teclado não pode ocupar o sofá inteiro.
    const primeiro = porteiro.quemEntrou(new Set<string>(), [um, dois], new Set());
    expect(primeiro).toBe('controle:0');
    const segundo = porteiro.quemEntrou(
      new Set<string>(),
      [um, dois],
      new Set([primeiro!]),
    );
    expect(segundo).toBeNull();
  });
});

describe('as fontes livres', () => {
  it('listam os teclados e os controles ligados, menos os já ocupados', () => {
    const livres = fontesLivres([padZerado(2)], new Set(['teclado:wasd' as const]));
    expect(livres.map((l) => l.fonte)).toEqual(['teclado:setas', 'controle:2']);
    // O rótulo é o que a pessoa lê na moldura vazia: tem de dizer o que apertar.
    expect(livres[0]!.comoEntrar).toBe('Enter');
    expect(rotuloDaFonte('controle:2')).toBe('Controle 3');
  });
});
