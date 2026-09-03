import { describe, expect, it } from 'vitest';

import { anguloDaBalanca } from '../src/client/vitrine';
import { FORMATOS, campoPara } from '../src/shared/formatos';
import { IDS_DOS_MAPAS, MAPAS, porTimeMaximo } from '../src/shared/mapas';
import { criarPartida } from '../src/shared/partida';
import { MAX_POR_TIME, salaConfiguravel, totalPorTime } from '../src/shared/protocolo';
import {
  PESO_MINIMO,
  PESO_POR_BOLSA,
  PESO_TOTAL,
  POR_TIME,
  carregadoresMaximos,
  carregadoresPara,
  chapeusDe,
  custoDaObraDe,
  pesoMaximoDe,
  pesoTotalDe,
} from '../src/shared/regras';

/**
 * A escala: o que muda quando o time cresce, e o que não pode mudar.
 *
 * A regra inteira cabe numa frase — *o que é por pessoa cresce com o time; o que
 * é por partida, não* — e ela quebra de três jeitos, todos silenciosos.
 *
 * **Frouxa demais**, e trinta e dois por lado estouram a balança em noventa
 * segundos: cinco vezes mais gente cunhando moeda contra o mesmo peso total. A
 * partida acaba antes de alguém chegar à ponte, e o jogo que se prometeu não
 * aconteceu.
 *
 * **Apertada demais**, e a mesma partida roda doze minutos com a barra parada no
 * meio: o peso total cresceu e a produção não. A economia fica faminta e nada do
 * que depende dela — nem a moeda, nem a obra — chega a acontecer. Foi
 * exatamente isso que a medição encontrou na primeira Planície.
 *
 * **Errada no seis**, e o pior dos três: o tamanho em que o jogo foi todo
 * medido muda de comportamento sem ninguém pedir, e todo o balanceamento
 * anterior vira ficção. Por isso a primeira coisa que este arquivo guarda é que
 * seis por lado continua sendo exatamente o que era.
 */

describe('a escala no tamanho de sempre', () => {
  it('não muda nada em seis por lado', () => {
    // A âncora de todo o resto. Se este teste cair, os números medidos com bots
    // ao longo do projeto inteiro deixaram de valer.
    expect(pesoTotalDe(POR_TIME)).toBe(PESO_TOTAL);
    expect(pesoMaximoDe(POR_TIME)).toBe(PESO_TOTAL - PESO_MINIMO);
    expect(carregadoresMaximos(POR_TIME)).toBe(3);
    expect(chapeusDe(3, POR_TIME)).toBe(3);
    expect(custoDaObraDe(4, POR_TIME)).toBe(4);
  });

  it('mantém as três faixas de carregador que o jogo sempre teve', () => {
    // Um carregador sozinho no leve, dois no meio, três no talo. O degrau é
    // grosso de propósito: quem está no meio de uma briga lê a barra, não um
    // número contínuo.
    expect(carregadoresPara(PESO_MINIMO)).toBe(1);
    expect(carregadoresPara(60)).toBe(1);
    expect(carregadoresPara(100)).toBe(2);
    expect(carregadoresPara(150)).toBe(3);
    expect(carregadoresPara(PESO_TOTAL - PESO_MINIMO)).toBe(3);
  });

  it('nunca pede menos de um nem mais que o teto', () => {
    // A conta usa `floor` de uma fração, e no talo exato a fração dá 1 — sem o
    // corte, o baú no limite pediria um carregador que não existe.
    for (const porTime of [1, 6, 8, 16, 32]) {
      for (const peso of [0, PESO_MINIMO, pesoMaximoDe(porTime), 1e9]) {
        const n = carregadoresPara(peso, porTime);
        expect(n).toBeGreaterThanOrEqual(1);
        expect(n).toBeLessThanOrEqual(carregadoresMaximos(porTime));
      }
    }
  });
});

describe('a escala em times grandes', () => {
  it('o tempo para estourar a balança é o mesmo em qualquer formato', () => {
    // **A promessa central.** Se a produção de bolsas cresce com o time e o peso
    // que a balança comporta cresce junto, o número de bolsas até o talo cresce
    // na mesma proporção — e o tempo de partida não muda. É a única grandeza que
    // precisa ficar constante, porque é dela que sai a duração.
    const bolsasAte = (porTime: number): number =>
      (pesoMaximoDe(porTime) - pesoTotalDe(porTime) / 2) / PESO_POR_BOLSA;
    const porPessoa = (porTime: number): number => bolsasAte(porTime) / porTime;

    const base = porPessoa(POR_TIME);
    for (const porTime of [8, 16, 32]) {
      // Dez por cento de folga: `pesoTotalDe` arredonda para múltiplo de vinte,
      // e é esse arredondamento — e nada mais — que separa os formatos.
      expect(porPessoa(porTime)).toBeGreaterThan(base * 0.9);
      expect(porPessoa(porTime)).toBeLessThan(base * 1.1);
    }
  });

  it('o peso total cresce, e a bolsa continua movendo doze', () => {
    // A alternativa era manter o total fixo e dividir o que a bolsa move. Daria
    // o mesmo tempo de partida e um jogo pior: com trinta e dois por lado uma
    // bolsa moveria dois pontos numa barra de duzentos, e o gesto que dá nome ao
    // jogo não teria efeito visível nenhum.
    expect(PESO_POR_BOLSA).toBe(12);
    expect(pesoTotalDe(32)).toBeGreaterThan(pesoTotalDe(16));
    expect(pesoTotalDe(16)).toBeGreaterThan(pesoTotalDe(8));
    expect(pesoTotalDe(8)).toBeGreaterThan(pesoTotalDe(6));
  });

  it('a escolta cresce com o time, mas para em oito', () => {
    // Três carregadores num time de trinta e dois é detalhe, não escolta: eles
    // mandam três sem sentir. Acima de oito o cortejo deixaria de ser um grupo e
    // viraria o time inteiro, e o resto do mapa ficaria vazio.
    expect(carregadoresMaximos(16)).toBeGreaterThan(3);
    expect(carregadoresMaximos(32)).toBe(8);
    expect(carregadoresMaximos(1000)).toBe(8);
  });

  it('o armário de chapéus cresce, senão o jogo vira trinta e dois aldeões', () => {
    // O estoque finito é o segundo diferencial: um time que domina as trocas
    // desmonta a composição do outro. Isso só é verdade enquanto o armário é
    // apertado — dividido por trinta e dois, ninguém veste nada.
    expect(chapeusDe(3, 32)).toBeGreaterThan(chapeusDe(3, 6) * 4);
    // E nunca chega a zero: um armário vazio não é aperto, é ausência.
    expect(chapeusDe(1, 1)).toBeGreaterThanOrEqual(1);
  });

  it('a partida nasce com a balança equilibrada em qualquer formato', () => {
    // O meio é o meio, e não metade de duzentos. Sem isso, uma partida de trinta
    // e dois começaria com um dos lados já perto do talo.
    for (const porTime of [6, 8, 16, 32]) {
      const { estado } = criarPartida(7, 'resgate', 'planicie', porTime);
      const [a, b] = estado.baus;
      expect(a!.peso).toBe(b!.peso);
      expect(a!.peso + b!.peso).toBe(pesoTotalDe(porTime));
      expect(estado.porTime).toBe(porTime);
    }
  });
});

describe('quem cabe em que campo', () => {
  it('o teto é do campo, e não um número solto', () => {
    // A regressão que isto guarda: o teto era a constante `8`, boa para o Corte
    // e absurda para a Planície, que tem quatro vezes a área.
    for (const id of IDS_DOS_MAPAS) {
      const teto = porTimeMaximo(MAPAS[id]);
      expect(teto).toBeGreaterThanOrEqual(1);
      // A densidade é a régua: nunca mais gente que área para ela andar.
      expect(teto * 2).toBeLessThan(MAPAS[id].largura * MAPAS[id].altura);
    }
    expect(totalPorTime('planicie')).toBeGreaterThan(totalPorTime('corte') * 3);
  });

  it('os campos pequenos comportam oito por lado, e não dezesseis', () => {
    // Oito era o teto antigo, escolhido a olho e que se mostrou bom; é dele que
    // a densidade foi calibrada. Se esta conta deixar de bater, o formato de
    // oito para de caber no Corte e o de dezesseis passa a caber.
    expect(totalPorTime('corte')).toBeGreaterThanOrEqual(8);
    expect(totalPorTime('corte')).toBeLessThan(16);
  });

  it('cada formato tem um campo que o comporta', () => {
    // Um botão de formato que não tem campo não é oferecido. O teste existe para
    // o dia em que alguém subir o teto sem desenhar o campo: aqui isso aparece
    // como falha, e não como um botão que não funciona.
    for (const f of FORMATOS) {
      const campo = campoPara(f.porTime);
      expect(campo).not.toBeNull();
      expect(porTimeMaximo(MAPAS[campo!])).toBeGreaterThanOrEqual(f.porTime);
    }
  });

  it('o formato escolhe o menor campo que serve', () => {
    // Um formato de oito não devia arrastar quem o escolheu para o campo de
    // trinta e dois só porque ele também caberia lá.
    expect(campoPara(6)).not.toBe('planicie');
    expect(campoPara(8)).not.toBe('planicie');
    expect(campoPara(32)).toBe('planicie');
  });

  it('o sorteio usa o teto do menor campo da lista', () => {
    // Uma sala que troca de campo a cada partida não pode aceitar trinta e dois
    // por lado e depois cair no Corte.
    expect(totalPorTime('sorteio')).toBe(
      Math.min(...IDS_DOS_MAPAS.map((id) => porTimeMaximo(MAPAS[id]))),
    );
    expect(salaConfiguravel({ mapa: 'sorteio', porTime: MAX_POR_TIME }).porTime).toBe(
      totalPorTime('sorteio'),
    );
  });
});

describe('o fiel da balança do menu', () => {
  const comPesos = (azul: number, vermelho: number) =>
    ({
      porTime: POR_TIME,
      baus: [
        { time: 'azul', peso: azul },
        { time: 'vermelho', peso: vermelho },
      ],
    }) as unknown as Parameters<typeof anguloDaBalanca>[0];

  it('fica reto quando ninguém está ganhando', () => {
    expect(anguloDaBalanca(comPesos(100, 100))).toBe(0);
  });

  it('não pende sem partida', () => {
    // Os primeiros segundos, antes do primeiro retrato. Nada de valor inventado
    // para o desenho não ficar vazio.
    expect(anguloDaBalanca(null)).toBe(0);
  });

  it('pende para o lado de quem guarda o refém mais pesado', () => {
    // **O teste que importa.** O prato azul carrega o refém que o azul guarda,
    // que é o baú vermelho. Trocar os dois faria o menu pender ao contrário do
    // jogo, e ninguém perceberia até comparar com a barra do alto numa partida.
    //
    // Peso alto no baú **vermelho** quer dizer que o azul empanturrou o refém
    // dele, então o prato do azul desce — e descer, em tela, é ângulo negativo.
    const azulDominando = anguloDaBalanca(comPesos(PESO_MINIMO, 160));
    expect(azulDominando).toBeLessThan(0);
    expect(anguloDaBalanca(comPesos(160, PESO_MINIMO))).toBeGreaterThan(0);
    // E é simétrico: o mesmo domínio dos dois lados dá o mesmo ângulo trocado.
    expect(anguloDaBalanca(comPesos(160, PESO_MINIMO))).toBeCloseTo(-azulDominando, 6);
  });
});
