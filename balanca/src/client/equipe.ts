import { CLASSES_COM_CHAPEU, perfil, vidaMaxima, type Classe } from '../shared/classes';
import { nivelDe, type Estado, type Unidade } from '../shared/estado';
import type { FichaDeJogador, VotacaoAberta } from '../shared/protocolo';
import type { Time } from '../shared/regras';

/**
 * O painel do time: quem é quem, e quem manda no npc.
 *
 * ## Por que em HTML, e não no `canvas`
 *
 * Pela mesma razão do menu: um painel com botões **é** um menu. Desenhado à mão
 * no `canvas`, cada botão viraria um retângulo com teste de colisão, cada lista
 * de classes um menu suspenso escrito do zero, e o foco de teclado não
 * existiria. Em HTML tudo isso vem de graça, e o campo de batalha continua
 * sendo a única coisa desenhada à mão — que é onde desenhar à mão se paga.
 *
 * ## O avatar é da classe, não da pessoa
 *
 * Cada classe tem um ícone do pacote `Human Avatars`. Cinco formas não cobrem
 * oito classes, então a cor do losango entra como segundo eixo — o time já está
 * dito pela moldura do painel e pelo fato de este painel mostrar **só o seu
 * time**, então a cor fica livre para separar classes. Ver `importar-arte.mjs`.
 *
 * ## Por que a lista só se refaz quando muda
 *
 * O laço de quadro roda sessenta vezes por segundo e a vida de todo mundo muda
 * a cada tick. Refazer oito linhas de DOM sessenta vezes por segundo é trabalho
 * jogado fora e faz o navegador recalcular estilo o tempo todo. Então a lista é
 * refeita quando a **assinatura** muda — quem está, de que classe, quem lidera —
 * e no resto dos quadros só a largura das barras de vida é tocada.
 */

export interface DadosDaEquipe {
  /** O time de quem está olhando. `null` fora de uma partida. */
  time: Time | null;
  estado: Estado | null;
  elenco: FichaDeJogador[];
  /** As unidades deste aparelho: elas ganham a marca de "você". */
  meus: readonly number[];
  /** Verdadeiro se quem olha manda no time. */
  souLider: boolean;
  votacao: VotacaoAberta | null;
  recado: string | null;
}

/** O ícone de cada classe. O nome do arquivo **é** o nome da classe. */
export const avatarDe = (classe: Classe): string => `/tiny/avatares/${classe}.png`;

export class PainelDaEquipe {
  private readonly raiz: HTMLElement;
  private readonly lista: HTMLElement;
  private readonly urna: HTMLElement;
  private readonly recado: HTMLElement;
  /** A última assinatura desenhada. Ver o topo do arquivo. */
  private assinatura = '';
  /** As barras de vida já no DOM, por id de unidade. */
  private readonly barras = new Map<number, HTMLElement>();
  /** Quem está com o menu de classes aberto, se alguém. */
  private escolhendo: number | null = null;

  constructor(
    raiz: HTMLElement,
    private readonly acoes: {
      mandar(alvo: number, classe: Classe, votar: boolean): void;
      votar(classe: Classe): void;
    },
  ) {
    this.raiz = raiz;
    this.lista = raiz.querySelector<HTMLElement>('.equipe-lista')!;
    this.urna = raiz.querySelector<HTMLElement>('.equipe-urna')!;
    this.recado = raiz.querySelector<HTMLElement>('.equipe-recado')!;
  }

  esconder(): void {
    this.raiz.hidden = true;
  }

  atualizar(d: DadosDaEquipe): void {
    if (!d.time || !d.estado) {
      this.esconder();
      return;
    }
    this.raiz.hidden = false;
    this.raiz.dataset.time = d.time;

    const time = d.estado.unidades.filter((u) => u.time === d.time);
    const fichas = new Map(d.elenco.map((f) => [f.id, f]));
    const assinatura = [
      d.souLider ? 'L' : '-',
      this.escolhendo ?? '-',
      ...time.map((u) => {
        const f = fichas.get(u.id);
        return `${u.id}:${u.classe}:${u.vivo ? 1 : 0}:${f?.lider ? 1 : 0}:${f?.pedida ?? ''}`;
      }),
    ].join('|');

    if (assinatura !== this.assinatura) {
      this.assinatura = assinatura;
      this.montar(time, fichas, d);
    }
    // Todo quadro: só a barra, que é uma escrita de estilo e não um recálculo
    // de árvore.
    for (const u of time) {
      const barra = this.barras.get(u.id);
      if (!barra) continue;
      const max = vidaMaxima(u.classe, nivelDe(d.estado, u.time));
      const fracao = Math.max(0, Math.min(1, u.vida / max));
      barra.style.width = `${fracao * 100}%`;
      barra.dataset.baixa = String(!u.vivo || fracao < 0.35);
    }

    this.pintarUrna(d.votacao);
    this.recado.textContent = d.recado ?? '';
    this.recado.hidden = !d.recado;
  }

  private montar(
    time: readonly Unidade[],
    fichas: Map<number, FichaDeJogador>,
    d: DadosDaEquipe,
  ): void {
    this.lista.replaceChildren();
    this.barras.clear();

    for (const u of time) {
      const ficha = fichas.get(u.id);
      const linha = document.createElement('div');
      linha.className = 'membro';
      if (!u.vivo) linha.classList.add('caido');
      if (d.meus.includes(u.id)) linha.classList.add('eu');

      const retrato = document.createElement('img');
      retrato.className = 'retrato';
      // A classe pedida aparece **antes** de o bot vestir: sem isso o líder dá
      // a ordem e não vê nada por dez segundos, que é o tempo de o npc
      // atravessar o castelo até a chapelaria.
      retrato.src = avatarDe(ficha?.pedida ?? u.classe);
      retrato.alt = '';
      linha.append(retrato);

      const texto = document.createElement('div');
      texto.className = 'quem';
      const nome = document.createElement('b');
      nome.textContent = ficha?.lider ? `${u.nome} ♛` : u.nome;
      const papel = document.createElement('small');
      papel.textContent = ficha?.pedida
        ? `${perfil(u.classe).nome} → ${perfil(ficha.pedida).nome}…`
        : perfil(u.classe).nome + (u.bot ? ' · npc' : '');
      const trilho = document.createElement('span');
      trilho.className = 'vida';
      const barra = document.createElement('i');
      trilho.append(barra);
      this.barras.set(u.id, barra);
      texto.append(nome, papel, trilho);
      linha.append(texto);

      // Só o líder manda, e só em npc: mandar num humano seria dizer a uma
      // pessoa o que vestir, que é uma discussão para o bate-papo e não para um
      // botão.
      if (d.souLider && u.bot) {
        const botao = document.createElement('button');
        botao.className = 'mandar';
        botao.textContent = this.escolhendo === u.id ? '×' : '⋯';
        botao.title = 'mandar este npc mudar de classe';
        botao.addEventListener('click', () => {
          this.escolhendo = this.escolhendo === u.id ? null : u.id;
          this.assinatura = '';
        });
        linha.append(botao);
      }
      this.lista.append(linha);

      if (this.escolhendo === u.id) this.lista.append(this.menuDeClasses(u.id));
    }
  }

  /** As classes que dá para pedir, com os dois jeitos de pedir. */
  private menuDeClasses(alvo: number): HTMLElement {
    const caixa = document.createElement('div');
    caixa.className = 'ordens';
    for (const classe of CLASSES_COM_CHAPEU) {
      const b = document.createElement('button');
      b.className = 'ordem';
      const img = document.createElement('img');
      img.src = avatarDe(classe);
      img.alt = '';
      const rotulo = document.createElement('span');
      rotulo.textContent = perfil(classe).nome;
      b.append(img, rotulo);
      b.addEventListener('click', (e) => {
        // Com Shift, abre votação em vez de mandar. É o mesmo gesto com um
        // peso diferente, e cabe na mesma lista — dois conjuntos de sete botões
        // dobrariam o menu para dizer a mesma coisa.
        this.acoes.mandar(alvo, classe, e.shiftKey);
        this.escolhendo = null;
        this.assinatura = '';
      });
      caixa.append(b);
    }
    const dica = document.createElement('small');
    dica.className = 'dica-ordem';
    dica.textContent = 'clique manda · Shift+clique abre votação';
    caixa.append(dica);
    return caixa;
  }

  private pintarUrna(v: VotacaoAberta | null): void {
    if (!v) {
      this.urna.hidden = true;
      this.urna.replaceChildren();
      return;
    }
    this.urna.hidden = false;
    this.urna.replaceChildren();

    const titulo = document.createElement('b');
    titulo.textContent = `${v.alvoNome} vira o quê? · ${v.restante}s`;
    this.urna.append(titulo);

    const opcoes = document.createElement('div');
    opcoes.className = 'ordens';
    CLASSES_COM_CHAPEU.forEach((classe, i) => {
      const b = document.createElement('button');
      b.className = 'ordem';
      if (v.meuVoto === classe) b.classList.add('meu-voto');
      const img = document.createElement('img');
      img.src = avatarDe(classe);
      img.alt = '';
      const rotulo = document.createElement('span');
      const quantos = v.votos[i] ?? 0;
      rotulo.textContent = quantos > 0 ? `${perfil(classe).nome} ${quantos}` : perfil(classe).nome;
      b.append(img, rotulo);
      b.addEventListener('click', () => this.acoes.votar(classe));
      opcoes.append(b);
    });
    this.urna.append(opcoes);
  }
}
