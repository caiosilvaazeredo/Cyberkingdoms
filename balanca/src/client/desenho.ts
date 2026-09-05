import { AGUA, PONTE, canhaoDe, decoracaoEm, type Arena, type Estrutura } from '../shared/arena';
import { perfil, vidaMaximaDe, PERFIS_DE_FERA, type Classe } from '../shared/classes';
import { nivelDe, type Estado, type Unidade, type VarianteDaInvasao } from '../shared/estado';
import {
  CUSTO_DO_NIVEL,
  DT,
  NIVEL_MAXIMO,
  pesoMinimoDe,
  RAIO_UNIDADE,
  custoDaObraDe,
  pesoMaximoDe,
  type Time,
} from '../shared/regras';
import { ZOOM_DA_VISAO, type Ajustes } from './ajustes';
import { quadro, quadroDaVez, quadroEm, type Animacao, type Arte, type IconeDaObra } from './arte';
import {
  passeioCircular,
  posicaoDaCobra,
  posicaoDaTartaruga,
  posicaoDaVilaDeGnomos,
  posicaoDoAbelhao,
  posicaoDoAnimal,
  posicaoDoBarco,
  posicaoDoCavaloMarinho,
  posicaoDoLagarto,
  posicaoDoPorco,
  posicaoDoTubarao,
  posicaoDoUrso,
} from './decoracao';
import type { Particulas } from './particulas';
import { TILE, chaoPara, encostaNaAgua, mascaraDe } from './tileset';

/**
 * O mundo desenhado — água, chão, castelos, gente, rebanho e baú.
 *
 * ## O gesto é a legenda
 *
 * Cada classe usa as folhas dela: o guerreiro gira a espada em dois golpes que
 * se alternam, o lanceiro estoca na direção em que aponta, o arqueiro puxa o
 * arco, o clérigo ergue o cajado, e os ofícios batem com machado, picareta e
 * faca. Numa briga de doze bonecos, o movimento é o que diz de longe quem é
 * quem — mais rápido que qualquer barra de cor ou ícone sobre a cabeça.
 *
 * ## O peso se vê antes de se ler
 *
 * O baú é desenhado **do tamanho do peso dele**, e a tampa abre conforme
 * enche. A barra no alto da tela diz o número, mas quem está correndo para
 * resgatar não lê número: vê que o refém no cofre inimigo está do tamanho de
 * uma casa, transbordando moeda, e entende sem legenda que vai precisar de
 * ajuda.
 *
 * ## Ordem por pé, e não por camada
 *
 * Tudo o que fica de pé no chão — árvore, prédio, unidade, ovelha — entra numa
 * lista só e é desenhado em ordem de Y. Sem isso, um jogador atrás de uma torre
 * aparece na frente dela, e a vista de cima perde a profundidade.
 */

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

/**
 * O que o desenho precisa saber sobre quem está jogando **aqui**.
 *
 * Enquanto havia um jogador por página, o desenho podia perguntar tudo à
 * conexão: "esta unidade é minha?" era `u.id === rede.meuId`. Com quatro
 * pessoas no mesmo aparelho existem quatro conexões, cada uma com a sua
 * previsão, e a pergunta certa passou a ser *de quem* é esta unidade — porque a
 * posição do jogador 3 tem de sair da previsão do jogador 3, e não do retrato
 * atrasado que a conexão do jogador 1 recebeu.
 *
 * Uma conexão sozinha satisfaz esta interface (é o caso de quem joga sozinho e
 * o do menu, que não tem ninguém em campo), e o sofá também. O desenho não
 * sabe a diferença.
 */
export interface OlharLocal {
  readonly estado: Estado | null;
  readonly brilhos: readonly { alvo: number; quando: number }[];
  /** Em que vaga do sofá esta unidade está, ou `null` se não é de ninguém daqui. */
  vagaDe(id: number): number | null;
  /** Quantas pessoas jogam neste aparelho. Muda o rótulo do próprio boneco. */
  readonly quantosLocais: number;
  /**
   * A unidade como o dono dela a prevê.
   *
   * Sem isto a animação lia o retrato do servidor: na janela entre pacotes o
   * boneco andava sem virar.
   */
  previsaoDe(u: Unidade): Unidade;
  posicaoDe(u: Unidade, agora: number): { x: number; y: number };
  alfa(agora: number): number;
  desdeORetrato(agora: number): number;
}

/**
 * A cor de cada vaga do sofá.
 *
 * Numa tela compartilhada, o problema nº 1 é **achar o próprio boneco**. Cor
 * fixa por vaga, na setinha sobre a cabeça e no cartão do canto, resolve isso
 * sem depender do time — os quatro estão do mesmo lado, então a cor do reino
 * não distingue ninguém.
 */
export const COR_DA_VAGA: readonly string[] = ['#ffd479', '#7ee081', '#7ec8ff', '#ff9ad5'];

const SPRITE_DA_ESTRUTURA: Record<Estrutura['tipo'], string> = {
  tesouraria: 'Castle',
  cofre: 'Tower',
  casaDaMoeda: 'Monastery',
  chapelaria: 'Barracks',
  nascedouro: 'House1',
};

const NOME_DA_ESTRUTURA: Record<Estrutura['tipo'], string> = {
  tesouraria: 'Tesouraria',
  cofre: 'Cofre',
  casaDaMoeda: 'Casa da Moeda',
  chapelaria: 'Chapelaria',
  nascedouro: 'Quartel',
};

/**
 * O ícone que diz, sem texto, o que se faz em cada construção.
 *
 * O nome escrito por cima do telhado responde "que prédio é este?"; não
 * responde "o que eu ganho aqui?". São perguntas diferentes, e a segunda é a
 * que alguém tem no meio de uma partida — ainda mais na chapelaria, que é onde
 * se **troca de classe** e cujo nome não diz isso a ninguém que chegou agora.
 *
 * O martelo na chapelaria é o mesmo ícone da obra de propósito: o prédio faz as
 * duas coisas, e quem entrega madeira lá é a mesma pessoa que veste o chapéu.
 */
const ICONE_DA_ESTRUTURA: Record<Estrutura['tipo'], IconeDaObra> = {
  tesouraria: 'moeda',
  cofre: 'escudo',
  casaDaMoeda: 'moeda',
  chapelaria: 'martelo',
  nascedouro: 'espada',
};

const COR_DO_TIME: Readonly<Record<Time, string>> = { azul: 'blue', vermelho: 'red' };

/** Qual animação de `Arte` cada variante do invasor usa — a comum, e as duas raras. */
const ANIM_DA_VARIANTE: Readonly<
  Record<VarianteDaInvasao, 'invasor' | 'invasorTocha' | 'invasorSlingshot'>
> = {
  comum: 'invasor',
  tocha: 'invasorTocha',
  slingshot: 'invasorSlingshot',
};

export function criarCamera(): Camera {
  return { x: 0, y: 0, zoom: 1 };
}

/**
 * Enquadra um grupo de pessoas na mesma tela.
 *
 * É o que um beat-'em-up de sofá faz: a câmera vai para o meio do grupo e
 * **abre** o quanto for preciso para caber todo mundo. O limite existe porque
 * sem ele dois teimosos em cantos opostos do mapa reduziriam o jogo a formigas;
 * passado o limite, a câmera para de abrir e quem ficou de fora é apontado pela
 * bússola da borda.
 *
 * Devolve os índices de quem não coube, para o desenho saber por quem apontar
 * a seta de borda — e em que cor, já que a cor é a da vaga.
 */
export function enquadrarGrupo(
  camera: Camera,
  arena: Arena,
  alvos: readonly { x: number; y: number }[],
  largura: number,
  altura: number,
  ajustes: Ajustes,
): number[] {
  if (alvos.length === 0) return [];
  const xs = alvos.map((a) => a.x);
  const ys = alvos.map((a) => a.y);
  const centro = {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
  };
  seguir(camera, arena, centro, largura, altura, ajustes);

  if (alvos.length > 1) {
    // Margem para o boneco não ficar colado na borda: ele tem meio corpo acima
    // do pé e um nome escrito em cima.
    const larguraPedida = Math.max(...xs) - Math.min(...xs) + 6 * TILE;
    const alturaPedida = Math.max(...ys) - Math.min(...ys) + 6 * TILE;
    const cabe = Math.min(largura / larguraPedida, altura / alturaPedida);
    if (cabe < camera.zoom) camera.zoom = Math.max(ZOOM_MINIMO_DO_SOFA, cabe);
    // Reabrir o zoom mudou o quanto de mundo cabe, e portanto até onde a
    // câmera pode chegar sem mostrar o lado de fora do mapa. Prender de novo.
    prender(camera, arena, centro, largura, altura);
  }

  const meioX = largura / 2 / camera.zoom;
  const meioY = altura / 2 / camera.zoom;
  const fora: number[] = [];
  for (const [i, a] of alvos.entries()) {
    if (Math.abs(a.x - camera.x) > meioX - TILE || Math.abs(a.y - camera.y) > meioY - TILE) {
      fora.push(i);
    }
  }
  return fora;
}

/**
 * O quanto a câmera pode abrir para caber o sofá inteiro.
 *
 * Abaixo disto o guerreiro fica do tamanho de um grão de arroz e ninguém acha o
 * próprio boneco — a partir daí é melhor deixar alguém sair de quadro e apontar
 * onde ele está.
 */
const ZOOM_MINIMO_DO_SOFA = 0.3;

/** A partir de que distância um arbusto deixa de notar quem passou perto. */
const RAIO_DO_ARBUSTO_TOCADO = TILE * 1.3;

/** Ajusta a câmera ao tamanho da tela e a prende dentro da arena. */
export function seguir(
  camera: Camera,
  arena: Arena,
  alvo: { x: number; y: number },
  largura: number,
  altura: number,
  ajustes: Ajustes,
): void {
  // Enquadramento por altura: numa tela larga, mostrar mais mundo na
  // horizontal é bônus; numa tela alta, mostrar mais na vertical arruinaria a
  // leitura de quem está chegando pelos flancos.
  const base = altura / (13 * TILE);
  camera.zoom = Math.max(0.42, Math.min(1.3, base * ZOOM_DA_VISAO[ajustes.visao]));
  prender(camera, arena, alvo, largura, altura);
}

/** Centra no alvo sem deixar a vista escorregar para fora do mapa. */
function prender(
  camera: Camera,
  arena: Arena,
  alvo: { x: number; y: number },
  largura: number,
  altura: number,
): void {
  const meioX = largura / 2 / camera.zoom;
  const meioY = altura / 2 / camera.zoom;
  const mundoLargura = arena.largura * TILE;
  const mundoAltura = arena.altura * TILE;
  camera.x =
    mundoLargura <= meioX * 2
      ? mundoLargura / 2
      : Math.max(meioX, Math.min(mundoLargura - meioX, alvo.x));
  camera.y =
    mundoAltura <= meioY * 2
      ? mundoAltura / 2
      : Math.max(meioY, Math.min(mundoAltura - meioY, alvo.y));
}

export interface Vista {
  paraTelaX(x: number): number;
  paraTelaY(y: number): number;
  escala: number;
}

export function vistaDe(camera: Camera, largura: number, altura: number): Vista {
  return {
    escala: camera.zoom,
    paraTelaX: (x) => (x - camera.x) * camera.zoom + largura / 2,
    paraTelaY: (y) => (y - camera.y) * camera.zoom + altura / 2,
  };
}

interface Pintura {
  y: number;
  pintar(): void;
}

export function desenharMundo(
  ctx: CanvasRenderingContext2D,
  arte: Arte,
  arena: Arena,
  olhar: OlharLocal,
  camera: Camera,
  largura: number,
  altura: number,
  tempo: number,
  ajustes: Ajustes,
  particulas?: Particulas,
): void {
  const estado = olhar.estado;
  const v = vistaDe(camera, largura, altura);
  const escala = v.escala;
  const passo = TILE * escala;
  const agora = performance.now();

  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#3a7ca8';
  ctx.fillRect(0, 0, largura, altura);

  const tx0 = Math.max(0, Math.floor((camera.x - largura / 2 / escala) / TILE) - 1);
  const ty0 = Math.max(0, Math.floor((camera.y - altura / 2 / escala) / TILE) - 1);
  const tx1 = Math.min(arena.largura - 1, Math.ceil((camera.x + largura / 2 / escala) / TILE) + 1);
  const ty1 = Math.min(arena.altura - 1, Math.ceil((camera.y + altura / 2 / escala) / TILE) + 1);

  const ehChao = (x: number, y: number): boolean => arena.ehChao(x, y);
  const telaX = (tx: number): number => v.paraTelaX(tx * TILE);
  const telaY = (ty: number): number => v.paraTelaY(ty * TILE);

  // --- água --------------------------------------------------------------
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (arena.tile(tx, ty) !== AGUA) continue;
      ctx.drawImage(
        arte.agua,
        Math.round(telaX(tx)),
        Math.round(telaY(ty)),
        Math.ceil(passo),
        Math.ceil(passo),
      );
    }
  }

  // --- espuma ------------------------------------------------------------
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (!ehChao(tx, ty) || !encostaNaAgua(tx, ty, ehChao)) continue;
      const anim = arte.espuma;
      // Cada instância começa num quadro diferente: com todas em fase, a costa
      // inteira pulsa junto e o mar parece um bicho só respirando.
      const q = quadroEm(anim, tempo, (tx * 7 + ty * 13) % anim.quadros);
      const lado = passo * 3;
      const i = ((q % anim.quadros) + anim.quadros) % anim.quadros;
      ctx.drawImage(
        anim.imagem,
        i * anim.lado,
        0,
        anim.lado,
        anim.lado,
        Math.round(telaX(tx) - (lado - passo) / 2),
        Math.round(telaY(ty) - (lado - passo) / 2),
        Math.ceil(lado),
        Math.ceil(lado),
      );
    }
  }

  // --- chão --------------------------------------------------------------
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (!ehChao(tx, ty)) continue;
      const c = chaoPara(mascaraDe(tx, ty, ehChao));
      ctx.drawImage(
        arte.chao,
        c.col * TILE,
        c.row * TILE,
        TILE,
        TILE,
        Math.round(telaX(tx)),
        Math.round(telaY(ty)),
        Math.ceil(passo),
        Math.ceil(passo),
      );
      if (arena.tile(tx, ty) === PONTE) desenharPonte(ctx, telaX(tx), telaY(ty), passo);
    }
  }

  const pinturas: Pintura[] = [];

  // --- mato --------------------------------------------------------------
  if (ajustes.mato) {
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const deco = decoracaoEm(arena, tx, ty);
        if (!deco) continue;
        const px = telaX(tx) + passo / 2;
        const py = telaY(ty) + passo;
        if (deco.tipo === 'pedra' || deco.tipo === 'ossos') {
          const im =
            deco.tipo === 'pedra'
              ? arte.pedras[deco.variante % arte.pedras.length]!
              : arte.ossos[deco.variante % arte.ossos.length]!;
          // Osso deitado é mais baixo que pedra em pé — do contrário parece
          // flutuar acima do chão, e não largado nele.
          const lado = deco.tipo === 'pedra' ? passo : passo * 0.7;
          pinturas.push({
            y: ty * TILE,
            pintar: () =>
              ctx.drawImage(
                im,
                Math.round(px - lado / 2),
                Math.round(py - lado),
                Math.ceil(lado),
                Math.ceil(lado),
              ),
          });
          continue;
        }
        const banco = deco.tipo === 'arvore' ? arte.arvores : arte.arbustos;
        const anim = banco[deco.variante % banco.length]!;
        const tamanho = deco.tipo === 'arvore' ? escala * 0.85 : escala;
        // O arbusto sente quem passa perto: um tremor que cresce conforme a
        // unidade viva mais próxima se aproxima e some (`Math.max(0, 1 -
        // d/raio)`) exatamente no raio, sem soletar — ao contrário de mudar a
        // velocidade da folha (que pularia de quadro no instante em que
        // alguém entra ou sai do raio), o ângulo nasce e morre em zero dos
        // dois lados, e por isso não pisca. É a mesma ideia do empurrão nos
        // bichos decorativos (`empurraoDeAlerta`) — "o cenário te notou" —
        // só que na planta em vez do bicho.
        const bx = tx * TILE + TILE / 2;
        const by = ty * TILE + TILE / 2;
        let proximidade = 0;
        if (deco.tipo === 'arbusto') {
          for (const u of estado?.unidades ?? []) {
            if (!u.vivo) continue;
            const d = Math.hypot(u.x - bx, u.y - by) / RAIO_DO_ARBUSTO_TOCADO;
            if (d < 1 && 1 - d > proximidade) proximidade = 1 - d;
          }
        }
        pinturas.push({
          y: ty * TILE,
          pintar: () => {
            const quadroAtual = quadroEm(anim, tempo, deco.deslocamento);
            if (proximidade <= 0) {
              quadro(ctx, anim, quadroAtual, px, py, tamanho);
              return;
            }
            const angulo = Math.sin(tempo * 14) * 0.09 * proximidade;
            ctx.save();
            ctx.translate(px, py);
            ctx.rotate(angulo);
            ctx.translate(-px, -py);
            quadro(ctx, anim, quadroAtual, px, py, tamanho);
            ctx.restore();
          },
        });
      }
    }
  }

  // --- jazidas ------------------------------------------------------------
  for (const j of arena.jazidas) {
    const cheia = estado?.jazidas.find((x) => x.id === j.id)?.cheia ?? true;
    const px = v.paraTelaX(j.x);
    const py = v.paraTelaY(j.y) + TILE * escala * 0.4;
    pinturas.push({
      y: j.y,
      pintar: () => {
        if (j.tipo === 'arvore') {
          if (cheia) {
            const anim = arte.arvores[j.variante % arte.arvores.length]!;
            quadro(ctx, anim, quadroEm(anim, tempo, j.id * 3), px, py, escala);
          } else {
            const toco = arte.tocos[j.variante % arte.tocos.length]!;
            // O toco do pacote é uma imagem única de 192×256, e não uma tira:
            // desenhá-lo pelo recorte de quadro cortaria um terço do sprite.
            const l = toco.width * escala;
            const a = toco.height * escala;
            ctx.drawImage(toco, Math.round(px - l / 2), Math.round(py - a), Math.ceil(l), Math.ceil(a));
          }
          return;
        }
        const im = cheia ? arte.jazidaOuro : arte.jazidaOuroVazia;
        const l = im.width * escala;
        const a = im.height * escala;
        ctx.drawImage(im, Math.round(px - l / 2), Math.round(py - a), Math.ceil(l), Math.ceil(a));
      },
    });
  }

  // --- estruturas ---------------------------------------------------------
  for (const e of arena.estruturas) {
    const sprite = arte.predios[`${COR_DO_TIME[e.time]}/${SPRITE_DA_ESTRUTURA[e.tipo]}`];
    if (!sprite) continue;
    const largo = sprite.width * escala;
    const alto = sprite.height * escala;
    const py = v.paraTelaY(e.y) + TILE * escala * 0.6;
    pinturas.push({
      y: e.y,
      pintar: () => {
        ctx.drawImage(
          sprite,
          Math.round(v.paraTelaX(e.x) - largo / 2),
          Math.round(py - alto),
          Math.ceil(largo),
          Math.ceil(alto),
        );
        rotulo(
          ctx,
          NOME_DA_ESTRUTURA[e.tipo],
          v.paraTelaX(e.x),
          Math.round(py - alto) - 6 * escala,
          escala,
        );
        // A placa do que a construção dá, e — quando é o caso — se ela está
        // pronta agora. "Pronta" é o que faz a placa valer a pena: um ícone que
        // nunca muda vira papel de parede em duas partidas.
        placaDaObra(
          ctx,
          arte,
          e,
          estado,
          v.paraTelaX(e.x),
          Math.round(py - alto) - 30 * escala,
          escala,
        );
        if (e.tipo === 'tesouraria') {
          // Um guarda de mercenário — sem cor de time, do jeito que o anexo
          // da obra também não tem — parado ao lado da porta. É onde o ouro
          // do reino descansa; não faz sentido ele ficar sem ninguém na
          // frente.
          const anim = arte.guardaDaTesouraria;
          const ladoDoGuarda = e.time === 'azul' ? 1 : -1;
          const pxGuarda = v.paraTelaX(e.x) + ladoDoGuarda * largo * 0.6;
          quadro(ctx, anim, quadroEm(anim, tempo, e.tx * 3), pxGuarda, py, escala * 0.6);

          // O canhão de cerco: parado no posto que `canhaoDe` calcula, virado
          // para o meio do campo — a folha do pacote olha para a direita, e
          // é por isso que só o Vermelho precisa do espelho.
          const canhao = arte.canhaoCorpo;
          const posto = canhaoDe(arena, e.time);
          const pxCanhao = v.paraTelaX(posto.x);
          const pyCanhao = v.paraTelaY(posto.y);
          const lCanhao = canhao.width * escala * 0.55;
          const aCanhao = canhao.height * escala * 0.55;
          espelhado(ctx, pxCanhao, e.time === 'vermelho', () =>
            ctx.drawImage(
              canhao,
              Math.round(pxCanhao - lCanhao / 2),
              Math.round(pyCanhao - aCanhao / 2),
              Math.ceil(lCanhao),
              Math.ceil(aCanhao),
            ),
          );
        }
        if (e.tipo === 'casaDaMoeda' && estado) {
          const forno = estado.casasDaMoeda.find((c) => c.time === e.time);
          if (forno && forno.cunhando > 0) {
            // Chaminé apagada é a forma mais barata de dizer "esta Casa da Moeda está
            // parada" — mais barata que texto, e legível de longe.
            quadro(
              ctx,
              arte.fumaca,
              quadroEm(arte.fumaca, tempo),
              v.paraTelaX(e.x),
              Math.round(py - alto * 0.85),
              escala * 0.7,
            );
            quadro(ctx, arte.fogo, quadroEm(arte.fogo, tempo), v.paraTelaX(e.x), py, escala * 0.8);
          }
          if (forno && forno.bolsas > 0) {
            for (let i = 0; i < forno.bolsas; i++) {
              desenharBolsa(
                ctx,
                v.paraTelaX(e.x) - 26 * escala + i * 24 * escala,
                py - 4 * escala,
                escala * 0.9,
              );
            }
          }
        }
        if (e.tipo === 'chapelaria' && estado) {
          const oficina = estado.oficinas.find((o) => o.time === e.time);
          if (oficina) {
            rotulo(
              ctx,
              `obra ${'I'.repeat(oficina.nivel)}`,
              v.paraTelaX(e.x),
              Math.round(py - alto) + 8 * escala,
              escala,
              '#ffd479',
            );
            // O anexo: nada no nível 1, a cabana encostada no 2, a torre no
            // 3. Cada nível já tinha o "obra I/II/III" escrito; agora também
            // se vê de longe, sem precisar chegar perto para ler a placa.
            const ladoDoAnexo = e.time === 'azul' ? -1 : 1;
            const px = v.paraTelaX(e.x) + ladoDoAnexo * largo * 0.68;
            if (oficina.nivel === 2) {
              const anim = arte.obraNivel2;
              const escalaAnexo = escala * 0.55;
              quadro(ctx, anim, quadroEm(anim, tempo, e.tx * 3), px, py, escalaAnexo);
            } else if (oficina.nivel >= 3) {
              const im = arte.obraNivel3;
              const l = im.width * escala * 0.6;
              const a = im.height * escala * 0.6;
              ctx.drawImage(im, Math.round(px - l / 2), Math.round(py - a), Math.ceil(l), Math.ceil(a));
            }
          }
        }
      },
    });
  }

  if (!estado) {
    for (const p of pinturas.sort((a, b) => a.y - b.y)) p.pintar();
    return;
  }

  // --- itens no chão ------------------------------------------------------
  for (const item of estado.itens) {
    const px = v.paraTelaX(item.x);
    const py = v.paraTelaY(item.y);
    pinturas.push({
      y: item.y,
      pintar: () => {
        const pulo = Math.sin(tempo * 3 + item.id) * 3 * escala;
        if (item.tipo === 'bolsa') {
          desenharBolsa(ctx, px, py + pulo, escala);
          return;
        }
        if (item.tipo === 'chapeu') {
          desenharChapeu(ctx, px, py + pulo - 8 * escala, escala * 1.4, item.classe!, item.origem);
          return;
        }
        const im = arte.recursos[item.tipo];
        const l = im.width * escala * 0.8;
        ctx.drawImage(
          im,
          Math.round(px - l / 2),
          Math.round(py + pulo - l),
          Math.ceil(l),
          Math.ceil(l),
        );
      },
    });
  }

  // --- bichos -------------------------------------------------------------
  const alfa = olhar.alfa(agora);
  for (const a of estado.animais) {
    if (!a.vivo) continue;
    const pos = posicaoDoAnimal(a, alfa);
    const px = v.paraTelaX(pos.x);
    const py = v.paraTelaY(pos.y) + RAIO_UNIDADE * escala * 0.6;
    const andando = Math.hypot(a.x - a.destinoX, a.y - a.destinoY) > 0.5;
    const anim = a.fugindo > 0 || andando ? arte.ovelha.andando : arte.ovelha.pastando;
    const paraEsquerda = a.x - a.destinoX < -0.5;
    pinturas.push({
      y: pos.y,
      pintar: () => {
        espelhado(ctx, px, paraEsquerda, () =>
          quadro(ctx, anim, quadroEm(anim, tempo, a.id * 5), px, py, escala, 'centro'),
        );
      },
    });
  }

  // --- invasão --------------------------------------------------------
  // Sem interpolação entre retratos, ao contrário da ovelha: a velocidade do
  // goblin é baixa (`INVASAO_VELOCIDADE`) de propósito, e o passo dele entre
  // dois pacotes já é pequeno o bastante para não valer a conta a mais.
  for (const inv of estado.invasores) {
    const px = v.paraTelaX(inv.x);
    const py = v.paraTelaY(inv.y) + RAIO_UNIDADE * escala * 0.6;
    const chapelaria = arena.estrutura('chapelaria', inv.time);
    const paraEsquerda = chapelaria.x - inv.x < 0;
    const anim = arte[ANIM_DA_VARIANTE[inv.variante]];
    pinturas.push({
      y: inv.y,
      pintar: () => {
        espelhado(ctx, px, paraEsquerda, () =>
          quadro(ctx, anim, quadroEm(anim, tempo, inv.id * 5), px, py, escala * 0.85, 'centro'),
        );
      },
    });
  }

  // --- totem do Modo Fera ----------------------------------------------
  // Raro e chamativo de propósito: um anel dourado que pulsa, sob as duas
  // feras possíveis alternando — quem chegar primeiro decide qual delas vira.
  if (estado.totem) {
    const totem = estado.totem;
    const px = v.paraTelaX(totem.x);
    const py = v.paraTelaY(totem.y);
    pinturas.push({
      y: totem.y,
      pintar: () => {
        const raio = (20 + Math.sin(tempo * 3) * 4) * escala;
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 210, 90, 0.9)';
        ctx.lineWidth = Math.max(2, 3 * escala);
        ctx.setLineDash([7 * escala, 5 * escala]);
        ctx.beginPath();
        ctx.ellipse(px, py, raio, raio * 0.55, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        const fera = Math.floor(tempo / 2) % 2 === 0 ? 'troll' : 'minotauro';
        const anim = arte.feras[fera].parado;
        quadro(ctx, anim, quadroEm(anim, tempo, totem.id * 3), px, py - RAIO_UNIDADE * escala * 0.6, escala * 0.9, 'centro');
        rotulo(ctx, 'totem', px, py + 16 * escala, escala, '#ffd25a');
      },
    });
  }

  // --- guardião do Modo Covil ------------------------------------------
  // Sem cor de time — ele não briga por nenhum dos dois reinos — e com a
  // vida sempre visível: diferente do boneco de jogador, cuja barra some
  // quando ele está cheio, um chefe de vida alta é justamente o que vale a
  // pena olhar o tempo inteiro.
  if (estado.guardiao) {
    const g = estado.guardiao;
    const px = v.paraTelaX(g.x);
    const py = v.paraTelaY(g.y);
    const anim = arte.guardioes[g.tipo];
    pinturas.push({
      y: g.y,
      pintar: () => {
        quadro(ctx, anim, quadroEm(anim, tempo, g.id * 3), px, py, escala * 1.3, 'centro');

        const larguraBarra = 60 * escala;
        const topo = py - anim.lado * escala * 0.62;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(px - larguraBarra / 2, topo - 6 * escala, larguraBarra, 6 * escala);
        ctx.fillStyle = g.vida / g.vidaMaxima > 0.35 ? '#e0a23c' : '#d9534f';
        ctx.fillRect(
          px - larguraBarra / 2,
          topo - 6 * escala,
          (larguraBarra * g.vida) / g.vidaMaxima,
          6 * escala,
        );
        rotulo(ctx, 'guardião', px, topo - 10 * escala, escala, '#e0a23c');
      },
    });
  }

  // --- presa do Modo Caça ----------------------------------------------
  // Mesmo tratamento do Guardião — sem time, vida sempre visível — só que
  // menor na tela e num tom diferente de barra, para não confundir as duas
  // ameaças caso um mapa um dia misture as duas (não é o caso hoje, mas o
  // desenho de uma não deveria depender de a outra não existir).
  if (estado.presa) {
    const p = estado.presa;
    const px = v.paraTelaX(p.x);
    const py = v.paraTelaY(p.y);
    const anim = arte.presa;
    pinturas.push({
      y: p.y,
      pintar: () => {
        quadro(ctx, anim, quadroEm(anim, tempo, p.id * 3), px, py, escala, 'centro');

        const larguraBarra = 44 * escala;
        const topo = py - anim.lado * escala * 0.55;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(px - larguraBarra / 2, topo - 6 * escala, larguraBarra, 6 * escala);
        ctx.fillStyle = p.vida / p.vidaMaxima > 0.35 ? '#7ec850' : '#d9534f';
        ctx.fillRect(
          px - larguraBarra / 2,
          topo - 6 * escala,
          (larguraBarra * p.vida) / p.vidaMaxima,
          6 * escala,
        );
        rotulo(ctx, 'presa', px, topo - 10 * escala, escala, '#7ec850');
      },
    });
  }

  // --- cajado do Modo Xamã ----------------------------------------------
  // O mesmo círculo tracejado do totem: um prêmio no chão, sem time, que
  // qualquer um dos dois reinos pode chegar primeiro.
  if (estado.cajado) {
    const cajado = estado.cajado;
    const px = v.paraTelaX(cajado.x);
    const py = v.paraTelaY(cajado.y);
    pinturas.push({
      y: cajado.y,
      pintar: () => {
        const raio = (18 + Math.sin(tempo * 3) * 4) * escala;
        ctx.save();
        ctx.strokeStyle = 'rgba(170, 120, 230, 0.9)';
        ctx.lineWidth = Math.max(2, 3 * escala);
        ctx.setLineDash([7 * escala, 5 * escala]);
        ctx.beginPath();
        ctx.ellipse(px, py, raio, raio * 0.55, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        const av = arte.xamaAvatar;
        const l = av.width * escala * 0.45;
        const a = av.height * escala * 0.45;
        const flutua = Math.sin(tempo * 2.4) * 3 * escala;
        ctx.drawImage(av, Math.round(px - l / 2), Math.round(py - a - RAIO_UNIDADE * escala * 0.5 + flutua), Math.ceil(l), Math.ceil(a));
        rotulo(ctx, 'cajado', px, py + 16 * escala, escala, '#c9a6f5');
      },
    });
  }

  // --- menino rei do Modo Fuga -------------------------------------------
  // O mesmo círculo tracejado do totem e do cajado — um objetivo neutro no
  // meio do mapa — só que dourado, para a cor já dizer "vitória", e sem
  // barra de vida: ele não é alvo de combate, ver `nascerMeninoRei` em
  // shared/pve.ts.
  if (estado.meninoRei) {
    const meninoRei = estado.meninoRei;
    const px = v.paraTelaX(meninoRei.x);
    const py = v.paraTelaY(meninoRei.y);
    pinturas.push({
      y: meninoRei.y,
      pintar: () => {
        const raio = (20 + Math.sin(tempo * 3) * 4) * escala;
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 210, 90, 0.9)';
        ctx.lineWidth = Math.max(2, 3 * escala);
        ctx.setLineDash([7 * escala, 5 * escala]);
        ctx.beginPath();
        ctx.ellipse(px, py, raio, raio * 0.55, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        const av = arte.meninoReiAvatar;
        const l = av.width * escala * 0.45;
        const a = av.height * escala * 0.45;
        const flutua = Math.sin(tempo * 2.4) * 3 * escala;
        ctx.drawImage(
          av,
          Math.round(px - l / 2),
          Math.round(py - a - RAIO_UNIDADE * escala * 0.5 + flutua),
          Math.ceil(l),
          Math.ceil(a),
        );
        rotulo(ctx, 'menino rei', px, py + 16 * escala, escala, '#ffd25a');
      },
    });
  }

  // --- porco decorativo ----------------------------------------------
  {
    const p = posicaoDoPorco(arena, tempo, estado.unidades);
    const px = v.paraTelaX(p.x);
    const py = v.paraTelaY(p.y) + RAIO_UNIDADE * escala * 0.6;
    // Uma em vinte arenas — a mesma conta de `montado`, para o desenho e a
    // decisão nunca discordarem — o porco vem com cavaleiro. É maior porque
    // carrega alguém em cima, não porque é um bicho diferente.
    const anim = p.montado ? arte.porcoMontado : arte.porco.andando;
    const escalaDoPorco = escala * (p.montado ? 0.9 : 0.8);
    pinturas.push({
      y: p.y,
      pintar: () => {
        espelhado(ctx, px, p.paraEsquerda, () =>
          quadro(ctx, anim, quadroEm(anim, tempo), px, py, escalaDoPorco, 'centro'),
        );
      },
    });
  }

  // --- o resto da vida selvagem decorativa ----------------------------
  const tartaruga = posicaoDaTartaruga(arena, tempo);
  if (tartaruga) {
    const px = v.paraTelaX(tartaruga.x);
    const py = v.paraTelaY(tartaruga.y);
    pinturas.push({
      y: tartaruga.y,
      pintar: () => {
        espelhado(ctx, px, tartaruga.paraEsquerda, () =>
          quadro(ctx, arte.tartaruga, quadroEm(arte.tartaruga, tempo), px, py, escala * 0.55, 'centro'),
        );
      },
    });
  }

  const urso = posicaoDoUrso(arena, tempo, estado.unidades);
  if (urso) {
    const px = v.paraTelaX(urso.x);
    const py = v.paraTelaY(urso.y) + RAIO_UNIDADE * escala * 0.6;
    pinturas.push({
      y: urso.y,
      pintar: () => {
        espelhado(ctx, px, urso.paraEsquerda, () =>
          quadro(ctx, arte.urso, quadroEm(arte.urso, tempo), px, py, escala * 0.75, 'centro'),
        );
      },
    });
  }

  const abelhao = posicaoDoAbelhao(arena, tempo);
  if (abelhao) {
    const px = v.paraTelaX(abelhao.x);
    // Voa: sobe da linha do chão em vez de ficar preso a ela, e ganha um
    // batimento vertical próprio (`Math.sin` num período curto) por cima do
    // passeio — senão parece um inseto deslizando, não voando.
    const py = v.paraTelaY(abelhao.y) - 18 * escala + Math.sin(tempo * 6) * 3 * escala;
    pinturas.push({
      y: abelhao.y - TILE,
      pintar: () => {
        espelhado(ctx, px, abelhao.paraEsquerda, () =>
          quadro(ctx, arte.abelhao, quadroEm(arte.abelhao, tempo), px, py, escala * 0.35, 'centro'),
        );
      },
    });
  }

  const cobra = posicaoDaCobra(arena, tempo, estado.unidades);
  if (cobra) {
    const px = v.paraTelaX(cobra.x);
    const py = v.paraTelaY(cobra.y) + RAIO_UNIDADE * escala * 0.3;
    pinturas.push({
      y: cobra.y,
      pintar: () => {
        espelhado(ctx, px, cobra.paraEsquerda, () =>
          quadro(ctx, arte.cobra, quadroEm(arte.cobra, tempo), px, py, escala * 0.4, 'centro'),
        );
      },
    });
  }

  const lagarto = posicaoDoLagarto(arena, tempo, estado.unidades);
  if (lagarto) {
    const px = v.paraTelaX(lagarto.x);
    const py = v.paraTelaY(lagarto.y) + RAIO_UNIDADE * escala * 0.3;
    pinturas.push({
      y: lagarto.y,
      pintar: () => {
        espelhado(ctx, px, lagarto.paraEsquerda, () =>
          quadro(ctx, arte.lagarto, quadroEm(arte.lagarto, tempo), px, py, escala * 0.4, 'centro'),
        );
      },
    });
  }

  const tubarao = posicaoDoTubarao(arena, tempo);
  if (tubarao) {
    const px = v.paraTelaX(tubarao.x);
    const py = v.paraTelaY(tubarao.y);
    pinturas.push({
      y: tubarao.y,
      pintar: () => {
        espelhado(ctx, px, tubarao.paraEsquerda, () =>
          quadro(ctx, arte.tubarao, quadroEm(arte.tubarao, tempo), px, py, escala * 0.6, 'centro'),
        );
      },
    });
  }

  const cavaloMarinho = posicaoDoCavaloMarinho(arena, tempo);
  if (cavaloMarinho) {
    const px = v.paraTelaX(cavaloMarinho.x);
    const py = v.paraTelaY(cavaloMarinho.y);
    pinturas.push({
      y: cavaloMarinho.y,
      pintar: () => {
        espelhado(ctx, px, cavaloMarinho.paraEsquerda, () =>
          quadro(
            ctx,
            arte.cavaloMarinho,
            quadroEm(arte.cavaloMarinho, tempo),
            px,
            py,
            escala * 0.45,
            'centro',
          ),
        );
      },
    });
  }

  const barco = posicaoDoBarco(arena);
  if (barco) {
    const px = v.paraTelaX(barco.x);
    const py = v.paraTelaY(barco.y);
    pinturas.push({
      y: barco.y,
      pintar: () => {
        quadro(ctx, arte.barco, quadroEm(arte.barco, tempo), px, py, escala * 0.7, 'centro');
      },
    });
  }

  // --- vila de gnomos --------------------------------------------------
  const vila = posicaoDaVilaDeGnomos(arena);
  if (vila) {
    // Duas folhas paradas, lado a lado — a torre-cogumelo mais alta, a
    // choupana mais baixa — e não desenhadas em cima uma da outra.
    const choupana = arte.gnomoChoupana;
    const torre = arte.gnomoTorre;
    const pxChoupana = v.paraTelaX(vila.x - TILE * 0.7);
    const pyChoupana = v.paraTelaY(vila.y);
    const lChoupana = choupana.width * escala;
    const aChoupana = choupana.height * escala;
    pinturas.push({
      y: vila.y,
      pintar: () => {
        ctx.drawImage(
          choupana,
          Math.round(pxChoupana - lChoupana / 2),
          Math.round(pyChoupana - aChoupana),
          Math.ceil(lChoupana),
          Math.ceil(aChoupana),
        );
      },
    });
    const pxTorre = v.paraTelaX(vila.x + TILE * 0.8);
    const pyTorre = v.paraTelaY(vila.y + TILE * 0.2);
    const lTorre = torre.width * escala;
    const aTorre = torre.height * escala;
    pinturas.push({
      y: vila.y + TILE * 0.2,
      pintar: () => {
        ctx.drawImage(
          torre,
          Math.round(pxTorre - lTorre / 2),
          Math.round(pyTorre - aTorre),
          Math.ceil(lTorre),
          Math.ceil(aTorre),
        );
      },
    });

    // Um gnomo rondando as próprias casas — a mesma receita do porco e da
    // cobra, só que sem tempo de espera: a vila não é um evento, é cenário,
    // e cenário vivo pede alguém andando nele.
    const faseDoGnomo = (arena.seed % 500) * 0.027 + 2;
    const passeioDoGnomo = passeioCircular(vila, tempo, faseDoGnomo, 0.9 * TILE, 0.5, 0.5);
    const pxGnomo = v.paraTelaX(passeioDoGnomo.x);
    const pyGnomo = v.paraTelaY(passeioDoGnomo.y) + RAIO_UNIDADE * escala * 0.3;
    pinturas.push({
      y: passeioDoGnomo.y,
      pintar: () => {
        espelhado(ctx, pxGnomo, passeioDoGnomo.paraEsquerda, () =>
          quadro(ctx, arte.gnomo, quadroEm(arte.gnomo, tempo), pxGnomo, pyGnomo, escala * 0.5, 'centro'),
        );
      },
    });
  }

  // --- baús ----------------------------------------------------------
  for (const p of estado.baus) {
    if (p.onde === 'resgatado') continue;
    const carregado = p.onde === 'carregado';
    const portador = carregado ? estado.unidades.find((u) => u.id === p.portador) : undefined;
    const base = portador ? olhar.posicaoDe(portador, agora) : { x: p.x, y: p.y };
    const px = v.paraTelaX(base.x);
    // Presa, ela fica **na base** da torre, e não no centro dela: o cofre é
    // um sprite alto, e desenhar o baú no ponto da estrutura a deixaria
    // flutuando na altura da janela. Carregada, sobe um pouco — está no colo.
    const py = v.paraTelaY(base.y) + (carregado ? -22 * escala : TILE * escala * 0.6);
    // O tamanho **é** o peso: de 0,9 a 1,9 do peão comum, do talo ao talo.
    // O tamanho e o quanto está cheio saem da mesma fração, e a fração usa o
    // teto **desta** partida: num time de trinta e dois a balança comporta
    // cinco vezes mais peso, e um baú medido pelo teto de seis já nasceria
    // desenhado no talo.
    const piso = pesoMinimoDe(estado.porTime);
    const cheio = (p.peso - piso) / (pesoMaximoDe(estado.porTime) - piso);
    const gordura = 0.9 + cheio;
    pinturas.push({
      y: base.y + (carregado ? 1 : TILE * 0.6),
      pintar: () => {
        desenharBau(ctx, px, py, escala * gordura, p.time, cheio, tempo);
        // A bomba de pavio aceso: só quando o baú está em trânsito, que é a
        // única hora em que ele pode ser perdido — parado no cofre ou já em
        // casa, não há nada a perder. Ela pulsa (`Math.sin`) para não virar
        // papel de parede num cortejo que demora minutos.
        if (carregado) {
          const anim = arte.efeitos.bomba;
          const flutua = Math.sin(tempo * 2) * 3 * escala;
          quadro(
            ctx,
            anim,
            quadroEm(anim, tempo),
            px,
            py - 30 * escala * gordura + flutua,
            escala * 0.5,
            'centro',
          );
        }
      },
    });
  }

  // --- unidades -----------------------------------------------------------
  for (const u of estado.unidades) {
    if (!u.vivo) continue;
    // A posição local já vinha da previsão, mas a animação ainda lia o retrato
    // do servidor. Na janela entre pacotes, o boneco andava sem virar. Usar a
    // mesma unidade prevista aplica a direção selecionada no mesmo quadro.
    const visivel = olhar.previsaoDe(u);
    const pos = olhar.posicaoDe(visivel, agora);
    const px = v.paraTelaX(pos.x);
    const py = v.paraTelaY(pos.y);
    const andando = moveu(olhar, visivel, agora);
    const escolha = folhaDaUnidade(arte, estado, visivel, andando);
    const vaga = olhar.vagaDe(visivel.id);
    pinturas.push({
      y: pos.y,
      pintar: () => {
        desenharUnidade(
          ctx,
          estado,
          visivel,
          escolha,
          px,
          py,
          escala,
          tempo,
          vaga,
          olhar.quantosLocais,
          ajustes,
        );
        // O feitiço carregado (Modo Xamã): o mesmo retrato do cajado no
        // chão, agora sobre a cabeça de quem está com ele — é o único jeito
        // de quem está por perto saber, antes do golpe, que aquele boneco
        // pode virar alguém porco.
        if (visivel.xamaAte > 0) {
          const av = arte.xamaAvatar;
          const l = av.width * escala * 0.32;
          const a = av.height * escala * 0.32;
          const flutua = Math.sin(tempo * 3 + visivel.id) * 2 * escala;
          ctx.drawImage(
            av,
            Math.round(px - l / 2),
            Math.round(py - 58 * escala + flutua),
            Math.ceil(l),
            Math.ceil(a),
          );
        }
      },
    });
  }

  for (const p of pinturas.sort((a, b) => a.y - b.y)) p.pintar();

  // --- efeito da bênção do clérigo ---------------------------------------
  for (const brilho of olhar.brilhos) {
    const alvo = estado.unidades.find((u) => u.id === brilho.alvo);
    if (!alvo) continue;
    const pos = olhar.posicaoDe(alvo, agora);
    const anim = arte.unidades[alvo.time]['clerigo_bencao'];
    if (!anim) continue;
    const idade = (agora - brilho.quando) / 1000;
    if (idade > anim.quadros / anim.fps) continue;
    quadro(
      ctx,
      anim,
      quadroDaVez(anim, idade / (anim.quadros / anim.fps)),
      v.paraTelaX(pos.x),
      v.paraTelaY(pos.y),
      escala,
      'centro',
    );
  }

  // --- projéteis ----------------------------------------------------------
  const adianta = olhar.desdeORetrato(agora);
  for (const pj of estado.projeteis) {
    const px = v.paraTelaX(pj.x + pj.vx * adianta);
    const py = v.paraTelaY(pj.y + pj.vy * adianta);

    if (pj.tipo === 'bolaDeCanhao') {
      // Uma bala é redonda: não precisa girar para a direção do voo, e
      // arredondar o desenho evita o serrilhado que uma escala não-inteira
      // deixaria numa imagem pequena.
      const bola = arte.canhaoBola;
      const l = Math.round(bola.width * escala * 0.5);
      ctx.drawImage(bola, Math.round(px - l / 2), Math.round(py - l / 2), l, l);
      continue;
    }

    const flecha = arte.unidades[pj.time]['flecha'];
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(Math.atan2(pj.vy, pj.vx));
    if (flecha) {
      const l = flecha.lado * escala;
      ctx.drawImage(flecha.imagem, 0, 0, flecha.lado, flecha.lado, -l / 2, -l / 2, l, l);
    }
    ctx.restore();
  }

  // --- efeitos e dizeres ---------------------------------------------------
  // Depois de tudo, e de propósito: um estouro é um clarão de meio segundo, e
  // meio segundo escondido atrás de uma árvore é meio segundo desperdiçado.
  // A ordem de Y vale para o que fica em pé no chão; o que pisca por cima dele
  // não é cenário e não disputa profundidade.
  if (particulas) {
    particulas.desenhar(ctx, v, escala, agora / 1000);
    particulas.desenharDizeres(ctx, v, escala, agora / 1000);
  }
}

/**
 * A placa acima da construção: o que ela dá, e se está pronta.
 *
 * ## Por que uma placa e não mais texto
 *
 * O nome já está escrito ali. Empilhar "pegue uma bolsa aqui" em cima dele
 * daria três linhas de letra pequena sobre cada telhado, e o campo tem cinco
 * construções por reino. Um ícone é lido de relance e não compete com a briga.
 *
 * ## O aceso e o apagado
 *
 * O ícone só brilha quando **há alguma coisa a pegar**: bolsa cunhada na Casa
 * da Moeda, obra com material para subir de nível. Apagado, ele ainda diz o que
 * o prédio é. É a mesma ideia da chaminé da Casa da Moeda, que já dizia "esta
 * está parada" sem nenhuma palavra.
 */
function placaDaObra(
  ctx: CanvasRenderingContext2D,
  arte: Arte,
  e: Estrutura,
  estado: Estado | null,
  x: number,
  y: number,
  escala: number,
): void {
  const icone = arte.icones[ICONE_DA_ESTRUTURA[e.tipo]];
  if (!icone) return;

  let aceso = false;
  if (estado) {
    if (e.tipo === 'casaDaMoeda') {
      aceso = (estado.casasDaMoeda.find((c) => c.time === e.time)?.bolsas ?? 0) > 0;
    } else if (e.tipo === 'chapelaria') {
      const o = estado.oficinas.find((x) => x.time === e.time);
      if (o && o.nivel < NIVEL_MAXIMO) {
        const base = CUSTO_DO_NIVEL[o.nivel + 1]!;
        aceso =
          o.madeira >= custoDaObraDe(base.madeira, estado.porTime) &&
          o.ouro >= custoDaObraDe(base.ouro, estado.porTime);
      }
    }
  }

  const l = 22 * escala;
  ctx.save();
  // A chapa escura por trás: sem ela o ícone se perde no mato, que é verde e
  // cheio de detalhe, e uma placa que não se lê não é uma placa. É a mesma
  // chapa que o nome da construção já usa, pelo mesmo motivo.
  ctx.fillStyle = aceso ? 'rgba(70, 52, 16, 0.86)' : 'rgba(12, 14, 20, 0.6)';
  ctx.beginPath();
  ctx.arc(x, y, l * 0.78, 0, Math.PI * 2);
  ctx.fill();
  if (aceso) {
    // O anel dourado é o "pode vir buscar". Ele pulsa? Não: uma placa que pisca
    // no canto do olho a partida inteira cansa mais do que informa.
    ctx.strokeStyle = 'rgba(255, 224, 130, 0.9)';
    ctx.lineWidth = Math.max(1, 2 * escala);
    ctx.stroke();
  }
  ctx.globalAlpha = aceso ? 1 : 0.62;
  ctx.drawImage(icone, Math.round(x - l / 2), Math.round(y - l / 2), Math.ceil(l), Math.ceil(l));
  ctx.restore();
}

export interface FolhaEscolhida {
  anim: Animacao;
  /** Quadro já resolvido. */
  indice: number;
  espelhar: boolean;
}

/**
 * Qual folha desenhar, e em que quadro.
 *
 * A ordem é a ordem da prioridade visual: o golpe cobre tudo (é o que o jogador
 * precisa ver para reagir), depois o trabalho, depois a carga nas mãos, e só
 * então o parado ou correndo da classe.
 */
export function folhaDaUnidade(
  arte: Arte,
  estado: Estado,
  u: Unidade,
  andando: boolean,
): FolhaEscolhida {
  const espelhar = u.olharX < -0.1;

  if (u.porco > 0) {
    // O porco (Modo Xamã) ignora a classe por baixo do mesmo jeito que a
    // fera — só que aqui a folha nem é nova: é o mesmo porco decorativo do
    // pátio, o que sela a piada sem gastar um sprite a mais.
    const anim = andando ? arte.porco.andando : arte.porco.parado;
    return { anim, indice: quadroEm(anim, performance.now() / 1000, u.id * 3), espelhar };
  }

  if (u.fera) {
    // A fera ignora a classe por baixo inteiramente: enquanto dura a
    // transformação, é o Troll ou o Minotauro que aparece na tela.
    const folhasFera = arte.feras[u.fera];
    const perfilFera = PERFIS_DE_FERA[u.fera];
    if (u.golpe > 0) {
      const progresso = 1 - Math.max(0, Math.min(1, u.golpe / perfilFera.duracaoDoGolpe));
      return { anim: folhasFera.golpe, indice: quadroDaVez(folhasFera.golpe, progresso), espelhar };
    }
    const anim = andando ? folhasFera.andando : folhasFera.parado;
    return { anim, indice: quadroEm(anim, performance.now() / 1000, u.id * 3), espelhar };
  }

  const folhas = arte.unidades[u.time];
  const p = perfil(u.classe);
  const pega = (chave: string): Animacao | undefined => folhas[chave];

  if (u.golpe > 0) {
    const progresso = 1 - Math.max(0, Math.min(1, u.golpe / p.duracaoDoGolpe));
    const anim = folhaDoGolpe(folhas, u, estado);
    if (anim) {
      return { anim, indice: quadroDaVez(anim, progresso), espelhar: espelharDoGolpe(u, espelhar) };
    }
  }

  if (u.colhendoId !== null) {
    const trabalho = pega(`${u.classe}_trabalhando`);
    if (trabalho) {
      // A batida do machado acompanha o progresso: a animação repete enquanto a
      // barra enche, e é por isso que o `%` usa o próprio progresso e não o
      // relógio — dois lenhadores lado a lado batem fora de compasso, como duas
      // pessoas bateriam.
      const voltas = 3;
      const t = (u.colheita * voltas) % 1;
      return { anim: trabalho, indice: quadroDaVez(trabalho, t), espelhar };
    }
  }

  const carga = u.carga;
  if (carga === 'madeira' || carga === 'ouro' || carga === 'minerio') {
    const anim = pega(`carregando_${carga}_${andando ? 'correndo' : 'parado'}`);
    if (anim) return { anim, indice: quadroEm(anim, performance.now() / 1000, u.id * 3), espelhar };
  }

  const anim = pega(`${u.classe}_${andando ? 'correndo' : 'parado'}`) ?? pega(`${u.classe}_parado`)!;
  return { anim, indice: quadroEm(anim, performance.now() / 1000, u.id * 3), espelhar };
}

/** A folha do golpe, que no lanceiro depende da direção. */
function folhaDoGolpe(
  folhas: Readonly<Record<string, Animacao>>,
  u: Unidade,
  estado: Estado,
): Animacao | undefined {
  if (u.classe === 'guerreiro') {
    // Dois golpes que se alternam. A escolha vem da paridade do tick em que o
    // golpe começou — determinística, e estável durante o gesto inteiro (usar o
    // relógio trocaria de folha no meio do arco).
    const tickDoGolpe = estado.tick - Math.round(u.golpe / DT);
    return folhas[tickDoGolpe % 2 === 0 ? 'guerreiro_golpe1' : 'guerreiro_golpe2'];
  }
  if (u.classe === 'lanceiro') return folhas[chaveDaLanca(u)];
  return folhas[`${u.classe}_golpe`] ?? folhas[`${u.classe}_trabalhando`];
}

/** A estocada tem cinco folhas; a direção do olhar escolhe. */
function chaveDaLanca(u: Unidade): string {
  const ax = Math.abs(u.olharX);
  const ay = Math.abs(u.olharY);
  if (ax < 0.38) return u.olharY < 0 ? 'lanceiro_golpe_cima' : 'lanceiro_golpe_baixo';
  if (ay < 0.38) return 'lanceiro_golpe_lado';
  return u.olharY < 0 ? 'lanceiro_golpe_cima_lado' : 'lanceiro_golpe_baixo_lado';
}

function espelharDoGolpe(u: Unidade, espelhar: boolean): boolean {
  // As folhas verticais da lança não têm lado: espelhá-las inverteria a mão que
  // segura a arma sem nenhum ganho.
  if (u.classe === 'lanceiro' && Math.abs(u.olharX) < 0.38) return false;
  return espelhar;
}

function espelhado(
  ctx: CanvasRenderingContext2D,
  px: number,
  espelhar: boolean,
  desenhar: () => void,
): void {
  if (!espelhar) {
    desenhar();
    return;
  }
  ctx.save();
  ctx.translate(px * 2, 0);
  ctx.scale(-1, 1);
  desenhar();
  ctx.restore();
}

function moveu(olhar: OlharLocal, u: Unidade, agora: number): boolean {
  const a = olhar.posicaoDe(u, agora);
  const b = olhar.posicaoDe(u, agora - 90);
  return Math.hypot(a.x - b.x, a.y - b.y) > 0.8;
}

function desenharUnidade(
  ctx: CanvasRenderingContext2D,
  estado: Estado,
  u: Unidade,
  escolha: FolhaEscolhida,
  px: number,
  py: number,
  escala: number,
  tempo: number,
  vaga: number | null,
  quantosLocais: number,
  ajustes: Ajustes,
): void {
  const souEu = vaga !== null;
  // As folhas do pacote põem o boneco no centro de uma caixa grande o bastante
  // para a arma. Ancorar no centro e empurrar um pouco para cima planta o pé no
  // chão sem que o lanceiro (caixa de 320) flutue acima do guerreiro (192).
  const centroY = py - escolha.anim.lado * escala * 0.08;
  espelhado(ctx, px, escolha.espelhar, () =>
    quadro(ctx, escolha.anim, escolha.indice, px, centroY, escala, 'centro'),
  );

  const topo = py - 34 * escala;

  // Barra de vida só quando falta vida: doze barras cheias na tela é ruído.
  const max = vidaMaximaDe(u.classe, nivelDe(estado, u.time), u.fera);
  if (u.vida < max) {
    const larguraBarra = 34 * escala;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(px - larguraBarra / 2, topo - 6 * escala, larguraBarra, 5 * escala);
    ctx.fillStyle = u.vida / max > 0.35 ? '#6ac46a' : '#d9534f';
    ctx.fillRect(px - larguraBarra / 2, topo - 6 * escala, (larguraBarra * u.vida) / max, 5 * escala);
  }

  if (u.colheita > 0) {
    const larguraBarra = 30 * escala;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(px - larguraBarra / 2, py + 10 * escala, larguraBarra, 4 * escala);
    ctx.fillStyle = '#e8c46a';
    ctx.fillRect(px - larguraBarra / 2, py + 10 * escala, larguraBarra * u.colheita, 4 * escala);
  }

  // A seta sobre a cabeça é o que torna a tela compartilhada jogável: com
  // quatro bonecos do mesmo time no mesmo quadro, ninguém acha o seu pelo
  // sprite. Ela pula devagar para não sumir no meio da briga.
  //
  // O tamanho tem um piso **em pixels de tela**, e não em escala do mundo: é
  // justamente quando o sofá se espalha e a câmera abre que achar o próprio
  // boneco fica difícil — e era aí que a seta encolhia até virar um ponto.
  const cor = vaga !== null ? COR_DA_VAGA[vaga % COR_DA_VAGA.length]! : '#ffe9a8';
  if (vaga !== null) {
    const tamanho = Math.max(7, 7 * escala);
    const pulo = Math.sin(tempo * 3.2 + vaga) * tamanho * 0.35;
    seta(ctx, px, py - Math.max(46, 60 * escala) + pulo, tamanho, cor);
  }

  if (ajustes.nomes || souEu) {
    // Com gente demais no sofá, "(você)" no boneco de todo mundo não diz nada;
    // aí o número da vaga é que identifica, e ele casa com a cor da seta e com
    // a do cartão no canto da tela.
    const marca = vaga === null ? '' : quantosLocais > 1 ? ` (P${vaga + 1})` : ' (você)';
    const nome = `${u.nome}${marca}`;
    if (nome.trim()) {
      rotulo(ctx, u.bot ? `${nome} ⚙` : nome, px, topo - 12 * escala, escala, cor);
    }
  }
}

/** A setinha de "este é o seu", apontando para baixo. */
function seta(ctx: CanvasRenderingContext2D, x: number, y: number, l: number, cor: string): void {
  ctx.save();
  ctx.fillStyle = cor;
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, y + l);
  ctx.lineTo(x - l, y - l);
  ctx.lineTo(x + l, y - l);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function rotulo(
  ctx: CanvasRenderingContext2D,
  texto: string,
  x: number,
  y: number,
  escala: number,
  cor = '#ffffff',
): void {
  const tamanho = Math.max(10, Math.round(12 * escala));
  ctx.font = `600 ${tamanho}px "Trebuchet MS", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.lineWidth = Math.max(2, 3 * escala);
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.strokeText(texto, x, y);
  ctx.fillStyle = cor;
  ctx.fillText(texto, x, y);
}

function desenharPonte(ctx: CanvasRenderingContext2D, x: number, y: number, lado: number): void {
  ctx.fillStyle = '#8a5a2b';
  ctx.fillRect(Math.round(x), Math.round(y), Math.ceil(lado), Math.ceil(lado));
  ctx.fillStyle = '#a8703a';
  const tabuas = 4;
  for (let i = 0; i < tabuas; i++) {
    ctx.fillRect(
      Math.round(x),
      Math.round(y + (i * lado) / tabuas + lado * 0.04),
      Math.ceil(lado),
      Math.ceil(lado / tabuas - lado * 0.08),
    );
  }
}

/**
 * A bolsa de moedas, desenhada à mão: o pacote não tem uma, e o depósito é o
 * coração do jogo.
 */
function desenharBolsa(ctx: CanvasRenderingContext2D, x: number, y: number, escala: number): void {
  const l = 18 * escala;
  const a = 15 * escala;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(0, 2 * escala, l * 0.6, 4 * escala, 0, 0, Math.PI * 2);
  ctx.fill();

  // O saco: uma barriga larga que estreita no pescoço, que é o que faz uma
  // bolsa de moedas ser reconhecida de longe sem nenhum detalhe dentro.
  ctx.fillStyle = '#8a5a34';
  ctx.beginPath();
  ctx.moveTo(-l * 0.2, -a);
  ctx.quadraticCurveTo(-l * 0.62, -a * 0.55, -l * 0.5, -a * 0.2);
  ctx.quadraticCurveTo(-l * 0.42, 0, 0, 0);
  ctx.quadraticCurveTo(l * 0.42, 0, l * 0.5, -a * 0.2);
  ctx.quadraticCurveTo(l * 0.62, -a * 0.55, l * 0.2, -a);
  ctx.closePath();
  ctx.fill();

  // O cordão dourado no pescoço, e a moeda espiando por cima: é o cordão que
  // diz que está cheia, e a moeda que diz do que.
  ctx.fillStyle = '#c9a227';
  ctx.fillRect(-l * 0.24, -a - escala, l * 0.48, 3 * escala);
  ctx.fillStyle = '#f5d76e';
  ctx.beginPath();
  ctx.arc(l * 0.16, -a - 2.5 * escala, 3 * escala, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * O baú refém, e o quanto ele está cheio.
 *
 * ## Por que ele é desenhado e não é um sprite
 *
 * O pacote Tiny Swords não tem baú, e o refém precisa de uma coisa que nenhum
 * sprite pronto entrega: **mudar de forma com o peso**. Antes daqui, o refém
 * era o aldeão do time tingido de rosa e esticado — funcionava, mas dizia a
 * coisa errada no tema novo, e a única pista do peso era o tamanho.
 *
 * Desenhado, o peso aparece em três lugares ao mesmo tempo: o tamanho (que vem
 * de fora, na escala), a **tampa que abre** conforme enche, e as moedas que
 * transbordam pela fresta. De longe se lê o volume; de perto se lê quanto falta
 * para o talo — que é a pergunta que a barra do alto responde em número.
 *
 * ## Ele é vivo
 *
 * A tampa respira e as moedas balançam com o relógio. Um baú parado no chão da
 * cofre some no cenário; um que se mexe é o refém que o jogo promete.
 *
 * @param cheio de 0 a 1, o peso normalizado entre os dois talos da balança.
 */
export function desenharBau(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  escala: number,
  time: Time,
  cheio: number,
  tempo: number,
): void {
  const l = 34 * escala;
  const a = 22 * escala;
  const respiro = Math.sin(tempo * 2.2 + (time === 'azul' ? 0 : 1.7)) * escala;
  // A tampa abre com o peso: quase fechada no talo de baixo, escancarada no de
  // cima. É a leitura de longe — não dá para contar moeda a essa distância, mas
  // dá para ver se a tampa fecha.
  const abertura = (5 + cheio * 17) * escala + respiro;
  const cor = time === 'azul' ? '#2f6fd0' : '#cf3b2f';

  ctx.save();
  ctx.translate(x, y);

  ctx.fillStyle = 'rgba(0,0,0,0.32)';
  ctx.beginPath();
  ctx.ellipse(0, 0, l * 0.52, 5 * escala, 0, 0, Math.PI * 2);
  ctx.fill();

  // As perninhas, fora de passo uma com a outra — é o que faz dele um baú
  // **vivo** e não um móvel.
  ctx.fillStyle = '#2c1f13';
  for (const lado of [-1, 1]) {
    const passo = Math.sin(tempo * 2.2 + lado) * 1.5 * escala;
    ctx.fillRect(lado * l * 0.26 - 2 * escala, -3 * escala + passo, 4 * escala, 5 * escala);
  }

  // O corpo. As cintas são de **ferro**, e não de ouro: douradas, elas somem
  // dentro do ouro que transborda e o baú vira um bloco amarelo.
  ctx.fillStyle = '#7a4f2a';
  ctx.fillRect(-l / 2, -a, l, a - 2 * escala);
  ctx.fillStyle = '#5d3a1d';
  ctx.fillRect(-l / 2, -a * 0.44, l, 3 * escala);
  ctx.fillStyle = '#4a4f57';
  for (const lado of [-1, 1]) {
    ctx.fillRect(lado * l * 0.34 - 1.5 * escala, -a, 3 * escala, a - 2 * escala);
  }
  ctx.strokeStyle = '#3a2717';
  ctx.lineWidth = Math.max(1, escala);
  ctx.strokeRect(-l / 2, -a, l, a - 2 * escala);

  // O ouro pela fresta: um monte de moedas empilhadas, e não um retângulo
  // amarelo. O retângulo era barato e lia como "tampa amarela"; são as bordas
  // redondas encavaladas que dizem *moeda* em dezoito pixels.
  const monte = Math.max(1, Math.round(2 + cheio * 5));
  for (let i = 0; i < monte; i++) {
    const t = monte === 1 ? 0.5 : i / (monte - 1);
    const fase = tempo * 2.6 + i * 1.7;
    ctx.fillStyle = i % 2 === 0 ? '#ffe89a' : '#dcae25';
    ctx.beginPath();
    ctx.arc(
      (t - 0.5) * l * 0.72,
      -a - abertura * 0.34 + Math.sin(fase) * escala * 0.8 + Math.abs(t - 0.5) * 6 * escala,
      3 * escala,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  // A tampa, erguida acima do ouro, com a faixa do reino de quem ele é: sem
  // ela, dois baús no mesmo pedaço de tela viram o mesmo baú.
  ctx.save();
  ctx.translate(0, -a - abertura);
  ctx.fillStyle = '#8a5a34';
  ctx.strokeStyle = '#3a2717';
  ctx.beginPath();
  ctx.moveTo(-l / 2, 7 * escala);
  ctx.quadraticCurveTo(0, -7 * escala, l / 2, 7 * escala);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = cor;
  ctx.fillRect(-l * 0.12, -2 * escala, l * 0.24, 6 * escala);
  ctx.restore();

  // A fechadura, que é o rosto dele.
  ctx.fillStyle = '#f2e6c9';
  ctx.fillRect(-2.5 * escala, -a * 0.62, 5 * escala, 6 * escala);
  ctx.fillStyle = '#3f2d1c';
  ctx.fillRect(-escala, -a * 0.55, 2 * escala, 3 * escala);
  ctx.restore();
}

const TINTA_DA_CLASSE: Readonly<Record<Classe, string>> = {
  aldeao: '#d9c8a2',
  guerreiro: '#c0392b',
  lanceiro: '#2f6fd0',
  arqueiro: '#27ae60',
  clerigo: '#ecf0f1',
  minerador: '#7f8c8d',
  lenhador: '#8a5a2b',
  saqueador: '#6b8e23',
};

/** O chapéu no chão. Também é à mão: no pacote a classe é a unidade inteira. */
function desenharChapeu(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  escala: number,
  classe: Classe,
  origem: Time | null,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = TINTA_DA_CLASSE[classe] ?? '#cccccc';
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = Math.max(1, 1.5 * escala);
  ctx.beginPath();
  if (classe === 'clerigo') {
    ctx.moveTo(-9 * escala, 2 * escala);
    ctx.lineTo(0, -16 * escala);
    ctx.lineTo(9 * escala, 2 * escala);
    ctx.closePath();
  } else if (classe === 'arqueiro' || classe === 'saqueador') {
    ctx.moveTo(-10 * escala, 2 * escala);
    ctx.lineTo(10 * escala, 2 * escala);
    ctx.lineTo(4 * escala, -9 * escala);
    ctx.lineTo(-4 * escala, -9 * escala);
    ctx.closePath();
  } else {
    ctx.ellipse(0, -2 * escala, 9 * escala, 7 * escala, 0, Math.PI, 0);
    ctx.rect(-11 * escala, -2 * escala, 22 * escala, 3 * escala);
  }
  ctx.fill();
  ctx.stroke();
  // Um ponto na cor do dono original: é como se lê, de longe, que aquele chapéu
  // de arqueiro que o inimigo está usando saiu da sua chapelaria.
  if (origem) {
    ctx.fillStyle = origem === 'azul' ? '#2f6fd0' : '#cf3b2f';
    ctx.beginPath();
    ctx.arc(0, -6 * escala, 2.4 * escala, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}


/** Anel que marca o alvo do botão de contexto. */
export function realce(
  ctx: CanvasRenderingContext2D,
  vista: Vista,
  alvo: { x: number; y: number },
  tempo: number,
): void {
  const x = vista.paraTelaX(alvo.x);
  const y = vista.paraTelaY(alvo.y);
  const r = (26 + Math.sin(tempo * 4) * 3) * vista.escala;
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 233, 168, 0.9)';
  ctx.lineWidth = Math.max(2, 3 * vista.escala);
  ctx.setLineDash([8 * vista.escala, 6 * vista.escala]);
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * 0.5, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** Seta na borda da tela apontando para algo importante fora dela. */
export function bussola(
  ctx: CanvasRenderingContext2D,
  vista: Vista,
  largura: number,
  altura: number,
  alvo: { x: number; y: number },
  cor: string,
): void {
  const x = vista.paraTelaX(alvo.x);
  const y = vista.paraTelaY(alvo.y);
  const margem = 44;
  if (x > margem && x < largura - margem && y > margem && y < altura - margem) return;
  const cx = largura / 2;
  const cy = altura / 2;
  const angulo = Math.atan2(y - cy, x - cx);
  const px = cx + Math.cos(angulo) * (Math.min(largura, altura) / 2 - margem);
  const py = cy + Math.sin(angulo) * (Math.min(largura, altura) / 2 - margem);
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(angulo);
  ctx.fillStyle = cor;
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(14, 0);
  ctx.lineTo(-8, -9);
  ctx.lineTo(-8, 9);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
