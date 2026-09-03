import { Sala, type Cliente } from '../src/server/sala';
import { bauDe } from '../src/shared/estado';
import { FORMATOS, campoPara } from '../src/shared/formatos';
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
 * na lista **parecem** prontos e podem não fazer nada. Já aconteceu: o Cofre Cheio
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
 *     npx tsx tools/medir.ts formatos   # o clássico em cada tamanho de time
 *     npx tsx tools/medir.ts tudo       # a matriz inteira, e demora
 *
 * ## A coluna do tempo de tick
 *
 * Só aparece nos formatos, e é a razão de eles serem medidos. Trinta e dois por
 * lado são sessenta e quatro bots pensando trinta vezes por segundo: a pergunta
 * "o modo funciona?" é fácil perto de "o servidor aguenta?", e a segunda só se
 * responde rodando.
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
  /** Quanto um tick custou, em média. O orçamento é 1000/30 = 33 ms. */
  msPorTick: number;
  unidades: number;
  /**
   * **Por que** a partida acabou.
   *
   * A coluna mais importante desta ferramenta, e a que faltava. Sem ela, medir
   * duração e placar diz que o modo "funciona" enquanto ele termina pelo mesmo
   * caminho do clássico — foi assim que o Cofre Cheio nasceu oco, e foi assim que
   * o Obra voltou a nascer oco depois de eu triplicar o custo da obra: as
   * partidas duravam o tempo certo e nenhuma delas era decidida pela obra.
   */
  motivo: string;
  placar: string;
  abates: string;
  pesos: string;
  obra: string;
  bichos: string;
  vencedor: string;
}

function rodar(modo: IdDoModo, mapa: IdDoMapa, seed: number, porTime = 6): Resultado {
  const sala = new Sala({ nome: 'm', seed, porTime, esperaPorJogadores: 0, modo, mapa });
  sala.entrar(mudo('Obs'));
  const limite = MODOS[modo].duracao + 30;
  let segundos: number | null = null;
  let ticks = 0;
  const comecou = Date.now();
  for (let i = 0; i < limite * TICKS_POR_SEGUNDO && segundos === null; i++) {
    sala.tocar('Obs');
    sala.passo();
    ticks++;
    if (sala.estado.fase === 'fim') segundos = Math.floor(i / TICKS_POR_SEGUNDO);
  }
  const msPorTick = (Date.now() - comecou) / Math.max(1, ticks);
  const e = sala.estado;
  const vivos = e.animais.filter((a) => a.vivo).length;
  const m = MODOS[modo];
  const motivo =
    segundos === null
      ? 'sem fim'
      : e.oficinas.some((o) => o.time === e.vencedor && o.nivel >= NIVEL_MAXIMO) && m.vitoriaPorObra
        ? 'OBRA'
        : m.abatesParaVencer !== null &&
            e.vencedor !== null &&
            e.abates[e.vencedor] >= m.abatesParaVencer
          ? 'ABATE'
          : e.vencedor !== null && e.placar[e.vencedor] >= m.pontosParaVencer
            ? 'resgate'
            : m.vitoriaPorBalanca && e.baus.some((p) => p.peso <= m.pesoQueVence)
              ? 'BALANÇA'
              : 'relógio';
  return {
    segundos,
    msPorTick,
    unidades: e.unidades.length,
    motivo,
    placar: `${e.placar.azul}-${e.placar.vermelho}`,
    abates: `${e.abates.azul}-${e.abates.vermelho}`,
    pesos: `${Math.round(bauDe(e, 'azul').peso)}/${Math.round(bauDe(e, 'vermelho').peso)}`,
    obra: e.oficinas.map((o) => o.nivel).join('/') + `de${NIVEL_MAXIMO}`,
    bichos: `${vivos}/${e.animais.length}`,
    vencedor: e.vencedor ?? '—',
  };
}

function linha(r: Resultado): string {
  return (
    `${(r.segundos === null ? 'NÃO ACABOU' : `${r.segundos}s`).padEnd(11)}` +
    ` por ${r.motivo.padEnd(8)}` +
    ` placar ${r.placar.padEnd(5)} abates ${r.abates.padEnd(7)}` +
    ` pesos ${r.pesos.padEnd(8)} obra ${r.obra.padEnd(6)}` +
    ` bichos ${r.bichos.padEnd(6)} vence ${r.vencedor}`
  );
}

const alvo = process.argv[2] ?? 'modos';

if (alvo === 'formatos') {
  console.log('Resgate, por tamanho de time (o orçamento de um tick é 33 ms)\n');
  for (const f of FORMATOS) {
    const campo = campoPara(f.porTime);
    if (campo === null) continue;
    for (const seed of SEEDS) {
      const r = rodar('resgate', campo, seed, f.porTime);
      console.log(
        `  ${f.nome.padEnd(8)} ${MAPAS[campo].nome.padEnd(12)} seed ${String(seed).padEnd(3)}` +
          ` ${String(r.unidades).padStart(2)} em campo · ${r.msPorTick.toFixed(2)} ms/tick · ${linha(r)}`,
      );
    }
  }
  process.exit(0);
}
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
