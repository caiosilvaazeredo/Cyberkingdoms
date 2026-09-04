import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { INVASAO_CHANCE_DE_SLINGSHOT, INVASAO_CHANCE_DE_TOCHA } from '../src/shared/regras';

/**
 * O README promete "uma onda em cada cinco" e "uma onda em cada sete" — números
 * escritos por extenso, para gente ler, que não têm nenhum vínculo com
 * `INVASAO_CHANCE_DE_TOCHA`/`_SLINGSHOT` além da atenção de quem editou os
 * dois por último. Reequilibrar a chance sem lembrar do texto deixa a
 * documentação mentindo — este teste é o vínculo que falta.
 */

const PALAVRA_PARA_NUMERO: Record<string, number> = {
  uma: 1,
  duas: 2,
  três: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
};

function chancesCitadasNoReadme(): number[] {
  const raiz = dirname(fileURLToPath(import.meta.url));
  const readme = readFileSync(join(raiz, '../README.md'), 'utf-8');
  const achados = [...readme.matchAll(/onda em cada (\w+)/g)].map((m) => {
    const numero = PALAVRA_PARA_NUMERO[m[1]!.toLowerCase()];
    if (numero === undefined) throw new Error(`palavra sem número mapeado: "${m[1]}"`);
    return numero;
  });
  return achados;
}

describe('os números do README batem com as constantes', () => {
  it('a raridade do Torch Goblin e do Slingshot Gnome é a que o texto promete', () => {
    const [tocha, slingshot] = chancesCitadasNoReadme();
    expect(tocha, 'onda em cada N citada para o Torch Goblin').toBe(
      Math.round(1 / INVASAO_CHANCE_DE_TOCHA),
    );
    expect(slingshot, 'onda em cada N citada para o Slingshot Gnome').toBe(
      Math.round(1 / INVASAO_CHANCE_DE_SLINGSHOT),
    );
  });
});
