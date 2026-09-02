import { Sala, type Cliente } from '../src/server/sala';
import { princesaDe } from '../src/shared/estado';
import { IDS_DOS_MAPAS, MAPAS } from '../src/shared/mapas';
import { IDS_DOS_MODOS, MODOS, type IdDoModo } from '../src/shared/modos';
import { type IdDoMapa } from '../src/shared/mapas';
import { NIVEL_MAXIMO, TICKS_POR_SEGUNDO } from '../src/shared/regras';

/**
 * Roda partidas de bot e conta o que aconteceu.
 *
 * ## Por que esta ferramenta existe
 *
 * Um modo com números diferentes na tabela e um mapa com coordenadas diferentes
 * na lista **parecem** prontos e podem não fazer nada. Já aconteceu: o Banquete
 * nasceu com todos os testes passando e terminava idêntico ao clássico, porque
 * outra regra apagava a condição de vitória a cada ponto. Nenhum teste de
 * unidade pegaria isso — só rodar a partida inteira pega.
 *
 * O teste automatizado guarda o que já se sabe. Esta ferramenta serve para
 * **descobrir**, e o resultado dela é para um humano ler: quanto durou, quem
 * ganhou, por que caminho, e se algum mapa deixa a partida travada.
 *
 * ## Uso
 *
 *     npx tsx tools/medir.ts            # todos os modos no mapa padrão
 *     npx tsx tools/medir.ts mapas      # o modo clássico em todos os mapas
 *     npx tsx tools/medir.ts tudo       # a matriz inteira, e demora
 */

const SEEDS = [11, 22, 33];

function mudo(nome: string): Cliente {
  return {
    chave: nome,
    nome,
    unidade: null,
    time: null,
    assistindo: false,
    silencio: 0,
    enviar() {},
    fechar() {},
  };
}

interface Resultado {
  segundos: number | null;
  placar: string;
  abates: string;
  pesos: string;
  obra: string;
  bichos: string;
  vencedor: string;
}

function rodar(modo: IdDoModo, mapa: IdDoMapa, seed: number): Resultado {
  const sala = new Sala({ nome: 'm', seed, porTime: 6, esperaPorJogadores: 0, modo, mapa });
  sala.entrar(mudo('Obs'));
  const limite = MODOS[modo].duracao + 30;
  let segundos: number | null = null;
  for (let i = 0; i < limite * TICKS_POR_SEGUNDO && segundos === null; i++) {
    sala.tocar('Obs');
    sala.passo();
    if (sala.estado.fase === 'fim') segundos = Math.floor(i / TICKS_POR_SEGUNDO);
  }
  const e = sala.estado;
  const vivos = e.animais.filter((a) => a.vivo).length;
  return {
    segundos,
    placar: `${e.placar.azul}-${e.placar.vermelho}`,
    abates: `${e.abates.azul}-${e.abates.vermelho}`,
    pesos: `${Math.round(princesaDe(e, 'azul').peso)}/${Math.round(princesaDe(e, 'vermelho').peso)}`,
    obra: e.oficinas.map((o) => o.nivel).join('/') + `de${NIVEL_MAXIMO}`,
    bichos: `${vivos}/${e.animais.length}`,
    vencedor: e.vencedor ?? '—',
  };
}

function linha(r: Resultado): string {
  return (
    `${(r.segundos === null ? 'NÃO ACABOU' : `${r.segundos}s`).padEnd(11)}` +
    ` placar ${r.placar.padEnd(5)} abates ${r.abates.padEnd(7)}` +
    ` pesos ${r.pesos.padEnd(8)} obra ${r.obra.padEnd(6)}` +
    ` bichos ${r.bichos.padEnd(6)} vence ${r.vencedor}`
  );
}

const alvo = process.argv[2] ?? 'modos';
const combinacoes: { modo: IdDoModo; mapa: IdDoMapa }[] = [];
if (alvo === 'mapas') {
  for (const mapa of IDS_DOS_MAPAS) combinacoes.push({ modo: 'resgate', mapa });
} else if (alvo === 'tudo') {
  for (const modo of IDS_DOS_MODOS) {
    for (const mapa of IDS_DOS_MAPAS) combinacoes.push({ modo, mapa });
  }
} else {
  for (const modo of IDS_DOS_MODOS) combinacoes.push({ modo, mapa: 'corte' });
}

for (const { modo, mapa } of combinacoes) {
  console.log(`\n${MODOS[modo].nome} · ${MAPAS[mapa].nome}`);
  for (const seed of SEEDS) {
    console.log(`  seed ${seed}: ${linha(rodar(modo, mapa, seed))}`);
  }
}
