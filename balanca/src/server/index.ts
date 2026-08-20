import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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

/**
 * A pasta publicada, achada a partir **deste arquivo** e não do diretório de
 * trabalho.
 *
 * `process.cwd()` é o que quem chamou o processo escolheu, e nem sempre é a
 * raiz do projeto: um serviço de nuvem que inicie o processo de um degrau acima
 * transforma um jogo inteiro em erro 503, e a mensagem que sobra ("compile o
 * cliente") aponta para o lugar errado. O caminho do módulo não depende de
 * quem chamou.
 */
const RAIZ = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../dist');

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

  if (!existe) {
    // Um pedido com extensão é um **arquivo**: se não existe, a resposta certa
    // é 404. Devolver o `index.html` no lugar dele — que é o que o roteador de
    // página única faz com as outras rotas — troca "faltou o PNG" por "esta
    // imagem não pode ser decodificada", que é a mesma falha contada de um
    // jeito que ninguém consegue depurar.
    if (extname(pedido) !== '') {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`não existe: ${pedido}`);
      return;
    }
    // Rota sem extensão é navegação: o cliente tem uma página só e resolve o
    // resto no navegador.
    enviarArquivo(res, join(RAIZ, 'index.html'));
    return;
  }
  enviarArquivo(res, caminho);
}

function enviarArquivo(res: ServerResponse, arquivo: string): void {
  const tipo = TIPOS[extname(arquivo)] ?? 'application/octet-stream';
  // Os nomes em `assets/` levam hash do conteúdo: mudou o código, mudou o nome,
  // então podem ser guardados para sempre. O resto não tem hash e precisa ser
  // reconferido a cada visita.
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
    time: null,
    assistindo: false,
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
        sala = lobby.acolher(cliente, {
          assistindo: msg.assistindo === true,
          // O nome da sala vem de fora e é usado para **procurar** uma sala que
          // já existe, nunca para criar uma: no pior caso o pedido não acha
          // nada e é recusado. O corte de tamanho é só para o log não virar
          // despejo de texto de quem estiver brincando com o protocolo.
          ...(typeof msg.sala === 'string' ? { sala: msg.sala.slice(0, 40) } : {}),
          privada: msg.privada === true,
        });
        if (!sala) ws.close();
        return;
      }
      case 'escolherTime': {
        if (!sala) return;
        sala.tocar(chave);
        if (msg.time !== 'azul' && msg.time !== 'vermelho') return;
        // O apelido chega aqui, e não no `entrar`: a conexão foi aberta pelo
        // menu, como plateia, antes de a pessoa dizer como quer ser chamada.
        if (msg.nome !== undefined) cliente.nome = apelido(msg.nome);
        sala.escolher(chave, msg.time);
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
  console.log(`Reino de Migalhas ouvindo em http://localhost:${PORTA}`);
  // O caminho vai para o log de propósito: quando a arte some em produção, a
  // primeira pergunta é sempre "de onde este processo está servindo?".
  console.log(existsSync(RAIZ) ? `servindo ${RAIZ}` : `SEM cliente compilado em ${RAIZ}`);
});
