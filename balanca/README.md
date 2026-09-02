# Meu Querido Rei

Um jogo de resgate por times, jogado só em rede, feito com a base do
CyberKingdoms: a mesma arte Tiny Swords, o mesmo gerador determinístico, o mesmo
jeito de escrever TypeScript. É o esqueleto do **Fat Princess** do PS3 — dois
castelos, dois reféns, chapéus que dão classe — com o tema trocado e uma regra
nova no meio, que muda a conta do jogo inteiro.

> A pasta continua se chamando `balanca/`, e o serviço publicado também: renomear
> os dois quebraria o `rootDir` do deploy que já está no ar por nada. **Balança**
> é o nome da mecânica; **Meu Querido Rei** é o nome do jogo.

---

## O tema: o Peso do Tesouro

Não há princesa. O refém é um **baú vivo** — um saco de tesouro com pernas —, e
o que o inimigo faz com ele é o oposto de cuidar: entulha de moeda até ele não
poder mais ser carregado de volta.

| o que era | o que é | por quê |
|---|---|---|
| princesa | **baú vivo** | ninguém pergunta por que um baú fica pesado |
| masmorra | **cofre** | é onde se guarda um baú |
| trono | **tesouraria** | é para onde ele volta |
| bolo | **bolsa de moedas** | o que se entulha |
| cozinha | **Casa da Moeda** | onde o minério vira moeda |
| carne | **minério** | o que sai do alforje do rebanho |
| caçador | **saqueador** | quem derruba a ovelha de carga |

A troca não foi só de nome: ela apaga a pergunta que mais custava explicar no
tema antigo — *"por que eu alimento a refém dela?"*. Ouro entrando num baú que
não é seu é uma frase que não precisa de manual. Em compensação perde-se o
humor do original; o jogo ficou mais frio de propósito.

---

## O diferencial: o peso é uma balança só

No Fat Princess, bolo é defesa pura: você engorda o refém que está na sua
masmorra e o cálculo acaba aí.

Aqui o peso do reino é **conservado**. Os dois baús dividem uma balança: a soma
dos dois pesos é sempre a mesma. Cada bolsa que você entulha no baú do seu cofre
tira exatamente aquele peso do **seu** baú, trancado do outro lado do mapa. O
ouro do mundo é finito, e enterrá-lo no baú do inimigo enriquece o baú e
empobrece o reino dele.

Uma bolsa é ataque e defesa no mesmo gesto:

| o que você faz | o que acontece no seu cofre | o que acontece no seu resgate |
|---|---|---|
| entulha uma bolsa no baú refém | ele pesa mais: o inimigo precisa de mais carregadores e anda mais devagar | o seu baú alivia: o seu resgate fica mais barato |

E o inimigo está fazendo a mesma coisa na direção contrária. A barra no alto da
tela é literalmente um cabo de guerra, e é o placar que mais se olha durante a
partida — inclusive porque ela **desempata** o jogo: acabado o tempo com o
placar igual, ganha o reino cujo baú está mais leve.

O que fecha o desenho é o custo. Moeda não nasce do chão: sai de **minério**, e
minério sai de ovelha de carga que alguém teve de derrubar no meio do mapa — e
quem está saqueando é um a menos segurando a ponte. Dominar a balança se paga
em gente.

### O segundo diferencial: chapéu cai, e chapéu se rouba

A classe vem do chapéu, como no original — mas o estoque é finito e o chapéu
**cai no chão** quando o dono morre. Quem passar pega, inclusive o inimigo. Um
time que domina as trocas não só mata mais: desmonta a composição do outro e
veste a própria com o que roubou. "O vermelho não tem mais arqueiros" vira uma
coisa que aconteceu na partida, não um número no menu.

---

## Só multiplayer, e os bots sabem disso

Não existe modo de um jogador. Toda partida roda no servidor, com o mesmo tick
para todo mundo. Quem entra sozinho não joga um jogo diferente — joga o mesmo
jogo com companhia emprestada:

- **adversário na hora.** Um time sem nenhum humano é preenchido por bots
  imediatamente: jogar contra o vazio não é jogar.
- **companheiro só depois da espera.** O seu time guarda as vagas por doze
  segundos, à espera de gente de verdade.
- **o bot cede o lugar.** Quando alguém entra numa sala cheia de bots, um bot é
  dispensado na hora — de preferência um que esteja morto, para ninguém ver
  alguém sumir no meio do campo. Humano nunca fica na fila atrás de máquina.
- **o lobby junta as pessoas.** Quem entra vai para a sala que já tem mais gente.
  Sala nova só nasce quando as existentes estão cheias de humanos.

Os bots jogam com as mesmas regras: mesmo campo de navegação, mesma mira, mesmo
dano, e um tempo de reação para não serem infalíveis. Um bot que trapaceia é um
bot que não dá para balancear.

---

## Como se joga

Traga o **seu** baú do cofre inimigo até a sua tesouraria. Três resgates
vencem; doze minutos no relógio.

| tecla | ação |
|---|---|
| `W` `A` `S` `D` | andar |
| mouse | mirar (dá para recuar atirando) |
| clique / `F` | atacar — e saquear, que é derrubar a ovelha de carga |
| `E` / botão direito | usar: pegar, entregar, entulhar, vestir, trabalhar |
| `Tab` | placar |

No celular: manche numa metade da tela e botões na outra — de que lado fica cada
coisa é ajustável.

O botão de contexto é um só, e a dica no rodapé diz sempre o que ele vai fazer.
Na chapelaria ele **roda a lista** de chapéus: aperte até chegar no que quer.
Durante o aquecimento é a única ação liberada — é para isso que o aquecimento
existe.

### Quatro pessoas, um aparelho

O jogo é de sofá além de ser de rede. Cabem **até quatro** numa tela só, e os
dois botões do menu — *Jogo Local* e *Jogo Online* — abrem a mesma cabine: quatro
molduras, uma por pessoa, e cada uma entra apertando o botão do seu controle.

| vaga | controle | andar | mirar | atacar | usar | entrar |
|---|---|---|---|---|---|---|
| qualquer | controle | analógico esq. / direcional | analógico dir. | `X` ou `RT` | `A` | `A` |
| teclado | WASD | `W` `A` `S` `D` | mouse | clique ou `F` | `E` | `Espaço` |
| teclado | setas | `↑` `←` `↓` `→` | *rumo* | `.` | `,` | `Enter` |

Quem não tem mouse nem analógico direito mira **para onde está indo**. É de
propósito: recuar atirando fica sendo uma vantagem de quem tem controle, como em
qualquer jogo de quatro — melhor do que fingir que dá para mirar com o teclado
numérico.

Três regras seguram o resto:

- **todo mundo no mesmo time.** A tela é uma só e a câmera não segue dois grupos
  correndo para lados opostos. O lado é escolhido uma vez e vale para os quatro.
- **a câmera enquadra o grupo.** Ela vai para o meio de quem está em campo e abre
  o quanto for preciso para caber todo mundo. Passado o limite ela para de abrir
  e aponta com uma seta na borda quem ficou fora — encolher o jogo até o boneco
  virar um pixel não ajuda ninguém.
- **cada um acha o seu.** Uma seta pulando sobre a cabeça, na cor da vaga, e um
  cartão de vida no rodapé com a mesma cor. Sem isso, quatro bonecos do mesmo
  reino na mesma tela são quatro bonecos iguais.

Por dentro, **cada pessoa abre a sua conexão**. Para o servidor são quatro
jogadores como quaisquer outros; nada lá sabe que estão no mesmo sofá. É o que
faz previsão local, reconciliação, vida e chapéu valerem para os quatro sem
existirem duas vezes no código. A única coisa que o servidor precisou aprender
foi entrar numa sala **pelo nome** — senão o lobby espalharia a turma por salas
diferentes, cada uma vendo uma partida na mesma tela.

*Jogo Local* abre ainda uma **sala reservada**: o lobby não manda estranhos para
ela e o resto do time vem de bot. *Jogo Online* usa a sala pública mais
movimentada, e aí o sofá entra junto de quem estiver na rede.

### Os sete modos

Um modo muda **uma** alavanca em relação ao clássico, e a alavanca que ele muda
é a que dá nome a ele. É o que permite explicá-lo numa linha na hora de escolher,
e o que impede a lista de virar sete variações indistinguíveis.

| modo | o que muda | mediana com bots |
|---|---|---|
| **Resgate** | o clássico: três resgates vencem, a balança desempata | 370 s |
| **Assalto** | um resgate decide · seis minutos · volta-se rápido para o campo | 85 s |
| **Cofre Cheio** | a balança **vence**: entulhe o baú refém até o talo da barra | 395 s |
| **Chapelaria aberta** | chapéu à vontade: ninguém disputa arco, ninguém rouba composição | 309 s |
| **Veia Seca** | a ovelha derrubada não volta: o minério do mapa é tudo o que existe | 372 s |
| **Obra** | vence quem terminar a chapelaria: picareta e machado decidem | 229 s |
| **Abate** | trinta baixas vencem · sem cortejo, sem moeda, só briga | 166 s |

A coluna da direita é medida, não estimada: doze seeds por modo, salas só de
bots. Todas as oitenta e quatro partidas terminaram, e o placar por lado ficou
equilibrado em todos os sete.

Por dentro, um modo é **dado** e não caminho de código: uma linha em
`shared/modos.ts` que o tick lê no lugar das constantes. A tentação era escrever
`if (modo === 'assalto')` no meio do tick; feito sete vezes, o tick vira uma
árvore que ninguém lê e cada regra nova precisa lembrar de todos os modos — que
é como um jogo ganha um modo quebrado que ninguém descobre por três meses. Aqui
o tick nunca soube o nome de nenhum deles.

O modo mora no **estado**, e não na sala, porque o cliente prevê o movimento
rodando a mesma simulação do servidor: fosse só do servidor, a previsão rodaria
com as regras erradas. Estando no estado, ele viaja no `bemvindo` e os dois lados
concordam de graça — uma vez por partida, e não quinze vezes por segundo.

#### Um modo só existe se a partida ficar diferente

Os quatro nasceram com testes de unidade passando e um deles era oco. Rodando
salas só de bots, o Cofre Cheio terminava **idêntico** ao clássico — mesmo placar,
mesmos pesos, mesmo vencedor, nas três seeds. O fim por peso existia; só nunca
acontecia, porque `recomecarRodada` relaxava a balança metade do caminho de volta
ao centro a cada resgate e apagava o trabalho que o modo pede.

A correção não é uma segunda alavanca: é a primeira funcionando. Uma condição de
vitória que outra regra apaga não é condição de vitória. Com a balança preservada
entre pontos, o modo passou a se comportar como se anuncia:

| seed | antes | depois |
|---|---|---|
| 11 | 356s · 3-0 · 91/109 | 482s · 2-1 · **40/160**, vitória pela balança |
| 22 | 293s · 1-3 · 109/91 | 309s · 1-3 · 100/100 |
| 33 | 302s · 3-1 · 79/121 | 403s · 3-2 · 112/88 |

A lição virou teste em duas camadas: um que confere a regra em isolamento, e um
que **roda a partida com bots** e exige que o Assalto acabe muito antes do
clássico. O primeiro passava com o modo oco; só o segundo prova que o jogo ficou
diferente.

A lição se repetiu com os modos novos, e as duas vezes a medição pegou:

- O **Obra** nasceu oco pelo mesmo motivo do Cofre Cheio. O rodízio de papéis dos
  bots põe **um** deles por time na economia, e a obra empacava no nível dois: as
  três primeiras partidas saíram idênticas às do clássico. Um bot que ignora a
  condição de vitória do modo é um bot que não joga aquele modo, então o rodízio
  passou a ser por modo — metade do time na picareta no Obra, ninguém cunhando
  no Abate.
- O **Abate** terminava por resgate em duas de três, num modo cujo lema promete
  "sem cortejo". O resgate deixou de decidir; o baú continua em campo e
  continua carregável, mas deixou de ser o placar.

E dois defeitos que só apareceram porque a medição foi feita:

- O contador do rodízio dos bots era **global**, e os bots entram alternando
  azul e vermelho. Com o rodízio clássico de três posições a paridade escapava
  por acaso; com o de quatro do modo Obra, o azul saía com **todos** os
  cozinheiros, terminava a chapelaria em noventa segundos e vencia as três
  partidas medidas. O contador virou um por time.
- O Obra, já equilibrado, decidia em 115 s de mediana — quase tão rápido quanto
  o Assalto, que é o modo expresso de propósito. Uma corrida de construção que
  acaba antes de o inimigo chegar à jazida não é corrida. A obra passou a custar
  o triplo nesse modo, e a mediana foi para 229 s.

Uma observação que fica registrada em vez de escondida: a **Chapelaria aberta**
produz a partida mais longa dos sete (até 729 s, e uma das seeds terminou 0-0 no
relógio). Com chapéu à vontade todo mundo vira combatente, a defesa fica dura e o
resgate quase não passa. É o modo sendo o que promete, mas é bom saber.

E uma sobre método: por duas vezes três seeds sugeriram um desequilíbrio de lado
que dez seeds desmentiram — 9×0 virou 19×21, e 10×2 virou 16×14. Amostra de três
serve para ver se o modo **faz** alguma coisa; não serve para dizer se ele é
justo.

### Os quatro formatos: de seis a trinta e dois por lado

O jogo nasceu para seis por lado e agora vai até trinta e dois — sessenta e
quatro pessoas em campo. Não bastava subir um número: a economia inteira foi
medida com doze unidades, e cinco vezes mais gente cunhando moeda, cavando
jazida e subindo obra transforma a mesma partida em outra coisa.

| formato | campo | o que muda |
|---|---|---|
| **6 × 6** | qualquer | o tamanho em que o jogo foi medido |
| **8 × 8** | qualquer | uma frente a mais, ainda nos campos pequenos |
| **16 × 16** | Planície | o time se divide em frentes ou não chega a lugar nenhum |
| **32 × 32** | Planície | o cortejo do baú vira uma operação de guerra |

#### A regra da escala: o que é por pessoa cresce; o que é por partida, não

A razão é `porTime / 6`. Cresce com ela tudo o que uma pessoa consome ou produz
— o peso que a balança comporta, o estoque de chapéus, o custo da obra, e o
rebanho e as jazidas do campo. Não cresce nada que seja da partida e não das
pessoas: o relógio, os pontos para vencer, a velocidade de quem anda.

O que isso **preserva** é o tempo. Se a produção de bolsas dobra e o peso que a
balança comporta dobra junto, o tempo até o talo é o mesmo — e é dele que sai a
duração da partida.

O peso total cresce em vez de a bolsa encolher, e isso foi uma escolha. Manter
`PESO_TOTAL` fixo e dividir o que cada bolsa move daria o mesmo tempo de partida
e um jogo pior: com trinta e dois por lado, uma bolsa moveria dois pontos numa
barra de duzentos, e o gesto que é a assinatura do jogo não teria efeito visível
nenhum.

O teto de gente por time saiu de uma constante e passou a ser conta do **mapa**:
cento e dez tiles de campo por unidade, que é a densidade do que já se conhecia
(oito por lado no Corte). Dá nove por time nos campos pequenos e trinta e sete
na Planície, e sobe sozinho no dia em que alguém desenhar um campo maior. Uma
sala que sorteia campo usa o teto do **menor** deles, senão aceitaria trinta e
dois por lado e cairia no Corte.

#### O que a medição mostrou, e o que ela não mostra

Três seeds por formato, salas só de bots, no modo Resgate:

| formato | ms por tick | como as partidas acabaram |
|---|---|---|
| 6 × 6 | 0,05 | duas de três por resgate, aos 253 s e 314 s |
| 8 × 8 | 0,06 | três de três por resgate |
| 16 × 16 | 0,31 | uma por resgate; as outras no relógio, com a balança decidindo |
| 32 × 32 | 0,41 | as três no relógio, decididas pela balança |

O orçamento de um tick é 33 ms, então sobra folga de setenta vezes até no
formato maior.

Nos formatos grandes o **resgate deixa de ser o caminho comum**: cinco
carregadores atravessando setenta tiles no meio de sessenta e quatro brigando é
caro, e a partida costuma ser decidida pela balança — que é a mecânica que dá
nome ao jogo, e não um empate técnico. Toda partida medida terminou com um
vencedor. Se isso é o desenho certo é uma pergunta de gosto, não de código, e a
resposta está a uma linha de distância em `modos.ts`.

Três seeds servem para ver se o formato faz alguma coisa; **não** servem para
dizer se ele é justo. Os números de abates por lado saíram muito desiguais em
algumas seeds (925 a 73 numa delas), e nada aqui autoriza a concluir nada sobre
isso.

#### O defeito que a medição pegou

A primeira medição de dezesseis contra dezesseis custou **48,9 ms por tick**,
com orçamento de 33: o servidor não daria conta. A causa não era o número de
bots — era o cache do navegador de campo. Cada perseguição a um inimigo que
corre pedia um destino novo, e com o cache cheio **toda** decisão virava uma
busca em largura do mapa inteiro.

O conserto tem duas metades. O cache cresceu de vinte e quatro para cento e
vinte e oito campos (dois megabytes, barato perto de estourar o tick), e o
destino passou a ser encostado num bloco de quatro por quatro, de modo que
dezesseis tiles compartilham um campo. Deu **0,23 ms** — e o formato de seis,
que ninguém estava tentando otimizar, ficou seis vezes mais rápido junto.

Duas armadilhas apareceram no caminho, e as duas foram achadas medindo:

- **atravessar parede.** A primeira versão ia em linha reta de dentro do bloco
  inteiro, e quatro tiles em linha reta cruzam fosso. O cortejo do clássico
  parou de chegar em casa: duas de três seeds terminavam 0 a 0 no relógio, onde
  antes acabavam por resgate aos cinco minutos. O atalho voltou a ser de um tile
  só, e a aproximação final passou a usar o campo exato.
- **âncora do outro lado do muro.** No Desfiladeiro, a âncora de um destino caía
  do outro lado do fosso e o campo dela dava infinito para o destino de verdade
  — o bot concluía que não havia caminho para onde ele chegava andando. Agora o
  campo do bloco é conferido antes de valer, ao custo de um acesso a vetor.

E uma terceira, que não era de navegação: a Planície nasceu com dezoito ovelhas
para trinta e dois por lado, contra dez para seis. A balança de uma partida de
dezesseis contra dezesseis andava doze pontos em doze minutos — a economia
estava faminta, e nada do que dependia dela chegava a acontecer. O rebanho
triplicou.

### Montar uma sala

O botão **Salas** abre um painel só, com as duas metades da mesma pergunta
("onde eu vou jogar?"): montar a sua, e a lista das abertas. Separá-las em dois
painéis faria quem quer jogar com um amigo abrir os dois para descobrir em qual
está a resposta.

Ao montar, escolhem-se três coisas: o modo, **quantos jogadores por time** e
**quantos npcs por time**. As duas contagens são por time, e não por sala: "oito
jogadores" deixa em aberto se são quatro contra quatro ou seis contra dois, e
essa ambiguidade viraria uma partida desequilibrada que ninguém pediu.

Os npcs de uma sala montada são **fixos**, e essa é a diferença que faz o campo
existir. Numa sala do lobby o bot é tapa-buraco: entra para completar o time e
sai quando chega gente. Numa sala montada ele foi pedido — três contra três com
dois npcs de cada lado é oito em campo, e continua sendo oito quando o terceiro
amigo chegar. A vaga de gente que sobra fica **aberta**, esperando por uma
pessoa, em vez de ocupada por uma máquina que essa pessoa teria de expulsar.

Os números chegam pela rede e o servidor não confia em nenhum deles: quem sanea
é `salaConfiguravel`, e o corte do teto de unidades tira dos **npcs**, nunca das
vagas de gente — quem pediu quatro amigos e seis bots quis, acima de tudo, jogar
com os quatro amigos. O mesmo saneamento roda no painel, para que o número na
tela seja o número que a sala vai ter: um formulário que promete o que o servidor
corta é um formulário que mente.

### Os cinco campos de batalha

Um mapa não mexe em regra nenhuma — mesma balança, mesmos chapéus, mesma moeda.
Ele mexe nas duas coisas que decidem o **ritmo**: onde estão os estrangulamentos
e quão exposta fica a economia.

| mapa | grid | o que muda |
|---|---|---|
| **Corte** | 60×34 | fosso em volta de cada castelo, duas pontes, lago no meio |
| **Vau** | 60×34 | castelo aberto e um rio no meio: a briga é sempre nas travessias |
| **Desfiladeiro** | 60×34 | **uma** ponte por castelo: quem defende o portão defende tudo |
| **Arquipélago** | 60×34 | o ouro do meio numa ilha cercada: cavar vira ato de guerra |
| **Planície** | 120×68 | o campo grande: três portões por castelo e quatro travessias no rio |

Os quatro primeiros são o mesmo grid de 60×34; a Planície tem quatro vezes a
área e existe para os times grandes (ver abaixo). Cada um descreve **só a metade
azul**: o
pincel que os relevos recebem escreve nos dois lados a cada traço, então um mapa
que tentasse desenhar assimetria não conseguiria. Com cinco mapas, manter dez
listas de coordenadas em pares seria garantir que um dia a Casa da Moeda vermelha
ficasse um tile mais longe do que a azul.

O tamanho do campo é do **mapa**, e não das regras: foi por isso que o espelho
deixou de ser constante de módulo. Enquanto havia um grid só, a constante era
honesta; com dois, ela daria um mapa grande espelhado pelo eixo do pequeno, e a
assimetria apareceria exatamente no meio, onde os dois times se encontram.

O que torna um mapa novo barato é o teste: `test/arena.test.ts` roda **em laço
sobre a tabela**, então escrever quarenta linhas de coordenadas já diz se elas
produzem um campo simétrico, alcançável, sem nada em cima d'água e com os
estrangulamentos que o mapa promete. Um mapa sem portão nenhum é legítimo — o
Vau existe para isso; o que não pode é prometer um estrangulamento e não
entregá-lo.

Na sala, o mapa é escolhido como o modo, e há um cartão **Sortear** que troca o
campo a cada partida. O sorteio vem da seed, e não de `Math.random`: a sequência
inteira é reproduzível a partir da primeira partida, que é o que permite repetir
um defeito em vez de contar história sobre ele.

### O menu, e a balança que é de verdade

O menu tinha o nome do jogo e cinco botões. Nada ali dizia o que o jogo **é** —
e o que ele é não é resgate, que todo mundo já viu, mas a balança: uma grandeza
conservada repartida entre dois reféns.

Agora a balança está no menu, com um baú pendurado em cada prato, e ela **pende
de verdade**. Atrás do menu já rodava uma partida de bots servindo de papel de
parede; é o peso daquela partida que inclina o fiel. Quem chega vê a barra
escorregar antes de apertar qualquer coisa e já sabe a regra — encheu de um
lado, aliviou do outro. Uma balança falsa oscilando por conta própria seria uma
promessa; esta é um retrato.

O baú é o mesmo desenho da partida, então o dia em que ele mudar de forma o menu
muda junto. E o painel escuro por trás não é enfeite: a primeira versão usava um
degradê suave, e por cima de um campo cheio de casa, árvore e boneco meia sombra
some — a balança lia como cenário, dois baús no chão e uma viga atravessada.

Abaixo dos botões há a tira das oito classes e a fita de números. A fita é lida
das **tabelas**: um menu que anuncia "quatro campos" continua anunciando quatro
no dia em que o quinto entrar, porque ninguém relê o menu. Lido da tabela, ele
conta cinco sozinho.

A tira quase entrou com um defeito bobo: a moldura tinha largura fixa e
"Saqueador" saía cortado nos cinco tamanhos de tela — setenta e dois casos do
mesmo erro, todos apontados por `tools/tamanhos.mjs` numa passada. A moldura
passou a se ajustar ao nome, que também resolve a próxima classe de nome
comprido antes de ela existir.

### As telas

Menu → cabine → escolha de lado → jogo.

**O menu não tem fundo: o fundo é o jogo.** A página conecta ao servidor assim
que abre, entra como plateia numa sala que já está rodando e desenha a partida
atrás do título, com uma câmera que persegue o que decide o jogo — o cortejo da
baú primeiro, o baú caído depois, o maior amontoado **com os dois
times** em seguida e, se ninguém estiver se esbarrando, o maior grupo de gente
que houver. É o modo atração do fliperama, e num jogo só multiplayer ele responde
sem texto a pergunta que todo mundo faz ao abrir: *tem alguém jogando aí?*

O último degrau dessa lista já foi o centro de massa de todo mundo, o que parece
razoável e é o pior alvo possível: com os dois times cada um no seu canto, a
média dos dois é o meio do mapa — grama vazia. O menu passava minutos filmando
um lago sem ninguém. Filmar a fila do chapéu é pior que filmar a briga e muito
melhor que filmar o vazio, então o desempate final virou o amontoado mais cheio,
misturado ou não.

Quem assiste **não ocupa vaga** — uma aba esquecida no menu não pode tirar o
lugar de quem quer jogar. Só ao escolher um lado é que a pessoa senta à mesa. O
botão **Assistir** esconde o menu e deixa só a partida; `Esc` volta.

As ações ficam numa **coluna à esquerda**, botões gordos e coloridos no traço dos
jogos de sofá: as duas portas de entrada no alto e nas cores mais quentes, o
resto embaixo e menor. Uma coluna ordena as intenções de cima para baixo e deixa
o campo de batalha inteiro visível ao lado; uma barra no rodapé faria o oposto —
daria o mesmo peso a todos os itens e cortaria a parte de baixo do jogo. Os
painéis (apelido, como se joga, ajustes, créditos) abrem **ao lado** da coluna,
nunca por cima: ler as regras não pode esconder o botão de jogar. Os ajustes
gravam no navegador a cada clique, sem botão de salvar: campo de visão, nomes na
tela, mato ligado ou desligado, registro de eventos e o lado do manche.

A **escolha de lado** é uma camada por cima da partida já rodando, como no Super
Smash Bros. e no Overcooked: os dois reinos aparecem com as vagas preenchidas ao
vivo — quem é gente, quem é bot, quanto está o placar — e você decide vendo o
campo atrás do painel. `A`/`D` ou clique troca de lado, `Enter` entra. Escolher o
lado mais cheio é permitido; só o que está cheio de **gente** é recusado, e com o
motivo escrito. A lista de vagas rola por dentro da caixa e o botão de entrar
fica fixo no rodapé: a ação principal de uma tela nunca pode exigir rolagem para
aparecer.

### A tipografia: a gótica é do nome

O título usa a **BlackFlag**, e ela para aí. É uma gótica: bonita num nome de
três letras a setenta pixels, e ilegível em tudo o mais — "Assistir" escrito nela
num botão de dezoito pixels vira mancha, e um menu que exige esforço para ser
lido é um menu que atrasa quem quer jogar. O resto da interface usa a mesma
sem-serifa do jogo, em peso alto, que é como um jogo de sofá escreve os seus
botões.

### Caber em qualquer tela

O menu vira uma coluna só abaixo de 700 px de largura, e o gradiente passa a
descer em vez de atravessar, para o texto ter contraste no alto e no rodapé.
Abaixo de 520 px de **altura** — celular deitado, que é onde o sofá acontece —
somem os subtítulos dos botões e a assinatura: explicação é a primeira coisa a
ceder quando não cabe o que se clica. As vagas da cabine e os dois reinos da
escolha se acomodam com `auto-fit`, sem uma escada de breakpoints que sempre
erra o tamanho de alguém, e todo alvo de toque tem piso de 40 px.

No `canvas` a mesma ideia, à mão: a legenda da balança encurta, o cabeçalho da
sala vira `2+10 · 12 ms` quando encostaria no relógio, e os cartões do sofá
perdem o nome e a classe quando ficam estreitos demais para eles — o que sobra é
a cor da vaga e a barra de vida, que é o que não pode faltar.

### As sete classes: quatro que brigam, três que sustentam

Cada uma tem as folhas de animação dela no pacote Tiny Swords — parado, corrida e
o **gesto de golpe** próprio. Numa briga de doze bonecos, o movimento é o que diz
de longe quem é quem.

| classe | vida | golpe | o que faz |
|---|---|---|---|
| Guerreiro | 175 | espada em dois arcos que se alternam | acerta tudo à frente; segura ponte |
| Lanceiro | 130 | estocada, com folha por direção | fura a fila: atinge todos na linha, alcance 108 |
| Arqueiro | 95 | puxa o arco e solta | flecha a 520 de distância; frágil de perto |
| Clérigo | 110 | ergue o cajado, com aura no curado | cura o aliado mais ferido no alcance |
| Minerador | 125 | picareta | tira **ouro** da jazida |
| Lenhador | 130 | machado | tira **madeira** da árvore |
| Saqueador | 100 | faca, rápida | derruba a ovelha de carga e leva o **minério** |
| Aldeão | 90 | sem arma | é o padrão, e é infinito: junta de tudo 1,8× mais devagar |

### As três cadeias da economia

```
ovelha de carga → saqueador derruba (3 golpes) → minério no chão
       → Casa da Moeda (2 minérios) → cunhagem (6 s) → bolsa de moedas
       → cofre → entulha o baú refém → a balança pende

árvore → lenhador  (2,4 s parado) → madeira ┐
jazida → minerador (2,4 s parado) → ouro    ┴→ chapelaria → obra I → II → III
                                               (+15% de vida e dano por nível)
```

Saquear é a única coleta que se faz **atacando**: a ovelha corre com o alforje
nas costas, e o saqueador a derruba em três golpes — qualquer outra classe leva
o dobro do tempo e vira alvo fácil enquanto tenta. Nas jazidas é o contrário: andar cancela o trabalho, e é
isso que faz o ofício custar posição em vez de não custar nada.

A obra exige os **dois** materiais, de propósito: um time só de lenhador acumula
madeira e não levanta nada. É o único lugar do jogo que obriga dois ofícios
diferentes a existirem ao mesmo tempo.

Parte das jazidas fica dentro do castelo e parte no campo aberto, e as ovelhas
estão em maioria no meio do mapa: a economia mínima é segura, a economia que
**ganha** a balança exige sair de casa.

Longe do cofre, a bolsa vira o que todo dinheiro é: você gasta consigo, e isso
cura 45.

### Os efeitos: o que aconteceu, e o que a construção faz

O jogo mudava de estado sem avisar. Um aldeão virava arqueiro e o único sinal
era o boneco trocar de folha entre dois quadros — quem estava olhando para outro
canto da tela não via nada. A transformação é o segundo diferencial do jogo
inteiro (chapéu dá classe, chapéu cai, chapéu se rouba) e não tinha gesto
nenhum.

| acontecimento | o que se vê |
|---|---|
| vestir chapéu | estouro dourado, e o nome da classe subindo sobre a cabeça |
| roubar chapéu do inimigo | o mesmo estouro, maior, e "roubou Arqueiro" em vermelho |
| entulhar o baú | labareda **no baú**, que é o que mudou de peso |
| resgate | estouro grande em quem trouxe |
| a obra subir de nível | labareda na chapelaria e "obra II" na cor do reino |
| correr | um bafo de poeira sob os pés — respingo, se for na beira d'água |

Os efeitos nascem de **eventos do servidor**, e não de o desenho comparar dois
retratos. Comparar funcionaria e mentiria em dois casos: um pacote perdido junta
duas trocas num quadro só (um efeito para duas), e a previsão local pode desfazer
o que ela mesma previu (um efeito para nenhuma). A lista de eventos que o mural
de abates já lia dá a contagem certa de graça.

A poeira dos pés é a única exceção, e por um motivo: andar não é acontecimento,
é o estado normal de todo mundo o tempo todo, e mandar um evento por passo seria
pagar banda para dizer o óbvio. Ela é decidida no cliente, comparando a posição
com a do quadro anterior, e só para quem está dentro da câmera.

Cada construção ganhou também uma **placa**: um ícone numa chapa escura dizendo
o que se faz ali. O nome no telhado responde "que prédio é este?"; não responde
"o que eu ganho aqui?" — e essa é a pergunta de quem chegou agora, ainda mais na
chapelaria, que é onde se troca de classe e cujo nome não diz isso a ninguém. A
placa **acende** quando há algo a buscar: bolsa cunhada na Casa da Moeda, obra
com material para subir. Apagada, ela ainda diz o que o prédio é.

### O minimapa mostra o que o time está vendo

O canto de cima à direita traz o relevo, o seu time inteiro, as construções que
importam (tesouraria e cofre) e o retângulo do pedaço de mundo que está na sua tela.

O inimigo é outra história: ele só aparece **enquanto alguém do seu time está
vendo** — perto o bastante e sem parede no meio, pela mesma função de linha livre
que os bots usam para escolher alvo. É a soma dos olhos do time, e não os seus:
um companheiro do outro lado do mapa acende o ponto para todo mundo. Um minimapa
que mostrasse o inimigo o tempo todo trocaria o cerco por leitura de radar e
apagaria a emboscada do jogo.

A refém do seu reino é a exceção deliberada: ela aparece sempre, porque a bússola
já aponta para ela e escondê-la no mapa seria o mapa desmentir a seta.

Isto é névoa de **interface**, não de rede — o retrato do servidor ainda leva
todo mundo, e o recorte acontece na hora de desenhar. A regra mora em
`shared/vista.ts` justamente para o dia em que o recorte passar para o servidor:
é a mesma função, só muda quem a chama.

---

## Rodar

```sh
npm install
npm run dev          # cliente, na 5173
npm run dev:server   # servidor, na 8787
```

O cliente descobre sozinho para onde conectar: na 5173 ele procura o servidor na
8787; publicado, usa a própria origem.

Para rodar como em produção — um processo só, servindo o site e o WebSocket:

```sh
npm run build
npm start            # http://localhost:8787
```

### Testes

```sh
npm test                 # 164 testes de regra, rede, controle, câmera e bots
npm run check            # TypeScript, sem emitir
node tools/fumaca.mjs    # sobe um Chromium e joga com duas pessoas no sofá
node tools/tamanhos.mjs  # abre cada tela em cinco tamanhos e mede o que vazou
```

Os dois roteiros de navegador precisam do servidor no ar (`npm start`) e do
Chromium do Playwright.

O **teste de fumaça** entra no jogo como duas pessoas entrariam — uma no WASD,
outra nas setas —, anda, ataca, e reprova se alguma coisa escrever no console de
erro, se o relógio da partida não andar, se o cliente parar de mandar comando ou
se o sofá se dividir entre os dois reinos.

O **roteiro de tamanhos** abre o menu, os cinco painéis, a cabine e a escolha de
lado em monitor, notebook, tablet, celular em pé e celular deitado. Ele não julga
beleza: mede três coisas mecânicas — algo mais largo que a janela, um alvo de
toque com menos de 40 px de altura, e uma **ação final** fora da tela.

"Ação final" é marcada no HTML com `data-acao-final`, e não deduzida da estrutura,
porque a diferença é semântica. "Escolher o lado" é a razão de a cabine existir:
escondê-lo quebra a tela. "Abrir a sala", no meio de um painel com quatro modos
explicados e uma lista embaixo, é o botão de enviar de um formulário longo — rolar
até ele é o que se faz com formulário. Os dois estão dentro de algo que rola, então
nenhuma regra estrutural separa os dois; quem sabe qual é qual é quem desenhou a
tela, e por isso é a tela que declara.

É o tipo de defeito que só aparece no tamanho em que ninguém abriu, e que passa
despercebido justamente porque quem programa olha no monitor em que tudo cabe.

---

## Arquitetura

```
src/
  shared/       a simulação, e ela é a mesma dos dois lados
    regras.ts     todos os números do jogo, num arquivo só
    modos.ts      os sete modos, como dado e não como caminho de código
    mapas.ts      os quatro campos de batalha, idem
    classes.ts    as oito classes, o estoque de chapéus e os ofícios
    arena.ts      o mapa como função pura da seed
    estado.ts     os tipos da partida, sem nenhuma regra
    partida.ts    o tick autoritativo
    bots.ts       a IA, escrevendo o mesmo Comando que um humano
    navegacao.ts  campos de distância por BFS, um por destino
    protocolo.ts  o que trafega, em tuplas
  server/
    sala.ts       uma partida, os clientes e o preenchimento com bots
    lobby.ts      quantas salas existem e quem cai em qual
    index.ts      HTTP + WebSocket, no mesmo processo
  client/
    telas.ts      menu, cabine, ajustes e escolha de lado (em HTML)
    atracao.ts    para onde a câmera olha quando ninguém está jogando
    ajustes.ts    preferências, saneadas na leitura
    arte.ts       as folhas do pacote, por classe e por time
    rede.ts       previsão local e interpolação
    sofa.ts       até quatro pessoas num aparelho, uma conexão cada
    controles.ts  os dois teclados e os controles, em funções puras
    desenho.ts    o mundo em canvas 2D, e qual folha cada unidade usa
    hud.ts        a balança, o placar, o registro
    contexto.ts   o que o botão de contexto vai fazer, em português
    entrada.ts    teclado, mouse e dedo virando o mesmo comando
tools/
  importar-arte.mjs  traz do pacote Tiny Swords só a arte que o jogo desenha
  fumaca.mjs         teste de fumaça num Chromium de verdade
  tamanhos.mjs       as telas em cinco tamanhos, medindo o que vazou
  medir.ts           partidas de bot por modo e por mapa, para um humano ler
```

## A arte

Do pacote [Tiny Swords](https://pixelfrog-assets.itch.io/tiny-swords), de Pixel
Frog (grátis, "name your own price"; a licença permite uso e modificação em
projeto comercial e proíbe redistribuir o pacote).

`tools/importar-arte.mjs` copia só o que entra na tela e **renomeia para o
vocabulário do jogo** — Warrior vira `guerreiro`, Monk vira `clerigo`, o Pawn com
machado vira `lenhador` — para que o inglês do pacote não apareça no meio de um
`switch` em português:

```sh
node tools/importar-arte.mjs "/caminho/para/Tiny Swords (Free Pack)"
```

O terreno segue o [guia de tilemap](https://pixelfrog-assets.itch.io/tiny-swords/devlog/1138989/tilemap-guide)
do próprio pacote: grade de 64 px, e as camadas na ordem que ele prescreve —
cor de fundo (água), espuma, chão plano. A espuma é de 128 px desenhada sobre a
grade de 64 e **transborda de propósito**, com cada instância começando num
quadro diferente, como o guia pede. Elevação e escadas, que o guia também
descreve, ficaram de fora: este mapa é de um nível só, e o fosso faz o papel do
desnível.

### Três decisões que sustentam o resto

**1. O mapa não trafega.** A arena é uma função pura da seed; servidor e cliente
rodam o mesmo `criarArena` e chegam ao mesmo tile. O servidor manda um número.

**2. O cliente prevê o próprio movimento, e só isso.** `moverUnidade` é a mesma
função nos dois lados: o cliente aplica o comando na hora, guarda-o numa fila e
refaz a conta quando o retrato chega. Dano, resgate e depósito só existem depois que
o servidor disse que existem — prever dano só produz mortes que voltam à vida.

**3. O tick não sorteia nada.** Nenhuma decisão da simulação usa aleatoriedade,
nem no dano, nem nos bots. É o que torna um replay possível a partir da seed e da
lista de comandos, e o que faz "às vezes o carregador solta o baú" ser
reproduzível em vez de folclore.

### Números da rede

Retrato completo a 15 Hz, em tuplas: ~1,5 kB por pacote com doze unidades em
campo, ~22 kB/s por jogador. Retrato inteiro, e não diferença, porque quem perde
um pacote se conserta sozinho no próximo — delta exigiria confirmação, buffer de
reenvio e um bug de dessincronização esperando o dia de aparecer.

---

## Publicar

O `render.yaml` da raiz do repositório traz o serviço `balanca-do-reino`. Ao
contrário do cliente 2D do CyberKingdoms, que é site estático, este precisa de um
processo Node no ar: o estado que vale é o do servidor.

No plano gratuito do Render, um serviço web hiberna depois de quinze minutos sem
acesso e leva quase um minuto para acordar — num jogo em rede, é a diferença
entre entrar e desistir. Vale a pena o plano pago, ou aceitar que a primeira
pessoa a entrar no dia espere.
