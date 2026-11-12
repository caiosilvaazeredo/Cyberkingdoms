"""
Construções voxel por primitivas paramétricas.

## Por que não sai do sprite

O sprite de um prédio é um desenho em 3/4: telhado visto de cima e fachada de
frente, num plano só, com o contorno à mão. Toda tentativa de "inflar" esse
desenho (extrusão, planta lida do contorno, fachada envolvida) dá um volume que
só convence de um ângulo — e a câmera do jogo anda em volta dele.

A reconstrução de prédios a partir de dados incompletos resolve isso do mesmo
jeito há trinta anos (Haala & Kada, *An update on automatic 3D building
reconstruction*, ISPRS 2010): o prédio é uma **composição de primitivas
paramétricas** — planta decomposta em células retangulares ou circulares, cada
uma com um tipo de telhado (duas águas, plano com parapeito, pirâmide) — e a
fachada é **sintetizada por uma gramática** a partir das regularidades que se
conhecem (janelas a intervalos fixos por andar, porta no eixo), e não copiada.

O sprite continua mandando no que importa para reconhecer o prédio no jogo:
a **paleta** (as cores saem dele, e a variante vermelha sai do par azul ×
vermelho do pacote) e as **proporções** (largura e fundo são os do corpo de
colisão; a altura, a do desenho).

## A pele

Cada material é uma textura procedural em 3D, avaliada no centro de cada
voxel (Oliveira, *PixeR*, 2019, §4.5.5): pedra em fiadas desencontradas com
argamassa, telha em fiadas ao longo do caimento, tábuas no piso, enxaimel com
vigas nas quinas. A variação de tom vem de um ruído por bloco — um tijolo
inteiro mais claro, e não um pixel solto —, que é o que dá unidade ao volume
visto de qualquer lado. A luz é a difusa de Lambert, no renderer.

Unidades: pixels do sprite (= unidades de mundo). `BLOCO` é o lado do voxel.
Altura `h` para cima a partir do chão; `x` com zero no meio da largura; `z`
com zero na fachada da frente e negativo para trás.
"""

from __future__ import annotations

import numpy as np

BLOCO = 2

# O papel de cada cor, com a cor do pacote azul de onde ela sai e um fator de
# brilho (1 = a cor do sprite; menos que 1 = um tom de sombra derivado dela).
PAPEIS: dict[str, tuple[str, float]] = {
    "contorno": ("#161c2e", 1.0),
    "pedra": ("#bbae93", 1.0),
    "pedra_luz": ("#e1dca3", 1.0),
    "pedra_esc": ("#bbae93", 0.86),
    "argamassa": ("#988e84", 1.0),
    "base": ("#809e94", 1.0),
    "base_luz": ("#a4b9aa", 1.0),
    "base_junta": ("#54726f", 1.0),
    "base_pe": ("#3f4a50", 1.0),
    "time_esc": ("#4c5c8b", 1.0),
    "time": ("#4795a7", 1.0),
    "time_luz": ("#63b7ba", 1.0),
    "time_brilho": ("#8bd8c8", 1.0),
    "piso": ("#d09862", 1.0),
    "piso_luz": ("#e9bc7f", 1.0),
    "piso_junta": ("#9b7260", 1.0),
    "viga": ("#8d6857", 1.0),
    "viga_luz": ("#bd8a59", 1.0),
    "viga_esc": ("#74514b", 1.0),
    "reboco": ("#e1dca3", 1.0),
    "reboco_sombra": ("#bbae93", 1.0),
    "vidro": ("#9cbeaa", 1.0),
    "vidro_esc": ("#404156", 1.0),
    "ouro": ("#e5be76", 1.0),
    "porta": ("#9b7260", 1.0),
    "porta_esc": ("#805953", 1.0),
}
NOMES = list(PAPEIS)
IDX = {n: i + 1 for i, n in enumerate(NOMES)}


def ruido(*eixos) -> np.ndarray:
    """Ruído de valor por célula inteira, em [0, 1): o mesmo número para o
    tijolo inteiro. É a variação que o ruído de Perlin dá a uma superfície,
    sem a suavização — num voxel de 2 px ela não apareceria."""
    h = np.zeros_like(np.asarray(eixos[0]), dtype=np.int64)
    for k, e in enumerate(eixos):
        h = h ^ (np.asarray(e, dtype=np.int64) * (73856093, 19349663, 83492791, 2654435761)[k % 4])
    h = (h ^ (h >> 13)) * 1274126177
    return ((h ^ (h >> 16)) & 0xFFFF) / 65536.0


class Obra:
    """Uma grade de voxels com as coordenadas de cada centro já calculadas."""

    def __init__(self, largura: float, fundo: float, altura: float) -> None:
        self.nx = int(np.ceil(largura / BLOCO))
        self.nz = int(np.ceil(fundo / BLOCO))
        self.nh = int(np.ceil(altura / BLOCO))
        self.largura, self.fundo = self.nx * BLOCO, self.nz * BLOCO
        h, x, z = np.meshgrid(
            (np.arange(self.nh) + 0.5) * BLOCO,
            (np.arange(self.nx) + 0.5) * BLOCO - self.largura / 2,
            (np.arange(self.nz) + 0.5) * BLOCO - self.fundo,
            indexing="ij",
        )
        self.H, self.X, self.Z = h, x, z
        self.g = np.zeros((self.nh, self.nx, self.nz), dtype=np.int32)
        # A origem do modelo: no meio da fachada da frente (prédio) ou no meio
        # da planta (árvore, personagem).
        self.origem_no_meio = False

    def por(self, mascara: np.ndarray, cores: np.ndarray | int) -> None:
        self.g = np.where(mascara, cores, self.g)

    def grade(self) -> np.ndarray:
        """No formato do mesher: [linha de cima para baixo, coluna, z]."""
        return self.g[::-1].copy()


# --- texturas ----------------------------------------------------------------


def pedra(H, u, grande=False) -> np.ndarray:
    """Fiadas de pedra desencontradas, argamassa fina, um bloco ou outro mais
    claro ou mais escuro."""
    alt, comp = (12, 24) if grande else (8, 16)
    fiada = np.floor(H / alt)
    uu = u + (fiada % 2) * comp / 2
    junta_h = (H % alt) < BLOCO
    junta_v = (uu % comp) < BLOCO
    n = ruido(fiada, np.floor(uu / comp))
    cor = np.where(n < 0.18, IDX["pedra_luz"], np.where(n > 0.86, IDX["pedra_esc"], IDX["pedra"]))
    return np.where(junta_h | junta_v, IDX["argamassa"], cor)


def embasamento(H, u) -> np.ndarray:
    """O soco do prédio: blocos maiores, esverdeados, com o pé escuro."""
    fiada = np.floor(H / 12)
    uu = u + (fiada % 2) * 12
    junta = ((H % 12) < BLOCO) | ((uu % 24) < BLOCO)
    n = ruido(fiada, np.floor(uu / 24), 7)
    cor = np.where(n < 0.3, IDX["base_luz"], IDX["base"])
    cor = np.where(junta, IDX["base_junta"], cor)
    return np.where(H < BLOCO * 2, IDX["base_pe"], cor)


def telha(d, s) -> np.ndarray:
    """Telha em fiadas paralelas ao beiral: sombra embaixo de cada fiada, luz
    em cima, emendas desencontradas."""
    fiada = np.floor(d / 8)
    resto = d % 8
    emenda = ((s + (fiada % 2) * 6) % 12) < BLOCO
    n = ruido(fiada, np.floor((s + (fiada % 2) * 6) / 12), 3)
    cor = np.where(n < 0.2, IDX["time_luz"], IDX["time"])
    cor = np.where(resto >= 6, IDX["time_luz"], cor)
    return np.where((resto < BLOCO) | emenda, IDX["time_esc"], cor)


def tabuado(a, b) -> np.ndarray:
    """Piso de tábuas ao longo de `b`, emendas desencontradas."""
    tabua = np.floor(a / 8)
    junta = ((a % 8) < BLOCO) | (((b + (tabua % 3) * 10) % 30) < BLOCO)
    n = ruido(tabua, np.floor((b + (tabua % 3) * 10) / 30), 5)
    cor = np.where(n < 0.3, IDX["piso_luz"], IDX["piso"])
    return np.where(junta, IDX["piso_junta"], cor)


def reboco(H, u) -> np.ndarray:
    n = ruido(np.floor(H / 6), np.floor(u / 6), 11)
    return np.where(n < 0.25, IDX["reboco_sombra"], IDX["reboco"])


# --- primitivas ----------------------------------------------------------------


def lado_da_caixa(o: Obra, x0, x1, z0, z1):
    """Para cada voxel: a distância à parede mais perto, a coordenada ao longo
    dela, e qual parede é (0 frente, 1 trás, 2 esquerda, 3 direita)."""
    dist = np.stack([z1 - o.Z, o.Z - z0, o.X - x0, x1 - o.X])
    qual = dist.argmin(axis=0)
    prof = dist.min(axis=0)
    ao_longo = np.where(qual < 2, o.X, o.Z)
    return prof, ao_longo, qual


def caixa(o: Obra, x0, x1, z0, z1, h0, h1) -> np.ndarray:
    return (o.X >= x0) & (o.X < x1) & (o.Z >= z0) & (o.Z < z1) & (o.H >= h0) & (o.H < h1)


def parede_de_pedra(o: Obra, mascara, u, soco: float, faixa: tuple[float, float] | None) -> None:
    cor = pedra(o.H, u)
    cor = np.where(o.H < soco, embasamento(o.H, u), cor)
    if faixa:
        f0, f1 = faixa
        cor = np.where((o.H >= f0) & (o.H < f1), np.where(o.H >= f1 - BLOCO, IDX["time_luz"], IDX["time_esc"]), cor)
    o.por(mascara, cor)


def ameias(o: Obra, anel, u, h0, alt, periodo=16) -> None:
    """Merlões no anel do parapeito, na cor do reino, com capa clara."""
    m = anel & (o.H >= h0) & (o.H < h0 + alt) & ((u % periodo) < periodo / 2)
    cor = np.where(o.H >= h0 + alt - BLOCO, IDX["time_brilho"], np.where((o.H - h0) % 6 < BLOCO, IDX["time_esc"], IDX["time"]))
    o.por(m, cor)
    # O topo do parapeito, entre um merlão e outro.
    topo = anel & (o.H >= h0 - BLOCO) & (o.H < h0)
    o.por(topo, IDX["time_luz"])


def vao(o: Obra, prof, ao_longo, qual, lado, centro, largura, h0, altura, arco=True,
        fundo=4, moldura="time", miolo="vidro_esc", vidro=None) -> None:
    """Uma janela ou porta escavada na parede `lado`: o vão recua `fundo` px,
    o fundo dele é escuro (ou vidro), e uma moldura de um voxel o contorna.
    Com `arco`, o topo é um semicírculo — o vão do pacote."""
    a = ao_longo - centro
    meio = largura / 2
    topo_reto = h0 + altura - (meio if arco else 0)
    dentro = (np.abs(a) < meio) & (o.H >= h0) & (o.H < h0 + altura)
    if arco:
        dentro &= (o.H < topo_reto) | (a**2 + (o.H - topo_reto) ** 2 < meio**2)
    # Só a parede de verdade: fora da caixa a distância é negativa, e sem esta
    # guarda a janela da torre do sino furava o telhado em volta dela.
    na_parede = (qual == lado) & (prof >= 0)
    perto = prof < fundo + BLOCO * 2
    furo = dentro & na_parede & (prof < fundo)
    fundo_do_vao = dentro & na_parede & (prof >= fundo) & perto
    m = meio + BLOCO
    borda = (np.abs(a) < m) & (o.H >= h0 - BLOCO) & (o.H < h0 + altura + BLOCO)
    if arco:
        borda &= (o.H < topo_reto) | (a**2 + (o.H - topo_reto) ** 2 < m**2)
    borda &= ~dentro & na_parede & (prof < BLOCO * 2) & (o.g > 0)
    o.por(borda, IDX[moldura])
    cor_fundo = IDX[miolo]
    if vidro:
        # Caixilho em cruz sobre o vidro.
        cruz = (np.abs(a) < BLOCO) | (np.abs(o.H - (h0 + altura / 2)) < BLOCO)
        cor_fundo = np.where(cruz, IDX[moldura], IDX[vidro])
    o.por(fundo_do_vao & (o.g > 0), cor_fundo)
    o.g = np.where(furo, 0, o.g)


def porta(o, prof, ao_longo, qual, lado, centro, largura, altura) -> None:
    """Uma porta: tábuas verticais com ferragem, recuada, sob arco."""
    vao(o, prof, ao_longo, qual, lado, centro, largura, 0, altura, fundo=6, moldura="base_junta", miolo="porta")
    a = ao_longo - centro
    dentro = (qual == lado) & (prof >= 6) & (prof < 10) & (np.abs(a) < largura / 2) & (o.H < altura) & (o.g > 0)
    tabua = np.where((a % 6) < BLOCO, IDX["porta_esc"], IDX["porta"])
    ferragem = (np.abs(o.H - altura * 0.3) < BLOCO) | (np.abs(o.H - altura * 0.62) < BLOCO)
    o.por(dentro, np.where(ferragem, IDX["contorno"], tabua))


def corpo_retangular(o: Obra, x0, x1, z0, z1, altura, soco, faixa) -> tuple:
    m = caixa(o, x0, x1, z0, z1, 0, altura)
    prof, ao_longo, qual = lado_da_caixa(o, x0, x1, z0, z1)
    parede_de_pedra(o, m, ao_longo + qual * 7, soco, faixa)
    return prof, ao_longo, qual


def terraco(o: Obra, x0, x1, z0, z1, piso, altura, espessura=8, ameia=12) -> None:
    """Telhado plano com parapeito: o miolo rebaixado até o piso de tábuas, e a
    pedra em volta subindo até `altura`, com ameias em cima."""
    prof, ao_longo, qual = lado_da_caixa(o, x0, x1, z0, z1)
    dentro = caixa(o, x0, x1, z0, z1, 0, 10_000)
    miolo = dentro & (prof >= espessura)
    o.g = np.where(miolo & (o.H >= piso), 0, o.g)
    o.por(miolo & (o.H >= piso - BLOCO) & (o.H < piso), tabuado(o.X, o.Z))
    anel = dentro & (prof < espessura)
    ameias(o, anel, ao_longo + qual * 5, altura, ameia)


def torre_redonda(o: Obra, cx, cz, r, altura, soco, faixa, piso, ameia=12, espessura=8) -> tuple:
    dx, dz = o.X - cx, o.Z - cz
    dist = np.hypot(dx, dz)
    ang = np.arctan2(dx, dz)
    u = ang * r
    m = (dist < r) & (o.H < altura)
    parede_de_pedra(o, m, u, soco, faixa)
    miolo = (dist < r - espessura)
    o.g = np.where(miolo & (o.H >= piso) & (o.H < altura + ameia + BLOCO), 0, o.g)
    o.por(miolo & (o.H >= piso - BLOCO) & (o.H < piso), tabuado(o.X, o.Z))
    anel = (dist < r) & (dist >= r - espessura)
    ameias(o, anel, u + 1000, altura, ameia)
    return r - dist, u, ang


def vao_na_torre(o, prof, u, ang, angulo, r, largura, h0, altura, **kw) -> None:
    """O mesmo vão, numa parede redonda: `ao_longo` é o arco a partir do
    ângulo dado."""
    delta = np.angle(np.exp(1j * (ang - angulo)))
    qual = np.where(np.abs(delta) < 0.9, 0, 9)
    vao(o, prof, delta * r, qual, 0, 0, largura, h0, altura, **kw)


def porta_na_torre(o, prof, ang, angulo, r, largura, altura) -> None:
    delta = np.angle(np.exp(1j * (ang - angulo)))
    qual = np.where(np.abs(delta) < 0.9, 0, 9)
    porta(o, prof, delta * r, qual, 0, 0, largura, altura)


def duas_aguas(o: Obra, x0, x1, z0, z1, beiral, cumeeira, aba=6, espessura=8) -> None:
    """Telhado de duas águas com a cumeeira de frente para trás (a empena
    voltada para a rua, como no pacote): oitões em reboco com enxaimel, e a
    telha por cima com aba e beirada de madeira."""
    meia = (x1 - x0) / 2
    cx = (x0 + x1) / 2
    inclin = (cumeeira - beiral) / meia
    linha = beiral + (meia - np.abs(o.X - cx)) * inclin
    # O oitão: a parede sobe até a linha do telhado.
    oitao = caixa(o, x0, x1, z0, z1, beiral, cumeeira + 1) & (o.H < linha)
    prof, ao_longo, qual = lado_da_caixa(o, x0, x1, z0, z1)
    o.por(oitao, enxaimel(o, prof, ao_longo, qual, x0, x1, z0, z1, beiral, cumeeira))
    # A telha: uma laje que acompanha o caimento, mais larga que o corpo.
    larga = meia + aba
    topo = beiral - aba * inclin + (larga - np.abs(o.X - cx)) * inclin
    laje = (np.abs(o.X - cx) < larga) & (o.Z >= z0 - aba) & (o.Z < z1 + aba) & (o.H < topo + BLOCO) & (o.H >= topo - espessura)
    d = larga - np.abs(o.X - cx)
    cor = telha(d * np.hypot(1, inclin), o.Z)
    cor = np.where(np.abs(o.X - cx) < BLOCO * 2, IDX["time_brilho"], cor)
    beirada = (o.Z >= z1 + aba - BLOCO * 2) | (o.Z < z0 - aba + BLOCO * 2)
    cor = np.where(beirada, np.where(o.H > topo - BLOCO * 2, IDX["viga_luz"], IDX["viga"]), cor)
    o.por(laje, cor)


def enxaimel(o: Obra, prof, ao_longo, qual, x0, x1, z0, z1, h0, h1) -> np.ndarray:
    """Parede de reboco com estrutura de madeira à mostra: pilares nas quinas
    e a cada 32 px, frechal em cima e baldrame embaixo."""
    cor = reboco(o.H, ao_longo + qual * 9)
    quina = (np.minimum(np.abs(o.X - x0), np.abs(x1 - o.X)) < 5) & (np.minimum(np.abs(o.Z - z0), np.abs(z1 - o.Z)) < 5)
    pilar = (((ao_longo + 16) % 32) < 4) | quina
    viga = (np.abs(o.H - h0) < 3) | (np.abs(o.H - h1) < 3)
    madeira = pilar | viga
    tom = np.where(ruido(np.floor(ao_longo / 32), qual, 13) < 0.5, IDX["viga"], IDX["viga_esc"])
    return np.where(madeira, tom, cor)


def corpo_de_enxaimel(o: Obra, x0, x1, z0, z1, altura, soco) -> tuple:
    m = caixa(o, x0, x1, z0, z1, 0, altura)
    prof, ao_longo, qual = lado_da_caixa(o, x0, x1, z0, z1)
    cor = enxaimel(o, prof, ao_longo, qual, x0, x1, z0, z1, soco, altura - 2)
    cor = np.where(o.H < soco, embasamento(o.H, ao_longo + qual * 7), cor)
    o.por(m, cor)
    return prof, ao_longo, qual


def piramide(o: Obra, cx, cz, meia, h0, h1) -> None:
    t = np.clip((o.H - h0) / (h1 - h0), 0, 1)
    raio = meia * (1 - t)
    m = (np.abs(o.X - cx) < raio) & (np.abs(o.Z - cz) < raio) & (o.H >= h0) & (o.H < h1)
    d = (o.H - h0) * 1.6
    s = np.where(np.abs(o.X - cx) > np.abs(o.Z - cz), o.Z, o.X)
    o.por(m, telha(d, s))


# --- as construções ---------------------------------------------------------------


def tesouraria() -> Obra:
    """O castelo: corpo com terraço entre duas torres redondas, portão no eixo."""
    L, F = 304, 118
    o = Obra(L, F, 132)
    r = 54
    prof, ao_longo, qual = corpo_retangular(o, -100, 100, -104, 0, 84, 16, (72, 78))
    terraco(o, -100, 100, -104, 0, 76, 84)
    for lado, ang in ((-1, -np.pi / 2), (1, np.pi / 2)):
        pt, u, a = torre_redonda(o, lado * (L / 2 - r), -r, r, 104, 16, (92, 98), 96)
        for k in (0.0, ang, np.pi):
            vao_na_torre(o, pt, u, a, k, r, 10, 58, 18, vidro="vidro")
    prof, ao_longo, qual = lado_da_caixa(o, -100, 100, -104, 0)
    porta(o, prof, ao_longo, qual, 0, 0, 40, 54)
    for x in (-60, 60):
        vao(o, prof, ao_longo, qual, 0, x, 12, 36, 22, vidro="vidro")
    for x in (-50, 0, 50):
        vao(o, prof, ao_longo, qual, 1, x, 12, 36, 22, vidro="vidro")
    return o


def cofre() -> Obra:
    """A torre: um cilindro de pedra com ameias e porta."""
    r = 52
    o = Obra(2 * r, 2 * r, 116)
    pt, u, a = torre_redonda(o, 0, -r, r, 100, 16, (86, 92), 92)
    porta_na_torre(o, pt, a, 0.0, r, 24, 38)
    for k in (np.pi / 2, np.pi, -np.pi / 2):
        vao_na_torre(o, pt, u, a, k, r, 10, 54, 18, vidro="vidro")
    vao_na_torre(o, pt, u, a, 0.0, r, 10, 58, 16, vidro="vidro")
    return o


def chapelaria() -> Obra:
    """O quartel: um bloco de pedra com terraço e ameias."""
    L, F = 176, 108
    o = Obra(L, F, 88)
    prof, ao_longo, qual = corpo_retangular(o, -L / 2, L / 2, -F, 0, 72, 14, (60, 66))
    terraco(o, -L / 2, L / 2, -F, 0, 64, 72)
    porta(o, prof, ao_longo, qual, 0, 0, 28, 40)
    for lado, xs in ((0, (-56, 56)), (1, (-50, 0, 50)), (2, (-74, -34)), (3, (-74, -34))):
        for x in xs:
            vao(o, prof, ao_longo, qual, lado, x, 12, 28, 22, vidro="vidro")
    return o


def casa_da_moeda() -> Obra:
    """O mosteiro: enxaimel com telhado de duas águas e a torre do sino."""
    L, F = 152, 112
    o = Obra(L + 16, F + 12, 232)
    x0, x1, z0, z1 = -L / 2, L / 2, -F, -6
    prof, ao_longo, qual = corpo_de_enxaimel(o, x0, x1, z0, z1, 64, 10)
    duas_aguas(o, x0, x1, z0, z1, 64, 124)
    porta(o, prof, ao_longo, qual, 0, 0, 32, 48)
    for lado, xs in ((2, (-80, -40)), (3, (-80, -40)), (1, (-40, 40))):
        for x in xs:
            vao(o, prof, ao_longo, qual, lado, x, 12, 22, 26, moldura="viga_esc", vidro="vidro")
    # A rosácea no oitão da frente.
    rosa = (qual == 0) & (np.hypot(o.X, o.H - 92) < 12) & (prof < BLOCO * 2) & (o.g > 0)
    o.por(rosa, np.where(np.hypot(o.X, o.H - 92) < 9, np.where(ruido(np.floor(o.X / 4), np.floor(o.H / 4)) < 0.5, IDX["vidro"], IDX["time_brilho"]), IDX["time_esc"]))
    # A torre do sino, nascendo da cumeeira.
    cz, meia = (z0 + z1) / 2, 20
    sino = caixa(o, -meia, meia, cz - meia, cz + meia, 100, 164)
    tp, ta, tq = lado_da_caixa(o, -meia, meia, cz - meia, cz + meia)
    o.por(sino, enxaimel(o, tp, ta, tq, -meia, meia, cz - meia, cz + meia, 100, 162))
    for lado in range(4):
        vao(o, tp, ta - (cz if lado >= 2 else 0), tq, lado, 0, 16, 132, 24, moldura="viga_esc", miolo="contorno")
    beiral = caixa(o, -meia - 4, meia + 4, cz - meia - 4, cz + meia + 4, 162, 166)
    o.por(beiral, IDX["viga_luz"])
    piramide(o, 0, cz, meia + 4, 166, 214)
    ponta = (np.abs(o.X) < 3) & (np.abs(o.Z - cz) < 3) & (o.H >= 212) & (o.H < 226)
    o.por(ponta, IDX["ouro"])
    return o


def nascedouro() -> Obra:
    """A casa: enxaimel com telhado de duas águas, porta e janelas."""
    L, F = 104, 104
    o = Obra(L + 16, F + 12, 104)
    x0, x1, z0, z1 = -L / 2, L / 2, -F, -6
    prof, ao_longo, qual = corpo_de_enxaimel(o, x0, x1, z0, z1, 46, 8)
    duas_aguas(o, x0, x1, z0, z1, 46, 92)
    porta(o, prof, ao_longo, qual, 0, 0, 22, 34)
    for lado, xs in ((2, (-70, -30)), (3, (-70, -30)), (1, (0,))):
        for x in xs:
            vao(o, prof, ao_longo, qual, lado, x, 12, 18, 16, moldura="viga_esc", vidro="vidro")
    for x in (-32, 32):
        vao(o, prof, ao_longo, qual, 0, x, 12, 18, 16, moldura="viga_esc", vidro="vidro")
    return o


CONSTRUCOES = {
    "tesouraria": tesouraria,
    "cofre": cofre,
    "chapelaria": chapelaria,
    "casaDaMoeda": casa_da_moeda,
    "nascedouro": nascedouro,
}


def paleta(azul: np.ndarray, outra: np.ndarray | None) -> list[tuple[int, int, int]]:
    """As cores dos papéis. Sem `outra`, as do pacote azul; com ela, a cor que o
    pacote pôs no mesmo pixel da outra variante (a mais comum), com o mesmo
    fator de sombra."""
    mapa: dict[tuple, tuple] = {}
    if outra is not None:
        op = (azul[..., 3] == 255) & (outra[..., 3] == 255)
        a = azul[op][:, :3]
        b = outra[op][:, :3]
        chaves, inverso = np.unique(a, axis=0, return_inverse=True)
        for k, c in enumerate(chaves):
            alvo, n = np.unique(b[inverso.reshape(-1) == k], axis=0, return_counts=True)
            mapa[tuple(int(v) for v in c)] = tuple(int(v) for v in alvo[n.argmax()])
    cores = []
    for nome in NOMES:
        hexa, fator = PAPEIS[nome]
        c = tuple(int(hexa[k : k + 2], 16) for k in (1, 3, 5))
        c = mapa.get(c, c)
        cores.append(tuple(int(round(v * fator)) for v in c))
    return cores
