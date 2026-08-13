import { AGUA, PONTE, decoracaoEm, type Arena, type Estrutura } from '../shared/arena';
import { perfil, vidaMaxima, type Classe } from '../shared/classes';
import { nivelDe, type Animal, type Estado, type Unidade } from '../shared/estado';
import { DT, PESO_MAXIMO, PESO_MINIMO, RAIO_UNIDADE, type Time } from '../shared/regras';
import { ZOOM_DA_VISAO, type Ajustes } from './ajustes';
import { quadro, quadroDaVez, quadroEm, type Animacao, type Arte } from './arte';
import type { Rede } from './rede';
import { TILE, chaoPara, encostaNaAgua, mascaraDe } from './tileset';

/**
 * O mundo desenhado — água, chão, castelos, gente, bicho e princesa.
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
 * A princesa é desenhada **do tamanho do peso dela**. A barra no alto da tela
 * diz o número, mas quem está correndo para resgatar não lê número: vê que a
 * moça na masmorra inimiga está do tamanho de uma casa e entende, sem legenda,
 * que vai precisar de ajuda.
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

const SPRITE_DA_ESTRUTURA: Record<Estrutura['tipo'], string> = {
  trono: 'Castle',
  jaula: 'Tower',
  cozinha: 'Monastery',
  chapelaria: 'Barracks',
  nascedouro: 'House1',
};

const NOME_DA_ESTRUTURA: Record<Estrutura['tipo'], string> = {
  trono: 'Trono',
  jaula: 'Masmorra',
  cozinha: 'Cozinha',
  chapelaria: 'Chapelaria',
  nascedouro: 'Quartel',
};

const COR_DO_TIME: Readonly<Record<Time, string>> = { azul: 'blue', vermelho: 'red' };

export function criarCamera(): Camera {
  return { x: 0, y: 0, zoom: 1 };
}

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
  rede: Rede,
  camera: Camera,
  largura: number,
  altura: number,
  tempo: number,
  ajustes: Ajustes,
): void {
  const estado = rede.estado;
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
        if (deco.tipo === 'pedra') {
          const im = arte.pedras[deco.variante % arte.pedras.length]!;
          pinturas.push({
            y: ty * TILE,
            pintar: () =>
              ctx.drawImage(
                im,
                Math.round(px - passo / 2),
                Math.round(py - passo),
                Math.ceil(passo),
                Math.ceil(passo),
              ),
          });
          continue;
        }
        const banco = deco.tipo === 'arvore' ? arte.arvores : arte.arbustos;
        const anim = banco[deco.variante % banco.length]!;
        const tamanho = deco.tipo === 'arvore' ? escala * 0.85 : escala;
        pinturas.push({
          y: ty * TILE,
          pintar: () => quadro(ctx, anim, quadroEm(anim, tempo, deco.deslocamento), px, py, tamanho),
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
        if (e.tipo === 'cozinha' && estado) {
          const forno = estado.cozinhas.find((c) => c.time === e.time);
          if (forno && forno.assando > 0) {
            // Chaminé apagada é a forma mais barata de dizer "esta cozinha está
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
          if (forno && forno.bolos > 0) {
            for (let i = 0; i < forno.bolos; i++) {
              desenharBolo(
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
        if (item.tipo === 'bolo') {
          desenharBolo(ctx, px, py + pulo, escala);
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
  const alfa = rede.alfa(agora);
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

  // --- princesas ----------------------------------------------------------
  for (const p of estado.princesas) {
    if (p.onde === 'salva') continue;
    const carregada = p.onde === 'carregada';
    const portador = carregada ? estado.unidades.find((u) => u.id === p.portador) : undefined;
    const base = portador ? rede.posicaoDe(portador, agora) : { x: p.x, y: p.y };
    const px = v.paraTelaX(base.x);
    // Presa, ela fica **na base** da torre, e não no centro dela: a masmorra é
    // um sprite alto, e desenhar a princesa no ponto da estrutura a deixaria
    // flutuando na altura da janela. Carregada, sobe um pouco — está no colo.
    const py = v.paraTelaY(base.y) + (carregada ? -22 * escala : TILE * escala * 0.6);
    // O tamanho **é** o peso: de 0,9 a 1,9 do peão comum, do talo ao talo.
    const gordura = 0.9 + ((p.peso - PESO_MINIMO) / (PESO_MAXIMO - PESO_MINIMO)) * 1;
    const anim = arte.princesa[p.time];
    pinturas.push({
      y: base.y + (carregada ? 1 : TILE * 0.6),
      pintar: () => {
        quadro(ctx, anim, quadroEm(anim, tempo, p.time === 'azul' ? 0 : 3), px, py, escala * gordura);
        coroa(ctx, px, py - TILE * escala * gordura * 0.92, escala * gordura, p.time);
      },
    });
  }

  // --- unidades -----------------------------------------------------------
  for (const u of estado.unidades) {
    if (!u.vivo) continue;
    // A posição local já vinha da previsão, mas a animação ainda lia o retrato
    // do servidor. Na janela entre pacotes, o boneco andava sem virar. Usar a
    // mesma unidade prevista aplica a direção selecionada no mesmo quadro.
    const visivel = u.id === rede.meuId ? rede.eu ?? u : u;
    const pos = rede.posicaoDe(visivel, agora);
    const px = v.paraTelaX(pos.x);
    const py = v.paraTelaY(pos.y);
    const andando = visivel.id === rede.meuId
      ? andandoAgora(rede, visivel, agora)
      : moveu(rede, visivel, agora);
    const escolha = folhaDaUnidade(arte, estado, visivel, andando);
    pinturas.push({
      y: pos.y,
      pintar: () =>
        desenharUnidade(
          ctx,
          estado,
          visivel,
          escolha,
          px,
          py,
          escala,
          tempo,
          rede.meuId === visivel.id,
          ajustes,
        ),
    });
  }

  for (const p of pinturas.sort((a, b) => a.y - b.y)) p.pintar();

  // --- efeito da bênção do clérigo ---------------------------------------
  for (const brilho of rede.brilhos) {
    const alvo = estado.unidades.find((u) => u.id === brilho.alvo);
    if (!alvo) continue;
    const pos = rede.posicaoDe(alvo, agora);
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
  const adianta = rede.desdeORetrato(agora);
  for (const pj of estado.projeteis) {
    const px = v.paraTelaX(pj.x + pj.vx * adianta);
    const py = v.paraTelaY(pj.y + pj.vy * adianta);
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
}

/** Interpola a ovelha entre os dois últimos retratos. */
function posicaoDoAnimal(a: Animal, alfa: number): { x: number; y: number } {
  return {
    x: a.destinoX + (a.x - a.destinoX) * alfa,
    y: a.destinoY + (a.y - a.destinoY) * alfa,
  };
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
  const folhas = arte.unidades[u.time];
  const p = perfil(u.classe);
  const pega = (chave: string): Animacao | undefined => folhas[chave];
  const espelhar = u.olharX < -0.1;

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
  if (carga === 'madeira' || carga === 'ouro' || carga === 'carne') {
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

function andandoAgora(rede: Rede, u: Unidade, agora: number): boolean {
  return moveu(rede, u, agora);
}

function moveu(rede: Rede, u: Unidade, agora: number): boolean {
  const a = rede.posicaoDe(u, agora);
  const b = rede.posicaoDe(u, agora - 90);
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
  souEu: boolean,
  ajustes: Ajustes,
): void {
  // As folhas do pacote põem o boneco no centro de uma caixa grande o bastante
  // para a arma. Ancorar no centro e empurrar um pouco para cima planta o pé no
  // chão sem que o lanceiro (caixa de 320) flutue acima do guerreiro (192).
  const centroY = py - escolha.anim.lado * escala * 0.08;
  espelhado(ctx, px, escolha.espelhar, () =>
    quadro(ctx, escolha.anim, escolha.indice, px, centroY, escala, 'centro'),
  );

  const topo = py - 34 * escala;

  // Barra de vida só quando falta vida: doze barras cheias na tela é ruído.
  const max = vidaMaxima(u.classe, nivelDe(estado, u.time));
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

  if (ajustes.nomes || souEu) {
    const nome = souEu ? `${u.nome} (você)` : u.nome;
    if (nome.trim()) {
      rotulo(
        ctx,
        u.bot ? `${nome} ⚙` : nome,
        px,
        topo - 12 * escala,
        escala,
        souEu ? '#ffe9a8' : '#ffffff',
      );
    }
  }
  void tempo;
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

/** O bolo é desenhado à mão: o pacote não tem um, e a fatia é o coração do jogo. */
function desenharBolo(ctx: CanvasRenderingContext2D, x: number, y: number, escala: number): void {
  const l = 20 * escala;
  const a = 14 * escala;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(0, 2 * escala, l * 0.6, 4 * escala, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#e8c98f';
  ctx.fillRect(-l / 2, -a, l, a);
  ctx.fillStyle = '#f6a5c0';
  ctx.fillRect(-l / 2, -a - 5 * escala, l, 6 * escala);
  ctx.fillStyle = '#c0392b';
  ctx.beginPath();
  ctx.arc(0, -a - 8 * escala, 3 * escala, 0, Math.PI * 2);
  ctx.fill();
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
  cacador: '#6b8e23',
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
  } else if (classe === 'arqueiro' || classe === 'cacador') {
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

function coroa(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  escala: number,
  time: Time,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#f5c542';
  ctx.strokeStyle = time === 'azul' ? '#2f6fd0' : '#cf3b2f';
  ctx.lineWidth = Math.max(1, 2 * escala);
  ctx.beginPath();
  ctx.moveTo(-10 * escala, 4 * escala);
  ctx.lineTo(-10 * escala, -6 * escala);
  ctx.lineTo(-4 * escala, 0);
  ctx.lineTo(0, -8 * escala);
  ctx.lineTo(4 * escala, 0);
  ctx.lineTo(10 * escala, -6 * escala);
  ctx.lineTo(10 * escala, 4 * escala);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
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
