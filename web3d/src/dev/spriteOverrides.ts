/**
 * Troca de modelo 3D em tempo de execução, para o modo Dev.
 *
 * ## O que este arquivo **não** faz, e por quê
 *
 * Ele não guarda o arquivo. Um `.glb` do kit da Kenney tem de centenas de KB a
 * vários MB; `localStorage` inteiro cabe em ~5 MB, e encher isso com um modelo
 * derrubaria o save da campanha junto. Gravar em IndexedDB resolveria o
 * tamanho e criaria outro problema: o jogo passaria a rodar com uma arte que
 * não está no repositório, e ninguém mais veria o mesmo jogo que você.
 *
 * Então a troca vale **para a sessão**, e a tela diz isso com todas as letras
 * junto com o caminho exato onde o arquivo tem de ser copiado para valer de
 * verdade. É a diferença entre uma ferramenta de experimentação honesta e uma
 * que promete persistência que não tem.
 */

/** Onde o carregador procura o modelo de um `spriteId`. */
export function defaultModelUrl(spriteId: string): string {
  return `models/${spriteId}.glb`;
}

/**
 * Caminho no repositório, para a tela dizer onde copiar o arquivo.
 *
 * `public/` porque o Vite serve o conteúdo dessa pasta na raiz sem processar —
 * é onde um `.glb` tem de estar para o caminho acima resolver.
 */
export function repositoryPathFor(spriteId: string): string {
  return `web3d/public/models/${spriteId}.glb`;
}

/** Formato que o carregador aceita, para a orientação na tela. */
export const EXPECTED_FORMAT = {
  extension: '.glb',
  label: 'glTF binário (.glb)',
  detail:
    'Um arquivo só, com malha e textura embutidas. `.gltf` separado em ' +
    '.bin e imagens não funciona aqui: o caminho de textura é relativo e ' +
    'quebra ao trocar o nome do arquivo.',
  hint:
    'Exporte do Blender em glTF 2.0 → formato "glTF Binary (.glb)", com ' +
    '"+Y para cima". O modelo é reescalado automaticamente para a footprint ' +
    'da construção, então o tamanho no arquivo não importa — só a orientação.',
} as const;

const overrides = new Map<string, string>();
const listeners = new Set<() => void>();

/** URL efetiva de um modelo: a trocada, se houver, senão a do repositório. */
export function modelUrlFor(spriteId: string): string {
  return overrides.get(spriteId) ?? defaultModelUrl(spriteId);
}

export function hasOverride(spriteId: string): boolean {
  return overrides.has(spriteId);
}

export function overriddenSprites(): readonly string[] {
  return [...overrides.keys()];
}

/**
 * Aponta um `spriteId` para um arquivo escolhido pelo jogador.
 *
 * A URL anterior é revogada: cada `createObjectURL` prende o arquivo na
 * memória da aba até alguém soltar, e trocar dez modelos numa sessão de teste
 * seguraria dez arquivos sem necessidade.
 */
export function setOverride(spriteId: string, file: Blob): string {
  clearOverride(spriteId);
  const url = URL.createObjectURL(file);
  overrides.set(spriteId, url);
  notify();
  return url;
}

export function clearOverride(spriteId: string): void {
  const antiga = overrides.get(spriteId);
  if (antiga) {
    URL.revokeObjectURL(antiga);
    overrides.delete(spriteId);
    notify();
  }
}

export function clearAllOverrides(): void {
  for (const url of overrides.values()) URL.revokeObjectURL(url);
  overrides.clear();
  notify();
}

/** Avisa quem desenha, para a cena recarregar o modelo trocado. */
export function onOverridesChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(): void {
  for (const fn of listeners) fn();
}
