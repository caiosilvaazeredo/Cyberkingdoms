import { defineConfig } from 'vite';

/**
 * O cliente é um site estático; o servidor é um processo Node à parte.
 *
 * Em desenvolvimento os dois rodam ao mesmo tempo — `npm run dev` sobe o Vite
 * na 5173 e `npm run dev:server` sobe o jogo na 8787. O cliente descobre para
 * onde conectar em tempo de execução (veja `src/client/net.ts`), então não há
 * proxy de WebSocket aqui: um proxy esconderia o endereço real e faria o erro
 * de conexão aparecer como "fechou sem motivo", que é o pior jeito de depurar
 * rede.
 *
 * Em produção o mesmo processo Node serve o `dist/` e aceita o WebSocket na
 * mesma porta, e aí origem do site e origem do socket coincidem.
 */
export default defineConfig({
  server: { port: 5173 },
  build: {
    outDir: 'dist',
    target: 'es2022',
    // A arte é pixel art de 64 px: nada aqui se beneficia de virar data URI, e
    // um sprite embutido no JS deixa de poder ser cacheado por nome.
    assetsInlineLimit: 0,
  },
});
