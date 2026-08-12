/**
 * Traz do pacote Tiny Swords só a arte que este jogo desenha.
 *
 * ## Por que existe um importador, e não um "copie a pasta"
 *
 * O pacote tem cinco cores de unidade, cinco de prédio, a interface inteira e
 * os inimigos pagos — alguns megabytes que o jogador baixaria para não ver. O
 * jogo usa duas cores e um punhado de folhas. Este roteiro é a lista explícita
 * do que entra, e serve de documentação: quem quiser saber de onde vem cada
 * sprite lê o mapa aqui embaixo.
 *
 * Ele também **renomeia** para o vocabulário do jogo. O pacote fala em Warrior,
 * Lancer e Monk; o resto do código fala em guerreiro, lanceiro e clérigo. Fazer
 * a tradução uma vez, na importação, evita que o inglês do pacote apareça no
 * meio de um `switch` em português três anos depois.
 *
 * ## Uso
 *
 *     node tools/importar-arte.mjs "/caminho/para/Tiny Swords (Free Pack)"
 *
 * O pacote se baixa em https://pixelfrog-assets.itch.io/tiny-swords (grátis,
 * "name your own price"). A licença permite usar e modificar em projeto
 * comercial; não permite redistribuir o pacote em si.
 */

import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const origem = process.argv[2];
if (!origem) {
  console.error('uso: node tools/importar-arte.mjs "<pasta do Tiny Swords (Free Pack)>"');
  process.exit(1);
}
const destino = resolve(process.cwd(), 'public/tiny');

/** Cor do pacote → cor do time. */
const CORES = [
  ['Blue', 'azul'],
  ['Red', 'vermelho'],
];

/** Sufixo da ferramenta do peão → ofício, no vocabulário do jogo. */
const FERRAMENTAS = [
  ['Axe', 'machado'],
  ['Pickaxe', 'picareta'],
  ['Knife', 'faca'],
];

/** Carga carregada na mão → nome do recurso no jogo. */
const CARGAS = [
  ['Wood', 'madeira'],
  ['Gold', 'ouro'],
  ['Meat', 'carne'],
];

const mapa = [];

for (const [cor, time] of CORES) {
  const u = `Units/${cor} Units`;
  const p = `units/${time}`;

  mapa.push(
    [`${u}/Warrior/Warrior_Idle.png`, `${p}/guerreiro_parado.png`],
    [`${u}/Warrior/Warrior_Run.png`, `${p}/guerreiro_correndo.png`],
    [`${u}/Warrior/Warrior_Attack1.png`, `${p}/guerreiro_golpe1.png`],
    [`${u}/Warrior/Warrior_Attack2.png`, `${p}/guerreiro_golpe2.png`],

    [`${u}/Lancer/Lancer_Idle.png`, `${p}/lanceiro_parado.png`],
    [`${u}/Lancer/Lancer_Run.png`, `${p}/lanceiro_correndo.png`],
    // A lança é a única arma com folha por direção: o pacote desenha a
    // estocada para cima, para o lado e para baixo, e espelhar dá as outras.
    [`${u}/Lancer/Lancer_Right_Attack.png`, `${p}/lanceiro_golpe_lado.png`],
    [`${u}/Lancer/Lancer_UpRight_Attack.png`, `${p}/lanceiro_golpe_cima_lado.png`],
    [`${u}/Lancer/Lancer_DownRight_Attack.png`, `${p}/lanceiro_golpe_baixo_lado.png`],
    [`${u}/Lancer/Lancer_Up_Attack.png`, `${p}/lanceiro_golpe_cima.png`],
    [`${u}/Lancer/Lancer_Down_Attack.png`, `${p}/lanceiro_golpe_baixo.png`],

    [`${u}/Archer/Archer_Idle.png`, `${p}/arqueiro_parado.png`],
    [`${u}/Archer/Archer_Run.png`, `${p}/arqueiro_correndo.png`],
    [`${u}/Archer/Archer_Shoot.png`, `${p}/arqueiro_golpe.png`],
    [`${u}/Archer/Arrow.png`, `${p}/flecha.png`],

    [`${u}/Monk/Idle.png`, `${p}/clerigo_parado.png`],
    [`${u}/Monk/Run.png`, `${p}/clerigo_correndo.png`],
    [`${u}/Monk/Heal.png`, `${p}/clerigo_golpe.png`],
    [`${u}/Monk/Heal_Effect.png`, `${p}/clerigo_bencao.png`],

    [`${u}/Pawn/Pawn_Idle.png`, `${p}/aldeao_parado.png`],
    [`${u}/Pawn/Pawn_Run.png`, `${p}/aldeao_correndo.png`],
  );

  for (const [ferramenta, oficio] of FERRAMENTAS) {
    mapa.push(
      [`${u}/Pawn/Pawn_Idle ${ferramenta}.png`, `${p}/${oficio}_parado.png`],
      [`${u}/Pawn/Pawn_Run ${ferramenta}.png`, `${p}/${oficio}_correndo.png`],
      [`${u}/Pawn/Pawn_Interact ${ferramenta}.png`, `${p}/${oficio}_trabalhando.png`],
    );
  }

  for (const [carga, nome] of CARGAS) {
    mapa.push(
      [`${u}/Pawn/Pawn_Idle ${carga}.png`, `${p}/carregando_${nome}_parado.png`],
      [`${u}/Pawn/Pawn_Run ${carga}.png`, `${p}/carregando_${nome}_correndo.png`],
    );
  }
}

const r = 'Terrain/Resources';
mapa.push(
  [`${r}/Meat/Sheep/Sheep_Idle.png`, 'recursos/ovelha_parada.png'],
  [`${r}/Meat/Sheep/Sheep_Move.png`, 'recursos/ovelha_andando.png'],
  [`${r}/Meat/Sheep/Sheep_Grass.png`, 'recursos/ovelha_pastando.png'],
  [`${r}/Meat/Meat Resource/Meat Resource.png`, 'recursos/carne.png'],
  [`${r}/Wood/Wood Resource/Wood Resource.png`, 'recursos/madeira.png'],
  [`${r}/Gold/Gold Resource/Gold_Resource.png`, 'recursos/ouro.png'],
  [`${r}/Gold/Gold Stones/Gold Stone 3.png`, 'recursos/jazida_ouro.png'],
  [`${r}/Gold/Gold Stones/Gold Stone 6.png`, 'recursos/jazida_ouro_vazia.png'],
);
for (let i = 1; i <= 4; i++) {
  mapa.push(
    [`${r}/Wood/Trees/Tree${i}.png`, `deco/Tree${i}.png`],
    [`${r}/Wood/Trees/Stump ${i}.png`, `deco/Stump${i}.png`],
  );
}

let copiados = 0;
const faltando = [];
for (const [de, para] of mapa) {
  const caminho = join(origem, de);
  if (!existsSync(caminho)) {
    faltando.push(de);
    continue;
  }
  const alvo = join(destino, para);
  mkdirSync(dirname(alvo), { recursive: true });
  cpSync(caminho, alvo);
  copiados++;
}

console.log(`copiados ${copiados} arquivos para ${destino}`);
if (faltando.length > 0) {
  console.error(`faltaram ${faltando.length}:`);
  for (const f of faltando) console.error(`  ${f}`);
  process.exit(1);
}
