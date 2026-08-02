import * as THREE from 'three';

/**
 * Câmera de construtor de cidade.
 *
 * ## O que muda em relação a uma câmera orbital comum
 *
 * A diferença que o jogador sente não é o ângulo, é **quem manda no dedo**.
 * Numa câmera orbital, arrastar gira o mundo em volta de um ponto; num City
 * Skylines, arrastar *empurra o chão*, e o ponto sob o dedo continua sob o
 * dedo. A segunda é a que faz um mapa grande parecer navegável, e é por isso
 * que todo tycoon usa ela.
 *
 * Daí o mapeamento:
 *
 * | Gesto | Ação |
 * |---|---|
 * | um dedo | arrastar o terreno |
 * | dois dedos, pinça | aproximar e afastar |
 * | dois dedos, torção | girar em torno do alvo |
 * | dois dedos, vertical | inclinar |
 *
 * ## Por que a faixa de inclinação é estreita e alta
 *
 * A visão é de cima. O piso de 1,18 rad (68°) não é preferência estética: é o
 * ângulo abaixo do qual a câmera começa a enxergar o horizonte, e com ele a
 * borda do trecho carregado. Um mundo com fim visível deixa de parecer mundo.
 *
 * Sobra pouco espaço para o acoplamento zoom -> inclinação — de perto e de
 * longe a câmera fica quase igual. Ele continua aqui porque define a direção
 * (afastar nunca rebaixa) e porque volta a ter efeito se a faixa reabrir.
 */

export interface CityCameraLimits {
  readonly minDistance: number;
  readonly maxDistance: number;
  /** Inclinação mínima, em radianos acima do horizonte. */
  readonly minPitch: number;
  readonly maxPitch: number;
}

export const defaultLimits: CityCameraLimits = {
  // A vila tem ~46 m de raio. Os limites acompanham isso:
  //
  // - 14 m é perto o bastante para ver uma construção de 1 tile inteira, sem
  //   a câmera entrar dentro dela.
  // - 110 m enquadra a vila inteira com folga. Passar disso não mostra mais
  //   jogo — só mostra o cinza de fora do limite, e o mapa vira decoração.
  //
  // Antes eram 12 e 220. O teto de 220 deixava afastar até o mundo virar uma
  // mancha verde sem escala, que é o oposto do que uma visão de planejamento
  // deveria dar.
  minDistance: 14,
  maxDistance: 110,
  // 0,95 rad ≈ 54°. É o piso de uma visão de cima: abaixo disso a câmera
  // começa a enxergar o horizonte, e com ele a borda do trecho carregado — o
  // mundo passa a ter fim visível, que é exatamente o que quebra a ilusão.
  // O teto de grama ainda aparece em ângulo, então a silhueta não se perde.
  minPitch: 1.18,
  // 1,45 rad ≈ 83°. Noventa graus exatos degeneram o `lookAt` — o vetor "para
  // cima" fica paralelo à direção de visão e a câmera dá um giro sem motivo.
  maxPitch: 1.45,
};

export class CityCamera {
  /** Ponto do terreno que a câmera observa. */
  readonly target = new THREE.Vector3();

  /** Giro em torno do alvo, em radianos. */
  yaw = 0.7;

  /** Inclinação pedida pelo jogador, antes do piso do zoom. */
  private desiredPitch = 0.55;

  distance = 46;

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    private readonly heightAt: (x: number, z: number) => number,
    readonly limits: CityCameraLimits = defaultLimits,
  ) {}

  /** Fração de afastamento, 0 = colado, 1 = no limite. */
  get zoomRatio(): number {
    const { minDistance, maxDistance } = this.limits;
    return (this.distance - minDistance) / (maxDistance - minDistance);
  }

  /**
   * Inclinação efetiva: a maior entre a pedida e o piso que o zoom impõe.
   *
   * Em telas altas soma-se um extra, porque em retrato o campo de visão
   * vertical dobra e o mesmo ângulo entrega uma tela cheia de céu.
   */
  get pitch(): number {
    const { minPitch, maxPitch } = this.limits;
    // Afastar levanta ainda mais: de longe o jogador planeja e quer a planta.
    const floor = minPitch + (maxPitch - minPitch) * 0.7 * this.zoomRatio;
    const portraitBoost = this.portraitBoost();
    return Math.min(
      maxPitch,
      Math.max(floor, this.desiredPitch) + portraitBoost,
    );
  }

  private portraitBoost(): number {
    const aspect = this.camera.aspect;
    if (!Number.isFinite(aspect) || aspect >= 1.2) return 0;
    return Math.min(0.42, (1.2 - aspect) * 0.5);
  }

  /**
   * Arrasta o terreno sob o dedo.
   *
   * A conversão de pixels para metros usa a altura do plano visível na
   * distância atual, e não um fator fixo: com fator fixo, arrastar de perto
   * atravessa o mapa e arrastar de longe não sai do lugar.
   */
  pan(dxPixels: number, dyPixels: number, viewportHeight: number): void {
    const worldPerPixel =
      (2 * this.distance * Math.tan((this.camera.fov * Math.PI) / 360)) /
      Math.max(1, viewportHeight);

    const dx = dxPixels * worldPerPixel;
    const dy = dyPixels * worldPerPixel;

    // Compensa a inclinação: quase de topo, um pixel vertical vale um metro;
    // rasante, vale muito mais. Sem isso o arrasto "cola" perto do horizonte.
    const forward = dy / Math.max(0.25, Math.sin(this.pitch));

    const cos = Math.cos(this.yaw);
    const sin = Math.sin(this.yaw);
    this.target.x -= dx * cos - forward * sin;
    this.target.z += dx * sin + forward * cos;
  }

  zoomBy(scale: number): void {
    const { minDistance, maxDistance } = this.limits;
    this.distance = Math.min(
      maxDistance,
      Math.max(minDistance, this.distance / scale),
    );
  }

  rotateBy(radians: number): void {
    this.yaw += radians;
  }

  tiltBy(radians: number): void {
    const { minPitch, maxPitch } = this.limits;
    this.desiredPitch = Math.min(
      maxPitch,
      Math.max(minPitch, this.desiredPitch + radians),
    );
  }

  /**
   * Recoloca a câmera. Chame depois de qualquer alteração.
   *
   * A altura do alvo acompanha o relevo e a câmera nunca desce abaixo dele: sem
   * essa trava, aproximar numa encosta enfia a câmera dentro do morro e a tela
   * fica preta — um dos jeitos mais rápidos de fazer um jogo parecer quebrado.
   */
  apply(): void {
    const groundY = this.heightAt(this.target.x, this.target.z);
    this.target.y = groundY;

    const pitch = this.pitch;
    const horizontal = this.distance * Math.cos(pitch);

    const x = this.target.x + horizontal * Math.sin(this.yaw);
    const z = this.target.z + horizontal * Math.cos(this.yaw);
    const y = this.target.y + this.distance * Math.sin(pitch);

    const terrainHere = this.heightAt(x, z);
    this.camera.position.set(x, Math.max(y, terrainHere + 2), z);
    this.camera.lookAt(this.target);
  }

  /** Leva o alvo para um ponto do mundo, mantendo ângulo e distância. */
  focusOn(x: number, z: number): void {
    this.target.x = x;
    this.target.z = z;
    this.apply();
  }
}
