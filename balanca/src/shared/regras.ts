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

/**
 * Aquecimento antes do apito, em segundos.
 *
 * Cinco segundos bastavam quando o aquecimento só segurava o combate — dava
 * para vestir um chapéu e pronto. Virou também uma parede fechada (o time não
 * sai do próprio castelo) e uma contagem regressiva grande na tela, e as duas
 * coisas precisam de tempo para serem **lidas**, não só cumpridas. Oito
 * segundos dão um "vestir o chapéu" com folga e um "3, 2, 1" que não estoura
 * antes de a pessoa erguer os olhos para o relógio.
 */
export const AQUECIMENTO = 8;

/** Pausa depois de um ponto, antes do reposicionamento. */
export const PAUSA_APOS_PONTO = 4;

/** Espera antes de chamar bots para completar o time. */
export const ESPERA_POR_JOGADORES = 12;

// --- a balança -------------------------------------------------------------

/**
 * O peso do reino num time de seis — a medida a partir da qual tudo escala.
 *
 * É esta soma que não muda **dentro de uma partida**: entulhar move peso de um
 * prato para o outro, nunca cria peso novo. Entre partidas ela muda com o
 * tamanho do time, e o porquê está em `pesoTotalDe`.
 */
export const PESO_TOTAL = 200;

/**
 * Ninguém fica de papel: mesmo perdendo a balança inteira, sobra este peso —
 * num time de seis. Ver `pesoMinimoDe`.
 */
export const PESO_MINIMO = 40;
export const PESO_MAXIMO = PESO_TOTAL - PESO_MINIMO;

// --- a escala --------------------------------------------------------------

/**
 * A economia em função do tamanho do time.
 *
 * ## O problema
 *
 * Os números abaixo foram medidos com seis por lado. Com trinta e dois, cinco
 * vezes mais gente cunha moeda, cava jazida e sobe obra — e nada mais muda. O
 * resultado não é uma partida grande: é uma partida que acaba em noventa
 * segundos porque a balança estourou antes de alguém chegar à ponte, com a obra
 * no nível três no primeiro minuto e um chapéu de arqueiro para cada seis
 * pessoas que o querem.
 *
 * ## A regra: o que é por pessoa cresce; o que é por partida, não
 *
 * A **razão** é `porTime / 6`. Cresce com ela tudo o que uma pessoa consome ou
 * produz — o peso que a balança comporta, o estoque de chapéus, o custo da
 * obra. Não cresce nada que seja da partida e não das pessoas: o relógio, os
 * pontos para vencer, a velocidade de quem anda.
 *
 * O que isto **preserva** é o tempo: se a produção de bolsas dobra e o peso que
 * a balança comporta dobra junto, o tempo até o talo é o mesmo. É a única
 * grandeza que precisa ficar igual, porque é dela que sai a duração da partida.
 *
 * ## Funções puras, e não um objeto no estado
 *
 * Poderia haver uma `Escala` montada uma vez e guardada no `Estado`. Não há,
 * porque ela teria de viajar no retrato, ser reconstruída pelo cliente e ficar
 * em dia com o servidor — três lugares onde a escala pode divergir. Aqui só
 * `porTime` viaja, e os dois lados chegam ao mesmo número pela mesma conta.
 */
export const razaoDaEscala = (porTime: number): number => Math.max(1, porTime) / POR_TIME;

/**
 * O peso que a balança comporta, para um time deste tamanho.
 *
 * A alternativa era manter `PESO_TOTAL` fixo e **dividir** o que cada bolsa
 * move. Daria o mesmo tempo de partida e um jogo pior: com trinta e dois por
 * lado, uma bolsa moveria dois pontos numa barra de duzentos, e o gesto que é a
 * assinatura do jogo não teria efeito visível nenhum. Crescendo o total, uma
 * bolsa continua movendo doze, e a barra — que é uma fração — continua parecendo
 * a mesma.
 */
export function pesoTotalDe(porTime: number): number {
  // Múltiplo de vinte para o meio da balança cair num número redondo, que é o
  // que a barra mostra a partida inteira.
  return Math.round((PESO_TOTAL * razaoDaEscala(porTime)) / 20) * 20;
}

/**
 * O piso da balança, para um time deste tamanho.
 *
 * Ele **tem** de escalar junto com o total, e por um motivo que só apareceu
 * quando o teste da invariante foi escrito. O que decide a duração da partida
 * não é o peso total: é a distância do meio até o talo, que é
 * `total / 2 - piso`. Com o total crescendo e o piso fixo em quarenta, essa
 * distância cresce **mais rápido** que o time — o piso morde uma fatia
 * proporcionalmente menor a cada formato.
 *
 * Medido: com o piso fixo, o número de bolsas por pessoa até o talo saía 12%
 * acima do normal em oito contra oito e **53%** acima em trinta e dois contra
 * trinta e dois. A partida grande levaria metade a mais de tempo para a balança
 * fechar, e a invariante que justifica a escala inteira estaria quebrada.
 *
 * Escalando o piso, a distância vira `razão × (100 - 40)` e é linear no time,
 * que é o que se queria.
 */
export const pesoMinimoDe = (porTime: number): number =>
  Math.round(PESO_MINIMO * razaoDaEscala(porTime));

export const pesoMaximoDe = (porTime: number): number =>
  pesoTotalDe(porTime) - pesoMinimoDe(porTime);

/** Quanto uma bolsa de moedas move na balança. Não escala — ver acima. */
export const PESO_POR_BOLSA = 12;

/** Minério que a Casa da Moeda consome para cunhar uma bolsa. */
export const MINERIO_POR_BOLSA = 2;

/** Segundos de cunhagem depois que o minério entrou. */
export const TEMPO_DE_CUNHAGEM = 6;

/** Bolsas paradas no chão da Casa da Moeda, no máximo. Estoque não é banco. */
export const BOLSAS_NA_CASA = 3;

/** Cura de gastar a bolsa consigo em vez de entregá-la. A escolha é o ponto. */
export const CURA_DA_BOLSA = 45;

/**
 * Quantos carregadores o baú pode chegar a exigir, num time deste tamanho.
 *
 * Três é o teto de sempre e continua sendo o de seis por lado. Ele existe
 * porque o degrau tem de ser **grosso**: o jogador precisa saber, olhando a
 * barra, se o resgate é solo ou se vai precisar de escolta, e um número
 * contínuo não se lê no meio de uma briga.
 *
 * Com times grandes, três deixa de ser escolta e vira detalhe — trinta e dois
 * mandam três sem sentir. O teto sobe com o time, mas para em oito: acima disso
 * o cortejo deixaria de ser um grupo e viraria o time inteiro, e o resto do
 * mapa ficaria vazio.
 */
export function carregadoresMaximos(porTime: number): number {
  return Math.max(3, Math.min(8, 1 + Math.round(porTime / 4)));
}

/**
 * Quantos carregadores o baú exige, por faixa de peso.
 *
 * Os degraus são iguais entre si, do peso mínimo ao máximo. Em seis por lado
 * isso dá as faixas de sempre com uma diferença: a primeira quebra em 80 e não
 * em 70. Foi trocado de propósito — a faixa irregular antiga não generalizava
 * para nenhum outro tamanho de time, e a medição com bots não mostrou mudança
 * no desfecho das partidas.
 */
export function carregadoresPara(peso: number, porTime: number = POR_TIME): number {
  const degraus = carregadoresMaximos(porTime);
  const piso = pesoMinimoDe(porTime);
  const faixa = pesoMaximoDe(porTime) - piso;
  const t = faixa <= 0 ? 0 : (peso - piso) / faixa;
  return Math.max(1, Math.min(degraus, 1 + Math.floor(t * degraus)));
}

/**
 * Chapéus de cada classe no armário, num time deste tamanho.
 *
 * O estoque finito é o segundo diferencial do jogo: um time que domina as
 * trocas desmonta a composição do outro. Isso só é verdade enquanto o armário é
 * apertado — com trinta e dois usando o armário de seis, ninguém veste nada e o
 * jogo vira trinta e dois aldeões.
 */
export function chapeusDe(base: number, porTime: number): number {
  return Math.max(1, Math.round(base * razaoDaEscala(porTime)));
}

/** O custo da obra, num time deste tamanho. Oito mineradores sobem oito vezes mais rápido. */
export function custoDaObraDe(base: number, porTime: number): number {
  return Math.max(1, Math.round(base * razaoDaEscala(porTime)));
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

// --- a invasão ---------------------------------------------------------------

/**
 * A invasão de goblins: uma ameaça de fora, sem time, que ronda a chapelaria.
 *
 * Não é a briga do jogo — é uma segunda coisa para perder de vista enquanto
 * a primeira acontece. Fica pior quando ninguém está de olho: quem está
 * ocupado brigando ou carregando o baú tem de decidir se vale a pena parar
 * para afugentar, e essa decisão é o jogo novo que a invasão traz.
 */

/** Segundos entre uma onda e a seguinte, por reino. */
export const INVASAO_INTERVALO = 75;

/** Segundos de aviso antes da onda chegar de verdade. */
export const INVASAO_AVISO_ANTES = 4;

/** Quantos goblins numa onda, por reino. */
export const INVASAO_TAMANHO = 2;

/** Mais lento que qualquer classe — dá tempo de alguém voltar correndo. */
export const INVASAO_VELOCIDADE = 120;

/** A que distância um jogador afugenta um goblin, só de chegar perto. */
export const INVASAO_RAIO_DE_AFUGENTAR = 50;

/** A que distância da chapelaria o goblin consuma o roubo. */
export const INVASAO_RAIO_DO_SAQUE = 40;

/**
 * A que distância o Slingshot Gnome consuma o roubo — bem mais longe do que
 * o goblin comum, porque ele atira de onde está em vez de arrombar a porta.
 * É essa distância que faz dele "à distância" de verdade: quem defende a
 * porta não alcança ninguém que nunca chega perto dela.
 */
export const INVASAO_RAIO_DO_SAQUE_SLINGSHOT = 130;

/**
 * A chance de uma onda de invasão nascer como Torch Goblin em vez do goblin
 * comum. Sorteada uma vez por onda — o grupo inteiro chega do mesmo jeito,
 * não metade tocha e metade não.
 */
export const INVASAO_CHANCE_DE_TOCHA = 0.2;

/**
 * A chance de a onda nascer como Slingshot Gnome — checada depois da chance
 * da tocha, no mesmo sorteio, para nunca sair uma onda que é as duas coisas
 * ao mesmo tempo.
 */
export const INVASAO_CHANCE_DE_SLINGSHOT = 0.15;

// --- o modo fera -------------------------------------------------------------

/**
 * O totem: um evento raro, dentro de qualquer modo, para pelo menos um
 * jogador poder virar Troll ou Minotauro por um tempo.
 *
 * Não é uma classe nova (ver `Fera` em classes.ts) — é uma transformação
 * passageira, que qualquer um pode pegar correndo até o meio do mapa.
 */

/** Segundos entre um totem sumir (pego ou não) e o próximo nascer. */
export const TOTEM_INTERVALO = 90;

/** Segundos de transformação, uma vez pego o totem. */
export const FERA_DURACAO = 25;

/** A que distância do totem uma unidade o pega, só de chegar perto. */
export const TOTEM_RAIO_DE_PEGAR = 40;

// --- o canhão de cerco -------------------------------------------------------

/**
 * O canhão: uma estrutura de defesa parada junto de cada tesouraria, que
 * atira sozinha em quem do outro time se aproxima demais.
 *
 * Não mata — o disparo pesa, mas para em 1 de vida. Um canhão que farma
 * abate sozinho premiaria quem fica parado perto da própria casa; um canhão
 * que dói é dissuasão de verdade sem roubar o abate de ninguém.
 */

/** Raio de vigia do canhão, a partir da posição dele. */
export const CANHAO_RAIO = 260;

/** Segundos entre um disparo e o próximo. */
export const CANHAO_CADENCIA = 4.5;

/** Quanto a bala tira, sem nunca derrubar quem leva o tiro. */
export const CANHAO_DANO = 14;

/** Velocidade da bala, em unidades de mundo por segundo. */
export const CANHAO_VELOCIDADE_DA_BOLA = 480;

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
