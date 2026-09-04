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

**Conquistas não estão implementadas ainda.** A API é
`client.achievement.activate('ID_DA_CONQUISTA')`, mas conquistas só existem
depois de cadastradas no painel do Steamworks (passo 3), e disparar uma no
momento certo (ex.: primeira partida vencida) pede um sinal vindo do
cliente do jogo — hoje o processo principal do Electron não sabe nada sobre
o estado da partida, só abre a janela. Se quiser isso, é um gancho pequeno
e opcional no cliente (`src/client/`) chamando de volta pro processo
principal, não precisa mexer no resto do jogo.

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
- Conquistas (se forem implementadas) precisam ser cadastradas no painel
  antes de aparecer para os jogadores.
