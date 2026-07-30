# Sprite renderer

Converte os kits 3D da Kenney (`.glb`) em sprites isométricos PNG que o cliente
Flutter consome, junto com um manifesto (`sprites_manifest.json`) descrevendo o
tamanho e a ancoragem de cada modelo.

## Por que existe

Os kits da Kenney usados no projeto — Castle Kit, Mini Dungeon, Mini Forest, e
os modelos dos dois Starter Kits — são **modelos 3D**, não sprites. O Flutter
não renderiza `.glb` de forma performática em celular, então os modelos são
pré-renderizados uma vez, offline, em projeção isométrica 2:1 (azimute 45°,
elevação `atan(1/2)` ≈ 26,57°).

O resultado: o visual 3D da Kenney rodando como 2D barato, a 60fps.

## Como rodar

```sh
cd tools/sprite-renderer
npm install
node render.mjs ../../assets/sprites <dir-com-glb> [<dir-com-glb>...]
```

Usa Chromium headless via `playwright-core` e three.js. O caminho do Chromium
está fixado em `render.mjs` — ajuste `executablePath` se o seu ambiente instalar
o browser em outro lugar.

O manifesto gerado inclui, por modelo:

- `sizeX/Y/Z` — dimensões do modelo original, usadas para calcular a footprint
  em tiles;
- `baseY` — onde o plano do chão do modelo cai na imagem, que é o que permite
  alinhar a base de um prédio com o losango do tile.
