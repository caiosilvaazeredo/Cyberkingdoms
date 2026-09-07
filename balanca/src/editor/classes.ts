import type { EsquemaDeClasse } from '../shared/classes';

import ALDEAO_JSON from '../shared/classes-dados/aldeao.json';
import ARQUEIRO_JSON from '../shared/classes-dados/arqueiro.json';
import CLERIGO_JSON from '../shared/classes-dados/clerigo.json';
import GUERREIRO_JSON from '../shared/classes-dados/guerreiro.json';
import LANCEIRO_JSON from '../shared/classes-dados/lanceiro.json';
import LENHADOR_JSON from '../shared/classes-dados/lenhador.json';
import MINERADOR_JSON from '../shared/classes-dados/minerador.json';
import SAQUEADOR_JSON from '../shared/classes-dados/saqueador.json';

/**
 * O editor de classes — fase 4 da engine.
 *
 * Diferente de mapa e modo, este editor não cria nada novo: uma classe nova
 * também precisa de sprite (a aba Sprites cobre isso) e de entrar em
 * `Classe`/`CLASSES_COM_CHAPEU`/`ESTOQUE_INICIAL` no código, que é o preço de
 * `Classe` continuar sendo uma união fechada — a mesma garantia que deixa o
 * TypeScript apontar, em tempo de compilação, todo lugar do jogo que esqueceu
 * de tratar uma classe. Reequilibrar as sete que já existem, porém, é dado
 * puro, e é isso que o formulário edita.
 */
export const PERFIS_CONHECIDOS: Readonly<Record<string, EsquemaDeClasse>> = {
  aldeao: ALDEAO_JSON as EsquemaDeClasse,
  guerreiro: GUERREIRO_JSON as EsquemaDeClasse,
  lanceiro: LANCEIRO_JSON as EsquemaDeClasse,
  arqueiro: ARQUEIRO_JSON as EsquemaDeClasse,
  clerigo: CLERIGO_JSON as EsquemaDeClasse,
  minerador: MINERADOR_JSON as EsquemaDeClasse,
  lenhador: LENHADOR_JSON as EsquemaDeClasse,
  saqueador: SAQUEADOR_JSON as EsquemaDeClasse,
};

export class EditorDeClasses {
  perfil: EsquemaDeClasse = PERFIS_CONHECIDOS.aldeao!;

  carregar(esquema: EsquemaDeClasse): void {
    this.perfil = esquema;
  }

  validar(): string[] {
    const erros: string[] = [];
    if (!/^[a-z0-9-]+$/.test(this.perfil.id)) erros.push('o id só pode ter letras minúsculas, números e hífen');
    if (!this.perfil.nome.trim()) erros.push('falta um nome');
    if (this.perfil.vida <= 0) erros.push('vida precisa ser maior que zero');
    if (this.perfil.velocidade <= 0) erros.push('velocidade precisa ser maior que zero');
    if (this.perfil.cadencia <= 0) erros.push('cadência precisa ser maior que zero');
    return erros;
  }
}
