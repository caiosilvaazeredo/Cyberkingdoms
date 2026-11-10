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
import struct
import sys
from collections import deque
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


def converter(folha: dict, manifesto: dict) -> dict:
    origem = RAIZ / manifesto["origem"]
    destino = RAIZ / manifesto["destino"]
    padroes = manifesto.get("padroes", {})
    meia = int(folha.get("meiaProfundidade", padroes.get("meiaProfundidade", 7)))

    base = abrir(origem / folha["arquivo"])
    lado = base.shape[0]
    largura_quadro = int(folha.get("larguraQuadro", lado))
    quadros = max(1, base.shape[1] // largura_quadro)
    opaco = base[..., 3] == 255

    # A paleta é indexada pela tupla (cor na base, cor em cada variante): se
    # dois pixels do mesmo azul viram vermelhos diferentes, são duas entradas.
    nomes = ["base"] + list(folha.get("variantes", {}))
    camadas = [base] + [abrir(origem / c) for c in folha.get("variantes", {}).values()]
    for nome, camada in zip(nomes, camadas):
        if camada.shape != base.shape or not ((camada[..., 3] == 255) == opaco).all():
            raise SystemExit(f"{folha['arquivo']}: a variante {nome} não tem a mesma silhueta da base")
    chaves = np.concatenate([c[..., :3] for c in camadas], axis=-1)[opaco]
    unicas, inverso = np.unique(chaves, axis=0, return_inverse=True)
    indices = np.zeros(opaco.shape, dtype=np.int32)
    indices[opaco] = inverso.reshape(-1)
    paletas = {
        nome: ["#%02x%02x%02x" % tuple(int(v) for v in linha[i * 3 : i * 3 + 3]) for linha in unicas]
        for i, nome in enumerate(nomes)
    }
    nome_da_base = Path(folha["arquivo"]).parent.name if folha.get("variantes") else "base"
    paletas[nome_da_base] = paletas.pop("base")

    pes = base_dos_pes(origem / folha["pesDe"], lado) if folha.get("pesDe") else lado
    ancora = folha.get("ancora", "pe")
    # Onde o 2D ancora o quadro, em pixels a partir do canto de cima: no
    # centro com 8% de folga para as unidades, na base para cenário.
    pivo = [largura_quadro / 2, lado * 0.58 if ancora == "centro" else float(lado)]

    glb = Glb()
    glb.json["extensionsUsed"] = ["KHR_mesh_quantization"]
    glb.json["extensionsRequired"] = ["KHR_mesh_quantization"]
    todas = folha.get("faces", padroes.get("faces", "visiveis")) == "todas"
    n = len(unicas)
    png = io.BytesIO()
    Image.fromarray(unicas[:, :3].astype(np.uint8).reshape(1, n, 3), "RGB").save(png, "PNG")
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
    total_de_voxels = 0
    for q in range(quadros):
        x0 = q * largura_quadro
        recorte = slice(x0, x0 + largura_quadro)
        grade = voxels(indices[:, recorte], opaco[:, recorte], base[:, recorte], meia)
        total_de_voxels += int((grade != 0).sum())
        pos, nor, uv, idx = malha(grade, (largura_quadro / 2, pes, meia), n, todas)
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

    glb.json["scenes"][0]["extras"] = {
        "quadros": quadros,
        "fps": folha.get("fps", padroes.get("fps", 10)),
        "larguraQuadro": largura_quadro,
        "lado": lado,
        "ancora": ancora,
        "pivo": pivo,
        "pes": pes,
        "base": nome_da_base,
        "paletas": paletas,
    }
    saida = (destino / folha["arquivo"]).with_suffix(".glb")
    glb.salvar(saida)
    relativo = str(Path(folha["arquivo"]).with_suffix(".glb"))
    fontes = {str(Path(folha["arquivo"]).with_suffix("")): {"glb": relativo, "paleta": nome_da_base}}
    for nome, caminho in folha.get("variantes", {}).items():
        fontes[str(Path(caminho).with_suffix(""))] = {"glb": relativo, "paleta": nome}
    return {
        "fontes": fontes,
        "arquivo": str(saida.relative_to(RAIZ)),
        "quadros": quadros,
        "voxels": total_de_voxels,
        "triangulos": triangulos,
        "cores": n,
        "bytes": saida.stat().st_size,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--manifesto", default=str(RAIZ / "tools/voxel/manifesto.json"))
    ap.add_argument("--so", help="converte só as folhas cujo caminho contém este texto")
    args = ap.parse_args()
    manifesto = json.loads(Path(args.manifesto).read_text(encoding="utf-8"))
    folhas = [f for f in manifesto["folhas"] if not args.so or args.so in f["arquivo"]]
    if not folhas:
        sys.exit("nenhuma folha do manifesto casa com o filtro")
    # O índice é o que o jogo lê para saber que folha já tem modelo. Ele é
    # refeito a partir do que existe, para um `--so` não apagar o resto.
    caminho_do_indice = RAIZ / manifesto["destino"] / "indice.json"
    indice = {"folhas": {}}
    if caminho_do_indice.exists():
        indice = json.loads(caminho_do_indice.read_text(encoding="utf-8"))
    for folha in folhas:
        r = converter(folha, manifesto)
        indice["folhas"].update(r["fontes"])
        caminho_do_indice.write_text(
            json.dumps(indice, indent=2, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8"
        )
        print(
            f"{r['arquivo']}: {r['quadros']} quadros, {r['voxels']} voxels, "
            f"{r['triangulos']} triângulos, {r['cores']} cores, {r['bytes'] / 1024:.0f} kB"
        )


if __name__ == "__main__":
    main()
