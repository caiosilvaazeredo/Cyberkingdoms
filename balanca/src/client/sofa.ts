import {
  atualizarRumo,
  controlesLigados,
  ESQUEMAS,
  lerControle,
  lerTeclado,
  MAXIMO_LOCAL,
  type IdDeFonte,
  type Rumo,
} from './controles';
import type { OlharLocal } from './desenho';
import type { Entrada, LeituraDeEntrada } from './entrada';
import { Rede } from './rede';
import type { Unidade } from '../shared/estado';
import type { Time } from '../shared/regras';

/**
 * O sofá: até quatro pessoas no mesmo aparelho, no mesmo time.
 *
 * ## Uma conexão por pessoa, e não um comando com quatro campos
 *
 * A tentação é mandar os quatro comandos num pacote só. É a decisão errada:
 * comando, previsão local, reconciliação, vida, chapéu e morte já existem — uma
 * vez — para *um* jogador, e duplicar isso "para o modo de sofá" criaria um
 * segundo jogo, com as suas próprias regras de sincronia, que divergiria do
 * primeiro no dia em que alguém mexesse só num.
 *
 * Então cada pessoa do sofá abre a **sua** conexão. Para o servidor são quatro
 * jogadores como quaisquer outros; nada lá sabe que estão na mesma sala física.
 * O preço é quatro fluxos de retrato pela rede, o que numa partida de doze
 * unidades é troco.
 *
 * O que o servidor precisou aprender foi só isto: entrar numa sala **pelo
 * nome**. Sem isso o lobby espalharia a turma por salas diferentes, cada uma
 * com a sua partida.
 *
 * ## Todo mundo do mesmo lado
 *
 * Quem senta junto joga junto. O time é escolhido uma vez e vale para as
 * quatro conexões — dividir o sofá em dois reinos seria tecnicamente possível e
 * socialmente absurdo, porque a tela é uma só e a câmera não tem como seguir
 * dois grupos que correm em direções opostas.
 *
 * ## Um dono por unidade
 *
 * O desenho pergunta ao sofá de quem é cada unidade. A resposta importa: a
 * posição do jogador 3 tem de sair da previsão **da conexão do jogador 3**, e
 * não do retrato que a conexão do jogador 1 recebeu 66 ms atrás. Sem isso os
 * jogadores 2 a 4 jogariam com a rede na mão enquanto o 1 joga liso.
 */

export interface JogadorLocal {
  /** A vaga: 0 é quem abriu o jogo. Define cor, canto do HUD e ordem. */
  readonly vaga: number;
  readonly fonte: IdDeFonte;
  nome: string;
  readonly rede: Rede;
  /** Para onde andou por último — é a mira de quem não tem mouse. */
  rumo: Rumo;
}

export type Modo = 'local' | 'online';

export class Sofa implements OlharLocal {
  private readonly locais: JogadorLocal[] = [];

  /**
   * @param anfitria a conexão que a página já tinha aberta como plateia. A
   * primeira pessoa a sentar herda essa conexão em vez de abrir outra: ela já
   * está numa sala, já baixou a arena e já é ela que desenha o menu.
   */
  constructor(
    private readonly endereco: string,
    private anfitria: Rede,
  ) {}

  get jogadores(): readonly JogadorLocal[] {
    return this.locais;
  }

  get quantosLocais(): number {
    return this.locais.length;
  }

  /** A conexão que manda: é dela que saem estado, relógio e nome da sala. */
  get principal(): Rede {
    return this.anfitria;
  }

  get estado() {
    return this.anfitria.estado;
  }

  get brilhos() {
    return this.anfitria.brilhos;
  }

  /**
   * Troca a conexão principal.
   *
   * Acontece ao começar um jogo local: a conexão de plateia estava numa sala
   * pública, e o sofá precisa de uma sala reservada.
   */
  trocarAnfitria(rede: Rede): void {
    this.anfitria = rede;
    const primeiro = this.locais[0];
    if (primeiro) this.locais[0] = { ...primeiro, rede };
  }

  /**
   * Senta alguém numa vaga.
   *
   * A primeira pessoa herda a conexão principal; da segunda em diante cada uma
   * abre a sua, já pedindo **a sala em que a primeira caiu**. Entram como
   * plateia: ninguém ocupa vaga de jogador antes de o time ser escolhido, e
   * assim desistir na cabine não deixa lugares presos no servidor.
   */
  sentar(fonte: IdDeFonte, nome: string): JogadorLocal | null {
    if (this.locais.length >= MAXIMO_LOCAL) return null;
    if (this.locais.some((j) => j.fonte === fonte)) return null;
    const vaga = this.locais.length;
    let rede = this.anfitria;
    if (vaga > 0) {
      rede = new Rede(this.endereco);
      rede.conectar(nome, true, { sala: this.anfitria.sala });
    }
    const jogador: JogadorLocal = { vaga, fonte, nome, rede, rumo: { x: 1, y: 0 } };
    this.locais.push(jogador);
    return jogador;
  }

  /** Desfaz o sofá, fechando tudo menos a conexão principal. */
  levantar(): void {
    for (const j of this.locais) {
      if (j.rede !== this.anfitria) j.rede.desconectar();
    }
    this.locais.length = 0;
  }

  /** Todos escolhem o mesmo lado. É a regra do sofá. */
  escolherTime(time: Time): void {
    for (const j of this.locais) j.rede.escolherTime(time, j.nome);
  }

  /** Verdadeiro quando todo mundo do sofá já nasceu em campo. */
  get todosEmCampo(): boolean {
    return this.locais.length > 0 && this.locais.every((j) => j.rede.eu !== null);
  }

  /** Quem ainda não conseguiu entrar, com o motivo que o servidor deu. */
  get recusa(): string | null {
    for (const j of this.locais) {
      if (j.rede.eu === null && j.rede.motivo) return j.rede.motivo;
    }
    return null;
  }

  /**
   * Resolve o sofá partido: uns entraram, outros foram recusados.
   *
   * Acontece de verdade — o lado escolhido pode encher entre o clique e a
   * resposta do servidor, e aí três nascem e o quarto é recusado. Esperar por
   * todos travaria a tela de escolha para sempre, com três pessoas já em campo
   * e a partida correndo sem elas; mandar todo mundo escolher de novo é pior,
   * porque quem já nasceu não pode escolher outra vez.
   *
   * Então quem ficou de fora **desce do sofá**: a conexão fecha, a vaga some da
   * tela e o jogo começa com quem coube. Devolve quantos ficaram de fora, para
   * que alguém diga isso em voz alta em vez de a pessoa descobrir sozinha que
   * não está jogando.
   *
   * Quando **ninguém** entrou, não desfaz nada: aí o time inteiro escolhe o
   * outro lado, que é a saída certa.
   */
  dispensarRecusados(): number {
    const entraram = this.locais.filter((j) => j.rede.eu !== null).length;
    if (entraram === 0) return 0;
    const foraram = this.locais.filter((j) => j.rede.eu === null && j.rede.motivo !== null);
    for (const j of foraram) {
      if (j.rede !== this.anfitria) j.rede.desconectar();
      this.locais.splice(this.locais.indexOf(j), 1);
    }
    return foraram.length;
  }

  get algumaCaiu(): boolean {
    return this.locais.some((j) => j.rede.fechado);
  }

  /**
   * Manda um passo de simulação para cada jogador.
   *
   * @param centro onde está na tela a unidade de cada vaga, para o esquema com
   * mouse mirar. As outras fontes ignoram.
   */
  passar(entrada: Entrada, centros: Map<number, { x: number; y: number }>): void {
    const pads = controlesLigados();
    for (const j of this.locais) {
      const leitura = this.lerJogador(j, entrada, pads, centros.get(j.vaga) ?? { x: 0, y: 0 });
      j.rumo = atualizarRumo(j.rumo, leitura.mx, leitura.my);
      if (j.rede.eu) j.rede.passar(leitura);
      else j.rede.manterVivo();
    }
  }

  private lerJogador(
    j: JogadorLocal,
    entrada: Entrada,
    pads: ReturnType<typeof controlesLigados>,
    centro: { x: number; y: number },
  ): LeituraDeEntrada {
    if (j.fonte.startsWith('controle:')) {
      const indice = Number(j.fonte.split(':')[1]);
      const pad = pads.find((p) => p.indice === indice);
      // Controle que sumiu no meio da partida devolve comando vazio: o boneco
      // para onde está em vez de sair correndo com o último eixo lido.
      return pad ? lerControle(pad, j.rumo) : parado();
    }
    const esquema = ESQUEMAS.find((e) => e.id === j.fonte);
    if (!esquema) return parado();
    // O esquema do WASD passa pela `Entrada` porque é o único que também tem
    // mouse e dedo — os três viram um comando só lá.
    if (esquema.comMouse) return entrada.ler(centro);
    return lerTeclado(esquema, entrada.teclasApertadas, j.rumo, null);
  }

  // --- o que o desenho pergunta -------------------------------------------

  vagaDe(id: number): number | null {
    const dono = this.locais.find((j) => j.rede.meuId === id);
    return dono ? dono.vaga : null;
  }

  previsaoDe(u: Unidade): Unidade {
    const dono = this.locais.find((j) => j.rede.meuId === u.id);
    return dono?.rede.eu ?? u;
  }

  posicaoDe(u: Unidade, agora: number): { x: number; y: number } {
    const dono = this.locais.find((j) => j.rede.meuId === u.id);
    return (dono?.rede ?? this.anfitria).posicaoDe(u, agora);
  }

  alfa(agora: number): number {
    return this.anfitria.alfa(agora);
  }

  desdeORetrato(agora: number): number {
    return this.anfitria.desdeORetrato(agora);
  }
}

function parado(): LeituraDeEntrada {
  return { mx: 0, my: 0, ax: 0, ay: 0, atacar: false, usar: false };
}
