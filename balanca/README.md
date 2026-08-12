# A Balança do Reino

Um jogo de resgate por times, jogado só em rede, feito com a base do
CyberKingdoms: a mesma arte Tiny Swords, o mesmo gerador determinístico, o mesmo
jeito de escrever TypeScript. É o esqueleto do **Fat Princess** do PS3 — dois
castelos, duas princesas, chapéus que dão classe — com uma regra nova no meio,
que muda a conta do jogo inteiro.

---

## O diferencial: o peso é uma balança só

No original, bolo é defesa. Você engorda a princesa presa na sua masmorra para
que o inimigo não consiga carregá-la de volta, e o cálculo acaba aí.

Aqui o peso do reino é **conservado**. As duas princesas dividem uma balança:
a soma dos dois pesos é sempre a mesma. Cada fatia que você dá à refém tira
exatamente aquele peso da **sua** princesa, presa do outro lado do mapa.

Uma fatia é ataque e defesa no mesmo gesto:

| o que você faz | o que acontece na sua masmorra | o que acontece no seu resgate |
|---|---|---|
| dá uma fatia à refém | ela engorda: o inimigo precisa de mais carregadores e anda mais devagar | a sua princesa emagrece: o seu resgate fica mais barato |

E o inimigo está fazendo a mesma coisa na direção contrária. A barra no alto da
tela é literalmente um cabo de guerra, e é o placar que mais se olha durante a
partida — inclusive porque ela **desempata** o jogo: acabado o tempo com o
placar igual, ganha o reino cuja princesa está mais leve.

O que fecha o desenho é o custo. Bolo não nasce do chão: sai de trigo que um
aldeão colheu e levou à cozinha, e aldeão colhendo é um a menos segurando a
ponte. Dominar a balança se paga em gente.

### O segundo diferencial: chapéu cai, e chapéu se rouba

A classe vem do chapéu, como no original — mas o estoque é finito e o chapéu
**cai no chão** quando o dono morre. Quem passar pega, inclusive o inimigo. Um
time que domina as trocas não só mata mais: desmonta a composição do outro e
veste a própria com o que roubou. "O vermelho não tem mais magos" vira uma coisa
que aconteceu na partida, não um número no menu.

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

Traga a **sua** princesa da masmorra inimiga até o seu trono. Três resgates
vencem; doze minutos no relógio.

| tecla | ação |
|---|---|
| `W` `A` `S` `D` | andar |
| mouse | mirar (dá para recuar atirando) |
| clique / `J` | atacar |
| `E` / botão direito | usar: pegar, entregar, alimentar, vestir, colher |
| `Tab` | placar |

No celular: manche na metade esquerda da tela, botões na direita.

O botão de contexto é um só, e a dica no rodapé diz sempre o que ele vai fazer.

### As cinco classes

| classe | vida | o que faz |
|---|---|---|
| Aldeão | 90 | colhe trigo e abastece a cozinha; é o padrão, e é infinito |
| Guerreiro | 170 | aguenta pancada e segura ponte |
| Arqueiro | 95 | fura a linha de longe, frágil de perto |
| Mago | 80 | bola de fogo lenta que estoura em área |
| Sacerdote | 105 | cura — ganha partida sem matar ninguém |

### O ciclo do bolo

```
trigal → aldeão colhe (2,2 s parado) → cozinha (3 trigo por bolo)
      → forno (6 s) → bolo → masmorra → fatia → a balança pende
```

Andar cancela a colheita: colher é o momento em que o aldeão está indefeso, e é
isso que faz a economia do bolo custar posição em vez de não custar nada.

Dois trigais ficam dentro de cada castelo e dois no campo aberto, mais dois no
meio do mapa. A economia mínima é segura; a economia que **ganha** a balança
exige sair de casa.

Longe da masmorra, o bolo vira o que qualquer bolo é: comida. Comer cura 45.

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
npm test             # 49 testes de regra, rede e comportamento dos bots
npm run check        # TypeScript, sem emitir
node tools/fumaca.mjs  # sobe um Chromium, entra numa partida e confere
```

O teste de fumaça precisa do servidor no ar (`npm start`) e do Chromium do
Playwright. Ele entra no jogo como uma pessoa entraria, anda, ataca, e reprova se
alguma coisa escrever no console de erro, se o relógio da partida não andar ou se
o cliente parar de mandar comando.

---

## Arquitetura

```
src/
  shared/       a simulação, e ela é a mesma dos dois lados
    regras.ts     todos os números do jogo, num arquivo só
    arena.ts      o mapa como função pura da seed
    partida.ts    o tick autoritativo
    bots.ts       a IA, escrevendo o mesmo Comando que um humano
    navegacao.ts  campos de distância por BFS, um por destino
    protocolo.ts  o que trafega, em tuplas
  server/
    sala.ts       uma partida, os clientes e o preenchimento com bots
    lobby.ts      quantas salas existem e quem cai em qual
    index.ts      HTTP + WebSocket, no mesmo processo
  client/
    rede.ts       previsão local e interpolação
    desenho.ts    o mundo em canvas 2D com a arte Tiny Swords
    hud.ts        a balança, o placar, o registro
    entrada.ts    teclado, mouse e dedo virando o mesmo comando
```

### Três decisões que sustentam o resto

**1. O mapa não trafega.** A arena é uma função pura da seed; servidor e cliente
rodam o mesmo `criarArena` e chegam ao mesmo tile. O servidor manda um número.

**2. O cliente prevê o próprio movimento, e só isso.** `moverUnidade` é a mesma
função nos dois lados: o cliente aplica o comando na hora, guarda-o numa fila e
refaz a conta quando o retrato chega. Dano, resgate e fatia só existem depois que
o servidor disse que existem — prever dano só produz mortes que voltam à vida.

**3. O tick não sorteia nada.** Nenhuma decisão da simulação usa aleatoriedade,
nem no dano, nem nos bots. É o que torna um replay possível a partir da seed e da
lista de comandos, e o que faz "às vezes o carregador solta a princesa" ser
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
