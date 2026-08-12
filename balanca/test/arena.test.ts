import { describe, expect, it } from 'vitest';

import {
  CASTELO,
  PONTES_Y,
  criarArena,
  espelhar,
  resolverColisao,
  type TipoDeEstrutura,
} from '../src/shared/arena';
import { Navegador } from '../src/shared/navegacao';
import { RAIO_UNIDADE, TILE, TIMES } from '../src/shared/regras';

/**
 * O mapa: simetria e alcançabilidade.
 *
 * Um mapa competitivo assimétrico é um mapa desequilibrado, e um mapa com um
 * canto inalcançável é um bot parado na parede a partida inteira. As duas
 * coisas são invisíveis lendo o código — e óbvias para quem está jogando.
 */

const TIPOS: TipoDeEstrutura[] = ['trono', 'jaula', 'cozinha', 'chapelaria', 'nascedouro'];

describe('a arena', () => {
  const arena = criarArena(123);

  it('dá a cada reino as mesmas jazidas e os mesmos pastos', () => {
    for (const tipo of ['arvore', 'ouro'] as const) {
      const azul = arena.jazidas.filter((j) => j.lado === 'azul' && j.tipo === tipo);
      const vermelho = arena.jazidas.filter((j) => j.lado === 'vermelho' && j.tipo === tipo);
      expect(azul).toHaveLength(vermelho.length);
      // E no espelho exato: uma árvore um tile mais longe da cozinha de um lado
      // é vantagem econômica que ninguém escolheu dar.
      expect(azul.map((j) => espelhar(Math.floor(j.x / TILE))).sort()).toEqual(
        vermelho.map((j) => Math.floor(j.x / TILE)).sort(),
      );
    }
    expect(arena.pastos.filter((p) => p.lado === 'azul')).toHaveLength(
      arena.pastos.filter((p) => p.lado === 'vermelho').length,
    );
  });

  it('é espelhada: o que vale para um reino vale para o outro', () => {
    for (let ty = 0; ty < arena.altura; ty++) {
      for (let tx = 0; tx < arena.largura; tx++) {
        expect(arena.tile(tx, ty)).toBe(arena.tile(espelhar(tx), ty));
      }
    }
  });

  it('põe cada construção no espelho da do inimigo', () => {
    for (const tipo of TIPOS) {
      const azul = arena.estrutura(tipo, 'azul');
      const vermelho = arena.estrutura(tipo, 'vermelho');
      expect(azul.ty).toBe(vermelho.ty);
      expect(espelhar(azul.tx)).toBe(vermelho.tx);
    }
  });

  it('não deixa nada em cima da água', () => {
    for (const e of arena.estruturas) {
      expect(arena.bloqueado(e.tx, e.ty)).toBe(false);
    }
    for (const ponto of [...arena.jazidas, ...arena.pastos]) {
      expect(arena.bloqueado(Math.floor(ponto.x / TILE), Math.floor(ponto.y / TILE))).toBe(false);
    }
  });

  it('liga tudo o que o jogo precisa alcançar', () => {
    const navegador = new Navegador(arena);
    for (const time of TIMES) {
      const casa = arena.estrutura('nascedouro', time);
      const destinos = [
        ...arena.estruturas.filter((e) => e.time !== time),
        ...arena.estruturas.filter((e) => e.time === time),
        ...arena.jazidas,
        ...arena.pastos,
      ];
      for (const destino of destinos) {
        expect(navegador.distancia(casa.x, casa.y, destino.x, destino.y)).toBeLessThan(Infinity);
      }
    }
  });

  it('cerca cada castelo, deixando só as pontes', () => {
    // Na coluna do fosso, as únicas passagens são as pontes. É o que dá à
    // defesa algo para defender: sem isso o castelo teria uma frente de vinte
    // tiles e nenhum estrangulamento.
    const passagens: number[] = [];
    for (let ty = CASTELO.y0; ty <= CASTELO.y1; ty++) {
      if (!arena.bloqueado(CASTELO.x1, ty)) passagens.push(ty);
    }
    expect(passagens).toEqual([...PONTES_Y]);
  });

  it('a colisão desliza pela parede em vez de grudar', () => {
    const arena2 = criarArena(5);
    // Encostado na moldura de água de cima, empurrando para o norte e o leste.
    let x = 10 * TILE;
    let y = 2 * TILE + RAIO_UNIDADE;
    for (let i = 0; i < 30; i++) {
      const r = resolverColisao(arena2, x + 6, y - 6, RAIO_UNIDADE);
      x = r.x;
      y = r.y;
    }
    expect(x).toBeGreaterThan(10 * TILE + 60);
    expect(arena2.bloqueado(Math.floor(x / TILE), Math.floor(y / TILE))).toBe(false);
  });
});

describe('o navegador', () => {
  it('guarda um campo por destino, e não um por consulta', () => {
    const arena = criarArena(9);
    const navegador = new Navegador(arena);
    const alvo = arena.estrutura('jaula', 'vermelho');
    for (let i = 0; i < 50; i++) {
      navegador.direcao(200 + i, 400, alvo.x, alvo.y);
    }
    expect(navegador.guardados).toBe(1);
  });

  it('aponta para o lado certo do fosso', () => {
    const arena = criarArena(9);
    const navegador = new Navegador(arena);
    const casa = arena.estrutura('nascedouro', 'azul');
    const alvo = arena.estrutura('jaula', 'vermelho');
    let x = casa.x;
    let y = casa.y;
    let passos = 0;
    while (Math.hypot(alvo.x - x, alvo.y - y) > TILE && passos < 4000) {
      const d = navegador.direcao(x, y, alvo.x, alvo.y);
      expect(d).not.toBeNull();
      const passo = resolverColisao(arena, x + d!.x * 8, y + d!.y * 8, RAIO_UNIDADE);
      x = passo.x;
      y = passo.y;
      passos++;
    }
    expect(passos).toBeLessThan(4000);
  });
});
