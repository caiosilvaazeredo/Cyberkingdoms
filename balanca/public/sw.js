// Service worker mínimo: existe para o jogo poder ser instalado (PWA no
// Google Play via TWA), não para jogar offline — sem servidor não tem
// partida, e fingir que dá seria pior que não ter cache nenhum.
//
// Estratégia: stale-while-revalidate para pedidos GET da própria origem.
// Serve do cache na hora (carregamento instantâneo numa segunda visita) e
// atualiza em paralelo — a versão nova aparece sozinha na próxima abertura,
// sem risco de alguém preso numa versão velha do jogo para sempre.
const CACHE = 'meu-querido-rei-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((chaves) => Promise.all(chaves.filter((c) => c !== CACHE).map((c) => caches.delete(c))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (evento) => {
  const pedido = evento.request;
  // O WebSocket do jogo nunca passa por aqui — só GET normal, e só da
  // própria origem: pedir a um CDN de fora com stale-while-revalidate
  // guardaria coisa que este jogo nem usa.
  if (pedido.method !== 'GET' || new URL(pedido.url).origin !== self.location.origin) return;

  evento.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const doCache = await cache.match(pedido);
      const daRede = fetch(pedido)
        .then((resposta) => {
          if (resposta.ok) cache.put(pedido, resposta.clone());
          return resposta;
        })
        .catch(() => doCache);
      return doCache ?? daRede;
    }),
  );
});
