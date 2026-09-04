namespace MeuQueridoRei.Simulacao;

/// <summary>
/// Os dois reinos. Port fiel de <c>Time</c> em <c>shared/regras.ts</c>.
/// </summary>
public enum Time
{
    Azul,
    Vermelho,
}

/// <summary>Algo com posição no mundo — o suficiente para <see cref="Regras.Perto"/>.</summary>
public interface IPosicionavel
{
    double X { get; }
    double Y { get; }
}

/// <summary>
/// Meu Querido Rei — os números do jogo, num arquivo só.
///
/// Port de <c>shared/regras.ts</c>. A regra do arquivo original continua valendo
/// aqui: nada de número solto no meio da lógica — cada constante tem nome e,
/// quando o porquê não é óbvio, um comentário.
///
/// Balanceamento é o trabalho que nunca acaba — a resposta para "quanto vale
/// uma bolsa?" precisa ser uma linha, não uma leitura do tick inteiro.
/// </summary>
public static class Regras
{
    // --- fundamentos ---------------------------------------------------------

    /// <summary>Lado do tile, em unidades de mundo.</summary>
    public const int Tile = 64;

    public const int ArenaLargura = 60;
    public const int ArenaAltura = 34;

    /// <summary>Passo fixo do servidor. Tudo na simulação é medido nesta moeda.</summary>
    public const int TicksPorSegundo = 30;

    public const double Dt = 1.0 / TicksPorSegundo;

    /// <summary>Quantos ticks entre dois retratos enviados ao cliente.</summary>
    public const int TicksPorEnvio = 2;

    /// <summary>
    /// Duas coisas a <paramref name="r"/> de distância ou menos — sem raiz quadrada,
    /// porque quem chama isto pergunta "cabe no alcance?" centenas de vezes por
    /// tick, e comparar os quadrados poupa a raiz em todas elas.
    /// </summary>
    public static bool Perto(IPosicionavel a, IPosicionavel b, double r)
    {
        var dx = a.X - b.X;
        var dy = a.Y - b.Y;
        return dx * dx + dy * dy <= r * r;
    }

    public static Time OutroTime(Time t) => t == Time.Azul ? Time.Vermelho : Time.Azul;

    // --- partida ---------------------------------------------------------------

    /// <summary>Jogadores por time. Doze em campo é o teto do que a arena comporta.</summary>
    public const int PorTime = 6;

    /// <summary>Resgates para vencer.</summary>
    public const int PontosParaVencer = 3;

    /// <summary>Duração máxima, em segundos. Empate no tempo vai para a balança.</summary>
    public const int DuracaoDaPartida = 12 * 60;

    /// <summary>
    /// Aquecimento antes do apito, em segundos — segura o combate, fecha o
    /// castelo, e dá tempo de ler a contagem regressiva na tela, não só cumpri-la.
    /// </summary>
    public const int Aquecimento = 8;

    /// <summary>Pausa depois de um ponto, antes do reposicionamento.</summary>
    public const int PausaAposPonto = 4;

    /// <summary>Espera antes de chamar bots para completar o time.</summary>
    public const int EsperaPorJogadores = 12;

    // --- a balança ---------------------------------------------------------------

    /// <summary>
    /// O peso do reino num time de seis — a medida a partir da qual tudo escala.
    /// Não muda <em>dentro</em> de uma partida: entulhar move peso de um prato
    /// para o outro, nunca cria peso novo.
    /// </summary>
    public const int PesoTotal = 200;

    /// <summary>Ninguém fica de papel: mesmo perdendo a balança inteira, sobra este peso — num time de seis.</summary>
    public const int PesoMinimo = 40;

    public const int PesoMaximo = PesoTotal - PesoMinimo;

    // --- a escala ------------------------------------------------------------

    /// <summary>
    /// A economia em função do tamanho do time. A razão é <c>porTime / 6</c>;
    /// cresce com ela tudo que uma pessoa consome ou produz (peso, estoque de
    /// chapéus, custo da obra). Não cresce nada que seja da partida e não das
    /// pessoas: relógio, pontos para vencer, velocidade de quem anda.
    /// </summary>
    public static double RazaoDaEscala(int porTime) => Math.Max(1, porTime) / (double)PorTime;

    /// <summary>
    /// O peso que a balança comporta, para um time deste tamanho. Múltiplo de
    /// vinte para o meio da balança cair num número redondo — o que a barra
    /// mostra a partida inteira.
    /// </summary>
    public static int PesoTotalDe(int porTime) =>
        (int)Math.Round(PesoTotal * RazaoDaEscala(porTime) / 20) * 20;

    /// <summary>
    /// O piso da balança, para um time deste tamanho. Escala junto com o total
    /// — se ficasse fixo, a distância do meio até o talo cresceria mais rápido
    /// que o time, e a partida grande demoraria desproporcionalmente mais para
    /// a balança fechar. Medido: 53% a mais em 32×32, com o piso fixo.
    /// </summary>
    public static int PesoMinimoDe(int porTime) =>
        (int)Math.Round(PesoMinimo * RazaoDaEscala(porTime));

    public static int PesoMaximoDe(int porTime) => PesoTotalDe(porTime) - PesoMinimoDe(porTime);

    /// <summary>Quanto uma bolsa de moedas move na balança. Não escala.</summary>
    public const int PesoPorBolsa = 12;

    /// <summary>Minério que a Casa da Moeda consome para cunhar uma bolsa.</summary>
    public const int MinerioPorBolsa = 2;

    /// <summary>Segundos de cunhagem depois que o minério entrou.</summary>
    public const int TempoDeCunhagem = 6;

    /// <summary>Bolsas paradas no chão da Casa da Moeda, no máximo.</summary>
    public const int BolsasNaCasa = 3;

    /// <summary>Cura de gastar a bolsa consigo em vez de entregá-la.</summary>
    public const int CuraDaBolsa = 45;

    /// <summary>
    /// Quantos carregadores o baú pode chegar a exigir, num time deste tamanho.
    /// Três é o teto de sempre (seis por lado); sobe com o time, mas para em
    /// oito — acima disso o cortejo viraria o time inteiro.
    /// </summary>
    public static int CarregadoresMaximos(int porTime) =>
        Math.Max(3, Math.Min(8, 1 + (int)Math.Round(porTime / 4.0)));

    /// <summary>Quantos carregadores o baú exige, por faixa de peso — degraus iguais do piso ao talo.</summary>
    public static int CarregadoresPara(double peso, int porTime = PorTime)
    {
        var degraus = CarregadoresMaximos(porTime);
        var piso = PesoMinimoDe(porTime);
        var faixa = PesoMaximoDe(porTime) - piso;
        var t = faixa <= 0 ? 0 : (peso - piso) / faixa;
        return Math.Max(1, Math.Min(degraus, 1 + (int)Math.Floor(t * degraus)));
    }

    /// <summary>
    /// Chapéus de cada classe no armário, num time deste tamanho. O estoque
    /// finito é o segundo diferencial do jogo — só é verdade enquanto o
    /// armário fica apertado em qualquer formato.
    /// </summary>
    public static int ChapeusDe(int baseValor, int porTime) =>
        Math.Max(1, (int)Math.Round(baseValor * RazaoDaEscala(porTime)));

    /// <summary>O custo da obra, num time deste tamanho. Oito mineradores sobem oito vezes mais rápido.</summary>
    public static int CustoDaObraDe(int baseValor, int porTime) =>
        Math.Max(1, (int)Math.Round(baseValor * RazaoDaEscala(porTime)));

    /// <summary>Fração da velocidade normal de quem carrega o baú.</summary>
    public static double VelocidadeCarregando(double peso)
    {
        var t = (peso - PesoMinimo) / (double)(PesoMaximo - PesoMinimo);
        return 0.85 - 0.45 * Math.Max(0, Math.Min(1, t));
    }

    // --- unidades --------------------------------------------------------------

    /// <summary>Raio de colisão de uma unidade.</summary>
    public const int RaioUnidade = 18;

    /// <summary>Segundos até renascer. Sobe com os pontos do inimigo para não virar rolo.</summary>
    public const int RenascimentoBase = 6;

    public const double RenascimentoPorPonto = 1.5;

    /// <summary>
    /// Até onde uma unidade avista o inimigo, para o minimapa. Fixo e igual
    /// para todos de propósito — não depende do que cabe na tela de cada um.
    /// </summary>
    public const int AlcanceDeVista = 9 * Tile;

    /// <summary>Distância em que um botão de contexto encosta em algo.</summary>
    public const int AlcanceDeUso = 70;

    /// <summary>Alcance de coleta e de entrega.</summary>
    public const int AlcanceDeColeta = 80;

    /// <summary>Segundos de picareta ou machado até a carga sair da jazida.</summary>
    public const double TempoDeTrabalho = 2.4;

    /// <summary>Segundos até a árvore rebrotar e a pedreira voltar a render.</summary>
    public const int JazidaVoltaEm = 14;

    // --- a caça ------------------------------------------------------------------

    /// <summary>Vida de um bicho. O saqueador derruba em três golpes; um guerreiro, em oito.</summary>
    public const int AnimalVida = 58;

    public const int AnimalPastando = 70;
    public const int AnimalFugindo = 205;

    /// <summary>Segundos de pânico depois de apanhar.</summary>
    public const int AnimalPanico = 3;

    /// <summary>Segundos até outro bicho aparecer no lugar do que morreu.</summary>
    public const int AnimalVoltaEm = 18;

    /// <summary>Até onde um bicho se afasta do lugar onde nasceu.</summary>
    public const int AnimalPasto = 4 * Tile;

    // --- a invasão -----------------------------------------------------------------

    /// <summary>Segundos entre uma onda e a seguinte, por reino.</summary>
    public const int InvasaoIntervalo = 75;

    /// <summary>Segundos de aviso antes da onda chegar de verdade.</summary>
    public const int InvasaoAvisoAntes = 4;

    /// <summary>Quantos goblins numa onda, por reino.</summary>
    public const int InvasaoTamanho = 2;

    /// <summary>Mais lento que qualquer classe — dá tempo de alguém voltar correndo.</summary>
    public const int InvasaoVelocidade = 120;

    /// <summary>A que distância um jogador afugenta um goblin, só de chegar perto.</summary>
    public const int InvasaoRaioDeAfugentar = 50;

    /// <summary>A que distância da chapelaria o goblin consuma o roubo.</summary>
    public const int InvasaoRaioDoSaque = 40;

    /// <summary>
    /// A que distância o Slingshot Gnome consuma o roubo — bem mais longe do
    /// que o goblin comum, porque ele atira de onde está.
    /// </summary>
    public const int InvasaoRaioDoSaqueSlingshot = 130;

    /// <summary>Chance de uma onda nascer como Torch Goblin, sorteada uma vez por onda.</summary>
    public const double InvasaoChanceDeTocha = 0.2;

    /// <summary>Chance de a onda nascer como Slingshot Gnome — checada depois da chance da tocha, no mesmo sorteio.</summary>
    public const double InvasaoChanceDeSlingshot = 0.15;

    // --- o modo fera -----------------------------------------------------------------

    /// <summary>Segundos entre um totem sumir (pego ou não) e o próximo nascer.</summary>
    public const int TotemIntervalo = 90;

    /// <summary>Segundos de transformação, uma vez pego o totem.</summary>
    public const int FeraDuracao = 25;

    /// <summary>A que distância do totem uma unidade o pega, só de chegar perto.</summary>
    public const int TotemRaioDePegar = 40;

    // --- o canhão de cerco -----------------------------------------------------------

    /// <summary>Raio de vigia do canhão, a partir da posição dele.</summary>
    public const int CanhaoRaio = 260;

    /// <summary>Segundos entre um disparo e o próximo.</summary>
    public const double CanhaoCadencia = 4.5;

    /// <summary>Quanto a bala tira, sem nunca derrubar quem leva o tiro.</summary>
    public const int CanhaoDano = 14;

    /// <summary>Velocidade da bala, em unidades de mundo por segundo.</summary>
    public const int CanhaoVelocidadeDaBola = 480;

    // --- o guardião (Modo Covil) ------------------------------------------------------

    /// <summary>Segundos até o primeiro Guardião nascer, contados do fim do aquecimento.</summary>
    public const int GuardiaoAtrasoInicial = 180;

    /// <summary>Segundos entre o Guardião cair (ou o covil ficar vazio) e o próximo nascer.</summary>
    public const int GuardiaoIntervalo = 90;

    /// <summary>Vida do Guardião — o bastante para exigir mais de uma pessoa.</summary>
    public const int GuardiaoVida = 1800;

    /// <summary>Raio da área que ele bate a cada golpe.</summary>
    public const int GuardiaoRaioDeAtaque = 90;

    /// <summary>Segundos entre um golpe de área e o próximo.</summary>
    public const int GuardiaoCadenciaDeAtaque = 2;

    /// <summary>Quanto o golpe de área tira, sem nunca derrubar quem leva.</summary>
    public const int GuardiaoDano = 10;

    /// <summary>Segundos de velocidade extra pro time que derrubou o Guardião.</summary>
    public const int GuardiaoBuffDuracao = 40;

    /// <summary>Multiplicador de velocidade do buff — o empurrão que força a jogada.</summary>
    public const double GuardiaoBuffVelocidade = 1.25;

    // --- a presa (Modo Caça) -----------------------------------------------------------

    /// <summary>Segundos até a primeira Presa nascer, contados do fim do aquecimento.</summary>
    public const int PresaAtrasoInicial = 30;

    /// <summary>Segundos entre a Presa cair (ou a toca ficar vazia) e a próxima nascer.</summary>
    public const int PresaIntervalo = 45;

    /// <summary>Vida da Presa — baixa: uma pessoa sozinha já dá conta.</summary>
    public const int PresaVida = 260;

    /// <summary>Raio da mordida da Presa.</summary>
    public const int PresaRaioDeAtaque = 50;

    /// <summary>Segundos entre uma mordida e a próxima.</summary>
    public const double PresaCadenciaDeAtaque = 1.4;

    /// <summary>Quanto a mordida tira, sem nunca derrubar quem leva.</summary>
    public const int PresaDano = 4;

    /// <summary>Segundos de dano extra pro time que derrubou a Presa.</summary>
    public const int PresaBuffDuracao = 20;

    /// <summary>Multiplicador de dano do buff — janela curta, vantagem real.</summary>
    public const double PresaBuffDano = 1.2;

    // --- o cajado do xamã (Modo Xamã) -------------------------------------------------

    /// <summary>Segundos entre o cajado ser pego (ou virar feitiço não usado) e o próximo nascer.</summary>
    public const int CajadoIntervalo = 120;

    /// <summary>Segundos que quem pega o cajado tem para usar o feitiço antes dele se perder.</summary>
    public const int XamaCargaDuracao = 20;

    /// <summary>Alcance do feitiço de transformação — mais longe que um golpe, mais perto que uma flecha.</summary>
    public const int XamaAlcance = 220;

    /// <summary>Segundos que a vítima do feitiço fica porco: sem atacar, sem colher, sem usar.</summary>
    public const int PorcoDuracao = 10;

    /// <summary>Quanto o porco anda mais devagar que a própria classe por baixo.</summary>
    public const double PorcoVelocidadeMult = 0.7;

    // --- a obra --------------------------------------------------------------------

    /// <summary>O que cada nível da chapelaria custa, em madeira e ouro.</summary>
    public static readonly IReadOnlyList<(int Madeira, int Ouro)> CustoDoNivel =
    [
        (0, 0),
        (0, 0),
        (4, 4),
        (6, 6),
    ];

    public const int NivelMaximo = 3;

    /// <summary>Distância máxima entre carregadores para o baú andar.</summary>
    public const int AlcanceDeAjuda = 110;

    /// <summary>Segundos que o baú espera no chão antes de voltar para o cofre.</summary>
    public const int BauVoltaEm = 20;

    /// <summary>Segundos que um chapéu fica no chão antes de voltar para a chapelaria.</summary>
    public const int ChapeuVoltaEm = 25;

    /// <summary>Empurrão que o baú dá ao ser alimentado.</summary>
    public const int EmpurraoDoBau = 220;

    // --- rede ------------------------------------------------------------------------

    /// <summary>Segundos sem notícia de um cliente antes de considerá-lo ido.</summary>
    public const int TimeoutDoCliente = 20;

    /// <summary>Teto de entradas de comando por pacote. Um cliente honesto manda uma.</summary>
    public const int MaxComandosPorPacote = 8;
}
