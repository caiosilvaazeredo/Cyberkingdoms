# Steam

O jogo continua sendo o mesmo site de sempre — `main.js` abre uma janela do
Electron carregando a URL de produção (veja o comentário no topo do arquivo
para o porquê). Isto aqui é só o empacotamento e o que falta para a Steam.

## 1. Testar local

```
npm install
npm start
```

Por padrão conecta em `https://balanca-do-reino.onrender.com`. Para testar
contra um servidor local (`npm start` na raiz do projeto primeiro):

```
MEU_QUERIDO_REI_URL=http://localhost:8787 npm start
```

## 2. Steamworks (opcional, não quebra quem não tem Steam aberto)

`steamworks.js` está como dependência opcional — se a plataforma não tiver
binário pré-compilado, ou o `require` falhar por qualquer razão, `main.js`
captura o erro e segue sem nenhum recurso de Steam. O mesmo vale se o
cliente Steam não estiver rodando: `steamworks.init()` lança, é capturado, e
o jogo abre normal.

O que já está ligado, tudo rodando só no processo principal (a janela nunca
ganha `nodeIntegration` — ela carrega um site remoto):

- Overlay da Steam (Shift+Tab) via `electronEnableSteamOverlay()`.
- Rich Presence estático (`No Reino de Migalhas`) via `localplayer.setRichPresence`.

Para testar com o cliente Steam de verdade, sem ainda ter um App ID
aprovado, crie `electron/steam_appid.txt` com `480` (o App ID de teste
oficial da Valve, "Spacewar") e abra a Steam antes de rodar `npm start`.
Depois de ter um App ID de verdade (passo 3), troque o conteúdo do arquivo
para ele — ou passe direto pra `steamworks.init(SEU_APP_ID)` em `main.js`.

**A primeira conquista já está ligada de ponta a ponta**: "primeira
partida", ID `PRIMEIRA_PARTIDA`. `src/client/main.ts` guarda em
`localStorage` a primeira vez que a própria pessoa termina uma partida (não
conta o modo atração atrás do menu) e chama
`window.steamworksBridge.primeiraPartida()` — uma função que só existe
porque `electron/preload.js` a expõe com `contextBridge`, a única porta
entre o site remoto e o processo principal (a janela continua sem
`nodeIntegration`). `main.js` recebe o aviso por IPC e chama
`client.achievement.activate('PRIMEIRA_PARTIDA')`, preso no mesmo try/catch
de sempre — sem Steam, sem App ID, ou com a conquista ainda não cadastrada
no painel, a chamada não faz nada e o jogo segue normal.

**Falta só um passo, e é só seu**: cadastrar uma conquista com o ID exato
`PRIMEIRA_PARTIDA` no painel do Steamworks (Steamworks → sua aplicação →
Estatísticas e conquistas), depois que tiver o App ID (passo 3). Sem isso
cadastrado, `activate` chama e não acontece nada — não é bug, é a conquista
não existir ainda do lado da Valve.

Para testar local sem gastar a única vez que o `localStorage` deixa passar:
`localStorage.removeItem('balanca.conquista.primeiraPartida')` no console
do DevTools (Ctrl+Shift+I na janela do Electron) antes de terminar outra
partida.

Uma conquista nova segue o mesmo caminho: um ID cadastrado no Steamworks, um
`client.achievement.activate('SEU_ID')` em `main.js` atrás de um `ipcMain.on`
próprio, e o gancho correspondente no cliente chamando
`window.steamworksBridge.suaFuncao?.()` — sempre com `?.`, porque fora do
Electron essa ponte não existe.

## 3. Conta Steamworks — o que só a sua conta consegue fazer

- **US$ 100** por jogo, taxa única (devolvida depois que o jogo arrecada
  US$ 1.000 em vendas).
- Cadastro em <https://partner.steamgames.com>, aceitar o Steam Distribution
  Agreement.
- Depois de aprovado, a Valve dá o **App ID** — é ele que entra no
  `steam_appid.txt` (ou em `steamworks.init(...)`) e no `appId` do
  `build` deste `package.json` se quiser automatizar.
- Classificação indicativa: o mesmo questionário IARC usado no Google Play
  serve aqui também.
- Ficha da loja: descrição, capturas de tela, capa, categoria ("Ação" ou
  parecido — o jogo é multiplayer, sem campanha solo).

## 4. SteamPipe — subir o build

A Valve distribui o `steamcmd` e o app `SteamPipeGUI`/`steamcmd` builder
pelo próprio Steamworks (exige login com a conta de parceiro, por isso não
dá pra automatizar daqui). Sequência, depois que a conta tiver o App ID:

```
npm run dist
```

Gera o instalável em `dist-electron/` (NSIS no Windows, AppImage no Linux,
`.app`/dmg no mac — configurado no bloco `build` deste `package.json`).
Depois:

1. Baixe o SDK do SteamPipe (Steamworks → área de parceiro → SteamPipe).
2. Configure um `app_build.vdf` apontando pra pasta de saída do `dist`.
3. Rode `steamcmd +login <usuário> +run_app_build ...` (documentado dentro
   do próprio painel do Steamworks, muda pouco entre versões — siga o passo
   a passo de lá).
4. Publique o "build" numa branch de teste antes de promover pra produção.

## 5. Depois de publicado

- `npm run dist` de novo a cada versão nova, repetindo o passo 4.
- Rich Presence e overlay já funcionam sem configuração extra da loja.
- "Primeira partida" só aparece para os jogadores depois de cadastrada no
  painel com o ID `PRIMEIRA_PARTIDA` (ver seção 2) — o código já está pronto
  e esperando por ela.
