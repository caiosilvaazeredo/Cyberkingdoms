import type { TipoDeEstrutura, TipoDeJazida } from '../shared/arena';
import type { EsquemaDeMapa, OperacaoDeRelevo } from '../shared/mapas';

/**
 * O editor de mapas — fase 1 da engine.
 *
 * ## O que ele edita
 *
 * Exatamente o que `EsquemaDeMapa` descreve: metadados, terreno (água/ponte),
 * as cinco construções, jazidas e pastos. Nada de código, nada de função —
 * o mapa exportado daqui é lido pelo jogo do mesmo jeito que os oito que já
 * existem, porque é o mesmo tipo.
 *
 * ## Por que só o lado azul se pinta
 *
 * `criarArena` espelha sozinho: terreno, construção, jazida-do-lado e
 * pasto-do-lado escritos uma vez viram os dois lados. Pintar os dois seria
 * dar ao editor a chance de desenhar uma assimetria que o próprio motor do
 * jogo não sabe reproduzir — melhor nem deixar acontecer. Todo clique no lado
 * vermelho é silenciosamente refletido para a coordenada azul equivalente
 * antes de entrar no estado.
 *
 * Jazida/pasto "do meio" são a exceção documentada em `mapas.ts`: a lista
 * já traz os dois pontos do par, sem espelho automático — o editor só
 * acrescenta exatamente onde se clicou.
 */

export type FerramentaDeTerreno = 'agua' | 'ponte' | 'grama';
export type FerramentaDePonto =
  | { tipo: 'estrutura'; estrutura: TipoDeEstrutura }
  | { tipo: 'jazida'; jazida: TipoDeJazida; onde: 'lado' | 'meio' }
  | { tipo: 'pasto'; onde: 'lado' | 'meio' };

export type Ferramenta = { tipo: 'terreno'; terreno: FerramentaDeTerreno } | FerramentaDePonto;

const TILE_PX = 12;

export class EditorDeMapas {
  id = 'meu-mapa';
  nome = 'Meu Mapa';
  lema = '';
  largura = 60;
  altura = 34;
  especiesDeArvore: readonly [number, number] = [2, 3];
  foraDoSorteio = false;
  bioma: 'padrao' | 'ossos' = 'padrao';

  /** Chave `ty*largura+tx`, sempre do lado azul (tx <= eixo). */
  private agua = new Set<number>();
  private pontes = new Set<number>();
  planta: Partial<Record<TipoDeEstrutura, readonly [number, number]>> = {};
  jazidasDoLado: [number, number, TipoDeJazida][] = [];
  jazidasDoMeio: [number, number, TipoDeJazida][] = [];
  pastosDoLado: [number, number][] = [];
  pastosDoMeio: [number, number][] = [];

  ferramenta: Ferramenta = { tipo: 'terreno', terreno: 'agua' };

  /** O eixo de simetria — cai entre dois tiles quando a largura é par. */
  get eixo(): number {
    return (this.largura - 1) / 2;
  }

  /** Reflete uma coordenada para o lado azul, se ela caiu do outro lado. */
  private paraAzul(tx: number): number {
    return tx <= this.eixo ? tx : this.largura - 1 - tx;
  }

  private dentroDoMapa(tx: number, ty: number): boolean {
    return tx >= 0 && ty >= 0 && tx < this.largura && ty < this.altura;
  }

  /** Aplica a ferramenta atual num tile clicado (ou arrastado). */
  clicar(tx: number, ty: number): void {
    if (!this.dentroDoMapa(tx, ty)) return;
    const f = this.ferramenta;
    if (f.tipo === 'terreno') {
      const ax = this.paraAzul(tx);
      const chave = ty * this.largura + ax;
      if (f.terreno === 'agua') {
        this.agua.add(chave);
        this.pontes.delete(chave);
      } else if (f.terreno === 'ponte') {
        this.pontes.add(chave);
        this.agua.add(chave);
      } else {
        this.agua.delete(chave);
        this.pontes.delete(chave);
      }
      return;
    }
    if (f.tipo === 'estrutura') {
      this.planta[f.estrutura] = [this.paraAzul(tx), ty];
      return;
    }
    if (f.tipo === 'jazida') {
      const lista = f.onde === 'lado' ? this.jazidasDoLado : this.jazidasDoMeio;
      const px = f.onde === 'lado' ? this.paraAzul(tx) : tx;
      const i = lista.findIndex((p) => p[0] === px && p[1] === ty);
      if (i >= 0) lista.splice(i, 1);
      else lista.push([px, ty, f.jazida]);
      return;
    }
    if (f.tipo === 'pasto') {
      const lista = f.onde === 'lado' ? this.pastosDoLado : this.pastosDoMeio;
      const px = f.onde === 'lado' ? this.paraAzul(tx) : tx;
      const i = lista.findIndex((p) => p[0] === px && p[1] === ty);
      if (i >= 0) lista.splice(i, 1);
      else lista.push([px, ty]);
    }
  }

  /** Água num tile, já resolvido dos dois lados — para o desenho e o export. */
  ehAgua(tx: number, ty: number): boolean {
    const ax = this.paraAzul(tx);
    return this.agua.has(ty * this.largura + ax);
  }

  ehPonte(tx: number, ty: number): boolean {
    const ax = this.paraAzul(tx);
    return this.pontes.has(ty * this.largura + ax);
  }

  /** Redimensiona, cortando ou preservando o que ainda cabe. */
  redimensionar(largura: number, altura: number): void {
    const aguaAntiga = this.agua;
    const pontesAntigas = this.pontes;
    const larguraAntiga = this.largura;
    this.largura = largura;
    this.altura = altura;
    this.agua = new Set();
    this.pontes = new Set();
    for (const chave of aguaAntiga) {
      const tx = chave % larguraAntiga;
      const ty = Math.floor(chave / larguraAntiga);
      if (tx < largura && ty < altura) this.agua.add(ty * largura + tx);
    }
    for (const chave of pontesAntigas) {
      const tx = chave % larguraAntiga;
      const ty = Math.floor(chave / larguraAntiga);
      if (tx < largura && ty < altura) this.pontes.add(ty * largura + tx);
    }
  }

  limpar(): void {
    this.id = 'meu-mapa';
    this.nome = 'Meu Mapa';
    this.lema = '';
    this.largura = 60;
    this.altura = 34;
    this.especiesDeArvore = [2, 3];
    this.foraDoSorteio = false;
    this.bioma = 'padrao';
    this.agua.clear();
    this.pontes.clear();
    this.planta = {};
    this.jazidasDoLado = [];
    this.jazidasDoMeio = [];
    this.pastosDoLado = [];
    this.pastosDoMeio = [];
  }

  /**
   * As validações que os testes do jogo já exigem de todo mapa — repetidas
   * aqui para avisar **antes** de exportar, e não só quando o servidor
   * recusar o mapa ou (pior) aceitar um quebrado.
   */
  validar(): string[] {
    const erros: string[] = [];
    const ESTRUTURAS: readonly TipoDeEstrutura[] = [
      'tesouraria',
      'cofre',
      'casaDaMoeda',
      'chapelaria',
      'nascedouro',
    ];
    for (const tipo of ESTRUTURAS) {
      if (!this.planta[tipo]) erros.push(`falta a construção "${tipo}"`);
    }
    for (const [tipo, pos] of Object.entries(this.planta)) {
      if (!pos) continue;
      const [tx, ty] = pos;
      if (this.ehAgua(tx, ty)) erros.push(`"${tipo}" está em cima d'água, em (${tx}, ${ty})`);
    }
    for (const [tx, ty] of [...this.jazidasDoLado, ...this.jazidasDoMeio]) {
      if (this.ehAgua(tx, ty)) erros.push(`uma jazida caiu na água, em (${tx}, ${ty})`);
    }
    for (const [tx, ty] of [...this.pastosDoLado, ...this.pastosDoMeio]) {
      if (this.ehAgua(tx, ty)) erros.push(`um pasto caiu na água, em (${tx}, ${ty})`);
    }
    if (!/^[a-z0-9-]+$/.test(this.id)) {
      erros.push('o id só pode ter letras minúsculas, números e hífen — é o nome do arquivo');
    }
    if (this.largura < 20 || this.altura < 20) {
      erros.push('o campo está pequeno demais para caber a moldura de água da borda');
    }
    return erros;
  }

  /** Monta o `EsquemaDeMapa` — o mesmo formato dos oito mapas do jogo. */
  paraEsquema(): EsquemaDeMapa {
    const relevoAgua: [number, number][] = [];
    const relevoPonte: [number, number][] = [];
    for (const chave of this.agua) {
      const tx = chave % this.largura;
      const ty = Math.floor(chave / this.largura);
      relevoAgua.push([tx, ty]);
    }
    for (const chave of this.pontes) {
      const tx = chave % this.largura;
      const ty = Math.floor(chave / this.largura);
      relevoPonte.push([tx, ty]);
    }
    const relevo: OperacaoDeRelevo[] = [];
    if (relevoAgua.length > 0) relevo.push({ tipo: 'tiles', material: 'agua', pontos: relevoAgua });
    if (relevoPonte.length > 0) {
      relevo.push({ tipo: 'tiles', material: 'ponte', pontos: relevoPonte });
    }
    return {
      id: this.id,
      nome: this.nome,
      lema: this.lema,
      largura: this.largura,
      altura: this.altura,
      especiesDeArvore: this.especiesDeArvore,
      foraDoSorteio: this.foraDoSorteio || undefined,
      bioma: this.bioma === 'ossos' ? 'ossos' : undefined,
      relevo,
      planta: this.planta as Record<TipoDeEstrutura, readonly [number, number]>,
      jazidasDoLado: this.jazidasDoLado,
      jazidasDoMeio: this.jazidasDoMeio,
      pastosDoLado: this.pastosDoLado,
      pastosDoMeio: this.pastosDoMeio,
      portoes: [],
    };
  }

  /** Reconstrói o estado do editor a partir de um `EsquemaDeMapa` importado. */
  carregar(esquema: EsquemaDeMapa): void {
    this.limpar();
    this.id = esquema.id;
    this.nome = esquema.nome;
    this.lema = esquema.lema;
    this.largura = esquema.largura;
    this.altura = esquema.altura;
    this.especiesDeArvore = esquema.especiesDeArvore;
    this.foraDoSorteio = esquema.foraDoSorteio ?? false;
    this.bioma = esquema.bioma === 'ossos' ? 'ossos' : 'padrao';
    this.planta = { ...esquema.planta };
    this.jazidasDoLado = esquema.jazidasDoLado.map((p) => [...p]) as [number, number, TipoDeJazida][];
    this.jazidasDoMeio = esquema.jazidasDoMeio.map((p) => [...p]) as [number, number, TipoDeJazida][];
    this.pastosDoLado = esquema.pastosDoLado.map((p) => [...p]) as [number, number][];
    this.pastosDoMeio = esquema.pastosDoMeio.map((p) => [...p]) as [number, number][];

    // O relevo de um mapa importado pode vir em `linha`/`elipse`/`pontes` — os
    // gestos dos oito mapas originais — e o editor só pinta tile a tile.
    // Interpretamos as operações contra um pincel de mentira que só anota o
    // que foi tocado, e o resultado vira os `Set` internos: um mapa antigo
    // abre no editor exatamente como está pintado, pronto para ser retocado.
    const largura = this.largura;
    const marcarAgua = (tx: number, ty: number): void => {
      const ax = tx <= (largura - 1) / 2 ? tx : largura - 1 - tx;
      if (tx >= 0 && ty >= 0 && tx < largura && ty < this.altura) this.agua.add(ty * largura + ax);
    };
    const marcarPonte = (tx: number, ty: number): void => {
      marcarAgua(tx, ty);
      const ax = tx <= (largura - 1) / 2 ? tx : largura - 1 - tx;
      if (tx >= 0 && ty >= 0 && tx < largura && ty < this.altura) this.pontes.add(ty * largura + ax);
    };
    for (const op of esquema.relevo) {
      if (op.tipo === 'linha') {
        for (let i = op.de; i <= op.ate; i++) {
          if (op.eixo === 'vertical') marcarAgua(op.fixo, i);
          else marcarAgua(i, op.fixo);
        }
      } else if (op.tipo === 'pontes') {
        for (const linha of op.linhas) marcarPonte(op.coluna, linha);
      } else if (op.tipo === 'elipse') {
        for (let ty = Math.floor(op.cy - op.ry); ty <= Math.ceil(op.cy + op.ry); ty++) {
          for (let tx = Math.floor(op.cx - op.rx); tx <= Math.ceil(op.cx); tx++) {
            const dx = (tx - op.cx) / op.rx;
            const dy = (ty - op.cy) / op.ry;
            if (dx * dx + dy * dy <= 1) marcarAgua(tx, ty);
          }
        }
      } else if (op.tipo === 'tiles') {
        for (const [tx, ty] of op.pontos) {
          if (op.material === 'agua') marcarAgua(tx, ty);
          else marcarPonte(tx, ty);
        }
      }
    }
  }
}

export { TILE_PX };
