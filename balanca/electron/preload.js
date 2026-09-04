// A única porta entre o site carregado e o processo principal — e só essa
// porta, porque a janela roda com contextIsolation e sem nodeIntegration
// (ver main.js). Sem isto, um site remoto nunca teria como avisar a Steam de
// nada; com isto, ele só ganha uma função, não o Node inteiro.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('steamworksBridge', {
  // src/client/main.ts chama isto uma vez, na primeira partida que a pessoa
  // termina — guardado por `localStorage`, então mesmo com o jogo reaberto
  // dez vezes isto só sai daqui uma vez de verdade. Sem Steam, sem App ID ou
  // sem a conquista cadastrada no Steamworks, o `ipcMain.on` do lado de
  // main.js engole o pedido sozinho — ver o comentário lá.
  primeiraPartida: () => ipcRenderer.send('conquista:primeira-partida'),
});
