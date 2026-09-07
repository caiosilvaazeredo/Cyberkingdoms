import type { EsquemaDeModo } from '../shared/modos';

/**
 * O editor de modos — fase 3 da engine.
 *
 * `EsquemaDeModo` já era uma tabela de números e chaves antes deste editor
 * existir (ver a nota em `modos.ts`); o formulário aqui só é a tela para
 * escrever essa tabela sem editar TypeScript. Não há terreno para desenhar,
 * então não há canvas — o "palco" deste editor é a pré-visualização do JSON
 * que vai sair.
 */
export class EditorDeModos {
  id = 'meu-modo';
  nome = 'Meu Modo';
  lema = '';
  pontosParaVencer = 3;
  duracao = 720;
  renascimentoBase = 6;
  vitoriaPorBalanca = false;
  chapeusInfinitos = false;
  animaisVoltam = true;
  vitoriaPorObra = false;
  pesoQueVence = 40;
  abatesParaVencer: number | null = null;
  temGuardiao = false;
  temCaca = false;
  temCajado = false;
  temFuga = false;
  temNoite = false;

  limpar(): void {
    this.id = 'meu-modo';
    this.nome = 'Meu Modo';
    this.lema = '';
    this.pontosParaVencer = 3;
    this.duracao = 720;
    this.renascimentoBase = 6;
    this.vitoriaPorBalanca = false;
    this.chapeusInfinitos = false;
    this.animaisVoltam = true;
    this.vitoriaPorObra = false;
    this.pesoQueVence = 40;
    this.abatesParaVencer = null;
    this.temGuardiao = false;
    this.temCaca = false;
    this.temCajado = false;
    this.temFuga = false;
    this.temNoite = false;
  }

  carregar(esquema: EsquemaDeModo): void {
    this.id = esquema.id;
    this.nome = esquema.nome;
    this.lema = esquema.lema;
    this.pontosParaVencer = esquema.pontosParaVencer;
    this.duracao = esquema.duracao;
    this.renascimentoBase = esquema.renascimentoBase;
    this.vitoriaPorBalanca = esquema.vitoriaPorBalanca;
    this.chapeusInfinitos = esquema.chapeusInfinitos;
    this.animaisVoltam = esquema.animaisVoltam;
    this.vitoriaPorObra = esquema.vitoriaPorObra;
    this.pesoQueVence = esquema.pesoQueVence;
    this.abatesParaVencer = esquema.abatesParaVencer;
    this.temGuardiao = esquema.temGuardiao;
    this.temCaca = esquema.temCaca;
    this.temCajado = esquema.temCajado;
    this.temFuga = esquema.temFuga;
    this.temNoite = esquema.temNoite;
  }

  /**
   * Os avisos que valem a pena antes de exportar — poucos, porque quase todo
   * campo aqui é um número ou um booleano e não tem como estar "errado" no
   * sentido em que um mapa pode estar. O que resta checar é a coerência entre
   * as duas alavancas de vitória que competem pelo mesmo relógio.
   */
  validar(): string[] {
    const erros: string[] = [];
    if (!/^[a-z0-9-]+$/.test(this.id)) {
      erros.push('o id só pode ter letras minúsculas, números e hífen — é o nome do arquivo');
    }
    if (!this.nome.trim()) erros.push('falta um nome');
    if (!this.lema.trim()) erros.push('falta o lema — a alavanca que este modo puxa, numa linha');
    if (this.abatesParaVencer !== null && this.pontosParaVencer < 1000) {
      erros.push(
        'com "abates para vencer" marcado, "resgates para vencer" devia ficar bem alto — senão os dois caminhos competem e o lema de "só briga" (ou o que for) acaba mentindo',
      );
    }
    return erros;
  }

  paraEsquema(): EsquemaDeModo {
    return {
      id: this.id,
      nome: this.nome,
      lema: this.lema,
      pontosParaVencer: this.pontosParaVencer,
      duracao: this.duracao,
      renascimentoBase: this.renascimentoBase,
      vitoriaPorBalanca: this.vitoriaPorBalanca,
      chapeusInfinitos: this.chapeusInfinitos,
      animaisVoltam: this.animaisVoltam,
      vitoriaPorObra: this.vitoriaPorObra,
      pesoQueVence: this.pesoQueVence,
      abatesParaVencer: this.abatesParaVencer,
      temGuardiao: this.temGuardiao,
      temCaca: this.temCaca,
      temCajado: this.temCajado,
      temFuga: this.temFuga,
      temNoite: this.temNoite,
    };
  }
}
