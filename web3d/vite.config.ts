import { resolve } from 'node:path';

import { defineConfig } from 'vite';

/**
 * Configuração de build.
 *
 * ## Por que existe, se antes não existia
 *
 * O Vite acha o `index.html` sozinho e, enquanto o projeto tinha uma página só,
 * não havia o que configurar. A página de teste de arte quebrou essa premissa:
 * ela mora em `preview.html` e, sem ser declarada aqui, **não entra no
 * `dist/`** — funciona no servidor de desenvolvimento e some no site publicado.
 * É a classe de defeito que só aparece em produção, e depois do deploy.
 */
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        principal: resolve(__dirname, 'index.html'),
        preview: resolve(__dirname, 'preview.html'),
      },
    },
    // O `three` sozinho passa de 500 kB e o aviso do Rollup vira ruído em todo
    // build. Separá-lo num pedaço próprio também ajuda o cache do navegador: a
    // biblioteca não muda entre deploys, o código do jogo muda toda vez.
    chunkSizeWarningLimit: 900,
  },
});
