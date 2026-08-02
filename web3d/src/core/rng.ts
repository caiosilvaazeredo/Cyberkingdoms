/**
 * Porta do `DeterministicRandom` do cliente Flutter.
 *
 * Duas implementações do mesmo gerador só têm valor se produzirem exatamente a
 * mesma sequência — é o que permite abrir a seed `neon-tokyo` no app e na web e
 * ver o mesmo mundo. O contrato é verificado por teste contra uma referência
 * gravada pelo Dart (`web3d/test/worldgen-fixture.json`); "parecido" reprova.
 *
 * A versão Dart já era aritmética de 32 bits, decomposta em metades de 16 bits,
 * justamente porque o dart2js compila `int` para double IEEE-754. Aqui isso sai
 * de graça: `Math.imul` é a mesma operação, implementada no motor.
 */

const MASK32 = 0xffffffff;

/** Multiplicação de 32 bits com truncamento, equivalente ao `_mul32` do Dart. */
const mul32 = (a: number, b: number): number => Math.imul(a, b) >>> 0;

export class DeterministicRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /**
   * Deriva um gerador filho a partir de um rótulo, sem consumir a sequência
   * deste. Dá a cada subsistema um fluxo independente e estável.
   */
  fork(label: string): DeterministicRandom {
    return new DeterministicRandom(mix(this.state, hashLabel(label)));
  }

  /** Próximo inteiro de 32 bits sem sinal (Mulberry32). */
  nextInt32(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let z = this.state;
    z = mul32(z ^ (z >>> 15), z | 1);
    z = (z ^ (z + mul32(z ^ (z >>> 7), z | 61))) >>> 0;
    return (z ^ (z >>> 14)) >>> 0;
  }

  /** Inteiro em `[0, max)`. */
  nextIntBelow(max: number): number {
    if (max <= 0) throw new RangeError('max deve ser > 0');
    return this.nextInt32() % max;
  }

  /** Inteiro em `[min, max]`, inclusivo nas duas pontas. */
  range(min: number, max: number): number {
    if (max < min) throw new RangeError('max deve ser >= min');
    return min + this.nextIntBelow(max - min + 1);
  }

  /** Double em `[0, 1)`. */
  nextDouble(): number {
    return this.nextInt32() / 4294967296;
  }

  /** Double em `[min, max)`. */
  rangeDouble(min: number, max: number): number {
    return min + this.nextDouble() * (max - min);
  }

  chance(probability: number): boolean {
    return this.nextDouble() < probability;
  }

  pick<T>(options: readonly T[]): T {
    if (options.length === 0) throw new RangeError('lista vazia');
    return options[this.nextIntBelow(options.length)]!;
  }

  /** Fisher-Yates in-place, na mesma ordem que a versão Dart. */
  shuffle<T>(items: T[]): void {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.nextIntBelow(i + 1);
      const tmp = items[i]!;
      items[i] = items[j]!;
      items[j] = tmp;
    }
  }
}

/**
 * Hash estável de uma string (FNV-1a de 32 bits).
 *
 * Percorre **unidades de código UTF-16**, não pontos de código: é o que
 * `String.codeUnits` do Dart devolve, e uma seed com emoji ou acento precisa
 * dar o mesmo número dos dois lados. Usar `[...label]` aqui pareceria mais
 * correto e quebraria o contrato para qualquer caractere fora do BMP.
 */
export function hashLabel(label: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < label.length; i++) {
    hash = (hash ^ label.charCodeAt(i)) >>> 0;
    hash = mul32(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Combina duas seeds. Finalizador do MurmurHash3 de 32 bits. */
export function mix(a: number, b: number): number {
  let z = (a ^ mul32(b, 0x9e3779b1)) >>> 0;
  z = (z ^ (z >>> 16)) >>> 0;
  z = mul32(z, 0x85ebca6b);
  z = (z ^ (z >>> 13)) >>> 0;
  z = mul32(z, 0xc2b2ae35);
  z = (z ^ (z >>> 16)) >>> 0;
  return z >>> 0;
}

/**
 * Ruído branco determinístico numa coordenada 2D.
 *
 * É o primitivo que decide "tem uma árvore aqui?" sem guardar estado nenhum:
 * a resposta depende só da seed e da posição, então é a mesma na primeira
 * visita e na centésima.
 */
export function whiteNoise2D(seed: number, x: number, y: number): number {
  const h = mix(seed, mix(mul32(x, 0x1f123bb5), mul32(y, 0x7c4a7c15)));
  return (h >>> 0) / 4294967296;
}

export { MASK32 };
