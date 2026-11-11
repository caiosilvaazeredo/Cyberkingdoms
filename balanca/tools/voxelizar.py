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
- **Volume arredondado, não extrusão.** A espessura de cada pixel sai do
  perfil circular do trecho opaco em que ele está — na linha **e** na coluna,
  valendo o menor dos dois. Só a linha faria de uma espada deitada uma laje.
- **Contorno escuro só na casca.** O pixel de contorno pinta a camada da
  frente e a do fundo; o miolo dele pega a cor do vizinho de dentro. Sem isso
  o topo da cabeça — que é uma linha inteira de contorno — viraria um disco
  preto visto de cima.
- **Pivô nos pés.** A origem do modelo é (centro do quadro, base dos pés,
  meio da espessura). `extras.pivo` guarda onde o jogo 2D ancora o mesmo
  quadro, para o renderer pôr o modelo exatamente no mesmo pixel.
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


def espessuras(opaco: np.ndarray, meia: int) -> np.ndarray:
    """Espessura em voxels (par, de 2 a 2*meia) de cada pixel opaco."""
    por_linha = trechos(opaco)
    por_coluna = trechos(opaco.T).T
    t = np.minimum(por_linha, por_coluna)
    t = np.clip(2 * np.round(t / 2), 2, 2 * meia).astype(np.int32)
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


def voxels(indices: np.ndarray, opaco: np.ndarray, rgba: np.ndarray, meia: int) -> np.ndarray:
    """Grade [linha, coluna, z] com o índice de paleta + 1 (0 = vazio).
    z cresce para a frente (para quem olha o sprite)."""
    alt, larg = opaco.shape
    t = espessuras(opaco, meia)
    eh_contorno = contorno(rgba, opaco)
    dentro = miolo(indices, opaco, eh_contorno)
    grade = np.zeros((alt, larg, 2 * meia), dtype=np.int32)
    for y, x in zip(*np.nonzero(opaco)):
        z0 = meia - t[y, x] // 2
        z1 = meia + t[y, x] // 2
        grade[y, x, z0:z1] = dentro[y, x] + 1
        grade[y, x, z0] = indices[y, x] + 1
        grade[y, x, z1 - 1] = indices[y, x] + 1
    return grade


def retangulos(mascara: np.ndarray):
    """Greedy meshing de uma fatia: devolve (u, v, largura, altura, cor)."""
    m = mascara.copy()
    nu, nv = m.shape
    for u in range(nu):
        v = 0
        while v < nv:
            cor = m[u, v]
            if cor == 0:
                v += 1
                continue
            h = 1
            while v + h < nv and m[u, v + h] == cor:
                h += 1
            w = 1
            while u + w < nu and (m[u + w, v : v + h] == cor).all():
                w += 1
            m[u : u + w, v : v + h] = 0
            yield u, v, w, h, int(cor)
            v += h


# As faces que a câmera do jogo consegue ver. Ela é oblíqua e só olha do sul
# e de cima, e o modelo só gira 0° ou 180°: face de lado (±x) fica de perfil,
# com área zero na tela, e a de baixo (-y) fica de costas. São metade dos
# triângulos, e nunca viram pixel. `"faces": "todas"` no manifesto as devolve.
FACES_VISIVEIS = {(1, 1), (2, 1), (2, -1)}


def malha(grade: np.ndarray, origem: tuple[float, float, float], cores: int, todas: bool):
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
            if not todas and (eixo, sentido) not in FACES_VISIVEIS:
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


def converter(folha: dict, manifesto: dict) -> dict:
    origem = RAIZ / manifesto["origem"]
    destino = RAIZ / manifesto["destino"]
    meia = int(folha.get("meiaProfundidade", 7))
    plano = folha.get("plano", "pe")

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

    glb = Glb()
    glb.json["extensionsUsed"] = ["KHR_mesh_quantization"]
    glb.json["extensionsRequired"] = ["KHR_mesh_quantization"]
    todas = folha.get("faces", "visiveis") == "todas"
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
            pos, nor, uv, idx = malha(grade, (0, 0, 0), total_de_cores, todas)
        else:
            grade = voxels(indices[linhas, cols], opaco[linhas, cols], base[linhas, cols], meia)
            pos, nor, uv, idx = malha(grade, (largura_quadro / 2, pes, meia), total_de_cores, todas)
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
        "pes": pes,
        "meiaProfundidade": 0 if plano == "chao" else meia,
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


def _converter(args):
    return converter(*args)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--manifesto", default=str(RAIZ / "tools/voxel/manifesto.json"))
    ap.add_argument("--so", help="converte só as folhas cujo caminho contém este texto")
    ap.add_argument("--processos", type=int, default=os.cpu_count() or 2)
    args = ap.parse_args()
    manifesto = json.loads(Path(args.manifesto).read_text(encoding="utf-8"))
    folhas = [f for f in expandir(manifesto) if not args.so or args.so in f["arquivo"]]
    if not folhas:
        sys.exit("nenhuma folha do manifesto casa com o filtro")

    # O índice é o que o jogo lê para saber que folha já tem modelo. Ele é
    # refeito a partir do que existe, para um `--so` não apagar o resto.
    caminho_do_indice = RAIZ / manifesto["destino"] / "indice.json"
    indice = {"folhas": {}, "modelos": {}}
    if caminho_do_indice.exists():
        indice = {**indice, **json.loads(caminho_do_indice.read_text(encoding="utf-8"))}

    total = bruto = 0
    with Pool(args.processos) as fila:
        while folhas:
            resultados = fila.map(_converter, [(f, manifesto) for f in folhas])
            folhas = []
            for r in resultados:
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
