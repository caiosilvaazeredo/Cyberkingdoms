namespace MeuQueridoRei.Simulacao;

/// <summary>As sete classes jogáveis. Port de <c>Classe</c> em <c>shared/classes.ts</c>.</summary>
public enum Classe
{
    Aldeao,
    Guerreiro,
    Lanceiro,
    Arqueiro,
    Clerigo,
    Minerador,
    Lenhador,
    Saqueador,
}

/// <summary>Como o golpe da classe atinge.</summary>
public enum TipoDeAtaque
{
    /// <summary>Meia-volta à frente, no alcance. Espada, machado, picareta, faca.</summary>
    Corpo,

    /// <summary>Uma linha reta à frente: atinge todos até o alcance. É a lança.</summary>
    Linha,

    /// <summary>Solta um projétil que viaja.</summary>
    Flecha,

    /// <summary>Não fere: cura o aliado mais ferido no alcance.</summary>
    Cura,
}

/// <summary>O gesto do golpe. Só o desenho usa — é o que distingue as classes na tela.</summary>
public enum Gesto
{
    Arco,
    Estocada,
    Disparo,
    Bencao,
    Picareta,
    Machado,
    Faca,
}

/// <summary>O que a classe consegue tirar do mundo.</summary>
public enum Oficio
{
    Ouro,
    Madeira,
    Minerio,
}

/// <summary>Port de <c>PerfilDeClasse</c>.</summary>
public sealed record PerfilDeClasse(
    Classe Id,
    string Nome,
    string Resumo,
    double Vida,
    double Velocidade,
    TipoDeAtaque Ataque,
    Gesto Gesto,
    double Dano,
    double Alcance,
    double Cadencia,
    double DuracaoDoGolpe,
    /// <summary>O ofício em que esta classe é rápida. Nulo no aldeão e nas classes de combate.</summary>
    Oficio? Oficio,
    double DanoContraAnimal,
    string TintaDoChapeu,
    string TintaDaArma
);

/// <summary>
/// A fera: uma transformação passageira, não uma classe. Não entra em
/// <see cref="Classe"/> de propósito — ver o porquê em <c>Fera</c> no arquivo original.
/// </summary>
public enum Fera
{
    Troll,
    Minotauro,
}

/// <summary>Port de <c>PerfilDeFera</c>.</summary>
public sealed record PerfilDeFera(
    string Nome,
    double Vida,
    double Velocidade,
    double Dano,
    double Alcance,
    double Cadencia,
    double DuracaoDoGolpe
);

/// <summary>
/// As sete classes, o estoque de chapéus e o que cada ofício sabe fazer.
/// Port de <c>shared/classes.ts</c>.
/// </summary>
public static class Classes
{
    public static readonly IReadOnlyList<Classe> Todas =
    [
        Classe.Aldeao,
        Classe.Guerreiro,
        Classe.Lanceiro,
        Classe.Arqueiro,
        Classe.Clerigo,
        Classe.Minerador,
        Classe.Lenhador,
        Classe.Saqueador,
    ];

    private static readonly IReadOnlyDictionary<Classe, PerfilDeClasse> Perfis =
        new Dictionary<Classe, PerfilDeClasse>
        {
            [Classe.Aldeao] = new(
                Classe.Aldeao, "Aldeão",
                "Sem chapéu. Junta de tudo, devagar, e apanha se ficar na frente.",
                Vida: 90, Velocidade: 215, Ataque: TipoDeAtaque.Corpo, Gesto: Gesto.Faca,
                Dano: 8, Alcance: 46, Cadencia: 0.55, DuracaoDoGolpe: 0.22, Oficio: null,
                DanoContraAnimal: 1, TintaDoChapeu: "#d9c8a2", TintaDaArma: "#b9a27a"),

            [Classe.Guerreiro] = new(
                Classe.Guerreiro, "Guerreiro",
                "Espada em arco: acerta tudo à frente. Aguenta pancada e segura ponte.",
                Vida: 175, Velocidade: 195, Ataque: TipoDeAtaque.Corpo, Gesto: Gesto.Arco,
                Dano: 26, Alcance: 60, Cadencia: 0.7, DuracaoDoGolpe: 0.3, Oficio: null,
                DanoContraAnimal: 1, TintaDoChapeu: "#c0392b", TintaDaArma: "#d6dde4"),

            [Classe.Lanceiro] = new(
                Classe.Lanceiro, "Lanceiro",
                "Estocada que fura a fila: alcança longe e atinge todos na linha.",
                Vida: 130, Velocidade: 200, Ataque: TipoDeAtaque.Linha, Gesto: Gesto.Estocada,
                Dano: 23, Alcance: 108, Cadencia: 0.85, DuracaoDoGolpe: 0.26, Oficio: null,
                DanoContraAnimal: 1, TintaDoChapeu: "#2f6fd0", TintaDaArma: "#9aa7b4"),

            [Classe.Arqueiro] = new(
                Classe.Arqueiro, "Arqueiro",
                "Puxa o arco e fura a linha de longe. Frágil se deixarem chegar perto.",
                Vida: 95, Velocidade: 205, Ataque: TipoDeAtaque.Flecha, Gesto: Gesto.Disparo,
                Dano: 22, Alcance: 520, Cadencia: 0.95, DuracaoDoGolpe: 0.35, Oficio: null,
                DanoContraAnimal: 1.5, TintaDoChapeu: "#27ae60", TintaDaArma: "#8a5a2b"),

            [Classe.Clerigo] = new(
                Classe.Clerigo, "Clérigo",
                "Ergue o cajado e cura quem carrega o baú. Ganha sem matar.",
                Vida: 110, Velocidade: 200, Ataque: TipoDeAtaque.Cura, Gesto: Gesto.Bencao,
                Dano: 26, Alcance: 250, Cadencia: 1, DuracaoDoGolpe: 0.45, Oficio: null,
                DanoContraAnimal: 1, TintaDoChapeu: "#ecf0f1", TintaDaArma: "#f5c542"),

            [Classe.Minerador] = new(
                Classe.Minerador, "Minerador",
                "Picareta na veia de ouro. O ouro levanta a chapelaria — e a picareta dói.",
                Vida: 125, Velocidade: 195, Ataque: TipoDeAtaque.Corpo, Gesto: Gesto.Picareta,
                Dano: 17, Alcance: 50, Cadencia: 0.8, DuracaoDoGolpe: 0.32, Oficio: Simulacao.Oficio.Ouro,
                DanoContraAnimal: 1, TintaDoChapeu: "#7f8c8d", TintaDaArma: "#95a5a6"),

            [Classe.Lenhador] = new(
                Classe.Lenhador, "Lenhador",
                "Machado na árvore, e no inimigo se precisar. A madeira levanta o reino.",
                Vida: 130, Velocidade: 200, Ataque: TipoDeAtaque.Corpo, Gesto: Gesto.Machado,
                Dano: 21, Alcance: 54, Cadencia: 0.9, DuracaoDoGolpe: 0.34, Oficio: Simulacao.Oficio.Madeira,
                DanoContraAnimal: 1.2, TintaDoChapeu: "#8a5a2b", TintaDaArma: "#c0392b"),

            [Classe.Saqueador] = new(
                Classe.Saqueador, "Saqueador",
                "Come quem corre: abate o bicho e leva o minério para a casa da moeda.",
                Vida: 100, Velocidade: 212, Ataque: TipoDeAtaque.Corpo, Gesto: Gesto.Faca,
                Dano: 14, Alcance: 58, Cadencia: 0.55, DuracaoDoGolpe: 0.18, Oficio: Simulacao.Oficio.Minerio,
                DanoContraAnimal: 4, TintaDoChapeu: "#6b8e23", TintaDaArma: "#e8e0c8"),
        };

    public static PerfilDeClasse Perfil(Classe classe) => Perfis[classe];

    /// <summary>As classes que existem como chapéu, na ordem em que a chapelaria oferece.</summary>
    public static readonly IReadOnlyList<Classe> ClassesComChapeu =
    [
        Classe.Guerreiro,
        Classe.Lanceiro,
        Classe.Arqueiro,
        Classe.Clerigo,
        Classe.Minerador,
        Classe.Lenhador,
        Classe.Saqueador,
    ];

    /// <summary>
    /// O estoque inicial da chapelaria de cada time. Dezesseis chapéus para
    /// seis jogadores: sobra escolha, e não sobra para todo mundo virar
    /// guerreiro.
    /// </summary>
    public static readonly IReadOnlyDictionary<Classe, int> EstoqueInicial = new Dictionary<Classe, int>
    {
        [Classe.Aldeao] = 0,
        [Classe.Guerreiro] = 3,
        [Classe.Lanceiro] = 3,
        [Classe.Arqueiro] = 3,
        [Classe.Clerigo] = 2,
        [Classe.Minerador] = 2,
        [Classe.Lenhador] = 2,
        [Classe.Saqueador] = 2,
    };

    /// <summary>Quanto o aldeão é mais lento que o especialista no mesmo trabalho.</summary>
    public const double LerdezaDoAldeao = 1.8;

    /// <summary>
    /// O bônus que a obra dá às classes — sobe vida e dano de todo mundo do
    /// time conforme o nível da chapelaria (1 a 3).
    /// </summary>
    public static double BonusDoNivel(int nivel) => 1 + 0.15 * (Math.Max(1, Math.Min(3, nivel)) - 1);

    public static double VidaMaxima(Classe classe, int nivel) =>
        Math.Round(Perfil(classe).Vida * BonusDoNivel(nivel));

    public static double DanoDe(Classe classe, int nivel) => Perfil(classe).Dano * BonusDoNivel(nivel);

    private static readonly IReadOnlyDictionary<Fera, PerfilDeFera> PerfisDeFera =
        new Dictionary<Fera, PerfilDeFera>
        {
            [Fera.Troll] = new("Troll", Vida: 340, Velocidade: 165, Dano: 34, Alcance: 70, Cadencia: 1.6, DuracaoDoGolpe: 0.9),
            [Fera.Minotauro] = new("Minotauro", Vida: 300, Velocidade: 195, Dano: 30, Alcance: 62, Cadencia: 1.1, DuracaoDoGolpe: 0.6),
        };

    public static PerfilDeFera PerfilDeFera(Fera fera) => PerfisDeFera[fera];

    /// <summary><see cref="VidaMaxima"/>, mas ciente de que a unidade pode estar transformada.</summary>
    public static double VidaMaximaDe(Classe classe, int nivel, Fera? fera) =>
        fera is { } f ? PerfilDeFera(f).Vida : VidaMaxima(classe, nivel);
}
