"""
Árvores e arbustos voxel por primitivas, com a paleta tirada do sprite.

A mesma ideia das construções (ver `predios.py`): o volume não sai do
desenho em 3/4 — que só convence de um ângulo —, e sim de primitivas que se
leem iguais de qualquer lado: tronco cilíndrico e copa feita de esferas que
se sobrepõem, como as copas facetadas dos jogos de construir e defender.

## A paleta (Voxify3D)

*Voxify3D: Pixel Art Meets Volumetric Rendering* (Huang et al., CVPR 2026)
mostra que um modelo voxel se lê como pixel art quando a cor de cada voxel é
uma escolha **discreta** numa paleta curta, extraída por k-means das imagens
de referência — de 2 a 8 cores. É o que se faz aqui: o sprite de cada espécie
passa por um k-means nas cores da copa (sem o contorno) e outro nas do tronco,
e cada voxel recebe o índice de uma delas, nunca uma mistura.

A cor é escolhida pela **altura na esfera** (o topo da copa, que pega sol, leva
as claras; a barriga, as escuras), quebrada por um ruído por touceira de folhas
— um tufo inteiro de uma cor, e não um voxel solto. A luz e a sombra de
verdade ficam por conta do renderer.
"""

from __future__ import annotations

import numpy as np

from predios import BLOCO, Obra, ruido

CONTORNO = np.array([0x16, 0x1C, 0x2E])


def kmeans(cores: np.ndarray, pesos: np.ndarray, k: int, voltas: int = 20) -> np.ndarray:
    """K-means ponderado, determinístico (começa pelos quantis de luminância)."""
    luma = cores @ np.array([0.299, 0.587, 0.114])
    ordem = np.argsort(luma)
    acumulado = np.cumsum(pesos[ordem]) / pesos.sum()
    centros = np.array([cores[ordem][np.searchsorted(acumulado, (i + 0.5) / k)] for i in range(k)], float)
    for _ in range(voltas):
        d = ((cores[:, None, :] - centros[None]) ** 2).sum(-1)
        rotulo = d.argmin(1)
        for i in range(k):
            m = rotulo == i
            if m.any():
                centros[i] = (cores[m] * pesos[m, None]).sum(0) / pesos[m].sum()
    luma_c = centros @ np.array([0.299, 0.587, 0.114])
    return centros[np.argsort(luma_c)].round().astype(int)


def paleta_do_sprite(rgba: np.ndarray, k_copa: int, k_tronco: int, base_do_tronco: int | None):
    """As cores da copa e do tronco, cada grupo da mais escura à mais clara.

    O tronco é o que aparece abaixo de `base_do_tronco` (a linha em que a copa
    termina); sem tronco, só a copa."""
    op = rgba[..., 3] == 255
    sem_contorno = op & ~(rgba[..., :3] == CONTORNO).all(-1)
    linhas = np.arange(rgba.shape[0])[:, None]
    def grupo(m: np.ndarray, k: int) -> np.ndarray:
        px = rgba[m][:, :3].astype(float)
        cores, pesos = np.unique(px, axis=0, return_counts=True)
        return kmeans(cores, pesos.astype(float), min(k, len(cores)))
    if base_do_tronco is None:
        return grupo(sem_contorno, k_copa), None
    copa = grupo(sem_contorno & (linhas < base_do_tronco), k_copa)
    tronco_m = sem_contorno & (linhas >= base_do_tronco)
    tronco = grupo(tronco_m, k_tronco) if tronco_m.sum() > 8 else None
    return copa, tronco


def medidas(rgba: np.ndarray):
    op = rgba[..., 3] == 255
    ys, xs = np.nonzero(op)
    return int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())


def copa(o: Obra, esferas, n_cores: int, primeiro: int) -> None:
    """Uma copa de esferas sobrepostas, pintada por altura e por touceira."""
    dentro = np.zeros_like(o.g, dtype=bool)
    altura_rel = np.full(o.g.shape, -1.0)
    for cx, ch, cz, r in esferas:
        d = np.sqrt((o.X - cx) ** 2 + ((o.H - ch) * 1.08) ** 2 + (o.Z - cz) ** 2)
        m = d < r
        dentro |= m
        altura_rel = np.where(m, np.maximum(altura_rel, (o.H - ch) / r), altura_rel)
    touceira = ruido(np.floor(o.X / 8), np.floor(o.H / 8), np.floor(o.Z / 8))
    nivel = (altura_rel + 1) / 2 * 0.8 + touceira * 0.45 - 0.1
    indice = np.clip((nivel * n_cores).astype(int), 0, n_cores - 1)
    # Uns poucos pontos da cor mais clara, soltos no alto: o brilho das folhas.
    brilho = (ruido(np.floor(o.X / 4), np.floor(o.H / 4), np.floor(o.Z / 4), 3) > 0.93) & (altura_rel > 0.2)
    indice = np.where(brilho, n_cores - 1, indice)
    o.por(dentro, primeiro + indice)


def tronco(o: Obra, cz: float, raio: float, altura: float, n_cores: int, primeiro: int) -> None:
    d = np.hypot(o.X, o.Z - cz)
    m = (d < raio) & (o.H < altura)
    # Casca em listras verticais: a clara de frente para o sol, a escura atrás.
    ang = np.arctan2(o.X, o.Z - cz)
    faixa = (np.floor((ang + np.pi) / (2 * np.pi) * 10) % 2).astype(int)
    indice = np.clip(faixa + (n_cores - 2) // 2, 0, n_cores - 1)
    o.por(m, primeiro + indice)


def arvore(rgba: np.ndarray):
    """Tronco e copa nas medidas do sprite. Devolve a obra e a paleta."""
    x0, x1, y0, y1 = medidas(rgba)
    largura = x1 - x0 + 1
    # O tronco aparece embaixo, abaixo da copa: as linhas de baixo em que o
    # desenho fica estreito (menos de 45% da largura).
    op = rgba[..., 3] == 255
    larguras = op.sum(1)
    base = y1
    while base > y0 and larguras[base] < largura * 0.45:
        base -= 1
    tronco_visivel = y1 - base
    altura_copa = (base - y0) * 0.78
    raio = largura / 2 * 0.92
    altura_tronco = max(14, tronco_visivel * 1.1)
    cores_copa, cores_tronco = paleta_do_sprite(rgba, 5, 3, base)
    if cores_tronco is None:
        cores_tronco = np.array([[0x55, 0x40, 0x45], [0x71, 0x4A, 0x4A], [0x84, 0x66, 0x55]])
    fundo = raio * 2 + 8
    o = Obra(largura + 8, fundo, altura_tronco + altura_copa + 8)
    o.origem_no_meio = True
    cz = -o.fundo / 2
    tronco(o, cz, max(5, largura * 0.07), altura_tronco + raio * 0.6, len(cores_tronco), 1)
    # A copa: uma esfera principal e quatro menores em volta e em cima, numa
    # roda fixa — irregular o bastante para não ser uma bola, igual de todo lado.
    meio = altura_tronco + altura_copa / 2
    r_principal = min(raio, altura_copa / 2)
    esferas = [(0, meio, cz, r_principal)]
    for k in range(4):
        a = k * np.pi / 2 + 0.6
        esferas.append((np.cos(a) * raio * 0.45, meio + (0.2 if k % 2 else -0.15) * altura_copa, cz + np.sin(a) * raio * 0.45, r_principal * 0.62))
    esferas.append((0, meio + altura_copa * 0.32, cz, r_principal * 0.55))
    primeiro = 1 + len(cores_tronco)
    copa(o, esferas, len(cores_copa), primeiro)
    cores = [tuple(int(v) for v in c) for c in list(cores_tronco) + list(cores_copa)]
    return o, cores


def arbusto(rgba: np.ndarray):
    x0, x1, y0, y1 = medidas(rgba)
    largura = x1 - x0 + 1
    altura = (y1 - y0 + 1) * 0.7
    cores_copa, _ = paleta_do_sprite(rgba, 4, 0, None)
    raio = largura / 2
    o = Obra(largura + 6, raio * 1.8 + 6, altura + 6)
    o.origem_no_meio = True
    cz = -o.fundo / 2
    r = min(raio * 0.62, altura * 0.62)
    esferas = [
        (-raio * 0.38, r * 0.75, cz + raio * 0.1, r),
        (raio * 0.36, r * 0.7, cz - raio * 0.12, r * 0.92),
        (0, r * 1.05, cz + raio * 0.02, r * 0.85),
    ]
    copa(o, esferas, len(cores_copa), 1)
    return o, [tuple(int(v) for v in c) for c in cores_copa]


MODELOS = {"arvore": arvore, "arbusto": arbusto}
