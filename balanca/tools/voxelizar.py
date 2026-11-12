#!/usr/bin/env python3
"""
Converte as folhas de sprite do Tiny Swords em modelos voxel (.glb).

Uso:
    pip install pillow numpy
    python tools/voxelizar.py                 # tudo o que está no manifesto
    python tools/voxelizar.py --so guerreiro  # só as folhas cujo caminho contém o texto

A lista do que converter é `tools/voxel/manifesto.json` — só o que o jogo
desenha, nunca o pacote inteiro. A saída espelha `public/tiny` em
`public/voxel`, um `.glb` por folha, uma malha por quadro (`q0`, `q1`, ...).

## As regras da conversão

- **1 pixel = 1 voxel**, com a cor exata do pixel. A unidade do modelo é o
  pixel do sprite, que é também a unidade de mundo do jogo (tile = 64).
- **Sem a sombra do chão.** O pacote pinta a sombra com alfa parcial; todo
  pixel que não é opaco fica de fora.
- **Cenário vira volume; personagem continua sprite.** A câmera do jogo é em
  perspectiva, baixa, atrás de quem joga. Prédio, árvore, pedra e chão são
  sólidos fechados; personagens, bichos e ícones são sprites planos em pé
  (`"forma": "sprite"`), e para eles o conversor só anota onde ficam os pés.
- **Volume arredondado, não extrusão.** A espessura de cada pixel sai do
  perfil circular do trecho opaco em que ele está — na linha **e** na coluna,
  valendo o menor dos dois — e é centrada na profundidade.
- **Prédio é caixa** (`"forma": "caixa"`): fachada em pé, telhado deitado.
- **Árvore, arbusto e pedra são redondos** (`"forma": "redondo"`): um sólido
  de revolução com a textura do sprite repetida em volta — ver
  `grade_redonda`.
- **Contorno escuro só na casca.** O pixel de contorno pinta a camada da
  frente e a do fundo; o miolo dele pega a cor do vizinho de dentro. Sem isso
  o topo da cabeça — que é uma linha inteira de contorno — viraria um disco
  preto visto de cima.
- **Pivô nos pés.** A origem do modelo é (centro do quadro, base dos pés,
  meio da espessura; nos prédios, a face da frente). O índice guarda a linha dos pés (`pes`), e o renderer
  encaixa o modelo no retângulo que o sprite ocuparia.
- **Uma malha, várias paletas.** A cor do vértice é um índice (a UV aponta
  para um texel da paleta). O azul vai embutido como textura; as outras cores
  vão em `extras.paletas` e o jogo troca a textura do material.
- **Greedy meshing.** Faces vizinhas da mesma cor e do mesmo plano viram um
  retângulo só.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import struct
import subprocess
import sys
from collections import deque
from multiprocessing import Pool
from pathlib import Path

import numpy as np
from PIL import Image

RAIZ = Path(__file__).resolve().parent.parent

# Abaixo disto a luminância é "tinta de contorno".
LUMA_DO_CONTORNO = 70


def abrir(caminho: Path) -> np.ndarray:
    return np.array(Image.open(caminho).convert("RGBA"))


def trechos(mascara: np.ndarray) -> np.ndarray:
    """Para cada célula opaca de cada linha, a espessura do perfil circular
    do trecho contíguo em que ela está (0 fora de trecho)."""
    alt, larg = mascara.shape
    saida = np.zeros((alt, larg), dtype=np.float32)
    for y in range(alt):
        linha = mascara[y]
        x = 0
        while x < larg:
            if not linha[x]:
                x += 1
                continue
            ini = x
            while x < larg and linha[x]:
                x += 1
            raio = (x - ini) / 2
            centro = ini + raio
            for i in range(ini, x):
                d = i + 0.5 - centro
                saida[y, i] = 2 * np.sqrt(max(0.0, raio * raio - d * d))
    return saida


def espessuras(opaco: np.ndarray, fundo: int, rgba: np.ndarray, finos: dict, degrau: int = 1) -> np.ndarray:
    """Espessura em voxels (de 1 a `fundo`) de cada pixel opaco.

    `finos` são os ajustes à mão: cor → espessura máxima. Uma lâmina, uma
    haste ou um escudo têm a largura do corpo no desenho, mas não a grossura
    dele — sem o ajuste, a espada ganha a mesma "tampa" que a cabeça."""
    por_linha = trechos(opaco)
    por_coluna = trechos(opaco.T).T
    t = np.minimum(por_linha, por_coluna)
    # `degrau` arredonda a espessura para múltiplos dele: a copa de uma árvore
    # tem um pixel de cada cor, e sem isto cada um vira um degrau próprio — são
    # dezenas de milhares de faces que ninguém distingue.
    t = np.clip(np.round(t / degrau) * degrau, min(degrau, fundo), fundo).astype(np.int32)
    for cor, teto in finos.items():
        alvo = tuple(int(cor[k : k + 2], 16) for k in (1, 3, 5))
        t = np.where((rgba[..., :3] == alvo).all(axis=-1), np.minimum(t, int(teto)), t)
    return np.where(opaco, t, 0)


def contorno(rgba: np.ndarray, opaco: np.ndarray) -> np.ndarray:
    """Pixels escuros encostados no vazio: a linha de fora do desenho."""
    luma = rgba[..., 0] * 0.299 + rgba[..., 1] * 0.587 + rgba[..., 2] * 0.114
    cheio = np.pad(opaco, 1)
    alt, larg = opaco.shape
    borda = np.zeros_like(opaco)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dx or dy:
                borda |= ~cheio[1 + dy : 1 + dy + alt, 1 + dx : 1 + dx + larg]
    return opaco & borda & (luma < LUMA_DO_CONTORNO)


def miolo(indices: np.ndarray, opaco: np.ndarray, eh_contorno: np.ndarray) -> np.ndarray:
    """A cor de dentro de cada pixel: a própria, ou — no contorno — a do pixel
    de dentro mais próximo (busca em largura a partir de todos de uma vez)."""
    saida = indices.copy()
    alt, larg = opaco.shape
    visto = opaco & ~eh_contorno
    fila = deque(zip(*np.nonzero(visto)))
    while fila:
        y, x = fila.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < alt and 0 <= nx < larg and eh_contorno[ny, nx] and not visto[ny, nx]:
                visto[ny, nx] = True
                saida[ny, nx] = saida[y, x]
                fila.append((ny, nx))
    return saida


def voxels(
    indices: np.ndarray, opaco: np.ndarray, rgba: np.ndarray, fundo: int, finos: dict, degrau: int = 1
) -> np.ndarray:
    """Grade [linha, coluna, z] com o índice de paleta + 1 (0 = vazio).

    O volume é centrado na profundidade: metade da espessura para a frente,
    metade para trás. A câmera do jogo é em perspectiva e anda em volta das
    coisas, então o modelo precisa ser um sólido de verdade, com costas e
    lados — uma árvore é um tufo redondo, e não um recorte com tampa."""
    alt, larg = opaco.shape
    t = espessuras(opaco, fundo, rgba, finos, degrau)
    # Para o miolo, "contorno" é toda tinta escura, e não só a que encosta no
    # vazio: de lado o que se vê é o miolo, e o traço do pacote — dois pixels
    # de largura — pintava as árvores de faixas pretas.
    luma = rgba[..., 0] * 0.299 + rgba[..., 1] * 0.587 + rgba[..., 2] * 0.114
    dentro = miolo(indices, opaco, opaco & (luma < LUMA_DO_CONTORNO))
    grade = np.zeros((alt, larg, fundo), dtype=np.int32)
    for y, x in zip(*np.nonzero(opaco)):
        z0 = (fundo - t[y, x]) // 2
        z1 = z0 + t[y, x]
        grade[y, x, z0:z1] = dentro[y, x] + 1
        # A casca — frente e fundo — leva a cor do pixel, contorno incluído.
        grade[y, x, z0] = indices[y, x] + 1
        grade[y, x, z1 - 1] = indices[y, x] + 1
    return grade


def grade_redonda(indices: np.ndarray, opaco: np.ndarray, rgba: np.ndarray):
    """Um objeto redondo — árvore, arbusto, pedra — como sólido de revolução.
    Devolve a grade e a profundidade dela.

    ## A forma

    De um objeto visto de um lado só não se sabe o fundo. A saída clássica é
    a interseção de silhuetas: supor que ele tem a mesma silhueta visto de
    qualquer ângulo, e ficar com o que cabe em todas. Para uma vista só,
    girada em volta do eixo vertical, isso é um sólido de revolução — cada
    linha do sprite vira um disco com a largura que ela tem. O disco gira em
    volta do meio **daquela linha**, e não de um eixo único: assim a vista de
    frente continua sendo a silhueta do sprite, mesmo torta.

    ## A cor

    Estender o pixel para o fundo deixa faixas de lado; girar a cor com a
    forma pinta tudo com a cor da borda. A que funciona é projetar o sprite
    de quatro lados — frente, direita, trás, esquerda —, cada um valendo no
    quarto de volta dele, **espelhando um sim, um não**. O espelho é o que
    casa as emendas: na diagonal, os dois lados pedem a mesma coluna do
    sprite. De frente, o miolo é o sprite pixel a pixel; em volta, a textura
    continua sem costura.

    O contorno escuro sai: é tinta da silhueta de uma vista, e num sólido ela
    viraria riscos no meio da copa.
    """
    alt, larg = opaco.shape
    luma = rgba[..., 0] * 0.299 + rgba[..., 1] * 0.587 + rgba[..., 2] * 0.114
    cor = miolo(indices, opaco, opaco & (luma < LUMA_DO_CONTORNO)) + 1
    vaos = [np.flatnonzero(opaco[y]) for y in range(alt)]
    raio_maximo = max((int(v[-1] - v[0]) + 1 for v in vaos if len(v)), default=1)
    fundo = raio_maximo + 2
    meio_z = fundo / 2
    grade = np.zeros((alt, larg, fundo), dtype=np.int32)
    zs = np.arange(fundo) + 0.5 - meio_z
    for y, vao in enumerate(vaos):
        if len(vao) == 0:
            continue
        esquerda, direita = int(vao[0]), int(vao[-1])
        centro = (esquerda + direita + 1) / 2
        raio = (direita - esquerda + 1) / 2
        # A linha sem buracos: o vão transparente no meio pega o vizinho.
        linha = cor[y, esquerda : direita + 1].copy()
        cheios = np.flatnonzero(opaco[y, esquerda : direita + 1])
        vazios = np.flatnonzero(~opaco[y, esquerda : direita + 1])
        if len(vazios):
            perto = cheios[np.abs(cheios[None, :] - vazios[:, None]).argmin(axis=1)]
            linha[vazios] = linha[perto]
        xs = np.arange(esquerda, direita + 1) + 0.5 - centro
        dx, dz = np.meshgrid(xs, zs, indexing="ij")
        dentro = dx * dx + dz * dz <= raio * raio
        # Frente e trás leem o sprite pela largura; os lados, pela profundidade.
        s = np.where(np.abs(dz) >= np.abs(dx), np.where(dz >= 0, dx, -dx), np.sign(dx) * dz)
        coluna = np.clip(np.floor(s + raio).astype(int), 0, len(linha) - 1)
        grade[y, esquerda : direita + 1, :] = np.where(dentro, linha[coluna], 0)
    return grade, fundo


def reduzido(a: np.ndarray, passo: int, pes: int):
    """Uma amostra a cada `passo` pixels, alinhada para a linha dos pés ficar
    inteira. Devolve a amostra e a linha dos pés nela."""
    primeira = (pes - 1) % passo
    return a[primeira::passo, passo // 2 :: passo], (pes - 1 - primeira) // passo + 1


def grade_da_caixa(indices: np.ndarray, opaco: np.ndarray, rgba: np.ndarray, pes: int, telhado: float):
    """Um prédio como caixa sólida. Devolve a grade e a profundidade dela.

    O sprite do prédio é desenhado em 3/4: a parte de cima é o telhado visto
    de cima, a de baixo é a fachada. As linhas abaixo do corte viram a parede
    da frente; as de cima viram o tampo da caixa, uma linha de pixel por voxel
    de profundidade — e é o desenho do telhado que diz onde a caixa existe. O
    miolo e as outras paredes repetem a cor da fachada naquela altura — sem o
    contorno escuro, que é tinta da silhueta e pintaria as laterais de preto.

    `telhado` é a fração da altura do desenho, a partir do topo, que é telhado.
    """
    alt, larg = opaco.shape
    linhas = np.nonzero(opaco.any(axis=1))[0]
    if len(linhas) == 0:
        return np.zeros((alt, larg, 1), dtype=np.int32), 1
    topo = int(linhas.min())
    corte = topo + max(1, int(round((pes - topo) * telhado)))
    fundo = corte - topo
    cor = np.where(opaco, indices + 1, 0)
    # tampo[coluna, z]: z = fundo − 1 é a beira da frente (a linha logo acima
    # do corte) e z = 0 é o fundo (a linha do topo do desenho).
    tampo = cor[topo:corte].T
    grade = np.zeros((alt, larg, fundo), dtype=np.int32)
    grade[corte] = tampo
    parede = cor[corte + 1 :]
    # Aqui "contorno" é toda tinta escura, e não só a que encosta no vazio: o
    # traço do pacote tem dois pixels de largura, e o de dentro contaminaria.
    luma = rgba[..., 0] * 0.299 + rgba[..., 1] * 0.587 + rgba[..., 2] * 0.114
    dentro = np.where(opaco, miolo(indices, opaco, opaco & (luma < LUMA_DO_CONTORNO)) + 1, 0)[corte + 1 :]
    grade[corte + 1 :] = np.where(tampo[None] > 0, dentro[:, :, None], 0)
    grade[corte + 1 :, :, fundo - 1] = parede
    # As outras três paredes levam o desenho da fachada: a de trás, o mesmo;
    # as de lado, as colunas da fachada a partir daquela quina. Sem isto, de
    # lado o prédio é um borrão de faixas — a câmera gira em volta dele.
    for v in range(corte + 1, alt):
        for z in range(fundo):
            colunas = np.nonzero(grade[v, :, z])[0]
            if len(colunas) == 0:
                continue
            k = fundo - 1 - z
            esquerda, direita = int(colunas[0]), int(colunas[-1])
            if esquerda + k < larg and cor[v, esquerda + k] > 0:
                grade[v, esquerda, z] = cor[v, esquerda + k]
            if direita - k >= 0 and cor[v, direita - k] > 0:
                grade[v, direita, z] = cor[v, direita - k]
    for v in range(corte + 1, alt):
        for c in np.nonzero(parede[v - corte - 1])[0]:
            fundos = np.nonzero(grade[v, c])[0]
            if len(fundos):
                grade[v, c, fundos[0]] = cor[v, c]
    return grade, fundo


def previa(grade: np.ndarray, cores: np.ndarray, escala: int = 3) -> Image.Image:
    """Projeta a grade na câmera oblíqua do jogo (tela = linha − profundidade)
    para conferir um modelo sem abrir o jogo."""
    alt, larg, fundo = grade.shape
    tela = np.zeros((alt + fundo, larg, 4), dtype=np.uint8)
    perto = np.full((alt + fundo, larg), 1e9)
    for y, x, z in zip(*np.nonzero(grade)):
        k = fundo - 1 - z
        cor = cores[grade[y, x, z] - 1]
        if k == 0 and perto[y + fundo, x] > 0:
            perto[y + fundo, x] = 0
            tela[y + fundo, x] = (*cor, 255)
        if y == 0 or grade[y - 1, x, z] == 0:
            linha = y + fundo - 1 - k
            if perto[linha, x] > k + 0.5:
                perto[linha, x] = k + 0.5
                tela[linha, x] = (*(int(c + (255 - c) * 0.14) for c in cor), 255)
    img = Image.fromarray(tela, "RGBA")
    return img.resize((larg * escala, (alt + fundo) * escala), Image.NEAREST)


def retangulos(mascara: np.ndarray):
    """Greedy meshing de uma fatia: devolve (u, v, largura, altura, cor).

    Só visita as células preenchidas: numa fatia de um sólido, as faces
    expostas são um anel fino, e varrer o vazio célula a célula era quase todo
    o tempo da conversão."""
    m = mascara.copy()
    nu, nv = m.shape
    for u in np.flatnonzero(m.any(axis=1)):
        for v in np.flatnonzero(m[u]):
            cor = m[u, v]
            if cor == 0:
                continue
            h = 1
            while v + h < nv and m[u, v + h] == cor:
                h += 1
            w = 1
            while u + w < nu and (m[u + w, v : v + h] == cor).all():
                w += 1
            m[u : u + w, v : v + h] = 0
            yield int(u), int(v), w, h, int(cor)


# As faces que a câmera do jogo consegue ver. Ela é oblíqua e só olha do sul
# e de cima: face de lado (±x) fica de perfil, com área zero na tela, e as de
# baixo (-y) e de trás (-z) ficam de costas. São metade dos
# triângulos, e nunca viram pixel. `"faces": "todas"` no manifesto as devolve.
FACES_VISIVEIS = {(1, 1), (2, 1)}
# O que a câmera em perspectiva alcança: ela gira em volta das coisas, sempre
# de cima, então vê tudo menos a base.
FACES_DO_VOLUME = {(0, 1), (0, -1), (1, 1), (2, 1), (2, -1)}


def malha(grade: np.ndarray, origem: tuple[float, float, float], cores: int, faces: set | None):
    """Faces expostas → posições, normais, UV de paleta e índices.

    `grade` é [linha, coluna, z]; no modelo, x = coluna, y = -linha (para
    cima), z = z. `origem` é o ponto da grade que vira (0, 0, 0)."""
    # Reordena para [x, y, z] com y para cima.
    g = grade.transpose(1, 0, 2)[:, ::-1, :]
    ox, oy, oz = origem
    oy = grade.shape[0] - oy
    pos, nor, uv, idx = [], [], [], []
    for eixo in range(3):
        u_eixo, v_eixo = [(1, 2), (2, 0), (0, 1)][eixo]
        for sentido in (1, -1):
            if faces is not None and (eixo, sentido) not in faces:
                continue
            vizinho = np.zeros_like(g)
            fatia_de = [slice(None)] * 3
            fatia_para = [slice(None)] * 3
            if sentido == 1:
                fatia_de[eixo] = slice(1, None)
                fatia_para[eixo] = slice(0, -1)
            else:
                fatia_de[eixo] = slice(0, -1)
                fatia_para[eixo] = slice(1, None)
            vizinho[tuple(fatia_para)] = g[tuple(fatia_de)]
            exposta = np.where((g != 0) & (vizinho == 0), g, 0)
            normal = [0.0, 0.0, 0.0]
            normal[eixo] = float(sentido)
            for k in range(g.shape[eixo]):
                fatia = np.take(exposta, k, axis=eixo)
                if not fatia.any():
                    continue
                # `np.take` devolve os dois eixos restantes em ordem crescente;
                # (u, v) precisa ser cíclico para a face sair anti-horária.
                if eixo == 1:
                    fatia = fatia.T
                plano = k + (1 if sentido == 1 else 0)
                for u, v, w, h, cor in retangulos(fatia):
                    cantos = [(u, v), (u + w, v), (u + w, v + h), (u, v + h)]
                    if sentido == -1:
                        cantos.reverse()
                    base = len(pos)
                    for cu, cv in cantos:
                        p = [0.0, 0.0, 0.0]
                        p[eixo] = plano
                        p[u_eixo] = cu
                        p[v_eixo] = cv
                        pos.append((p[0] - ox, p[1] - oy, p[2] - oz))
                        nor.append(tuple(127 * c for c in normal))
                        uv.append((round((cor - 1 + 0.5) / cores * 65535), 32768))
                    idx += [base, base + 1, base + 2, base, base + 2, base + 3]
    # Quantizado (KHR_mesh_quantization): a posição é meio-inteira no máximo,
    # então vai em int16 no dobro da escala e o nó desfaz com scale 0.5.
    return (
        np.round(np.array(pos, dtype=np.float64).reshape(-1, 3) * 2).astype(np.int16),
        np.array(nor, dtype=np.int8).reshape(-1, 3),
        np.array(uv, dtype=np.uint16).reshape(-1, 2),
        np.array(idx, dtype=np.uint32),
    )


def base_dos_pes(caminho: Path, lado: int) -> int:
    """A linha logo abaixo do último pixel opaco, olhando todos os quadros."""
    rgba = abrir(caminho)
    linhas = np.nonzero((rgba[..., 3] == 255).any(axis=1))[0]
    return int(linhas.max()) + 1 if len(linhas) else lado


class Glb:
    """Um escritor de glTF binário mínimo: um buffer, vistas alinhadas a 4."""

    def __init__(self) -> None:
        self.bin = bytearray()
        self.json: dict = {
            "asset": {"version": "2.0", "generator": "meu-querido-rei/voxelizar.py"},
            "buffers": [{}],
            "bufferViews": [],
            "accessors": [],
            "meshes": [],
            "nodes": [],
            "scenes": [{"nodes": []}],
            "scene": 0,
        }

    def vista(self, dados: bytes, alvo: int | None = None) -> int:
        while len(self.bin) % 4:
            self.bin.append(0)
        v = {"buffer": 0, "byteOffset": len(self.bin), "byteLength": len(dados)}
        if alvo is not None:
            v["target"] = alvo
        self.bin += dados
        self.json["bufferViews"].append(v)
        return len(self.json["bufferViews"]) - 1

    def acessor(
        self, a: np.ndarray, tipo: str, alvo: int, limites: bool = False, normalizado: bool = False
    ) -> int:
        componente = {"float32": 5126, "uint32": 5125, "uint16": 5123, "int16": 5122, "int8": 5120}[a.dtype.name]
        dados = a
        if alvo == 34962 and a.strides[0] % 4:
            # Atributo de vértice tem de andar de 4 em 4 bytes.
            sobra = 4 - a.strides[0] % 4
            dados = np.concatenate([a.view(np.uint8).reshape(len(a), -1), np.zeros((len(a), sobra), np.uint8)], axis=1)
        indice = self.vista(dados.tobytes(), alvo)
        if dados is not a:
            self.json["bufferViews"][indice]["byteStride"] = dados.shape[1]
        acc = {
            "bufferView": indice,
            "componentType": componente,
            "count": int(a.shape[0]),
            "type": tipo,
        }
        if normalizado:
            acc["normalized"] = True
        if limites:
            acc["min"] = a.min(axis=0).tolist()
            acc["max"] = a.max(axis=0).tolist()
        self.json["accessors"].append(acc)
        return len(self.json["accessors"]) - 1

    def salvar(self, caminho: Path) -> None:
        while len(self.bin) % 4:
            self.bin.append(0)
        self.json["buffers"][0]["byteLength"] = len(self.bin)
        texto = json.dumps(self.json, separators=(",", ":"), ensure_ascii=False).encode()
        texto += b" " * (-len(texto) % 4)
        total = 12 + 8 + len(texto) + 8 + len(self.bin)
        caminho.parent.mkdir(parents=True, exist_ok=True)
        with open(caminho, "wb") as f:
            f.write(struct.pack("<4sII", b"glTF", 2, total))
            f.write(struct.pack("<I4s", len(texto), b"JSON"))
            f.write(texto)
            f.write(struct.pack("<I4s", len(self.bin), b"BIN\0"))
            f.write(self.bin)


def paleta_de(camadas: list[np.ndarray], opaco: np.ndarray):
    """Índice de paleta por pixel. A chave é a tupla (cor na base, cor em cada
    variante): se dois pixels do mesmo azul viram vermelhos diferentes, são
    duas entradas."""
    chaves = np.concatenate([c[..., :3] for c in camadas], axis=-1)[opaco]
    unicas, inverso = np.unique(chaves, axis=0, return_inverse=True)
    indices = np.zeros(opaco.shape, dtype=np.int32)
    indices[opaco] = inverso.reshape(-1)
    return unicas, indices


def grade_do_chao(indices: np.ndarray, opaco: np.ndarray, altura: int, cores: int) -> np.ndarray:
    """Um tile deitado: cada pixel opaco vira uma coluna de `altura` voxels
    com o topo na cor do pixel e o corpo na cor escurecida (índice + cores)."""
    lado_z, lado_x = opaco.shape
    grade = np.zeros((altura, lado_x, lado_z), dtype=np.int32)
    topo = np.where(opaco, indices + 1, 0).T
    grade[0] = topo
    # O corpo é de uma cor só — a mais comum do tile, escurecida. Escurecer
    # pixel a pixel levava o contorno da borda para a parede, em listras.
    if opaco.any():
        comum = int(np.bincount(indices[opaco]).argmax())
        grade[1:] = np.where(topo > 0, comum + 1 + cores, 0)
    return grade


PASTA_DA_PREVIA: str | None = None


def converter(folha: dict, manifesto: dict) -> dict:
    origem = RAIZ / manifesto["origem"]
    destino = RAIZ / manifesto["destino"]
    fundo = int(folha.get("profundidade", 6))
    finos = folha.get("finos", {})
    plano = folha.get("plano", "pe")
    caixa = folha.get("forma") == "caixa"
    redondo = folha.get("forma") == "redondo"

    base = abrir(origem / folha["arquivo"])
    opaco = base[..., 3] == 255

    # Uma variante só troca a paleta se tiver exatamente a mesma silhueta. A
    # que não tiver é devolvida para ser convertida como modelo próprio.
    variantes, sobras = {}, []
    for nome, caminho in folha.get("variantes", {}).items():
        camada = abrir(origem / caminho)
        if camada.shape == base.shape and ((camada[..., 3] == 255) == opaco).all():
            variantes[nome] = (caminho, camada)
        else:
            sobras.append(caminho)
    unicas, indices = paleta_de([base] + [c for _, c in variantes.values()], opaco)
    n = len(unicas)
    nome_da_base = Path(folha["arquivo"]).parent.name
    paletas = {}
    for i, nome in enumerate([nome_da_base] + list(variantes)):
        cores = [tuple(int(v) for v in linha[i * 3 : i * 3 + 3]) for linha in unicas]
        if plano == "chao":
            # O corpo do bloco: a mesma cor, mais escura, na segunda metade.
            cores += [tuple(int(v * 0.62) for v in cor) for cor in cores]
        paletas[nome] = ["#%02x%02x%02x" % cor for cor in cores]
    total_de_cores = len(paletas[nome_da_base])

    alt_img, larg_img = opaco.shape
    if plano == "chao":
        g = folha["grade"]
        celula, colunas = int(g["celula"]), int(g["colunas"])
        recortes = [
            (slice(l * celula, (l + 1) * celula), slice(c * celula, (c + 1) * celula))
            for l in range(int(g["linhas"]))
            for c in range(colunas)
        ]
        largura_quadro = lado = celula
        pes = 0
    else:
        lado = alt_img
        largura_quadro = int(folha.get("larguraQuadro") or (lado if larg_img % lado == 0 else larg_img))
        colunas = max(1, larg_img // largura_quadro)
        recortes = [(slice(None), slice(q * largura_quadro, (q + 1) * largura_quadro)) for q in range(colunas)]
        pes = base_dos_pes(origem / folha["pesDe"], lado) if folha.get("pesDe") else base_dos_pes(origem / folha["arquivo"], lado)

    if folha.get("forma") == "sprite":
        # Personagem, bicho, ícone: no jogo é um sprite plano em pé. Não há
        # modelo; o índice só precisa dizer onde ficam os pés no quadro.
        dados = {"larguraQuadro": largura_quadro, "lado": lado, "pes": pes}
        sprites = {str(Path(folha["arquivo"]).with_suffix("")): dados}
        for caminho in folha.get("variantes", {}).values():
            sprites[str(Path(caminho).with_suffix(""))] = dados
        return {"sprites": sprites, "sobras": [], "arquivo": folha["arquivo"]}

    glb = Glb()
    glb.json["extensionsUsed"] = ["KHR_mesh_quantization"]
    glb.json["extensionsRequired"] = ["KHR_mesh_quantization"]
    faces = {"todas": None, "visiveis": FACES_VISIVEIS}.get(folha.get("faces", "volume"), FACES_DO_VOLUME)
    png = io.BytesIO()
    cores_da_base = np.array(
        [[int(c[k : k + 2], 16) for k in (1, 3, 5)] for c in paletas[nome_da_base]], dtype=np.uint8
    )
    Image.fromarray(cores_da_base.reshape(1, total_de_cores, 3), "RGB").save(png, "PNG")
    glb.json["images"] = [{"bufferView": glb.vista(png.getvalue()), "mimeType": "image/png"}]
    glb.json["samplers"] = [{"magFilter": 9728, "minFilter": 9728, "wrapS": 33071, "wrapT": 33071}]
    glb.json["textures"] = [{"source": 0, "sampler": 0}]
    glb.json["materials"] = [
        {
            "name": "paleta",
            "pbrMetallicRoughness": {
                "baseColorTexture": {"index": 0},
                "metallicFactor": 0,
                "roughnessFactor": 1,
            },
        }
    ]

    triangulos = 0
    for q, (linhas, cols) in enumerate(recortes):
        if plano == "chao":
            grade = grade_do_chao(indices[linhas, cols], opaco[linhas, cols], int(folha.get("altura", 16)), n)
            pos, nor, uv, idx = malha(grade, (0, 0, 0), total_de_cores, faces)
        elif caixa:
            grade, fundo_da_caixa = grade_da_caixa(
                indices[linhas, cols], opaco[linhas, cols], base[linhas, cols], pes, float(folha.get("telhado", 0.45))
            )
            pos, nor, uv, idx = malha(grade, (largura_quadro / 2, pes, fundo_da_caixa), total_de_cores, faces)
        elif redondo:
            # Com `voxel` maior que 1 o objeto é feito de blocos maiores: o
            # sprite é amostrado mais ralo e a malha, ampliada de volta.
            passo = int(folha.get("voxel", 1))
            ind_r, pes_r = reduzido(indices[linhas, cols], passo, pes)
            opa_r, _ = reduzido(opaco[linhas, cols], passo, pes)
            rgb_r, _ = reduzido(base[linhas, cols], passo, pes)
            grade, fundo_r = grade_redonda(ind_r, opa_r, rgb_r)
            pos, nor, uv, idx = malha(grade, (ind_r.shape[1] / 2, pes_r, fundo_r / 2), total_de_cores, faces)
            pos = (pos.astype(np.int32) * passo).astype(np.int16)
        else:
            grade = voxels(
                indices[linhas, cols], opaco[linhas, cols], base[linhas, cols], fundo, finos, int(folha.get("degrau", 1))
            )
            pos, nor, uv, idx = malha(grade, (largura_quadro / 2, pes, fundo / 2), total_de_cores, faces)
            if q == 0 and PASTA_DA_PREVIA:
                destino_da_previa = Path(PASTA_DA_PREVIA) / Path(folha["arquivo"]).with_suffix(".png")
                destino_da_previa.parent.mkdir(parents=True, exist_ok=True)
                previa(grade, cores_da_base).save(destino_da_previa)
        if len(idx) == 0:
            pos = np.zeros((3, 3), np.int16)
            nor = np.zeros((3, 3), np.int8)
            uv = np.zeros((3, 2), np.uint16)
            idx = np.array([0, 1, 2], np.uint32)
        if len(pos) < 65536:
            idx = idx.astype(np.uint16)
        triangulos += len(idx) // 3
        glb.json["meshes"].append(
            {
                "primitives": [
                    {
                        "attributes": {
                            "POSITION": glb.acessor(pos, "VEC3", 34962, limites=True),
                            "NORMAL": glb.acessor(nor, "VEC3", 34962, normalizado=True),
                            "TEXCOORD_0": glb.acessor(uv, "VEC2", 34962, normalizado=True),
                        },
                        "indices": glb.acessor(idx, "SCALAR", 34963),
                        "material": 0,
                    }
                ],
            }
        )
        glb.json["nodes"].append({"name": f"q{q}", "mesh": q, "scale": [0.5, 0.5, 0.5]})
        glb.json["scenes"][0]["nodes"].append(q)

    extras = {
        "quadros": len(recortes),
        "colunas": colunas,
        "larguraQuadro": largura_quadro,
        "lado": lado,
        "plano": plano,
        # Prédio tapa a visão: o renderer esconde o nome de quem está atrás.
        "oclui": caixa,
        # Redondo é igual de todo lado: o renderer ilumina os lados por igual.
        "redondo": redondo,
        "pes": pes,
        "paletas": paletas,
    }
    relativo = str(Path(folha["arquivo"]).with_suffix(".glb"))
    saida = destino / relativo
    glb.salvar(saida)
    bruto = saida.stat().st_size
    if manifesto.get("compactar", True):
        compactar(saida)

    # Os dados do modelo vão no índice, e não só dentro do .glb: o jogo precisa
    # deles antes de baixar o arquivo, e o compactador não promete guardá-los.
    entrada = {"glb": relativo, **extras}
    fontes = {str(Path(folha["arquivo"]).with_suffix("")): {"glb": relativo, "paleta": nome_da_base}}
    for nome, (caminho, _) in variantes.items():
        fontes[str(Path(caminho).with_suffix(""))] = {"glb": relativo, "paleta": nome}
    return {
        "fontes": fontes,
        "modelo": entrada,
        "sobras": sobras,
        "arquivo": relativo,
        "quadros": len(recortes),
        "triangulos": triangulos,
        "cores": total_de_cores,
        "bruto": bruto,
        "bytes": saida.stat().st_size,
    }


def compactar(caminho: Path) -> None:
    """Passa o .glb pelo gltfpack (EXT_meshopt_compression): a geometria de
    voxel é muito regular e cai para um quinto. Sem o gltfpack instalado
    (`npm install`), o arquivo fica como saiu — maior, mas igualmente válido."""
    binario = RAIZ / "node_modules/.bin/gltfpack"
    if not binario.exists():
        return
    temporario = caminho.with_suffix(".bruto.glb")
    caminho.rename(temporario)
    feito = subprocess.run(
        [str(binario), "-i", str(temporario), "-o", str(caminho), "-cc", "-kn", "-ke", "-km"],
        capture_output=True,
        text=True,
    )
    if feito.returncode != 0 or not caminho.exists():
        temporario.rename(caminho)
        print(f"  gltfpack falhou em {caminho.name}: {feito.stderr.strip()[:200]}", file=sys.stderr)
    else:
        temporario.unlink()


def pes_de(origem: Path, arquivo: str, regra: str | None) -> str | None:
    """`"pesDe": "parado"`: a folha irmã `<prefixo>_parado.png`, tirando
    pedaços do nome pela direita até achar (`lanceiro_golpe_cima_lado` →
    `lanceiro_parado`). Os pés não podem pular de um quadro de golpe para o
    parado, e é a folha parada que diz onde eles ficam."""
    if not regra:
        return None
    caminho = Path(arquivo)
    partes = caminho.stem.split("_")
    for corte in range(len(partes) - 1, 0, -1):
        candidato = caminho.with_name("_".join(partes[:corte] + [regra]) + ".png")
        if (origem / candidato).exists():
            return str(candidato)
    return None


def expandir(manifesto: dict) -> list[dict]:
    """Os grupos do manifesto (um glob e as opções dele) viram uma folha por
    arquivo. A primeira regra que pega um arquivo fica com ele."""
    origem = RAIZ / manifesto["origem"]
    folhas, vistos = [], set()
    for grupo in manifesto["grupos"]:
        opcoes = {k: v for k, v in grupo.items() if k not in ("glob", "exceto", "variantes", "pesDe")}
        for caminho in sorted(origem.glob(grupo["glob"])):
            arquivo = str(caminho.relative_to(origem))
            if arquivo in vistos or caminho.stem in grupo.get("exceto", []):
                continue
            vistos.add(arquivo)
            variantes = {
                nome: f"{pasta}/{caminho.name}"
                for nome, pasta in grupo.get("variantes", {}).items()
                if (origem / pasta / caminho.name).exists()
            }
            folhas.append(
                {**opcoes, "arquivo": arquivo, "variantes": variantes, "pesDe": pes_de(origem, arquivo, grupo.get("pesDe"))}
            )
    return folhas


def _previa_em(pasta):
    global PASTA_DA_PREVIA
    PASTA_DA_PREVIA = pasta


def _converter(args):
    return converter(*args)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--manifesto", default=str(RAIZ / "tools/voxel/manifesto.json"))
    ap.add_argument("--so", help="converte só as folhas cujo caminho contém este texto")
    ap.add_argument("--processos", type=int, default=os.cpu_count() or 2)
    ap.add_argument("--previa", help="pasta onde gravar um PNG do primeiro quadro de cada modelo, já projetado")
    args = ap.parse_args()
    global PASTA_DA_PREVIA
    PASTA_DA_PREVIA = args.previa
    manifesto = json.loads(Path(args.manifesto).read_text(encoding="utf-8"))
    folhas = [f for f in expandir(manifesto) if not args.so or args.so in f["arquivo"]]
    if not folhas:
        sys.exit("nenhuma folha do manifesto casa com o filtro")

    # O índice é o que o jogo lê para saber que folha já tem modelo. Ele é
    # refeito a partir do que existe, para um `--so` não apagar o resto.
    caminho_do_indice = RAIZ / manifesto["destino"] / "indice.json"
    indice = {"folhas": {}, "modelos": {}, "sprites": {}}
    if caminho_do_indice.exists() and args.so:
        indice = {**indice, **json.loads(caminho_do_indice.read_text(encoding="utf-8"))}

    total = bruto = 0
    with Pool(args.processos, initializer=_previa_em, initargs=(args.previa,)) as fila:
        while folhas:
            resultados = fila.map(_converter, [(f, manifesto) for f in folhas])
            folhas = []
            for r in resultados:
                if "sprites" in r:
                    indice["sprites"].update(r["sprites"])
                    continue
                indice["folhas"].update(r["fontes"])
                indice["modelos"][r["arquivo"]] = r["modelo"]
                total += r["bytes"]
                bruto += r["bruto"]
                print(
                    f"{r['arquivo']}: {r['quadros']} quadros, {r['triangulos']} triângulos, "
                    f"{r['cores']} cores, {r['bytes'] / 1024:.0f} kB"
                )
                # Variante de silhueta diferente vira modelo próprio.
                folhas += [{"arquivo": sobra, "variantes": {}, "pesDe": None} for sobra in r["sobras"]]
    caminho_do_indice.write_text(
        json.dumps(indice, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8"
    )
    print(f"{len(indice['modelos'])} modelos no índice · {total / 1e6:.1f} MB ({bruto / 1e6:.1f} MB sem compactar)")


if __name__ == "__main__":
    main()
