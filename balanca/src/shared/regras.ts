/**
 * Meu Querido Rei — os números do jogo, num arquivo só.
 *
 * ## O jogo
 *
 * Dois reinos, dois castelos, dois baús vivos. O seu está trancado no cofre do
 * inimigo; resgatá-lo e trazê-lo à sua tesouraria vale um ponto. É o esqueleto
 * do Fat Princess, e o esqueleto é bom: resgate é um objetivo que dá para
 * explicar apontando para a tela.
 *
 * ## O diferencial: o peso é uma balança só
 *
 * No Fat Princess, bolo é defesa pura: você engorda o refém que está na sua
 * masmorra para o inimigo não conseguir carregá-lo de volta, e o cálculo acaba
 * aí.
 *
 * Aqui o peso do reino é **conservado**. Os dois baús dividem uma balança: a
 * soma dos dois pesos é sempre `PESO_TOTAL`. Cada bolsa de moedas que você
 * entulha no baú refém do seu cofre tira exatamente aquele peso do **seu** baú,
 * trancado lá do outro lado. O ouro do mundo é finito: enterrá-lo no baú do
 * inimigo enriquece o baú e empobrece o reino dele.
 *
 * Isso troca a conta inteira. Entulhar deixa de ser só defender:
 *
 * - o baú refém no seu cofre fica **mais pesado** — o inimigo precisa de mais
 *   gente para carregá-lo, e anda mais devagar quando consegue;
 * - o **seu** baú, do outro lado do mapa, fica mais leve na mesma hora — o seu
 *   resgate fica mais barato.
 *
 * Uma bolsa é ataque e defesa no mesmo gesto, e o inimigo está fazendo a mesma
 * coisa na direção contrária. A balança vira um cabo de guerra que corre a
 * partida inteira, visível numa barra só no alto da tela, e cada depósito é
 * território ganho nos dois sentidos.
 *
 * A consequência tática que fecha o desenho: moeda não nasce do chão. Sai de
 * **minério**, e minério sai de mula de carga que alguém teve de derrubar no
 * meio do mapa — e quem está saqueando é um a menos segurando a ponte. O custo
 * do domínio da balança é medido em gente.
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
 * "quanto vale uma bolsa?" sem ler o tick inteiro. Aqui a resposta é uma linha.
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
 * O peso do reino, dividido entre os dois baús. É esta soma que não muda:
 * entulhar move peso de um prato para o outro, nunca cria peso novo.
 */
export const PESO_TOTAL = 200;

/** Ninguém fica de papel: mesmo perdendo a balança inteira, sobra este peso. */
export const PESO_MINIMO = 40;
export const PESO_MAXIMO = PESO_TOTAL - PESO_MINIMO;

/** Quanto um depósito move na balança. */
export const PESO_POR_BOLSA = 12;

/** Minério que a Casa da Moeda consome para assar uma bolsa. */
export const MINERIO_POR_BOLSA = 2;

/** Segundos de forno depois que o trigo entrou. */
export const TEMPO_DE_CUNHAGEM = 6;

/** Bolsas parados no chão da Casa da Moeda, no máximo. Estoque não é banco. */
export const BOLSAS_NA_CASA = 3;

/** Cura de comer a bolsa em vez de entregá-lo. A escolha é o ponto. */
export const CURA_DA_BOLSA = 45;

/**
 * Quantos carregadores o baú exige, por faixa de peso.
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

/** Fração da velocidade normal de quem carrega o baú. */
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

/**
 * Até onde uma unidade avista o inimigo, para o minimapa.
 *
 * Nove tiles é mais ou menos o que cabe na altura da tela no zoom padrão — a
 * câmera enquadra treze tiles de altura, então isto é "o que a pessoa está
 * vendo", com folga.
 *
 * Fixo e igual para todos de propósito. Fazê-lo depender do que **de fato** cabe
 * na tela de cada um daria mais informação a quem tem monitor maior, que é
 * vantagem comprada com dinheiro. Ver `vista.ts`.
 */
export const ALCANCE_DE_VISTA = 9 * TILE;

/** Distância em que um botão de contexto encosta em algo. */
export const ALCANCE_DE_USO = 70;

/** Alcance de coleta e de entrega. */
export const ALCANCE_DE_COLETA = 80;

/** Segundos de picareta ou machado até a carga sair da jazida. */
export const TEMPO_DE_TRABALHO = 2.4;

/** Segundos até a árvore rebrotar e a pedreira voltar a render. */
export const JAZIDA_VOLTA_EM = 14;

// --- a caça ----------------------------------------------------------------

/** Vida de um bicho. O saqueador derruba em três golpes; um guerreiro, em oito. */
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

/** Distância máxima entre carregadores para o baú andar. */
export const ALCANCE_DE_AJUDA = 110;

/** Segundos que o baú espera no chão antes de voltar para o cofre. */
export const BAU_VOLTA_EM = 20;

/** Segundos que um chapéu fica no chão antes de voltar para a chapelaria. */
export const CHAPEU_VOLTA_EM = 25;

/** Empurrão que o baú dá ao ser alimentada — ela está de mau humor. */
export const EMPURRAO_DO_BAU = 220;

// --- rede ------------------------------------------------------------------

/** Segundos sem notícia de um cliente antes de considerá-lo ido. */
export const TIMEOUT_DO_CLIENTE = 20;

/** Teto de entradas de comando por pacote. Um cliente honesto manda uma. */
export const MAX_COMANDOS_POR_PACOTE = 8;
