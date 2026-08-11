import { Biome } from '../world/biome';
import { DeterministicRandom } from '../core/rng';
import type { WorldGenerator } from '../world/worldGen';
import { animacao, carregarImagem, desenharQuadro, quadroEm, type Animacao } from './atlas';
import { CORES_USADAS, FORMAS_USADAS, LARGURA_DA_FORMA } from './estilos';
import { dentroDoTerreno, type Predio, type RetanguloTerreno } from './predios';
import { TILE, chaoPara, encostaNaAgua, mascaraDe } from './tileset';

export type { Predio, RetanguloTerreno } from './predios';

/**
 * O mundo do CyberKingdoms desenhado com a arte do Tiny Swords.
 *
 * ## O que muda, e o que não muda
 *
 * A geração continua sendo a mesma: bioma, elevação, cidades e estradas saem do
 * `WorldGenerator` que o jogo já usa e que está preso ao contrato com o cliente
 * Dart. Nenhuma regra foi tocada — o que este módulo troca é a **tinta**.
 *
 * A troca é maior do que parece, porque muda a projeção: o mundo era relevo
 * contínuo em três dimensões e passa a ser uma grade de tiles vista de cima. O
 * bioma, que antes virava cor de solo e densidade de grama, agora vira **peça
 * de tilemap e decoração**.
 *
 * ## Por que a água vem do bioma, e não de um mapa de altura
 *
 * O gerador já classifica `deadWater` abaixo da cota da água. Reaproveitar essa
 * classificação mantém a costa exatamente onde o resto do jogo acredita que ela
 * está: o mapa-múndi, o traçado das estradas e o desenho do terreno passam a
 * concordar sobre o que é terra sem que ninguém precise sincronizar dois
 * limiares.
 */

export interface Assets {
  readonly chao: HTMLImageElement;
  readonly agua: HTMLImageElement;
  readonly espuma: Animacao;
  readonly sombra: HTMLImageElement;
  readonly arvores: readonly Animacao[];
  readonly arbustos: readonly Animacao[];
  readonly pedras: readonly HTMLImageElement[];
  /** Indexado por `"cor/Forma"`. São 8 formas × 5 cores de telhado. */
  readonly construcoes: Readonly<Record<string, HTMLImageElement>>;
  /** Montes de recurso, ferramentas e afins, indexados pelo nome do enfeite. */
  readonly enfeites: Readonly<Record<string, HTMLImageElement>>;
  readonly ovelha: Animacao;
  readonly fogo: Animacao;
  readonly fumaca: Animacao;
  readonly peaoParado: Animacao;
  readonly peaoCorrendo: Animacao;
}

const RAIZ = '/tiny';

export async function carregarAssets(): Promise<Assets> {
  const img = (p: string): Promise<HTMLImageElement> => carregarImagem(`${RAIZ}/${p}`);
  const [
    chao, agua, espuma, sombra,
    t1, t2, t3, t4,
    b1, b2, b3, b4,
    r1, r2, r3, r4,
    parado, correndo,
  ] = await Promise.all([
    img('terrain/ground.png'), img('terrain/water.png'),
    img('terrain/foam.png'), img('terrain/shadow.png'),
    img('deco/Tree1.png'), img('deco/Tree2.png'), img('deco/Tree3.png'), img('deco/Tree4.png'),
    img('deco/Bushe1.png'), img('deco/Bushe2.png'), img('deco/Bushe3.png'), img('deco/Bushe4.png'),
    img('deco/Rock1.png'), img('deco/Rock2.png'), img('deco/Rock3.png'), img('deco/Rock4.png'),
    img('units/Pawn_Idle.png'), img('units/Pawn_Run.png'),
  ]);

  // Toda cor × forma. São 40 arquivos de ~10 kB: carregar tudo de uma vez sai
  // mais barato que descobrir no meio do jogo que falta um telhado roxo.
  const chaves: string[] = [];
  for (const cor of CORES_USADAS) {
    for (const forma of FORMAS_USADAS) chaves.push(`${cor}/${forma}`);
  }
  const carregadas = await Promise.all(chaves.map((k) => img(`buildings/${k}.png`)));
  const construcoes: Record<string, HTMLImageElement> = {};
  chaves.forEach((k, i) => {
    construcoes[k] = carregadas[i]!;
  });

  const nomesEnfeite = [
    'madeira', 'ouro', 'pedra', 'carne', 'pedregulho', 'arbusto', 'toco',
    'ferramenta1', 'ferramenta2', 'ferramenta3', 'ferramenta4',
  ];
  const enfeitesCarregados = await Promise.all(
    nomesEnfeite.map((n) => img(`props/${n}.png`)),
  );
  const enfeites: Record<string, HTMLImageElement> = {};
  nomesEnfeite.forEach((n, i) => {
    enfeites[n] = enfeitesCarregados[i]!;
  });

  const [ovelha, fogo, fumaca] = await Promise.all([
    img('props/ovelha.png'), img('fx/fogo.png'), img('fx/fumaca.png'),
  ]);

  return {
    enfeites,
    ovelha: animacao(ovelha, 6),
    fogo: animacao(fogo, 12),
    fumaca: animacao(fumaca, 10),
    chao,
    agua,
    // A espuma é a única animação do terreno, e é lenta de propósito: o guia
    // manda cada instância começar num quadro diferente, senão a costa inteira
    // pulsa junto e o mar parece um único bicho respirando.
    espuma: animacao(espuma, 8),
    sombra,
    arvores: [t1, t2, t3, t4].map((i) => animacao(i, 8)),
    arbustos: [b1, b2, b3, b4].map((i) => animacao(i, 6)),
    pedras: [r1, r2, r3, r4],
    construcoes,
    peaoParado: animacao(parado, 8),
    peaoCorrendo: animacao(correndo, 12),
  };
}

export interface Camera {
  /** Centro da vista, em tiles. */
  x: number;
  y: number;
  /** Pixels de tela por pixel de arte. */
  zoom: number;
}

export interface Mundo2D {
  desenhar(ctx: CanvasRenderingContext2D, largura: number, altura: number, tempo: number): void;
  readonly camera: Camera;
  ehTerra(x: number, y: number): boolean;
  /** Tiles visíveis na última chamada de `desenhar`. Diagnóstico. */
  readonly tilesDesenhados: number;
  /** Decorações espalhadas no último quadro. Diagnóstico. */
  readonly decoracoes: number;
}

export function criarMundo2D(options: {
  world: WorldGenerator;
  assets: Assets;
  /**
   * As construções, lidas a cada quadro.
   *
   * É função, e não lista, porque o terreno muda **durante** a partida: erguer
   * uma construção precisa aparecer no mesmo quadro, sem recriar o mundo.
   */
  predios: () => readonly Predio[];
  /** O terreno do jogador, em tiles do mundo. */
  terreno?: RetanguloTerreno;
  camera?: Partial<Camera>;
  /** Onde o peão está, em tiles. */
  jogador: () => { x: number; y: number; andando: boolean };
}): Mundo2D {
  const { world, assets, terreno } = options;
  const camera: Camera = { x: 0, y: 0, zoom: 1, ...options.camera };

  // Uma consulta de bioma por tile é barata, mas o desenho pergunta pelo mesmo
  // tile até nove vezes — uma por vizinho de cada tile em volta. O cache evita
  // multiplicar por nove o custo do quadro.
  const cacheTerra = new Map<number, boolean>();
  const ehTerra = (x: number, y: number): boolean => {
    const chave = (x + 0x8000) * 0x10000 + (y + 0x8000);
    const guardado = cacheTerra.get(chave);
    if (guardado !== undefined) return guardado;
    const terra = world.biomeAt(x, y) !== Biome.deadWater;
    if (cacheTerra.size < 400000) cacheTerra.set(chave, terra);
    return terra;
  };

  let tilesDesenhados = 0;
  let decoracoesDesenhadas = 0;

  function desenhar(
    ctx: CanvasRenderingContext2D,
    largura: number,
    altura: number,
    tempo: number,
  ): void {
    ctx.imageSmoothingEnabled = false;
    const escala = camera.zoom;
    const tilePx = TILE * escala;

    // Meio tile de folga em cada borda: sprites altos — árvore, torre — têm o
    // pé dentro da tela e a copa fora, e recortar pelo pé faria eles piscarem
    // ao entrar em quadro.
    const colunas = Math.ceil(largura / tilePx) + 4;
    const linhas = Math.ceil(altura / tilePx) + 6;
    const x0 = Math.floor(camera.x - colunas / 2);
    const y0 = Math.floor(camera.y - linhas / 2);

    const paraTelaX = (tx: number): number => (tx - camera.x) * tilePx + largura / 2;
    const paraTelaY = (ty: number): number => (ty - camera.y) * tilePx + altura / 2;

    // --- camada 1: cor de fundo da água -----------------------------------
    ctx.fillStyle = '#1c799e';
    ctx.fillRect(0, 0, largura, altura);
    for (let ty = y0; ty < y0 + linhas; ty++) {
      for (let tx = x0; tx < x0 + colunas; tx++) {
        ctx.drawImage(
          assets.agua,
          Math.round(paraTelaX(tx)),
          Math.round(paraTelaY(ty)),
          Math.ceil(tilePx),
          Math.ceil(tilePx),
        );
      }
    }

    // --- camada 2: espuma onde a terra toca a água -------------------------
    //
    // Sprite de 192 desenhado sobre um tile de 64: ele transborda de propósito,
    // e é esse transbordo que faz a linha da costa parecer desenhada à mão em
    // vez de recortada na grade.
    tilesDesenhados = 0;
    for (let ty = y0; ty < y0 + linhas; ty++) {
      for (let tx = x0; tx < x0 + colunas; tx++) {
        if (!ehTerra(tx, ty) || !encostaNaAgua(tx, ty, ehTerra)) continue;
        const deslocamento = ((tx * 7 + ty * 13) % assets.espuma.quadros + assets.espuma.quadros) %
          assets.espuma.quadros;
        const anim = assets.espuma;
        const q = ((quadroEm(anim, tempo, deslocamento) % anim.quadros) + anim.quadros) % anim.quadros;
        const lado = anim.lado * escala * (TILE / anim.lado) * 3;
        ctx.drawImage(
          anim.imagem,
          q * anim.lado, 0, anim.lado, anim.lado,
          Math.round(paraTelaX(tx) - (lado - tilePx) / 2),
          Math.round(paraTelaY(ty) - (lado - tilePx) / 2),
          Math.ceil(lado), Math.ceil(lado),
        );
      }
    }

    // --- camada 3: chão -----------------------------------------------------
    for (let ty = y0; ty < y0 + linhas; ty++) {
      for (let tx = x0; tx < x0 + colunas; tx++) {
        if (!ehTerra(tx, ty)) continue;
        const celula = chaoPara(mascaraDe(tx, ty, ehTerra));
        ctx.drawImage(
          assets.chao,
          celula.col * TILE, celula.row * TILE, TILE, TILE,
          Math.round(paraTelaX(tx)), Math.round(paraTelaY(ty)),
          Math.ceil(tilePx), Math.ceil(tilePx),
        );
        tilesDesenhados++;
      }
    }

    // --- camada 3b: a divisa do terreno -------------------------------------
    //
    // A divisa é chão pisado, não uma linha desenhada — a mesma decisão do
    // cliente 3D. Numa vista de cima, uma linha de um pixel some debaixo dos
    // sprites; uma faixa de terra batida some debaixo de nada, e diz sem
    // legenda onde o terreno do jogador começa.
    if (terreno) {
      const faixa = Math.max(2, Math.round(6 * escala));
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = '#6b4b2a';
      for (let ty = terreno.minY; ty <= terreno.maxY; ty++) {
        for (let tx = terreno.minX; tx <= terreno.maxX; tx++) {
          if (tx > x0 + colunas || tx < x0 - 1 || ty > y0 + linhas || ty < y0 - 1) continue;
          if (!ehTerra(tx, ty)) continue;
          const naBorda =
            tx === terreno.minX || tx === terreno.maxX ||
            ty === terreno.minY || ty === terreno.maxY;
          if (!naBorda) continue;
          const px = Math.round(paraTelaX(tx));
          const py = Math.round(paraTelaY(ty));
          const lado = Math.ceil(tilePx);
          if (ty === terreno.minY) ctx.fillRect(px, py, lado, faixa);
          if (ty === terreno.maxY) ctx.fillRect(px, py + lado - faixa, lado, faixa);
          if (tx === terreno.minX) ctx.fillRect(px, py, faixa, lado);
          if (tx === terreno.maxX) ctx.fillRect(px + lado - faixa, py, faixa, lado);
        }
      }
      ctx.restore();
    }

    // --- camada 4: decoração ------------------------------------------------
    //
    // Espalhada por ruído determinístico, e não por sorteio guardado: o que
    // nasce em cada tile é função da seed e da coordenada, então o mesmo mundo
    // tem a mesma mata em qualquer sessão e nada disso precisa ir para o save.
    const predios = options.predios();
    const desenhos: { y: number; desenhar: () => void }[] = [];
    for (let ty = y0; ty < y0 + linhas; ty++) {
      for (let tx = x0; tx < x0 + colunas; tx++) {
        if (!ehTerra(tx, ty)) continue;
        // Dentro do terreno não nasce mato: é terra limpa, e é do jogador. O
        // recorte por retângulo substitui a antiga folga em volta de cada
        // prédio, que era uma aproximação de uma cerca que agora existe.
        if (terreno && dentroDoTerreno(terreno, tx, ty)) continue;
        const dado = new DeterministicRandom(
          (world.seed ^ (tx * 374761393) ^ (ty * 668265263)) >>> 0,
        );
        const sorte = dado.nextDouble();
        // Fora do terreno, o recorte é a pegada do prédio mais um tile de
        // folga. Comparar distância com **largura** limpava um quadrado de
        // onze por onze em volta do castelo: de 304 tiles visíveis, 271
        // ficavam proibidos e o mapa saía pelado.
        const perto = predios.some(
          (p) =>
            tx >= p.x - 1 && tx <= p.x + p.tiles &&
            ty >= p.y - 1 && ty <= p.y + p.tilesAltura,
        );
        if (perto) continue;

        const px = paraTelaX(tx) + tilePx / 2;
        const py = paraTelaY(ty) + tilePx;

        if (sorte < 0.09) {
          const anim = assets.arvores[dado.range(0, assets.arvores.length - 1)]!;
          const deslocamento = dado.range(0, anim.quadros - 1);
          desenhos.push({
            y: ty,
            desenhar: () =>
              desenharQuadro(ctx, anim, quadroEm(anim, tempo, deslocamento), px, py, escala * 0.85),
          });
        } else if (sorte < 0.15) {
          const anim = assets.arbustos[dado.range(0, assets.arbustos.length - 1)]!;
          const deslocamento = dado.range(0, anim.quadros - 1);
          desenhos.push({
            y: ty,
            desenhar: () =>
              desenharQuadro(ctx, anim, quadroEm(anim, tempo, deslocamento), px, py, escala),
          });
        } else if (sorte < 0.19) {
          const pedra = assets.pedras[dado.range(0, assets.pedras.length - 1)]!;
          desenhos.push({
            y: ty,
            desenhar: () => {
              const lado = TILE * escala;
              ctx.drawImage(
                pedra,
                Math.round(px - lado / 2),
                Math.round(py - lado),
                Math.ceil(lado),
                Math.ceil(lado),
              );
            },
          });
        }
      }
    }

    decoracoesDesenhadas = desenhos.length;

    // --- camada 5: construções e o peão ------------------------------------
    //
    // A posição do peão é lida antes das construções porque o rótulo depende
    // dela: só tem nome o prédio que está perto de quem joga.
    const jogador = options.jogador();

    // Só o prédio mais próximo do peão mostra o nome. Um terreno cheio tem
    // doze construções encostadas, e doze rótulos ao mesmo tempo viram uma
    // mancha de texto por cima justamente da arte que os telhados acabaram de
    // diferenciar. Obra é exceção: o prazo interessa mesmo de longe.
    let maisPerto: Predio | null = null;
    let menorDistancia = Infinity;
    for (const p of predios) {
      const d = Math.hypot(
        jogador.x - (p.x + p.tiles / 2),
        jogador.y - (p.y + p.tilesAltura / 2),
      );
      if (d < menorDistancia) {
        menorDistancia = d;
        maisPerto = p;
      }
    }
    for (const p of predios) {
      const sprite = assets.construcoes[`${p.cor}/${p.forma}`];
      if (!sprite) continue;
      // O prédio é centrado na **pegada inteira**, não no primeiro tile: uma
      // construção 2×2 desenhada a partir do canto fica meio tile fora do
      // próprio terreno, e o desencontro aparece justamente na divisa.
      //
      // A largura sai da **forma**, e não da pegada: esticar um sprite de duas
      // colunas para caber num tile achata o desenho e o pixel deixa de ser
      // quadrado. O prédio ocupa a largura nativa da forma, no máximo o que a
      // pegada permitir mais um tile de transbordo — que é como esta arte já
      // trata copa de árvore e telhado.
      const larguraEmTiles = Math.min(
        LARGURA_DA_FORMA[p.forma],
        Math.max(p.tiles, 1.3),
      ) * p.escala;
      const largura2 = larguraEmTiles * TILE * escala;
      const altura2 = (sprite.height / sprite.width) * largura2;
      const px = paraTelaX(p.x) + (p.tiles * tilePx) / 2;
      const py = paraTelaY(p.y) + p.tilesAltura * tilePx;
      const emObra = (p.obraDias ?? 0) > 0;
      desenhos.push({
        y: p.y + p.tilesAltura,
        desenhar: () => {
          // A sombra vem antes e é a peça do pacote, deslocada um tile para
          // baixo como o guia manda: é ela que planta o prédio no chão. Ela
          // acompanha o porte: fixa em dois tiles, sumia debaixo do quartel e
          // sobrava debaixo do barraco.
          const s = largura2 * 1.05;
          ctx.globalAlpha = 0.5;
          ctx.drawImage(
            assets.sombra,
            Math.round(px - s / 2),
            Math.round(py - s * 0.62),
            Math.ceil(s),
            Math.ceil(s),
          );

          // O anexo vem **antes** do principal: encostado à esquerda e um
          // pouco atrás, ele fica parcialmente coberto, que é como um conjunto
          // de construções se lê numa vista de cima. Desenhado depois, ele
          // passaria por cima da casa grande e o conjunto viraria colagem.
          // Mesma cor de telhado: é o mesmo dono.
          if (p.anexo) {
            const sa = assets.construcoes[`${p.cor}/${p.anexo}`];
            if (sa) {
              const la = largura2 * 0.6;
              const ha = (sa.height / sa.width) * la;
              ctx.globalAlpha = emObra ? 0.45 : 1;
              ctx.drawImage(
                sa,
                Math.round(px - largura2 * 0.66),
                Math.round(py - ha - tilePx * 0.18),
                Math.ceil(la), Math.ceil(ha),
              );
            }
          }

          // Obra aparece fantasma. O prédio já ocupa o espaço — a regra do
          // jogo diz que ocupa — mas ainda não produz, e a tela precisa dizer
          // isso sem que ninguém abra ficha nenhuma. Parada é o inverso: está
          // de pé e não trabalha, então perde a cor em vez da presença.
          ctx.globalAlpha = emObra ? 0.45 : 1;
          if (p.parada) ctx.filter = 'grayscale(0.8)';
          ctx.drawImage(
            sprite,
            Math.round(px - largura2 / 2),
            Math.round(py - altura2),
            Math.ceil(largura2),
            Math.ceil(altura2),
          );
          ctx.filter = 'none';
          ctx.globalAlpha = 1;

          // --- composição: o que a construção faz, espalhado ao pé dela -----
          //
          // É esta camada que separa cinco oficinas com o mesmo telhado. A
          // forma dá o porte, a cor dá a família, e o enfeite dá o ofício:
          // pilha de madeira, monte de minério, ferramenta caída, ovelha.
          // Obra não ganha enfeite: o pátio ainda não existe.
          if (!emObra) {
            const passo = tilePx * 0.72;
            const base = px - ((p.enfeites.length - 1) * passo) / 2;
            p.enfeites.forEach((nome, i) => {
              const ex = base + i * passo;
              const ey = py + tilePx * 0.18;
              if (nome === 'ovelha') {
                desenharQuadro(
                  ctx, assets.ovelha, quadroEm(assets.ovelha, tempo, i * 3),
                  ex, ey, escala * 0.5,
                );
                return;
              }
              const peca = assets.enfeites[nome];
              if (!peca) return;
              const lado = TILE * escala * 0.8;
              ctx.drawImage(
                peca,
                Math.round(ex - lado / 2), Math.round(ey - lado),
                Math.ceil(lado), Math.ceil(lado),
              );
            });

            // Fogo e fumaça saem do topo, e só de quem está produzindo. É a
            // leitura de "trabalhando" mais barata que existe numa vista de
            // cima: não custa texto nem ícone, e se lê de longe.
            if (p.fx) {
              const anim = p.fx === 'fogo' ? assets.fogo : assets.fumaca;
              const deslocamento = ((p.x * 5 + p.y * 11) % anim.quadros + anim.quadros) %
                anim.quadros;
              ctx.globalAlpha = p.fx === 'fumaca' ? 0.65 : 1;
              desenharQuadro(
                ctx, anim, quadroEm(anim, tempo, deslocamento),
                px, Math.round(py - altura2 + tilePx * 0.5), escala * 0.7,
              );
              ctx.globalAlpha = 1;
            }
          }

          if (!p.rotulo) return;
          if (p !== maisPerto && !emObra) return;
          const texto = emObra ? `${p.rotulo} · ${p.obraDias} d` : p.rotulo;
          ctx.font = `${Math.round(11 * escala)}px ui-monospace, Menlo, monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.lineWidth = Math.max(2, 3 * escala);
          ctx.strokeStyle = 'rgba(30, 18, 8, 0.85)';
          ctx.fillStyle = emObra ? '#ffd98a' : '#f4e4c1';
          const ty2 = Math.round(py - altura2 - 4 * escala);
          ctx.strokeText(texto, Math.round(px), ty2);
          ctx.fillText(texto, Math.round(px), ty2);
        },
      });
    }

    const anim = jogador.andando ? assets.peaoCorrendo : assets.peaoParado;
    desenhos.push({
      y: jogador.y,
      desenhar: () =>
        desenharQuadro(
          ctx,
          anim,
          quadroEm(anim, tempo),
          paraTelaX(jogador.x) + tilePx / 2,
          paraTelaY(jogador.y) + tilePx,
          escala * 0.9,
        ),
    });

    // Ordenar pelo Y do pé é o que dá profundidade numa vista de cima: quem
    // está mais ao sul aparece na frente. Sem isso, a árvore ao sul da casa
    // seria desenhada atrás dela e a cena perderia o sentido de espaço.
    desenhos.sort((a, b) => a.y - b.y);
    for (const d of desenhos) d.desenhar();
  }

  return {
    desenhar,
    camera,
    ehTerra,
    get tilesDesenhados() {
      return tilesDesenhados;
    },
    get decoracoes() {
      return decoracoesDesenhadas;
    },
  };
}
