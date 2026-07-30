# CyberKingdoms

MMORPG mobile-first de **economia viva, política e sobrevivência** num futuro
cyberpunk distópico, construído em Flutter + Flame.

Cada campanha gera um **mundo procedural novo** a partir de uma seed: relevo,
biomas, 5 Capitais, 15 Satélites e a malha de estradas PvP que liga tudo.

---

## Estado atual

| Sistema | Situação |
|---|---|
| Geração procedural do mundo | Completo |
| Renderer isométrico 2.5D (Flame) | Completo |
| Sobrevivência + reset diário | Completo, com as tabelas do GDD |
| Economia de 3 camadas + mercados | Completo |
| Terrenos e 40 tipos de construção | Completo |
| Customização: nome, cor, níveis I–III, módulos | Completo |
| Identidade do vilarejo (brasão, cores, lema) | Completo |
| Campanha principal com 17 quests | Completo |
| Combate determinístico | Completo |
| Política, eleições e rebeliões | Completo |
| Áudio: trilha em loop, efeitos e combate | Completo |
| Multiplayer real (Firestore) | **Pendente** — ver "Backend" |

242 testes automatizados cobrindo determinismo, balanceamento, regras de
construção, quests, persistência, navegação, layout em cinco tamanhos de tela e
capturas de tela versionadas.

---

## Arquitetura

```
lib/
  core/seed/      RNG determinístico e ruído de gradiente
  domain/
    world/        Geração procedural, biomas, cidades, estradas
    building/     Terrenos, construções, módulos e identidade do vilarejo
    survival/     Fome/Sede — tabelas literais do GDD
    economy/      Itens, receitas, inventário, mercados
    politics/     Governo, eleições, rebeliões
    combat/       Resolução determinística de PvP
    campaign/     Estado da campanha, quests e o motor do reset diário
  game/           Camada Flame: projeção isométrica e catálogo de sprites
  data/           Repositórios (local e Firestore)
  state/          Providers Riverpod
  ui/             Telas e widgets
tools/
  sprite-renderer/  Pipeline GLB → sprite isométrico
  audio-synth/      Síntese da trilha e dos efeitos de combate
```

### Duas decisões que sustentam o resto

**1. O terreno não é salvo.** O mundo é uma função pura `(seed, x, y) → tile`,
como no Minecraft. Um mundo infinito custa zero bytes em disco, e dois
dispositivos com a mesma seed enxergam exatamente o mesmo mapa — condição
necessária para o servidor validar o que o cliente afirma ter feito. Só a
macroestrutura (posição das cidades e traçado das estradas), que depende de uma
visão global do mapa, é persistida.

**2. Tudo é determinístico e roda em 32 bits.** O RNG usa Mulberry32 com
multiplicação decomposta em metades de 16 bits. Isso não é preciosismo: na web
o Dart compila `int` para double IEEE-754, e um gerador de 64 bits produz um
mundo diferente no navegador — ou simplesmente não compila. Ver
`lib/core/seed/deterministic_random.dart`.

---

## Assets

Todos os sprites vêm de kits da **Kenney** (CC0). Os kits 3D são
pré-renderizados em projeção isométrica 2:1 pelo pipeline em
`tools/sprite-renderer/`; ver o README de lá para o porquê.

| Pacote | Uso |
|---|---|
| Castle Kit | Torres, muros, cercos, ruínas |
| Mini Dungeon | Interiores, baús, personagens, subsolo |
| Mini Forest | Vegetação, acampamentos, terreno natural |
| Starter Kit City Builder | Prédios urbanos, ruas, pavimento |
| Starter Kit Basic Scene | Arena, colunas, personagem soldado |
| UI Pack: Space Expansion | Barras vitais e painéis do HUD |
| Fantasy UI Borders | Molduras de seção |
| UI Pack Adventure | Ícones de minimapa e bússola |
| Input Prompts | Ícones de toque |
| UI Audio | Cliques, toggles e navegação |
| RPG Audio | Moedas, construção, viagem, passos |
| Music Jingles | Quest concluída, promoção, obra pronta, fim de dia |

A **trilha de fundo** e os **efeitos de combate** não vêm de pack: são
sintetizados por `tools/audio-synth/synth.py`. O Voice-over Pack: Fighter foi
descartado — a locução de fliperama ("FIGHT!", "YOU WIN!") destoava do tom do
GDD, que é economia fria e sobrevivência, não torneio.

### Áudio

Três canais independentes — **efeitos**, **trilha/jingles** e **combate** —
cada um desligável em separado, com volume geral e volume próprio da trilha. O
controle fica no HUD, não enterrado num menu: som em jogo de celular precisa ser
silenciável no instante em que incomoda.

Três trilhas em loop, trocadas por contexto e não por tela — alternar a música a
cada aba chamaria atenção para a navegação em vez do mundo:

| Contexto | Trilha |
|---|---|
| Menu, cidade, mercado, política | `city` — 84 BPM, sem percussão, escura |
| Mundo aberto e terreno | `world` — 96 BPM, pulso constante |
| Estrada e combate | `tension` — 118 BPM, baixo insistente |

Os loops fecham dobrando a cauda de volta no início (`wrap_tail`): um loop
musicalmente exato ainda estala se o release do pad e a realimentação do delay
forem cortados na emenda.

O `AudioService` **nunca lança**. Se um arquivo faltar, se o navegador bloquear
a reprodução antes do primeiro gesto do usuário, ou se o dispositivo não tiver
saída, o jogo segue em silêncio. O preço dessa robustez é que um caminho errado
não aparece em runtime — por isso há um teste que confere que todo som
referenciado existe em disco, está declarado no `pubspec`, e que nenhum arquivo
empacotado ficou sem uso.

| Momento | Som |
|---|---|
| Troca de aba | clique curto |
| Escolher trabalho / construção | switch |
| Compra, venda, salário | moedas |
| Iniciar obra | metal |
| Evoluir construção, instalar módulo | trava metálica |
| Demolir | rangido |
| Viajar | porta abrindo |
| Andar no mundo | passos alternados |
| Emboscada na estrada | alerta seco + impacto + confirmação |
| Quest concluída | jingle chiptune |
| Promoção de nível | jingle chiptune |
| Morte permanente | drone sub que colapsa em 2,6s |

---

## Rodando

```sh
flutter pub get
flutter run -d chrome   # navegador (mais rápido para ver funcionando)
flutter run             # Android / iOS
flutter test            # 242 testes
```

Requer Flutter 3.35+ / Dart 3.9+.

**[→ Guia completo em RUNNING.md](RUNNING.md)** — instalação, emuladores,
builds de release, Firebase, re-render de sprites e solução de problemas.

---

## Backend

O app é **offline-first**: roda inteiro sem rede, guardando cada campanha num
JSON local. O código de nuvem já está escrito e apenas desligado.

Para conectar ao projeto Firebase `cyberkingdoms-f1142`:

```sh
dart pub global activate flutterfire_cli
flutterfire configure --project=cyberkingdoms-f1142
```

Isso sobrescreve `lib/firebase_options.dart` — hoje um placeholder com
`isConfigured = false` — com as chaves reais de cada plataforma. A partir daí o
app autentica anonimamente e usa `FirebaseCampaignRepository` sem que nenhuma
tela precise mudar.

**O que ainda falta para ser um MMO de verdade:** o Firestore hoje guarda o
estado do jogador. A economia compartilhada (livro de ofertas, governos,
eleições) precisa de escrita transacional e de um worker autoritativo rodando o
tick de 24h — o cliente não pode fechar o próprio dia num jogo com dinheiro em
disputa. O motor em `domain/campaign/daily_tick.dart` já é determinístico
exatamente para que esse worker possa recalcular o dia e comparar.

---

## Design

O jogo segue o GDD (Rev. 3.0) e o Endogenous Game Design Canvas do projeto. Os
números de balanceamento — consumo de Fome e Sede por atividade, custo de
viagem, efeito de estimulantes — estão transcritos literalmente em
`lib/domain/survival/survival_tables.dart` e cobertos por testes que validam o
exemplo resolvido do próprio documento.
