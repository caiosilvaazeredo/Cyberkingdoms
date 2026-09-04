# Meu Querido Rei — port para Unity, PlayFab e Xbox de PC

Este diretório é o começo de um port completo do jogo (hoje TypeScript/Canvas em
`balanca/`) para Unity/C#, com o objetivo de publicar em Steam, Google Play e —
o motivo do port — no **Microsoft Store como jogo, categoria Jogos, via GDK for
PC**, hospedado na **PlayFab**.

Continua o mesmo jogo: mesmo design, mesmas regras, mesmos assets do Tiny
Swords. Muda a implementação por baixo.

## Por que Unity, e não manter TypeScript

A pesquisa do documento anterior (`Do Navegador ao Console`) tinha assumido que
dava para embrulhar o cliente web (Electron/TWA) e manter o servidor Node. Duas
coisas mudam essa conta:

1. **GDK for PC** (o caminho self-serve, sem precisar de ID@Xbox, que coloca o
   jogo na categoria "Jogos" da Microsoft Store/app Xbox no PC) é uma SDK
   nativa Win32 — não existe forma de apontar um `MicrosoftGame.config` para um
   processo Electron. Precisa de um executável que fale a API do GDK de
   verdade.
2. **PlayFab Multiplayer Servers** — o GSDK (Game Server SDK) que o processo
   do servidor precisa rodar para ser gerenciado pela PlayFab só tem suporte
   oficial em **C++, C# e Java**. Node.js não é suportado oficialmente; existem
   implementações comunitárias experimentais para outras linguagens, mas
   nenhuma para Node — apostar nisso seria construir e manter uma ponte não
   oficial para o coração da infraestrutura de rede do jogo.

Dado que os dois pontos mais duros do pedido (GDK for PC e PlayFab) já
empurram para C#, a escolha de engine que resolve os **três** destinos de uma
vez — Xbox (GDK for PC), Steam (Steamworks.NET) e Google Play (export Android
nativo) — é o Unity: suporte oficial a GDK for PC, SDK oficial da PlayFab para
Unity, e é o motor mais natural para um jogo 2D top-down com folhas de sprite
como as do Tiny Swords/Enemy Pack já usadas no projeto.

## O que muda de arquitetura

| | hoje (`balanca/`) | depois (`meu-querido-rei-unity/`) |
|---|---|---|
| linguagem | TypeScript | C# |
| cliente | Canvas 2D + Vite | Unity (2D) |
| servidor | Node + `ws` | processo C# com o GSDK da PlayFab |
| hospedagem | Render, um processo | PlayFab Multiplayer Servers (container Linux) |
| protocolo | JSON sobre WebSocket | a definir — provavelmente ainda um payload compacto próprio, transportado pelo canal que a PlayFab aloca, mantendo a mesma filosofia de retrato completo por tick (ver `protocolo.ts`) |

A simulação em si — `shared/` inteiro — é o que está sendo portado primeiro,
porque é o que menos depende de decisão de infraestrutura e o que mais precisa
estar certo. `partida.ts`, `arena.ts`, `pve.ts`, `bots.ts` viram bibliotecas
C# puras, testáveis com `dotnet test`, sem nenhuma dependência de Unity ou da
PlayFab — a mesma separação que `shared/` já tem hoje em relação a
`client/`/`server/`.

## O anticheat

A pesquisa não achou um anticheat open-source maduro que sirva aqui. O que
existe:

- **Easy Anti-Cheat / BattlEye**: gratuito ou barato, mas fechados (não são
  open-source) e pensados para jogos nativos C++ com ameaça de aimbot/ESP —
  overkill para um jogo cooperativo-competitivo em vista de cima.
- **TLAC, UltimateAntiCheat, NoMercy, Open-ByteAntiCheat**: projetos
  open-source reais, mas todos client-side, nível de kernel/usermode, C++,
  Windows ou Linux nativo — não fazem sentido plugados num jogo cujo cliente é
  (por enquanto) uma tela 2D sem processos a inspecionar por baixo.
- **OACS (Open Anti Cheat System)**: o mais próximo em filosofia — framework
  Python de detecção server-side por estatística — mas é um framework de
  pesquisa, não uma biblioteca para importar num servidor de produção.

Conclusão: nenhum se encaixa sem adaptação maior do que escrever um do zero
usando a defesa que o jogo já tem. Implementando aqui, como parte do próprio
servidor C# (`MeuQueridoRei.Simulacao.Anticheat`):

1. **Servidor autoritativo** (já é assim desde a versão TypeScript) — o
   cliente nunca decide dano, morte ou depósito.
2. **Validação de borda**: velocidade máxima por classe, detecção de
   teleporte (posição impossível de alcançar desde o último tick, com folga
   para lag), limite de taxa por tipo de comando.
3. **Heurística com pontuação de suspeita**: cada jogador acumula uma
   pontuação por padrão fora da curva — não bane sozinho, só sinaliza; decidir
   o limiar de banimento automático é uma escolha de produto para depois de
   observar dados reais.

## O que este ambiente consegue verificar, e o que não consegue

Este é um ambiente Linux sem interface gráfica. Instalei o SDK do .NET 8 e
consigo compilar e **rodar testes de verdade** (`dotnet test`) para tudo que
for biblioteca C# pura — é assim que a simulação portada vai ser verificada,
com o mesmo rigor que os testes Vitest tinham na versão TypeScript.

O que este ambiente **não** consegue fazer, e por quê:

- **Abrir o Unity Editor** — não há instalação do Unity aqui (é um instalador
  de alguns GB com ativação de licença e interface gráfica). O scaffold do
  projeto Unity vai ser preparado como arquivos (`Assets/`, scripts C#,
  `Packages/manifest.json`), mas só abre e roda de verdade no Editor, na sua
  máquina.
- **Falar com a PlayFab de verdade** — GSDK precisa de um Title ID e de uma
  build registrada na sua conta PlayFab. Vou preparar o código de integração,
  mas o registro em si (criar o title, subir o container, configurar a build)
  só você consegue fazer, com as suas credenciais.
- **Empacotar para o GDK for PC** — exige Windows com o Gaming Services
  Runtime e o próprio GDK instalados, mais uma conta no Partner Center. Vou
  deixar o `MicrosoftGame.config` e o passo a passo prontos; rodar
  `MakePkg`/enviar o pacote é em máquina Windows.
- **Buildar para Steam ou Android de verdade** — mesma lógica: o código e a
  configuração ficam prontos aqui, o build final roda no Unity Editor da sua
  máquina (ou numa esteira de CI que você configurar).

Em resumo: aqui portamos e testamos de verdade **o jogo em si** (a parte que
mais importa errar). O que só existe fora deste ambiente (Editor, contas,
Windows) fica documentado com precisão suficiente para você (ou uma sessão
futura já com esses acessos) executar sem adivinhar nada.

## Roteiro

1. ~~Decidir e documentar a arquitetura~~ — este arquivo.
2. Portar `regras.ts`/`classes.ts`/`mapas.ts` → constantes e tabelas C#.
3. Portar `rng.ts` e os tipos de `estado.ts`.
4. Portar `arena.ts`, com os testes equivalentes aos de `arena.test.ts`.
5. Portar `partida.ts` — o tick da simulação, em fatias.
6. Portar `pve.ts`, `bots.ts`, `modos.ts`, `protocolo.ts`.
7. Anticheat: implementar como parte do servidor C#.
8. Integrar o GSDK da PlayFab (precisa da sua conta a partir daqui).
9. Scaffold do projeto Unity (cliente) — Assets, scripts, import dos sprites.
10. Documentar o empacotamento: GDK for PC (Xbox), Steamworks.NET (Steam),
    export Android (Google Play).

Cada passo entra numa tarefa rastreada; o estado atual está sempre visível na
lista de tarefas da sessão.
