// O embrulho da Steam: uma janela do Electron carregando o mesmo site de
// sempre — não um cliente à parte, não uma cópia local dos arquivos.
//
// ## Por que carregar a URL ao vivo, e não empacotar `dist/` dentro do app
//
// `enderecoDoServidor()` (em `src/client/main.ts`) descobre o WebSocket do
// jogo a partir de `location.protocol`/`location.host` — o mesmo código que
// já funciona em qualquer navegador. Empacotar os arquivos e abrir por
// `file://` quebraria essa conta sem nenhum aviso (protocolo e host somem os
// dois), e a alternativa — ensinar o cliente a reconhecer Electron como um
// terceiro ambiente — seria mexer no coração da rede só para a Steam. Como o
// jogo é só multiplayer (sem servidor não tem partida, em navegador ou fora
// dele), abrir a URL de verdade custa a mesma internet que o jogo já exige e
// não pede nenhuma mudança no cliente.
const { app, BrowserWindow, Menu } = require('electron');
const path = require('node:path');

// Troca a URL para testar contra um servidor local — a build empacotada usa
// sempre a de produção.
const URL_DO_JOGO = process.env.MEU_QUERIDO_REI_URL ?? 'https://balanca-do-reino.onrender.com';

// steamworks.js é opcional e roda só aqui no processo principal — a janela
// continua sem nodeIntegration, então nada disto fica exposto ao site
// carregado. Sem o pacote instalado, sem steam_appid.txt ou sem o cliente
// Steam aberto, tudo aqui vira no-op e o jogo segue normal (ver LEIA-ME.md).
let steamworks = null;
try {
  steamworks = require('steamworks.js');
} catch {
  steamworks = null;
}

let steamClient = null;

function iniciarSteam() {
  if (!steamworks) return;
  try {
    // Precisa vir antes de app ficar "ready": é quem liga o overlay
    // (Shift+Tab) sobre a janela do Electron.
    steamworks.electronEnableSteamOverlay();
    steamClient = steamworks.init();
    steamClient.localplayer.setRichPresence('status', 'No Reino de Migalhas');
  } catch {
    steamClient = null;
  }
}

iniciarSteam();

function criarJanela() {
  const janela = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: '#10121a',
    icon: path.join(__dirname, '..', 'public', 'pwa', 'icone-512.png'),
    autoHideMenuBar: true,
    webPreferences: {
      // A janela carrega um site remoto — trata-lo como qualquer página da
      // internet, sem acesso a Node, é a postura padrão do Electron para
      // isto e não há razão para abrir exceção aqui.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  janela.loadURL(URL_DO_JOGO);
}

// Sem menu: "Edit"/"View"/"Window" são sobra do template padrão do Electron
// e não servem a um jogo — o title bar de um app de sofá não precisa deles.
Menu.setApplicationMenu(null);

app.whenReady().then(criarJanela);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) criarJanela();
});
