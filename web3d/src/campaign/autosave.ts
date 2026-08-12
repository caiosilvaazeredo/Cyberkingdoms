import { Campaign } from './campaign';
import { resolveStore, type KeyValueStore } from '../net/localServer';

/**
 * Salvamento automático de uma partida só.
 *
 * ## Por que isto existe separado do servidor local
 *
 * `LocalGameServer` guarda campanhas por sessão, com índice, blueprint e
 * slots — é a estrutura de que a casca de MMO precisa, com menu de servidores
 * e escolha de mundo. O cliente 2D não tem essa casca: ele abre direto no jogo.
 * Passar por sessão e slot para guardar uma partida seria carregar o
 * vocabulário inteiro do menu numa tela que não tem menu.
 *
 * O que ele reaproveita é o que importa: `resolveStore`, que já sabe que
 * `localStorage` pode existir e mesmo assim falhar — em aba privada do Safari o
 * objeto está lá e `setItem` lança. Cair para memória em vez de estourar é o
 * que evita perder a partida num `catch` genérico mais tarde.
 *
 * ## Por que a chave inclui a seed
 *
 * Abrir `?seed=krom` não pode carregar por cima a partida de `?seed=verde`.
 * Cada mundo tem seu próprio espaço, e trocar de seed é começar outra coisa —
 * não é perder a anterior.
 */

const PREFIXO = 'ck.2d';

/** Quanto tempo esperar antes de gravar. Ver `Autosave.marcar`. */
const ESPERA_MS = 1500;

export class Autosave {
  private pendente = 0;

  constructor(
    private readonly seedLabel: string,
    private readonly store: KeyValueStore = resolveStore(),
  ) {}

  private get chave(): string {
    return `${PREFIXO}.${this.seedLabel}`;
  }

  /**
   * Grava agora.
   *
   * Devolve `false` quando falha, e não lança: uma campanha que não coube na
   * cota do navegador não pode derrubar o laço de desenho junto.
   */
  salvar(campaign: Campaign): boolean {
    try {
      this.store.setItem(this.chave, JSON.stringify(campaign.toJson()));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Agenda uma gravação.
   *
   * O jogo muda de estado a cada compra, obra e tique da fila. Gravar em toda
   * mudança serializaria o mundo dezenas de vezes por segundo; agrupar num
   * intervalo curto guarda a mesma coisa e custa uma gravação. O intervalo é
   * curto de propósito: o que se perde ao fechar a aba no pior instante é um
   * segundo e meio de jogo, não uma sessão.
   */
  marcar(campaign: Campaign): void {
    if (this.pendente) return;
    this.pendente = setTimeout(() => {
      this.pendente = 0;
      this.salvar(campaign);
    }, ESPERA_MS) as unknown as number;
  }

  /** Grava o que estiver pendente. Para o `pagehide` da aba. */
  descarregar(campaign: Campaign): void {
    if (this.pendente) {
      clearTimeout(this.pendente);
      this.pendente = 0;
    }
    this.salvar(campaign);
  }

  /**
   * Recupera a partida guardada, se houver e se ela ainda for legível.
   *
   * Save corrompido — de uma versão anterior, de uma gravação cortada pela
   * metade — devolve `null` em vez de quebrar a abertura do jogo. Perder a
   * partida é ruim; não conseguir abrir o jogo é pior, e sem saída.
   */
  carregar(): Campaign | null {
    const bruto = this.store.getItem(this.chave);
    if (!bruto) return null;
    try {
      return Campaign.fromJson(JSON.parse(bruto));
    } catch {
      return null;
    }
  }

  apagar(): void {
    try {
      this.store.removeItem(this.chave);
    } catch {
      // Nada a fazer: o jogador pediu para recomeçar, e recomeçar não pode
      // depender de o navegador aceitar apagar.
    }
  }
}
