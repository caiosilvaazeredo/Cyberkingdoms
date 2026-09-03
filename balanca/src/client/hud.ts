import { CLASSES_COM_CHAPEU, perfil, vidaMaxima } from '../shared/classes';
import { nivelDe, bauDe, type Carga, type Estado, type Evento, type Unidade } from '../shared/estado';
import { MAPAS } from '../shared/mapas';
import { modoDe } from '../shared/modos';
import {
  carregadoresPara,
  pesoTotalDe,
  outroTime,
  type Time,
} from '../shared/regras';
import type { Ajustes } from './ajustes';
import { COR_DA_VAGA } from './desenho';
import type { Entrada } from './entrada';
import { caixaDoMinimapa } from './minimapa';
import type { Rede } from './rede';

/**
 * A interface, e a barra que explica o jogo sem texto.
 *
 * ## A balança é o HUD
 *
 * Um jogo cujo diferencial é uma grandeza conservada precisa mostrar essa
 * grandeza o tempo todo, e mostrar de um jeito que não peça leitura. Por isso a
 * barra do alto é **uma só**, dividida: o pedaço azul é o quanto o reino azul
 * encheu o baú refém que guarda, o vermelho é o mesmo do outro lado, e a soma dos
 * dois é sempre a largura inteira.
 *
 * Quem olha entende três coisas de uma vez, sem número: quem está ganhando a
 * balança, quanto falta para o talo, e — porque o número de carregadores está
 * escrito em cada ponta — quantas pessoas o resgate vai custar.
 *
 * ## Por que o resto é discreto
 *
 * Tudo o mais (vida, carga, chapéus em estoque) é desenhado pequeno e no canto.
 * A tela de um jogo de ação é disputada, e a atenção que o HUD toma é atenção
 * que sai do campo. O que precisa de destaque tem destaque: o aviso de que o
 * cortejo está travado por falta de escolta aparece no meio da tela, porque é
 * um problema que o jogador tem de resolver **agora**.
 */

const COR: Record<Time, string> = { azul: '#3b7fe0', vermelho: '#e04b3b' };
const COR_CLARA: Record<Time, string> = { azul: '#8fc0ff', vermelho: '#ff9c8f' };
const NOME_DO_TIME: Record<Time, string> = { azul: 'Azul', vermelho: 'Vermelho' };

/**
 * Como cada carga se chama na tela.
 *
 * Existe porque o cartão do sofá escrevia o identificador cru — "minerio",
 * "bau" — no lugar onde a pessoa lê o que está carregando. O identificador é
 * do código; o rótulo é de quem joga, e os dois não precisam ser a mesma
 * palavra.
 */
const NOME_DA_CARGA: Record<Carga, string> = {
  nada: '',
  madeira: 'madeira',
  ouro: 'ouro',
  minerio: 'minério',
  bolsa: 'bolsa de moedas',
  bau: 'o baú',
};

/**
 * @param locais as unidades de quem está neste aparelho, em ordem de vaga.
 * Uma pessoa ganha o cartão grande de sempre; de duas em diante, cada uma ganha
 * um cartão estreito com a cor da sua vaga — porque numa tela dividida por
 * quatro o problema é saber **qual boneco é o seu**, e não ler o estoque da
 * chapelaria com letra grande.
 */
export function desenharHud(
  ctx: CanvasRenderingContext2D,
  rede: Rede,
  locais: readonly { vaga: number; unidade: Unidade }[],
  entrada: Entrada,
  largura: number,
  altura: number,
  tempo: number,
  ajustes: Ajustes,
): void {
  const estado = rede.estado;
  const eu = locais[0]?.unidade ?? null;
  // Entre o "bem-vindo" e o primeiro retrato existe um punhado de quadros em
  // que o estado existe mas está vazio. Desenhar a balança ali significaria
  // procurar um baú que ainda não chegou.
  if (!estado || estado.baus.length < 2) return;

  balanca(ctx, estado, largura, eu?.time ?? 'azul');
  placar(ctx, estado, largura);
  cabecalho(ctx, rede, largura);
  if (locais.length > 1) {
    cartoesDoSofa(ctx, estado, locais, largura, altura);
  } else if (eu) {
    cartaoDaClasse(ctx, estado, eu, largura, altura);
  }
  // O aviso do meio da tela é do dono do aparelho: quatro avisos empilhados no
  // centro tapariam a briga que eles mandam resolver.
  if (eu) avisosDoCentro(ctx, estado, eu, largura, altura, tempo);
  if (ajustes.registro) registro(ctx, rede, largura, altura, ajustes);
  faixaDeFase(ctx, estado, largura, altura, tempo);
  if (entrada.placarAberto) tabela(ctx, estado, largura, altura);
  botoesDeToque(ctx, entrada, largura, altura);
}

/**
 * Uma tira de cartões no rodapé, um por pessoa do sofá.
 *
 * Cada um leva a cor da vaga — a mesma da seta sobre a cabeça do boneco. É esse
 * par de cores que responde, sem texto, "cadê o meu?" e "quanta vida eu tenho?"
 * na única tela que os quatro dividem.
 */
function cartoesDoSofa(
  ctx: CanvasRenderingContext2D,
  estado: Estado,
  locais: readonly { vaga: number; unidade: Unidade }[],
  largura: number,
  altura: number,
): void {
  const espaco = largura < 560 ? 4 : 8;
  const l = Math.min(210, (largura - espaco * (locais.length + 1)) / locais.length);
  // Estreito demais para o nome e a classe caberem, o cartão encolhe para o que
  // não pode faltar: a cor da vaga e a barra de vida. Escrever "Lenhador · ouro"
  // em setenta pixels não informa nada — só suja a beira da tela.
  const apertado = l < 116;
  const a = apertado ? 34 : 58;
  const y = altura - a - 10;
  const total = l * locais.length + espaco * (locais.length - 1);
  let x = (largura - total) / 2;

  for (const { vaga, unidade: u } of locais) {
    const cor = COR_DA_VAGA[vaga % COR_DA_VAGA.length]!;
    const max = vidaMaxima(u.classe, nivelDe(estado, u.time));
    const margem = apertado ? 8 : 12;
    ctx.save();
    ctx.fillStyle = 'rgba(12, 14, 20, 0.75)';
    arredondado(ctx, x, y, l, a, 8);
    ctx.fill();
    ctx.fillStyle = cor;
    ctx.fillRect(x, y, 4, a);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = cor;
    ctx.font = '700 12px "Trebuchet MS", system-ui, sans-serif';
    ctx.fillText(
      apertado ? `P${vaga + 1}` : `P${vaga + 1} · ${u.nome}`.slice(0, 22),
      x + margem,
      y + 7,
    );

    if (!apertado) {
      ctx.fillStyle = 'rgba(255,255,255,0.72)';
      ctx.font = '500 11px "Trebuchet MS", system-ui, sans-serif';
      ctx.fillText(
        `${perfil(u.classe).nome}${u.carga !== 'nada' ? ` · ${NOME_DA_CARGA[u.carga]}` : ''}`,
        x + margem,
        y + 23,
      );
    }

    const barra = l - margem * 2;
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(x + margem, y + a - 14, barra, 7);
    // Morto continua na tira, com a barra vazia: sumir o cartão faria a pessoa
    // achar que perdeu a vaga em vez de estar esperando o renascimento.
    ctx.fillStyle = !u.vivo ? '#555' : u.vida / max > 0.35 ? '#6ac46a' : '#d9534f';
    ctx.fillRect(x + margem, y + a - 14, (barra * Math.max(0, u.vida)) / max, 7);
    ctx.restore();
    x += l + espaco;
  }
}

/** A barra que dá nome ao jogo. */
function balanca(ctx: CanvasRenderingContext2D, estado: Estado, largura: number, meu: Time): void {
  const azulTemNoCofre = bauDe(estado, 'vermelho').peso;
  const vermelhoTemNoCofre = bauDe(estado, 'azul').peso;
  const l = Math.min(560, largura - 80);
  const x = (largura - l) / 2;
  const y = 72;
  const a = 22;
  const fracaoAzul = azulTemNoCofre / pesoTotalDe(estado.porTime);

  ctx.save();
  ctx.fillStyle = 'rgba(12, 14, 20, 0.72)';
  arredondado(ctx, x - 8, y - 8, l + 16, a + 40, 10);
  ctx.fill();

  ctx.fillStyle = COR.azul;
  ctx.fillRect(x, y, l * fracaoAzul, a);
  ctx.fillStyle = COR.vermelho;
  ctx.fillRect(x + l * fracaoAzul, y, l * (1 - fracaoAzul), a);

  // O fiel da balança: onde estaria o equilíbrio perfeito.
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + l / 2, y - 6);
  ctx.lineTo(x + l / 2, y + a + 6);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, l, a);

  // Estreito, as duas legendas se encontrariam no meio e virariam uma linha
  // ilegível. Aí a palavra "carregadores" some e fica o número, que é a
  // informação — quem está jogando já sabe o que aquele número conta.
  const curto = largura < 640;
  ctx.font = `600 ${curto ? 11 : 12}px "Trebuchet MS", system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.fillText(
    curto
      ? `Azul: ${Math.round(azulTemNoCofre)} · ${carregadoresPara(azulTemNoCofre, estado.porTime)}↑`
      : `baú refém do Azul: ${Math.round(azulTemNoCofre)} · ${carregadoresPara(azulTemNoCofre, estado.porTime)} carregadores`,
    x,
    y + a + 14,
  );
  ctx.textAlign = 'right';
  ctx.fillText(
    curto
      ? `${carregadoresPara(vermelhoTemNoCofre, estado.porTime)}↑ · Vermelho: ${Math.round(vermelhoTemNoCofre)}`
      : `${carregadoresPara(vermelhoTemNoCofre, estado.porTime)} carregadores · baú refém do Vermelho: ${Math.round(vermelhoTemNoCofre)}`,
    x + l,
    y + a + 14,
  );

  // No Cofre Cheio a barra não é só o desempate: é a linha de chegada. O rótulo
  // diz isso, porque é a única diferença visível entre os dois modos e ninguém
  // vai deduzi-la olhando uma barra que parece a de sempre.
  ctx.textAlign = 'center';
  ctx.fillStyle = COR_CLARA[meu];
  ctx.font = '700 12px "Trebuchet MS", system-ui, sans-serif';
  ctx.fillText(
    modoDe(estado.modo).vitoriaPorBalanca ? 'A BALANÇA VENCE' : 'A BALANÇA DO REINO',
    x + l / 2,
    y - 13,
  );
  ctx.restore();
}

function placar(ctx: CanvasRenderingContext2D, estado: Estado, largura: number): void {
  const minutos = Math.floor(estado.relogio / 60);
  const segundos = Math.floor(estado.relogio % 60);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = '700 26px "Trebuchet MS", system-ui, sans-serif';
  // No Abate o placar **é** o de baixas: mostrar resgates num modo em que
  // ninguém carrega o baú seria dois zeros que nunca mudam ao lado de um
  // relógio que corre.
  const contagem = modoDe(estado.modo).abatesParaVencer !== null ? estado.abates : estado.placar;
  ctx.fillStyle = COR.azul;
  ctx.fillText(String(contagem.azul), largura / 2 - 64, 8);
  ctx.fillStyle = COR.vermelho;
  ctx.fillText(String(contagem.vermelho), largura / 2 + 64, 8);
  ctx.fillStyle = '#f2e6c9';
  ctx.font = '600 18px "Trebuchet MS", system-ui, sans-serif';
  ctx.fillText(`${minutos}:${String(segundos).padStart(2, '0')}`, largura / 2, 12);
  ctx.font = '400 10px "Trebuchet MS", system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.fillText(objetivoDoModo(estado), largura / 2, 34);
  ctx.restore();
}

/**
 * Uma linha dizendo como se ganha esta partida.
 *
 * Nasce do modo, e não de constante: escrita fixa, ela mentia em dois dos
 * quatro modos que existiam, e mentiria em três dos sete de hoje. Uma tela que
 * promete a regra errada é pior do que uma que não promete nada — a pessoa joga
 * a partida inteira perseguindo o objetivo de outro jogo.
 */
function objetivoDoModo(estado: Estado): string {
  const modo = modoDe(estado.modo);
  if (modo.abatesParaVencer !== null) return `${modo.abatesParaVencer} baixas vencem`;
  if (modo.vitoriaPorObra) return 'vence quem terminar a chapelaria';
  const alvo =
    modo.pontosParaVencer === 1 ? 'um resgate decide' : `resgates até ${modo.pontosParaVencer}`;
  return modo.vitoriaPorBalanca ? `${alvo} · ou a balança` : alvo;
}

function cabecalho(ctx: CanvasRenderingContext2D, rede: Rede, largura: number): void {
  const humanos = [...rede.elenco.values()].filter((f) => !f.bot).length;
  const bots = rede.elenco.size - humanos;
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = '500 12px "Trebuchet MS", system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  // A linha vai até onde o relógio começa. Num celular em pé a versão inteira
  // atravessava o meio da tela e escrevia por cima do placar — duas informações
  // no mesmo pixel viram nenhuma.
  const cabe = largura / 2 - 80;
  const nomeDoModo = modoDe(rede.modo).nome;
  const nomeDoMapa = MAPAS[rede.mapa]?.nome ?? rede.mapa;
  const inteira = `${nomeDoModo} · ${nomeDoMapa} · ${rede.sala} · ${humanos} jogadores, ${bots} bots · ${rede.ping} ms`;
  // Estreito, o que sobra é o modo e o mapa: numa sala montada por outra pessoa,
  // saber por que regra e em que campo se está jogando vale mais do que saber o
  // nome da sala.
  const curta = `${nomeDoModo} · ${nomeDoMapa} · ${rede.ping} ms`;
  ctx.fillText(ctx.measureText(inteira).width <= cabe ? inteira : curta, 12, 10);
  ctx.restore();
}

function cartaoDaClasse(
  ctx: CanvasRenderingContext2D,
  estado: Estado,
  eu: Unidade,
  largura: number,
  altura: number,
): void {
  const p = perfil(eu.classe);
  const nivel = nivelDe(estado, eu.time);
  const max = vidaMaxima(eu.classe, nivel);
  const x = 12;
  const y = altura - 108;
  // Num celular estreito o cartão não pode ser mais largo que a tela: 272 fixos
  // deixavam a linha da obra saindo pela direita.
  const l = Math.min(272, largura - 24);
  ctx.save();
  ctx.fillStyle = 'rgba(12, 14, 20, 0.72)';
  arredondado(ctx, x, y, l, 96, 10);
  ctx.fill();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = COR_CLARA[eu.time];
  ctx.font = '700 15px "Trebuchet MS", system-ui, sans-serif';
  ctx.fillText(`${p.nome}${eu.carga !== 'nada' ? ` · ${eu.carga}` : ''}`, x + 12, y + 10);

  const barra = l - 102;
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(x + 12, y + 32, barra, 8);
  ctx.fillStyle = eu.vida / max > 0.35 ? '#6ac46a' : '#d9534f';
  ctx.fillRect(x + 12, y + 32, (barra * Math.max(0, eu.vida)) / max, 8);
  ctx.font = '500 11px "Trebuchet MS", system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillText(`${Math.max(0, Math.round(eu.vida))}/${max}`, x + barra + 20, y + 30);

  const estoque = estado.estoque[eu.time];
  const chapeus = CLASSES_COM_CHAPEU.filter((c) => estoque[c] > 0)
    .map((c) => `${perfil(c).nome.slice(0, 3).toLowerCase()} ${estoque[c]}`)
    .join(' · ');
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillText(`chapelaria: ${chapeus || 'vazia'}`, x + 12, y + 48);
  const forno = estado.casasDaMoeda.find((c) => c.time === eu.time);
  if (forno) {
    ctx.fillText(
      `moeda: ${forno.bolsas} bolsa(s) · ${forno.minerio} minério${forno.cunhando > 0 ? ' · cunhando' : ''}`,
      x + 12,
      y + 62,
    );
  }
  const oficina = estado.oficinas.find((o) => o.time === eu.time);
  if (oficina) {
    ctx.fillText(
      `obra ${'I'.repeat(oficina.nivel)} · ${oficina.madeira} madeira · ${oficina.ouro} ouro`,
      x + 12,
      y + 76,
    );
  }
  ctx.restore();
}

/** Os avisos que não podem passar despercebidos. */
function avisosDoCentro(
  ctx: CanvasRenderingContext2D,
  estado: Estado,
  eu: Unidade,
  largura: number,
  altura: number,
  tempo: number,
): void {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (!eu.vivo) {
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, largura, altura);
    ctx.fillStyle = '#f2e6c9';
    ctx.font = '700 34px "Trebuchet MS", system-ui, sans-serif';
    ctx.fillText('caiu em combate', largura / 2, altura / 2 - 16);
    ctx.font = '500 18px "Trebuchet MS", system-ui, sans-serif';
    ctx.fillText(`volta em ${Math.ceil(eu.renasceEm)}s`, largura / 2, altura / 2 + 18);
    ctx.restore();
    return;
  }

  if (eu.colheita > 0 && eu.colheita < 1) {
    ctx.font = '600 16px "Trebuchet MS", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,233,168,0.9)';
    ctx.fillText('trabalhando — andar cancela', largura / 2, altura - 172);
  }

  if (eu.carga === 'bau') {
    const p = estado.baus.find((x) => x.portador === eu.id);
    if (p) {
      const precisa = carregadoresPara(p.peso, estado.porTime);
      const tem = p.ajudantes + 1;
      const falta = precisa - tem;
      ctx.font = '700 22px "Trebuchet MS", system-ui, sans-serif';
      if (falta > 0) {
        const pulso = 0.6 + Math.abs(Math.sin(tempo * 4)) * 0.4;
        ctx.fillStyle = `rgba(255, 120, 90, ${pulso})`;
        ctx.fillText(
          `pesada demais — faltam ${falta} carregador${falta > 1 ? 'es' : ''}`,
          largura / 2,
          altura - 150,
        );
      } else {
        ctx.fillStyle = 'rgba(150, 240, 160, 0.95)';
        ctx.fillText(`levando o baú (${tem}/${precisa})`, largura / 2, altura - 150);
      }
    }
  }
  ctx.restore();
}

export function desenharDica(
  ctx: CanvasRenderingContext2D,
  texto: string,
  largura: number,
  altura: number,
  toque: boolean,
): void {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '600 16px "Trebuchet MS", system-ui, sans-serif';
  const rotulo = toque ? texto : `[E] ${texto}`;
  const l = ctx.measureText(rotulo).width + 28;
  ctx.fillStyle = 'rgba(12, 14, 20, 0.78)';
  arredondado(ctx, (largura - l) / 2, altura - 120, l, 32, 8);
  ctx.fill();
  ctx.fillStyle = '#ffe9a8';
  ctx.fillText(rotulo, largura / 2, altura - 104);
  ctx.restore();
}

/** O registro do que acabou de acontecer, no canto direito. */
function registro(
  ctx: CanvasRenderingContext2D,
  rede: Rede,
  largura: number,
  altura: number,
  ajustes: Ajustes,
): void {
  const agora = performance.now();
  ctx.save();
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.font = '500 13px "Trebuchet MS", system-ui, sans-serif';
  // O mural começa abaixo do minimapa quando ele está ligado: os dois moram no
  // canto de cima à direita, e sobrepostos nenhum dos dois se lê.
  const caixa = ajustes.minimapa && rede.arena ? caixaDoMinimapa(largura, rede.arena) : null;
  let y = caixa ? caixa.y + caixa.a + 14 : 110;
  for (const aviso of rede.avisos) {
    const idade = (agora - aviso.quando) / 1000;
    if (idade > 8) continue;
    ctx.globalAlpha = Math.max(0, Math.min(1, (8 - idade) / 2));
    ctx.fillStyle = aviso.cor ?? 'rgba(255,255,255,0.9)';
    ctx.fillText(aviso.texto, largura - 14, y);
    y += 18;
  }
  ctx.restore();
  void altura;
}

function faixaDeFase(
  ctx: CanvasRenderingContext2D,
  estado: Estado,
  largura: number,
  altura: number,
  tempo: number,
): void {
  if (estado.fase === 'aquecimento') {
    contagemRegressiva(ctx, estado, largura, altura, tempo);
    return;
  }
  if (estado.fase === 'jogando') {
    vaiSeAcabouDeComecar(ctx, largura, altura, tempo);
    return;
  }

  let texto: string | null = null;
  let cor = '#f2e6c9';
  if (estado.fase === 'ponto') texto = 'baú em casa!';
  if (estado.fase === 'fim') {
    texto = estado.vencedor ? `${NOME_DO_TIME[estado.vencedor]} vence` : 'empate';
    cor = estado.vencedor ? COR_CLARA[estado.vencedor] : '#f2e6c9';
  }
  if (!texto) return;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '700 40px "Trebuchet MS", system-ui, sans-serif';
  ctx.fillStyle = cor;
  ctx.globalAlpha = 0.85 + Math.sin(tempo * 3) * 0.15;
  ctx.fillText(texto, largura / 2, altura / 2 - 60);
  if (estado.fase === 'fim') {
    ctx.font = '500 16px "Trebuchet MS", system-ui, sans-serif';
    ctx.globalAlpha = 0.9;
    ctx.fillText('a próxima partida começa em instantes', largura / 2, altura / 2 - 20);
  }
  ctx.restore();
}

/**
 * A contagem regressiva do aquecimento — a mesma promessa do "champion
 * select": todo mundo se prepara atrás de uma parede fechada, e os últimos
 * instantes antes dela sumir são o momento mais visível da tela.
 *
 * ## Dois estágios, e não um número que só encolhe
 *
 * Do início até faltarem três segundos, o aviso é uma frase — "o portão abre
 * em N" — pequena o bastante para não brigar com o resto do HUD enquanto a
 * pessoa ainda está escolhendo chapéu. Nos três segundos finais ele vira o
 * numeral gigante, pulsando, no centro da tela: é o instante em que ninguém
 * devia estar fazendo mais nada além de olhar para o relógio.
 *
 * O "VAI!" não é um terceiro estágio, é um quadro só — `faseEm` chega a zero
 * e no próximo retrato a fase já é `jogando`, então ele é desenhado a partir
 * do tempo de parede (`tempo`) medido contra o instante em que a fase virou,
 * e não a partir de `estado.faseEm`, que já não existe mais para contar.
 */
let apitouEm: number | null = null;

function contagemRegressiva(
  ctx: CanvasRenderingContext2D,
  estado: Estado,
  largura: number,
  altura: number,
  tempo: number,
): void {
  const faltam = estado.faseEm;
  const cx = largura / 2;
  const cy = altura / 2 - 60;
  apitouEm = null;

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (faltam > 3) {
    ctx.font = '700 30px "Trebuchet MS", system-ui, sans-serif';
    ctx.fillStyle = '#f2e6c9';
    ctx.globalAlpha = 0.9;
    ctx.fillText(`o portão abre em ${Math.ceil(faltam)}`, cx, cy);
    ctx.restore();
    return;
  }

  // Os três segundos finais: o numeral cresce e pulsa mais forte quanto mais
  // perto do zero, para o olho ser puxado para o centro sem precisar ler. O
  // pulso usa `tempo` — relógio de parede do quadro, e não `faseEm` — porque
  // `faseEm` só muda quando um retrato novo chega; animado por ele, o pulso
  // teria a cadência da rede, não a de sessenta quadros por segundo.
  const n = Math.max(1, Math.ceil(faltam));
  const pulso = 1 + (0.5 + Math.sin(tempo * 6) * 0.5) * 0.3;
  ctx.font = `900 ${Math.round(120 * pulso)}px "Trebuchet MS", system-ui, sans-serif`;
  ctx.fillStyle = n === 1 ? '#ff9c8f' : '#ffd479';
  ctx.globalAlpha = 0.75 + Math.sin(tempo * 6) * 0.25;
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 18;
  ctx.fillText(String(n), cx, cy);
  ctx.restore();
}

/**
 * O "VAI!" que estoura no quadro em que o portão abre.
 *
 * Chamado toda vez que a fase é `jogando` — a função decide sozinha se ainda
 * vale a pena desenhar, comparando o relógio de parede com o instante em que
 * ela **notou** a virada. `apitouEm` é zerado por `contagemRegressiva`
 * sempre que o aquecimento ainda está rodando, então o primeiro quadro de
 * `jogando` é sempre o primeiro a marcar o instante — não há como este
 * "VAI!" disparar tarde ou sobreviver a uma nova partida.
 */
function vaiSeAcabouDeComecar(
  ctx: CanvasRenderingContext2D,
  largura: number,
  altura: number,
  tempo: number,
): void {
  if (apitouEm === null) apitouEm = tempo;
  const desde = tempo - apitouEm;
  const DURACAO = 0.9;
  if (desde >= DURACAO) return;

  const t = desde / DURACAO;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.globalAlpha = 1 - t;
  ctx.font = `900 ${Math.round(130 + t * 40)}px "Trebuchet MS", system-ui, sans-serif`;
  ctx.fillStyle = '#ffd479';
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 22;
  ctx.fillText('VAI!', largura / 2, altura / 2 - 60);
  ctx.restore();
}

function tabela(
  ctx: CanvasRenderingContext2D,
  estado: Estado,
  largura: number,
  altura: number,
): void {
  const l = Math.min(680, largura - 60);
  const a = Math.min(420, altura - 120);
  const x = (largura - l) / 2;
  const y = (altura - a) / 2;
  ctx.save();
  ctx.fillStyle = 'rgba(10, 12, 18, 0.9)';
  arredondado(ctx, x, y, l, a, 12);
  ctx.fill();
  ctx.textBaseline = 'top';

  for (const [coluna, time] of (['azul', 'vermelho'] as Time[]).entries()) {
    const cx = x + 20 + coluna * (l / 2);
    ctx.textAlign = 'left';
    ctx.font = '700 16px "Trebuchet MS", system-ui, sans-serif';
    ctx.fillStyle = COR_CLARA[time];
    ctx.fillText(`${NOME_DO_TIME[time]} — ${estado.placar[time]}`, cx, y + 16);
    ctx.font = '500 12px "Trebuchet MS", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText('jogador', cx, y + 42);
    ctx.fillText('aba  mor  fat  res  ent', cx + l / 2 - 168, y + 42);

    const time_ = estado.unidades
      .filter((u) => u.time === time)
      .sort((a2, b) => b.depositos + b.resgates * 5 - (a2.depositos + a2.resgates * 5));
    time_.forEach((u, i) => {
      const ly = y + 62 + i * 20;
      ctx.fillStyle = u.bot ? 'rgba(255,255,255,0.55)' : '#ffffff';
      ctx.font = '500 13px "Trebuchet MS", system-ui, sans-serif';
      ctx.fillText(`${u.nome}${u.bot ? ' ⚙' : ''} · ${perfil(u.classe).nome}`, cx, ly);
      ctx.fillText(
        `${pad(u.abates)}  ${pad(u.mortes)}  ${pad(u.depositos)}  ${pad(u.resgates)}  ${pad(u.entregas)}`,
        cx + l / 2 - 168,
        ly,
      );
    });
  }

  ctx.textAlign = 'center';
  ctx.font = '500 12px "Trebuchet MS", system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillText(
    'aba = abates · mor = mortes · dep = depósitos · res = resgates · ent = carga entregue',
    largura / 2,
    y + a - 26,
  );
  ctx.restore();
}

const pad = (n: number): string => String(n).padStart(2, ' ');

function botoesDeToque(
  ctx: CanvasRenderingContext2D,
  entrada: Entrada,
  largura: number,
  altura: number,
): void {
  const temToque = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  if (!temToque) {
    entrada.botoes = {};
    return;
  }
  const r = 46;
  // Os botões ficam do lado **oposto** ao manche: é a mão que sobra.
  const aDireita = entrada.ladoDoManche === 'esquerda';
  const bx = (recuo: number): number => (aDireita ? largura - recuo : recuo - r * 2);
  entrada.botoes = {
    atacar: { x: bx(150), y: altura - 130, largura: r * 2, altura: r * 2 },
    usar: { x: bx(240), y: altura - 80, largura: r * 2, altura: r * 2 },
  };
  ctx.save();
  ctx.font = '600 14px "Trebuchet MS", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const [nome, b] of Object.entries(entrada.botoes)) {
    ctx.fillStyle = 'rgba(20, 22, 30, 0.55)';
    ctx.beginPath();
    ctx.arc(b.x + r, b.y + r, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#ffe9a8';
    ctx.fillText(nome, b.x + r, b.y + r);
  }
  const manche = entrada.manche;
  if (manche) {
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(manche.x, manche.y, 56, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    const t = Math.min(1, Math.hypot(manche.dx, manche.dy) / 56);
    ctx.arc(manche.x + manche.dx * t, manche.y + manche.dy * t, 22, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function arredondado(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  l: number,
  a: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + l, y, x + l, y + a, r);
  ctx.arcTo(x + l, y + a, x, y + a, r);
  ctx.arcTo(x, y + a, x, y, r);
  ctx.arcTo(x, y, x + l, y, r);
  ctx.closePath();
}

/** Traduz um evento do servidor para uma linha do registro. */
export function narrar(
  evento: Evento,
  estado: Estado,
  meuTime: Time | null,
): { texto: string; cor?: string } | null {
  const nome = (id: number): string => estado.unidades.find((u) => u.id === id)?.nome ?? 'alguém';
  switch (evento.tipo) {
    case 'abate':
      return { texto: `${nome(evento.algoz)} derrubou ${nome(evento.vitima)}` };
    case 'deposito': {
      const quemGanhou = outroTime(evento.bau);
      return {
        texto: `${nome(evento.unidade)} entulhou o baú — refém do ${NOME_DO_TIME[quemGanhou]} em ${Math.round(evento.peso)}`,
        cor: COR_CLARA[quemGanhou],
      };
    }
    case 'resgate':
      return {
        texto: `${nome(evento.unidade)} trouxe o baú do ${NOME_DO_TIME[evento.time]} para casa!`,
        cor: COR_CLARA[evento.time],
      };
    case 'chapeu':
      return evento.roubado
        ? { texto: `${nome(evento.unidade)} roubou um chapéu de ${evento.classe}`, cor: '#ffd479' }
        : null;
    case 'nivel':
      return {
        texto: `a obra do ${NOME_DO_TIME[evento.time]} chegou ao nível ${'I'.repeat(evento.nivel)}`,
        cor: COR_CLARA[evento.time],
      };
    case 'saque':
      return null;
    case 'cura':
      return null;
    case 'pegouBau':
      return {
        texto: `${nome(evento.unidade)} pegou o baú do ${NOME_DO_TIME[evento.bau]}`,
        cor: evento.bau === meuTime ? COR_CLARA[evento.bau] : undefined,
      };
    case 'largouBau':
      return { texto: `o baú do ${NOME_DO_TIME[evento.bau]} caiu no chão` };
    case 'fim':
      return {
        texto: evento.vencedor ? `fim — ${NOME_DO_TIME[evento.vencedor]} vence` : 'fim — empate',
      };
    default:
      return null;
  }
}
