# CyberKingdoms 3D

Cliente web em **three.js**: o mesmo mundo do app Flutter, desenhado com relevo
contínuo e grama instanciada em vez de sprites isométricos.

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # o contrato com o gerador do Flutter
npm run build
```

## O contrato com o cliente Flutter

A geração **não foi reescrita, foi portada**. RNG, ruído e limiares de bioma são
os mesmos, e isso é verificado — não presumido:

```sh
flutter test test/fixture_export_test.dart   # grava web3d/test/worldgen-fixture.json
cd web3d && npm test                         # compara, tile a tile
```

O fixture traz 400 tiles, 24 amostras de ruído e a sequência do RNG. Se passar,
a seed `neon-tokyo` abre o mesmo mundo no celular e no navegador — mesmo bioma,
mesma altura, no mesmo tile. Divergir em qualquer camada reprova, e o teste diz
**qual** camada: RNG, ruído ou classificação de bioma.

Mudar uma constante do gerador de um lado só quebra o contrato em silêncio no
outro. O sintoma aparece como uma ilha que existe no app e não existe na web.

## Catálogos gerados, não transcritos

Itens, receitas e tabelas de Fome/Sede vivem em `src/data/*.json`, **gerados**
do catálogo Dart:

```sh
flutter test test/catalog_export_test.dart
```

São algumas centenas de números já conferidos contra o GDD. Copiá-los à mão não
é difícil, é silencioso: um preço-base trocado não quebra teste nenhum e só
aparece meses depois como uma economia que não fecha. Dados como dados,
comportamento como código.

## Porte em andamento

O three.js vai substituir o cliente Flutter. Ordem do porte:

| Camada | Situação |
|---|---|
| Geração do mundo | pronta, com contrato verificado |
| Itens, inventário, sobrevivência | pronta |
| Receitas e mercados | catálogo exportado, lógica pendente |
| Construções, terreno, vilarejo | pendente |
| Campanha, tick diário, quests | pendente |
| Política e combate | pendente |
| Interface e persistência | pendente |

## O que a web tem a mais

| | Flutter | three.js |
|---|---|---|
| Relevo | 9 degraus discretos | altura contínua |
| Chão | sprite de bloco de grama | malha + grama instanciada |
| Vegetação | sprite por tile | lâminas com vento no vertex shader |
| Pintura de grama | — | pincel aditivo/subtrativo |

## Mobile-first depois da troca de motor

O aparelho de referência é um celular mediano, não um desktop. Três decisões
concretas:

**O orçamento se mede, não se adivinha.** `render/quality.ts` começa num
palpite pela classe do aparelho e ajusta pelo tempo de quadro real: cai de
classe depois de meio segundo ruim, sobe só depois de quatro segundos bons.
A assimetria é de propósito — engasgo o jogador sente na hora, ganho de
qualidade ele nem repara. A faixa morta entre 45 e 58 FPS impede que um
aparelho parado no limite troque de classe a cada segundo, o que custaria
refazer o campo inteiro.

A resolução cai antes da grama: num celular o gargalo é preenchimento, e baixar
o `devicePixelRatio` de 2,0 para 1,5 corta 44% dos pixels sem quase se ver.

**Gestos, não atalhos.** Um dedo gira, dois dedos aproximam e deslocam, e o
pincel é um botão na tela — não há `shift` num celular, e toque longo
competiria com o menu do navegador.

**O laço para com a aba oculta.** Render em segundo plano é o motivo número um
de um jogo web esquentar o celular no bolso.

Ainda não medi em aparelho real: o que existe neste ambiente é rasterizador por
software, que não diz nada sobre um Snapdragon. É justamente por isso que o
orçamento se ajusta sozinho em vez de vir de constante.

## Estilo

Quatro coisas fazem a grama parecer pintada em vez de plástica, em ordem de
importância: gradiente ao longo da folha, curvatura, variação por instância e
escurecimento na raiz. Todas em vertex shader, que não custa preenchimento — o
gargalo no celular. Ver o comentário no topo de `src/render/grass.ts`.

O orçamento é de **90 mil lâminas**, 12 vértices cada. Dobrar derruba o frame
rate de um celular mediano e a diferença a 30 m é quase nenhuma.

## Controles

| | |
|---|---|
| arrastar | orbitar |
| roda | aproximar |
| `shift`+arrastar, ou botão direito | plantar grama |
| `W` `A` `S` `D` | caminhar |
| `C` | limpar a pintura |
