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

## Cenário plano e visão de cima

O terreno é **plano** e a câmera fica **de cima**, entre 68° e 83°. As duas
coisas se sustentam:

- Morro esconde construção, obriga a câmera a desviar e estraga a leitura da
  grade em que o jogador encaixa. `heightAt` devolve zero de propósito.
- Abaixo de 68° a câmera enxerga o horizonte, e com ele a **borda do trecho
  carregado**. Um mundo com fim visível deixa de parecer mundo.

O relevo não foi apagado do modelo: `rawElevation` continua classificando bioma
e marcando a linha d'água, e há teste que reprova se ele for zerado junto. Se um
dia couber relevo suave, a assinatura está lá.

A malha de terreno é 3,2× o trecho semeado, e não 1,6×: quase na vertical, a
borda entrava em quadro no zoom máximo e aparecia como um precipício no vazio.

## Telas

O jogo abre no **menu**, não no mapa. O mapa é uma tela entre várias — tratá-lo
como abertura escondia as decisões que precisam ser tomadas antes de entrar.

O mundo 3D só é montado quando alguém entra nele. Não é arrumação: carregar
three.js, semear as lâminas e subir a malha leva segundos num celular, e fazer
isso antes do jogador escolher gasta bateria e paciência à toa.

`ui/screens.ts` é uma pilha de telas, não `display:none` espalhado. Com a pilha
explícita, "voltar" existe de graça e o botão físico do Android faz o que deve —
sem isso ele fecha o jogo no meio de um submenu.

**Continuar vem primeiro e é o botão maior.** Quem volta ao jogo quer voltar ao
jogo; enterrar isso sob "Novo" cobra um toque extra de todo mundo, todo dia,
para servir a quem chega uma vez. Sem save ele não some — fica desabilitado e
explicado, senão o menu dança entre aberturas.

## Cliente e servidor

O jogo é um MMO: o estado que vale é o do servidor, não o da tela. Por isso a
fronteira (`src/net/gameServer.ts`) foi escrita **antes** de existir servidor —
custa um arquivo e economiza a refatoração inteira depois.

Hoje só existe `LocalGameServer`, que guarda tudo no navegador. Ele não é
protótipo descartável: é o **modo offline**, e continua valendo depois que o
servidor real existir — para jogar sem rede, para testar, e para o Sandbox, que
não precisa de servidor nenhum.

Duas decisões que ficam mais baratas agora do que depois:

- **Tudo é assíncrono, inclusive no local.** Uma chamada que hoje devolve na
  hora e amanhã leva 200 ms quebraria cada tela que a tratasse como síncrona.
- **`saveState` devolve o estado aceito, não `void`.** Num servidor de verdade
  o envio é uma *proposta*: o servidor recalcula o dia com o mesmo motor
  determinístico e pode devolver algo diferente. O cliente já nasce escrito
  para isso.

| Modo | Precisa de servidor | Sobrevivência |
|---|---|---|
| Campanha | não | sim |
| Mundo Persistente | sim | sim |
| Sandbox | não | não |

Partida rápida com amigos ficou para depois: é o único modo que precisa de
sincronização em tempo real, e não do tick de 24 h que todo o resto assume.

## Porte em andamento

O three.js vai substituir o cliente Flutter. Ordem do porte:

| Camada | Situação |
|---|---|
| Geração do mundo | pronta, com contrato verificado |
| Itens, inventário, sobrevivência | pronta |
| Receitas e mercados | catálogo exportado, lógica pendente |
| Construções, terreno, vilarejo | pronta |
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

**Celular**

| | |
|---|---|
| um dedo arrastando | arrastar o terreno |
| dois dedos, pinça | aproximar e afastar |
| dois dedos, torção | girar |
| dois dedos, vertical | inclinar |

**PC** — não é porta de segunda: no computador os gestos de dois dedos não
existem, e arrastar com o mouse para atravessar a vila cansa.

| | |
|---|---|
| `W` `A` `S` `D`, ou setas | mover |
| `Q` `E` | girar |
| `R` `F` | aproximar e afastar |
| roda do mouse | aproximar e afastar |
| arrastar | arrastar o terreno |

A velocidade do teclado é proporcional ao afastamento: de longe cada passo
cobre mais chão, senão atravessar a vila afastado leva o dobro do tempo.

## O limite da vila

O mundo é infinito, mas o **jogo** acaba na borda da vila. Fora dela não se
constrói, não se trabalha e não se guarda nada — a viagem entre cidades é uma
decisão da tela de cidade, com custo de Fome e Sede e risco de emboscada, não
uma caminhada.

Deixar a câmera sair livremente ensinava a coisa errada. O limite se apresenta
em três camadas: o terreno perde cor e a grama rareia ao longo de uma faixa de
18 m; a câmera **desacelera e desliza** pela borda em vez de bater, porque
trava seca parece defeito e freio parece regra; e ao encostar aparece o nome do
destino com a explicação de como se chega lá.

## Grama

Densidade alta em todo lugar. Havia um pincel para plantar, herdado da
ferramenta que inspirou o renderizador — saiu inteiro: o que se queria dele era
o resultado, não o trabalho de pintar. O ruído de clareira continua, senão o
campo vira carpete, mas o piso é alto e a clareira agora é uma moita menos
fechada, nunca chão pelado.

Um dedo arrastar o chão em vez de orbitar é a diferença que a mão sente: o
ponto sob o dedo continua sob o dedo, e um mapa grande vira navegável. É a
convenção de City Skylines e dos tycoons, e o jogador já chega sabendo.

A inclinação segue o zoom: longe o jogador está planejando e quer ver o
traçado, então a câmera sobe; perto está apreciando, e ela baixa. Isso define o
**piso** do ângulo — inclinar à mão continua funcionando.
