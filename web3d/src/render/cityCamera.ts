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
 * ## Por que a inclinação segue o zoom
 *
 * Longe, o jogador está planejando: quer ver o traçado, então a câmera sobe
 * para quase o topo. Perto, está apreciando: quer ver volume e silhueta, então
 * a câmera baixa. Amarrar as duas coisas evita o estado inútil de estar
 * afastado *e* rasante, onde só se vê horizonte.
 *
 * O jogador ainda pode inclinar à mão; o acoplamento define o **piso** do
 * ângulo, não o valor.
 */

export interface CityCameraLimits {
  readonly minDistance: number;
  readonly maxDistance: number;
  /** Inclinação mínima, em radianos acima do horizonte. */
  readonly minPitch: number;
  readonly maxPitch: number;
}

export const defaultLimits: CityCameraLimits = {
  minDistance: 12,
  maxDistance: 220,
  // 0,18 rad ≈ 10°: baixo o bastante para a grama ter volume, alto o bastante
  // para o terreno não virar uma linha.
  minPitch: 0.18,
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
    const floor = minPitch + (maxPitch - minPitch) * 0.55 * this.zoomRatio;
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
