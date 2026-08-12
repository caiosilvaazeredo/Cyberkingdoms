import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';

import { Lobby } from './lobby';
import type { Cliente } from './sala';
import { VERSAO_DO_PROTOCOLO, type DoCliente, type DoServidor } from '../shared/protocolo';

/**
 * O processo do servidor: serve o site e aceita os jogadores.
 *
 * ## Um processo só, e não dois
 *
 * O site estático e o WebSocket vivem na mesma porta. Poderiam ser um CDN e um
 * serviço separados, e num jogo grande seriam — mas aqui a mesma origem elimina
 * a classe inteira de problemas de CORS e de "funciona no meu computador e não
 * no celular", e um jogo que não conecta é um jogo que não existe.
 *
 * Em desenvolvimento o Vite serve o cliente na 5173 e este processo continua
 * respondendo na 8787; o cliente descobre para onde ir sozinho.
 */

const PORTA = Number(process.env.PORT ?? 8787);
const RAIZ = resolve(process.cwd(), 'dist');

const lobby = new Lobby();
lobby.ligar();

const TIPOS: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const servidor = createServer((req, res) => {
  if (req.url === '/salas') {
    responderJson(res, { salas: lobby.lista, versao: VERSAO_DO_PROTOCOLO });
    return;
  }
  if (req.url === '/saude') {
    responderJson(res, { ok: true, salas: lobby.quantidade });
    return;
  }
  servirArquivo(req, res);
});

function responderJson(res: ServerResponse, corpo: unknown): void {
  const texto = JSON.stringify(corpo);
  res.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(texto);
}

function servirArquivo(req: IncomingMessage, res: ServerResponse): void {
  if (!existsSync(RAIZ)) {
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('O cliente ainda não foi compilado. Rode `npm run build`.');
    return;
  }
  const pedido = (req.url ?? '/').split('?')[0]!;
  // `normalize` depois de juntar, e a conferência de prefixo depois disso: é o
  // que impede `/../../etc/passwd` de sair da pasta publicada.
  const caminho = normalize(join(RAIZ, decodeURIComponent(pedido)));
  const dentro = caminho.startsWith(RAIZ);
  const existe = dentro && existsSync(caminho) && statSync(caminho).isFile();
  // Qualquer rota desconhecida cai no `index.html`: o cliente tem uma página só
  // e resolve o resto no navegador.
  const arquivo = existe ? caminho : join(RAIZ, 'index.html');
  const tipo = TIPOS[extname(arquivo)] ?? 'application/octet-stream';
  const cache = arquivo.includes(`${join('assets')}`)
    ? 'public, max-age=31536000, immutable'
    : 'no-cache';
  res.writeHead(200, { 'content-type': tipo, 'cache-control': cache });
  createReadStream(arquivo).pipe(res);
}

const wss = new WebSocketServer({ server: servidor, maxPayload: 4096 });

let proximaChave = 1;

wss.on('connection', (ws: WebSocket) => {
  const chave = `c${proximaChave++}`;
  let sala: ReturnType<Lobby['acolher']> = null;

  const cliente: Cliente = {
    chave,
    nome: 'Anônimo',
    unidade: null,
    silencio: 0,
    enviar(msg: DoServidor) {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    },
    fechar() {
      ws.close();
    },
  };

  ws.on('message', (bruto) => {
    let msg: DoCliente;
    try {
      msg = JSON.parse(String(bruto)) as DoCliente;
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;

    switch (msg.t) {
      case 'entrar': {
        if (sala) return;
        if (msg.versao !== VERSAO_DO_PROTOCOLO) {
          cliente.enviar({ t: 'recusado', motivo: 'versão do jogo diferente — recarregue a página' });
          ws.close();
          return;
        }
        cliente.nome = apelido(msg.nome);
        sala = lobby.acolher(cliente);
        if (!sala) ws.close();
        return;
      }
      case 'comando':
        sala?.receber(chave, msg.c);
        return;
      case 'ping':
        sala?.tocar(chave);
        cliente.enviar({ t: 'pong', tempo: msg.tempo });
        return;
      case 'sair':
        ws.close();
        return;
      default:
        return;
    }
  });

  ws.on('close', () => {
    sala?.sair(chave);
  });
  ws.on('error', () => {
    sala?.sair(chave);
  });
});

/**
 * Um apelido que não pode estragar a tela de ninguém.
 *
 * O nome de um jogador aparece na tela de todos os outros, e por isso ele é
 * dado de fora — a categoria de entrada que menos merece confiança. Controle,
 * quebra de linha e comprimento saem aqui, na entrada, e não na hora de
 * desenhar: filtrar na saída significa lembrar de filtrar em todos os lugares
 * onde o nome aparece, e um dia alguém esquece.
 */
function apelido(bruto: unknown): string {
  const texto = typeof bruto === 'string' ? bruto : '';
  // eslint-disable-next-line no-control-regex
  const limpo = texto.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return limpo.slice(0, 16) || 'Anônimo';
}

servidor.listen(PORTA, () => {
  console.log(`A Balança do Reino ouvindo em http://localhost:${PORTA}`);
});
