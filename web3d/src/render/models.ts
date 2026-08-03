import * as THREE from 'three';

import { modelUrlFor, onOverridesChanged } from '../dev/spriteOverrides';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Carrega os modelos 3D da Kenney.
 *
 * ## Por que voltar aos `.glb`
 *
 * Eu tinha resolvido desenhar caixas coloridas, argumentando que num construtor
 * de cidade o que se lê de longe é silhueta e cor. O argumento não estava
 * errado, mas a conclusão estava: os modelos **já existiam**, já estavam
 * mapeados construção por construção no catálogo, e um telhado da Kenney lê a
 * silhueta melhor que qualquer caixa. Trocar arte pronta por primitiva foi
 * economia no lugar errado.
 *
 * Os `.glb` vêm dos mesmos kits que alimentaram o cliente isométrico, e o
 * `spriteId` de cada construção continua sendo a chave — o mapeamento não
 * precisou mudar em nada.
 *
 * ## Como o modelo é encaixado
 *
 * Cada kit tem sua própria escala e seu próprio ponto de origem. Em vez de
 * confiar nisso, o carregador mede a caixa envolvente e **normaliza**: escala
 * para a footprint que a regra do jogo declara, e assenta a base no chão. Assim
 * uma construção 3x2 ocupa 3x2 tiles, venha o modelo de onde vier.
 */

const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Object3D>>();

// Trocar um modelo no modo Dev invalida o que já foi baixado: sem isto, a peça
// continuaria mostrando o `.glb` antigo até recarregar a página, e o jogador
// concluiria que a troca não funcionou.
onOverridesChanged(() => cache.clear());

/**
 * Caminho público do modelo a partir do `spriteId` do catálogo.
 *
 * A estrutura de pastas espelha o `spriteId` — `miniforest/building-structure`
 * vira `models/miniforest/building-structure.glb` — e isso **não** é estética.
 * O `GLTFLoader` resolve textura relativa ao `.glb`, então achatar o nome para
 * `miniforest__building-structure.glb` fazia o modelo procurar a textura em
 * `models/Textures/` e não achar. Os prédios apareciam brancos, sem erro
 * nenhum no console.
 */
function urlFor(spriteId: string): string {
  // O modo Dev pode ter apontado este sprite para um arquivo local; fora dele,
  // `modelUrlFor` devolve exatamente o caminho acima.
  return modelUrlFor(spriteId);
}

/**
 * Carrega e normaliza um modelo.
 *
 * Devolve sempre o **mesmo** objeto do cache; quem for usar deve clonar. Isso
 * evita baixar o mesmo prédio dez vezes num terreno com dez cópias dele.
 */
export function loadModel(spriteId: string): Promise<THREE.Object3D> {
  const hit = cache.get(spriteId);
  if (hit) return hit;

  const promise = loader
    .loadAsync(urlFor(spriteId))
    .then((gltf) => {
      const root = gltf.scene;

      root.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        o.castShadow = false;
        o.receiveShadow = false;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          // Mesmo defeito do pipeline de sprites: quase todo kit da Kenney
          // declara metallicFactor 1, e sem environment map o three.js desenha
          // arte fosca como metal polido sem nada para refletir — tudo sai
          // escuro e dessaturado.
          if ('metalness' in m) (m as THREE.MeshStandardMaterial).metalness = 0;
          if ('roughness' in m) (m as THREE.MeshStandardMaterial).roughness = 0.85;
        }
      });

      return root;
    })
    .catch((erro: unknown) => {
      // Um modelo que falta não pode derrubar a cena inteira. Devolve um grupo
      // vazio e segue; o chamador desenha a caixa de reserva.
      console.warn(`modelo ausente: ${spriteId}`, erro);
      return new THREE.Group();
    });

  cache.set(spriteId, promise);
  return promise;
}

/**
 * Uma cópia pronta para entrar na cena, escalada para a footprint pedida.
 *
 * `footprintX`/`footprintZ` vêm da regra do jogo, em metros. O modelo é
 * escalado pelo **menor** dos dois fatores para não distorcer: esticar um
 * telhado para preencher um retângulo denuncia mais que sobrar um palmo de
 * grama na borda.
 */
export async function instantiate(
  spriteId: string,
  footprintX: number,
  footprintZ: number,
): Promise<THREE.Object3D | null> {
  const base = await loadModel(spriteId);
  if (base.children.length === 0) return null;

  const clone = base.clone(true);

  const box = new THREE.Box3().setFromObject(clone);
  const size = box.getSize(new THREE.Vector3());
  if (size.x <= 0 || size.z <= 0) return null;

  const escala = Math.min(footprintX / size.x, footprintZ / size.z);
  clone.scale.setScalar(escala);

  // Reposiciona para o centro da footprint com a base no chão. Sem isto,
  // modelos com origem no centro ficam meio enterrados e modelos com origem
  // num canto ficam fora da célula.
  const boxEscalada = new THREE.Box3().setFromObject(clone);
  const centro = boxEscalada.getCenter(new THREE.Vector3());
  clone.position.x -= centro.x;
  clone.position.z -= centro.z;
  clone.position.y -= boxEscalada.min.y;

  const wrapper = new THREE.Group();
  wrapper.add(clone);
  return wrapper;
}
