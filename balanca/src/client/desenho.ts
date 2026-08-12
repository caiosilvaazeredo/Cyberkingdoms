import { AGUA, PONTE, decoracaoEm, type Arena, type Estrutura } from '../shared/arena';
import { perfil } from '../shared/classes';
import type { Estado, Unidade } from '../shared/estado';
import { PESO_MAXIMO, PESO_MINIMO, RAIO_UNIDADE, type Time } from '../shared/regras';
import { COR_DO_TIME, quadro, quadroEm, type Arte } from './arte';
import type { Rede } from './rede';
import { TILE, chaoPara, encostaNaAgua, mascaraDe } from './tileset';

/**
 * O mundo desenhado — água, chão, castelos, gente e princesa.
 *
 * ## O peso se vê antes de se ler
 *
 * A princesa é desenhada **do tamanho do peso dela**. A barra no alto da tela
 * diz o número, mas quem está correndo para resgatar não lê número: vê que a
 * moça na masmorra inimiga está do tamanho de uma casa e entende, sem legenda,
 * que vai precisar de ajuda. É o diferencial do jogo virando silhueta.
 *
 * ## Ordem por pé, e não por camada
 *
 * Tudo o que fica de pé no chão — árvore, prédio, unidade, princesa — entra numa
 * lista só e é desenhado em ordem de Y. Sem isso, um jogador atrás de uma torre
 * aparece na frente dela, e a vista de cima perde a profundidade que a arte
 * tenta dar.
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
): void {
  // Enquadramento por altura: numa tela larga, mostrar mais mundo na
  // horizontal é bônus; numa tela alta, mostrar mais na vertical arruinaria a
  // leitura de quem está chegando pelos flancos.
  camera.zoom = Math.max(0.42, Math.min(1.15, altura / (13 * TILE)));
  const meioX = largura / 2 / camera.zoom;
  const meioY = altura / 2 / camera.zoom;
  const mundoLargura = arena.largura * TILE;
  const mundoAltura = arena.altura * TILE;
  camera.x = mundoLargura <= meioX * 2
    ? mundoLargura / 2
    : Math.max(meioX, Math.min(mundoLargura - meioX, alvo.x));
  camera.y = mundoAltura <= meioY * 2
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
      ctx.drawImage(arte.agua, Math.round(telaX(tx)), Math.round(telaY(ty)), Math.ceil(passo), Math.ceil(passo));
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
        i * anim.lado, 0, anim.lado, anim.lado,
        Math.round(telaX(tx) - (lado - passo) / 2),
        Math.round(telaY(ty) - (lado - passo) / 2),
        Math.ceil(lado), Math.ceil(lado),
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
        c.col * TILE, c.row * TILE, TILE, TILE,
        Math.round(telaX(tx)), Math.round(telaY(ty)),
        Math.ceil(passo), Math.ceil(passo),
      );
      if (arena.tile(tx, ty) === PONTE) desenharPonte(ctx, telaX(tx), telaY(ty), passo);
    }
  }

  const pinturas: Pintura[] = [];

  // --- mato --------------------------------------------------------------
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const deco = decoracaoEm(arena, tx, ty);
      if (!deco) continue;
      const px = telaX(tx) + passo / 2;
      const py = telaY(ty) + passo;
      if (deco.tipo === 'pedra') {
        const img = arte.pedras[deco.variante % arte.pedras.length]!;
        pinturas.push({
          y: ty * TILE,
          pintar: () =>
            ctx.drawImage(img, Math.round(px - passo / 2), Math.round(py - passo), Math.ceil(passo), Math.ceil(passo)),
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

  // --- trigais ------------------------------------------------------------
  for (const t of arena.trigais) {
    const maduro = estado?.trigais.find((x) => x.id === t.id)?.maduro ?? true;
    pinturas.push({
      y: t.y,
      pintar: () => desenharTrigo(ctx, v.paraTelaX(t.x), v.paraTelaY(t.y), escala, maduro, tempo),
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
        rotulo(ctx, NOME_DA_ESTRUTURA[e.tipo], v.paraTelaX(e.x), Math.round(py - alto) - 6 * escala, escala);
        if (e.tipo === 'cozinha' && estado) {
          const forno = estado.cozinhas.find((c) => c.time === e.time);
          if (forno && forno.assando > 0) {
            // Chaminé apagada é a forma mais barata de dizer "esta cozinha
            // está parada" — mais barata que texto, e legível de longe.
            quadro(ctx, arte.fumaca, quadroEm(arte.fumaca, tempo), v.paraTelaX(e.x), Math.round(py - alto * 0.85), escala * 0.7);
            quadro(ctx, arte.fogo, quadroEm(arte.fogo, tempo), v.paraTelaX(e.x), Math.round(py), escala * 0.8);
          }
          if (forno && forno.bolos > 0) {
            for (let i = 0; i < forno.bolos; i++) {
              desenharBolo(ctx, v.paraTelaX(e.x) - 26 * escala + i * 24 * escala, py - 4 * escala, escala * 0.9);
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
        if (item.tipo === 'bolo') desenharBolo(ctx, px, py + pulo, escala);
        else desenharChapeu(ctx, px, py + pulo - 8 * escala, escala * 1.4, item.classe!, item.origem);
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
    const py =
      v.paraTelaY(base.y) + (carregada ? -22 * escala : TILE * escala * 0.6);
    // O tamanho **é** o peso: de 0,9 a 1,9 do peão comum, do talo ao talo.
    const gordura = 0.9 + ((p.peso - PESO_MINIMO) / (PESO_MAXIMO - PESO_MINIMO)) * 1.0;
    const anim = carregada ? arte.princesaCorrendo : arte.princesa;
    pinturas.push({
      // Presa, ela é desenhada depois da torre: a ordem por pé colocaria a
      // torre na frente, porque o pé dela está mais abaixo.
      y: base.y + (carregada ? 1 : TILE * 0.6),
      pintar: () => {
        quadro(ctx, anim, quadroEm(anim, tempo, p.time === 'azul' ? 0 : 3), px, py, escala * gordura);
        coroa(ctx, px, py - TILE * escala * gordura * 0.95, escala * gordura, p.time);
      },
    });
  }

  // --- unidades -----------------------------------------------------------
  for (const u of estado.unidades) {
    if (!u.vivo) continue;
    const pos = rede.posicaoDe(u, agora);
    const px = v.paraTelaX(pos.x);
    const py = v.paraTelaY(pos.y) + RAIO_UNIDADE * escala;
    const andando = u.id === rede.meuId ? true : moveu(rede, u, agora);
    const anim = andando ? arte.correndo[u.time] : arte.parado[u.time];
    pinturas.push({
      y: pos.y,
      pintar: () => desenharUnidade(ctx, arte, anim, u, px, py, escala, tempo, rede.meuId === u.id),
    });
  }

  for (const p of pinturas.sort((a, b) => a.y - b.y)) p.pintar();

  // --- projéteis ----------------------------------------------------------
  const adianta = rede.desdeORetrato(agora);
  for (const pj of estado.projeteis) {
    const px = v.paraTelaX(pj.x + pj.vx * adianta);
    const py = v.paraTelaY(pj.y + pj.vy * adianta);
    if (pj.tipo === 'flecha') desenharFlecha(ctx, px, py, Math.atan2(pj.vy, pj.vx), escala);
    else desenharBola(ctx, px, py, escala, tempo);
  }
}

function moveu(rede: Rede, u: Unidade, agora: number): boolean {
  const a = rede.posicaoDe(u, agora);
  const b = rede.posicaoDe(u, agora - 60);
  return Math.hypot(a.x - b.x, a.y - b.y) > 0.6;
}

function desenharUnidade(
  ctx: CanvasRenderingContext2D,
  arte: Arte,
  anim: Parameters<typeof quadro>[1],
  u: Unidade,
  px: number,
  py: number,
  escala: number,
  tempo: number,
  souEu: boolean,
): void {
  ctx.save();
  // O peão do pacote olha para a direita. Espelhar é o jeito honesto de virar
  // uma folha que não tem quadro para a esquerda.
  if (u.olharX < 0) {
    ctx.translate(px * 2, 0);
    ctx.scale(-1, 1);
  }
  quadro(ctx, anim, quadroEm(anim, tempo, u.id * 3), px, py, escala);
  ctx.restore();

  const topo = py - TILE * escala;
  if (u.classe !== 'aldeao') desenharChapeu(ctx, px, topo + 10 * escala, escala * 1.2, u.classe, u.time);

  // Barra de vida só quando falta vida: doze barras cheias na tela é ruído.
  const max = perfil(u.classe).vida;
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
    ctx.fillRect(px - larguraBarra / 2, py + 4 * escala, larguraBarra, 4 * escala);
    ctx.fillStyle = '#e8c46a';
    ctx.fillRect(px - larguraBarra / 2, py + 4 * escala, larguraBarra * u.colheita, 4 * escala);
  }

  if (u.carga === 'trigo') desenharEspiga(ctx, px + 14 * escala, topo + 26 * escala, escala);
  if (u.carga === 'bolo') desenharBolo(ctx, px + 14 * escala, topo + 30 * escala, escala * 0.8);

  const nome = souEu ? `${u.nome} (você)` : u.nome;
  if (nome.trim()) {
    rotulo(ctx, u.bot ? `${nome} ⚙` : nome, px, topo - 12 * escala, escala, souEu ? '#ffe9a8' : '#ffffff');
  }
  void arte;
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

function desenharTrigo(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  escala: number,
  maduro: boolean,
  tempo: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#6b4b2a';
  ctx.beginPath();
  ctx.ellipse(0, 0, 26 * escala, 14 * escala, 0, 0, Math.PI * 2);
  ctx.fill();
  const hastes = 7;
  for (let i = 0; i < hastes; i++) {
    const dx = (-24 + i * 8) * escala;
    const balanco = Math.sin(tempo * 1.6 + i) * 2 * escala;
    const alturaHaste = (maduro ? 26 : 8) * escala;
    ctx.strokeStyle = maduro ? '#d8a72c' : '#8f7a3e';
    ctx.lineWidth = Math.max(1, 2.5 * escala);
    ctx.beginPath();
    ctx.moveTo(dx, 2 * escala);
    ctx.quadraticCurveTo(dx + balanco, -alturaHaste / 2, dx + balanco * 1.6, -alturaHaste);
    ctx.stroke();
    if (!maduro) continue;
    ctx.fillStyle = '#f2c94c';
    ctx.beginPath();
    ctx.ellipse(dx + balanco * 1.6, -alturaHaste, 3.2 * escala, 6 * escala, balanco * 0.05, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function desenharEspiga(ctx: CanvasRenderingContext2D, x: number, y: number, escala: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = '#c99a2e';
  ctx.lineWidth = Math.max(1, 2 * escala);
  ctx.beginPath();
  ctx.moveTo(0, 8 * escala);
  ctx.lineTo(0, -8 * escala);
  ctx.stroke();
  ctx.fillStyle = '#f2c94c';
  ctx.beginPath();
  ctx.ellipse(0, -8 * escala, 4 * escala, 7 * escala, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

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

const TINTA_DA_CLASSE: Record<string, string> = {
  guerreiro: '#c0392b',
  arqueiro: '#27ae60',
  mago: '#8e44ad',
  sacerdote: '#ecf0f1',
  aldeao: '#d9c8a2',
};

function desenharChapeu(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  escala: number,
  classe: string,
  origem: Time | null,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = TINTA_DA_CLASSE[classe] ?? '#cccccc';
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = Math.max(1, 1.5 * escala);
  ctx.beginPath();
  if (classe === 'mago') {
    ctx.moveTo(-9 * escala, 2 * escala);
    ctx.lineTo(0, -16 * escala);
    ctx.lineTo(9 * escala, 2 * escala);
    ctx.closePath();
  } else if (classe === 'arqueiro') {
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
  // Um ponto na cor do dono original: é como se lê, de longe, que aquele
  // chapéu de mago que o inimigo está usando saiu da sua chapelaria.
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

function desenharFlecha(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angulo: number,
  escala: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angulo);
  ctx.strokeStyle = '#3d2a14';
  ctx.lineWidth = Math.max(1.5, 2.5 * escala);
  ctx.beginPath();
  ctx.moveTo(-14 * escala, 0);
  ctx.lineTo(8 * escala, 0);
  ctx.stroke();
  ctx.fillStyle = '#cfd6dd';
  ctx.beginPath();
  ctx.moveTo(14 * escala, 0);
  ctx.lineTo(6 * escala, -4 * escala);
  ctx.lineTo(6 * escala, 4 * escala);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function desenharBola(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  escala: number,
  tempo: number,
): void {
  const r = (10 + Math.sin(tempo * 20) * 1.5) * escala;
  const brilho = ctx.createRadialGradient(x, y, 1, x, y, r * 1.8);
  brilho.addColorStop(0, 'rgba(255,240,180,0.95)');
  brilho.addColorStop(0.5, 'rgba(255,140,40,0.85)');
  brilho.addColorStop(1, 'rgba(255,80,0,0)');
  ctx.fillStyle = brilho;
  ctx.beginPath();
  ctx.arc(x, y, r * 1.8, 0, Math.PI * 2);
  ctx.fill();
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

export function estadoVisivel(estado: Estado | null): estado is Estado {
  return estado !== null;
}
