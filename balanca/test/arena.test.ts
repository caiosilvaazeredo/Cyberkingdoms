import { describe, expect, it } from 'vitest';

import { criarArena, decoracaoEm, espelhar, resolverColisao, type TipoDeEstrutura } from '../src/shared/arena';
import { IDS_DOS_MAPAS, MAPAS } from '../src/shared/mapas';
import { Navegador } from '../src/shared/navegacao';
import { RAIO_UNIDADE, TILE, TIMES } from '../src/shared/regras';

/**
 * Os mapas: simetria e alcançabilidade, para todos eles.
 *
 * Um mapa competitivo assimétrico é um mapa desequilibrado, e um mapa com um
 * canto inalcançável é um bot parado na parede a partida inteira. As duas
 * coisas são invisíveis lendo o código — e óbvias para quem está jogando.
 *
 * Este arquivo roda **em laço sobre a tabela de mapas**, e é essa a razão de
 * um mapa novo ser barato: escrever quarenta linhas de coordenadas e descobrir
 * na hora se elas produzem um campo jogável, em vez de abrir o navegador e
 * andar até o canto para ver se dá.
 */

const TIPOS: TipoDeEstrutura[] = ['tesouraria', 'cofre', 'casaDaMoeda', 'chapelaria', 'nascedouro'];

describe.each(IDS_DOS_MAPAS)('o mapa %s', (id) => {
  const arena = criarArena(123, id);
  const mapa = MAPAS[id];

  it('dá a cada reino as mesmas jazidas e os mesmos pastos', () => {
    for (const tipo of ['arvore', 'ouro'] as const) {
      const azul = arena.jazidas.filter((j) => j.lado === 'azul' && j.tipo === tipo);
      const vermelho = arena.jazidas.filter((j) => j.lado === 'vermelho' && j.tipo === tipo);
      expect(azul).toHaveLength(vermelho.length);
      // E no espelho exato: uma árvore um tile mais longe da Casa da Moeda de um lado
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

  it('estrangula onde diz que estrangula, e só ali', () => {
    // Cada portão declarado tem de ter exatamente as passagens que promete. É o
    // que dá à defesa algo para defender — e é a parte que mais fácil se quebra
    // ao mexer num relevo, porque um tile de água a mais fecha o mapa e um a
    // menos abre um buraco que ninguém vê.
    //
    // Um mapa sem portão nenhum é legítimo: o Vau existe para isso. O que não
    // pode é prometer um estrangulamento e não entregá-lo.
    for (const portao of mapa.portoes) {
      const passagens: number[] = [];
      for (let ty = portao.de; ty <= portao.ate; ty++) {
        if (!arena.bloqueado(portao.coluna, ty)) passagens.push(ty);
      }
      expect(passagens).toEqual([...portao.passagens]);
    }
  });

  it('não deixa nenhum ponto de interesse dentro do castelo do inimigo', () => {
    // A cofre do azul guarda o baú vermelha e fica no castelo azul; tudo o
    // mais que tem lado precisa estar do lado certo do eixo, senão o mapa dá a
    // um time uma jazida dentro da casa do outro.
    const meio = (arena.largura * TILE) / 2;
    for (const j of arena.jazidas) {
      if (j.lado === 'azul') expect(j.x).toBeLessThan(meio);
      if (j.lado === 'vermelho') expect(j.x).toBeGreaterThan(meio);
    }
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

  it('árvores, arbustos e pedras decorativas bloqueiam a passagem', () => {
    let encontrada: { x: number; y: number } | null = null;
    for (let y = 0; y < arena.altura && !encontrada; y++) {
      for (let x = 0; x < arena.largura; x++) {
        if (decoracaoEm(arena, x, y)) {
          encontrada = { x, y };
          break;
        }
      }
    }

    expect(encontrada).not.toBeNull();
    expect(arena.bloqueado(encontrada!.x, encontrada!.y)).toBe(true);
  });
});

describe('o navegador', () => {
  it('guarda um campo por destino, e não um por consulta', () => {
    const arena = criarArena(9);
    const navegador = new Navegador(arena);
    const alvo = arena.estrutura('cofre', 'vermelho');
    for (let i = 0; i < 50; i++) {
      navegador.direcao(200 + i, 400, alvo.x, alvo.y);
    }
    expect(navegador.guardados).toBe(1);
  });

  it('aponta para o lado certo do fosso', () => {
    const arena = criarArena(9);
    const navegador = new Navegador(arena);
    const casa = arena.estrutura('nascedouro', 'azul');
    const alvo = arena.estrutura('cofre', 'vermelho');
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
