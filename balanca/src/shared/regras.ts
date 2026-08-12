/**
 * A Balança do Reino — os números do jogo, num arquivo só.
 *
 * ## O jogo
 *
 * Dois reinos, dois castelos, duas princesas. A sua está presa na masmorra do
 * inimigo; resgatá-la e trazê-la ao seu trono vale um ponto. É o esqueleto do
 * Fat Princess, e o esqueleto é bom: resgate é um objetivo que dá para explicar
 * apontando para a tela.
 *
 * ## O diferencial: o peso é uma balança só
 *
 * No original, bolo é defesa pura. Você engorda a princesa que está na sua
 * masmorra para que o inimigo não consiga carregá-la de volta. Quem tem mais
 * bolo tem mais defesa, e o cálculo acaba aí.
 *
 * Aqui o peso do reino é **conservado**. As duas princesas dividem uma balança:
 * a soma dos dois pesos é sempre `PESO_TOTAL`. Cada fatia que você dá à refém
 * na sua masmorra tira exatamente o mesmo peso da sua princesa, presa lá do
 * outro lado.
 *
 * Isso troca a conta inteira. Alimentar deixa de ser só defender:
 *
 * - a refém na sua masmorra fica **mais pesada** — o inimigo precisa de mais
 *   gente para carregá-la, e anda mais devagar quando consegue;
 * - a **sua** princesa, do outro lado do mapa, fica mais leve na mesma hora —
 *   o seu resgate fica mais barato.
 *
 * Um bolo é ataque e defesa no mesmo gesto, e o inimigo está fazendo a mesma
 * coisa na direção contrária. A balança vira um cabo de guerra que corre a
 * partida inteira, visível numa barra só no alto da tela, e cada fatia entregue
 * é território ganho nos dois sentidos.
 *
 * A consequência tática que fecha o desenho: bolo não nasce do chão. Sai de
 * carne, e carne sai de bicho que alguém teve de caçar no meio do mapa — e quem
 * está caçando é um a menos segurando a ponte. O custo do domínio da balança é
 * medido em gente.
 *
 * ## O segundo diferencial: chapéu cai, e chapéu se rouba
 *
 * A classe vem do chapéu, como no original. Só que o estoque é finito e o
 * chapéu **cai no chão** quando o dono morre — e quem passar pega, inclusive o
 * inimigo. Um time que domina as trocas não só mata mais: ele desmonta a
 * composição do outro e veste a própria com o que roubou. Quando o time
 * vermelho não tem mais arqueiros, isso é uma história que aconteceu na
 * partida, não um número no menu.
 *
 * ## Por que tudo é constante nomeada e nada é número solto
 *
 * Balanceamento é o trabalho que nunca acaba. Se os números moram no meio da
 * lógica, mexer em um deles vira arqueologia, e ninguém consegue responder
 * "quanto vale um bolo?" sem ler o tick inteiro. Aqui a resposta é uma linha.
 */

/** Lado do tile, em unidades de mundo (que são pixels de arte). */
export const TILE = 64;

/** Tamanho da arena, em tiles. Ímpar em nada: o mapa é espelhado no meio. */
export const ARENA_LARGURA = 60;
export const ARENA_ALTURA = 34;

/** Passo fixo do servidor. Tudo na simulação é medido nesta moeda. */
export const TICKS_POR_SEGUNDO = 30;
export const DT = 1 / TICKS_POR_SEGUNDO;

/** Quantos ticks entre dois retratos enviados ao cliente. */
export const TICKS_POR_ENVIO = 2;

// --- times -----------------------------------------------------------------

export type Time = 'azul' | 'vermelho';
export const TIMES: readonly Time[] = ['azul', 'vermelho'];
export const outroTime = (t: Time): Time => (t === 'azul' ? 'vermelho' : 'azul');

// --- partida ---------------------------------------------------------------

/** Jogadores por time. Doze em campo é o teto do que a arena comporta. */
export const POR_TIME = 6;

/** Resgates para vencer. */
export const PONTOS_PARA_VENCER = 3;

/** Duração máxima, em segundos. Empate no tempo vai para a balança. */
export const DURACAO_DA_PARTIDA = 12 * 60;

/** Aquecimento antes do apito, em segundos. */
export const AQUECIMENTO = 5;

/** Pausa depois de um ponto, antes do reposicionamento. */
export const PAUSA_APOS_PONTO = 4;

/** Espera antes de chamar bots para completar o time. */
export const ESPERA_POR_JOGADORES = 12;

// --- a balança -------------------------------------------------------------

/**
 * O peso do reino, dividido entre as duas princesas. É esta soma que não muda:
 * alimentar move peso de um prato para o outro, nunca cria peso novo.
 */
export const PESO_TOTAL = 200;

/** Ninguém fica de papel: mesmo perdendo a balança inteira, sobra este peso. */
export const PESO_MINIMO = 40;
export const PESO_MAXIMO = PESO_TOTAL - PESO_MINIMO;

/** Quanto uma fatia move na balança. */
export const PESO_POR_BOLO = 12;

/** Carne que a cozinha consome para assar um bolo. */
export const CARNE_POR_BOLO = 2;

/** Segundos de forno depois que o trigo entrou. */
export const TEMPO_DE_FORNO = 6;

/** Bolos parados no chão da cozinha, no máximo. Estoque não é banco. */
export const BOLOS_NA_COZINHA = 3;

/** Cura de comer o bolo em vez de entregá-lo. A escolha é o ponto. */
export const CURA_DO_BOLO = 45;

/**
 * Quantos carregadores a princesa exige, por faixa de peso.
 *
 * O degrau é grosso de propósito: o jogador precisa saber, olhando a barra, se
 * o resgate é solo ou se vai precisar de escolta — um número contínuo não se lê
 * no meio de uma briga.
 */
export function carregadoresPara(peso: number): number {
  if (peso <= 70) return 1;
  if (peso <= 120) return 2;
  return 3;
}

/** Fração da velocidade normal de quem carrega a princesa. */
export function velocidadeCarregando(peso: number): number {
  const t = (peso - PESO_MINIMO) / (PESO_MAXIMO - PESO_MINIMO);
  return 0.85 - 0.45 * Math.max(0, Math.min(1, t));
}

// --- unidades --------------------------------------------------------------

/** Raio de colisão de uma unidade. */
export const RAIO_UNIDADE = 18;

/** Segundos até renascer. Sobe com os pontos do inimigo para não virar rolo. */
export const RENASCIMENTO_BASE = 6;
export const RENASCIMENTO_POR_PONTO = 1.5;

/** Distância em que um botão de contexto encosta em algo. */
export const ALCANCE_DE_USO = 70;

/** Alcance de coleta e de entrega. */
export const ALCANCE_DE_COLETA = 80;

/** Segundos de picareta ou machado até a carga sair da jazida. */
export const TEMPO_DE_TRABALHO = 2.4;

/** Segundos até a árvore rebrotar e a pedreira voltar a render. */
export const JAZIDA_VOLTA_EM = 14;

// --- a caça ----------------------------------------------------------------

/** Vida de um bicho. O caçador derruba em três golpes; um guerreiro, em oito. */
export const ANIMAL_VIDA = 58;

/** Velocidade pastando e velocidade em pânico. */
export const ANIMAL_PASTANDO = 70;
export const ANIMAL_FUGINDO = 205;

/** Segundos de pânico depois de apanhar. */
export const ANIMAL_PANICO = 3;

/** Segundos até outro bicho aparecer no lugar do que morreu. */
export const ANIMAL_VOLTA_EM = 18;

/** Até onde um bicho se afasta do lugar onde nasceu. */
export const ANIMAL_PASTO = 4 * TILE;

// --- a obra ----------------------------------------------------------------

/**
 * O que cada nível da chapelaria custa, em madeira e ouro.
 *
 * Os dois materiais são exigidos juntos de propósito: um time que só tem
 * lenhador acumula madeira e não sobe nada. A obra é o único lugar do jogo que
 * obriga dois ofícios diferentes a existirem ao mesmo tempo.
 */
export const CUSTO_DO_NIVEL: readonly { madeira: number; ouro: number }[] = [
  { madeira: 0, ouro: 0 },
  { madeira: 0, ouro: 0 },
  { madeira: 4, ouro: 4 },
  { madeira: 6, ouro: 6 },
];

export const NIVEL_MAXIMO = 3;

/** Distância máxima entre carregadores para a princesa andar. */
export const ALCANCE_DE_AJUDA = 110;

/** Segundos que a princesa espera no chão antes de voltar para a masmorra. */
export const PRINCESA_VOLTA_EM = 20;

/** Segundos que um chapéu fica no chão antes de voltar para a chapelaria. */
export const CHAPEU_VOLTA_EM = 25;

/** Empurrão que a princesa dá ao ser alimentada — ela está de mau humor. */
export const EMPURRAO_DA_PRINCESA = 220;

// --- rede ------------------------------------------------------------------

/** Segundos sem notícia de um cliente antes de considerá-lo ido. */
export const TIMEOUT_DO_CLIENTE = 20;

/** Teto de entradas de comando por pacote. Um cliente honesto manda uma. */
export const MAX_COMANDOS_POR_PACOTE = 8;
