namespace MeuQueridoRei.Simulacao.Anticheat;

public enum NivelDeSuspeita
{
    Normal,
    Suspeito,
    MuitoSuspeito,
}

/// <summary>Um motivo que somou pontos à suspeita de um jogador, para auditoria.</summary>
public sealed record EventoDeSuspeita(int JogadorId, string Motivo, double Peso, double PontuacaoDepois);

/// <summary>
/// A camada de anticheat que este jogo tem: nenhum anticheat open-source
/// encontrado servia (os que existem são de kernel/usermode nativo, C++,
/// pensados para um binário compilado — não para um servidor autoritativo
/// como este, cuja defesa mais forte já é nunca confiar no que o cliente diz
/// que aconteceu).
///
/// Isto não bane sozinho — acumula uma pontuação de suspeita por jogador, com
/// decaimento no tempo, para quem opera o jogo decidir o limiar de ação
/// depois de ver dados reais. Combina dois sinais:
///
/// - <see cref="RegistrarMovimentoImpossivel"/>: teleporte ou velocidade
///   além do que a classe permite, pesado pelo tamanho do excesso.
/// - <see cref="RegistrarRajadaDeComando"/>: taxa de ações acima do que um
///   cliente honesto manda.
/// </summary>
public sealed class Anticheat
{
    private const double PesoBaseDeMovimentoImpossivel = 8;
    private const double PesoDeRajadaDeComando = 3;

    /// <summary>Pontos perdidos por segundo — um pico isolado não persegue o jogador para sempre.</summary>
    private const double DecaimentoPorSegundo = 0.5;

    private const double LimiarSuspeito = 10;
    private const double LimiarMuitoSuspeito = 30;
    private const int TetoDeEventosGuardados = 500;

    private readonly Dictionary<int, double> _pontuacoes = new();
    private readonly List<EventoDeSuspeita> _eventos = new();

    /// <summary>Os últimos eventos que somaram suspeita, mais recente por último.</summary>
    public IReadOnlyList<EventoDeSuspeita> Eventos => _eventos;

    public void RegistrarMovimentoImpossivel(int jogadorId, double excessoDeDistancia)
    {
        // Quanto maior o excesso sobre a folga (já generosa) de latência,
        // mais pesa — até um teto, para um único evento absurdo não zerar
        // o jogador de uma vez e impedir de ver o padrão se repetindo.
        var multiplicador = Math.Min(4, 1 + Math.Max(0, excessoDeDistancia) / 100);
        Somar(jogadorId, PesoBaseDeMovimentoImpossivel * multiplicador, "movimento impossível");
    }

    public void RegistrarRajadaDeComando(int jogadorId)
    {
        Somar(jogadorId, PesoDeRajadaDeComando, "taxa de comando acima do esperado");
    }

    /// <summary>Chamar uma vez por tick do servidor — a pontuação esfria com o tempo, não só com o silêncio.</summary>
    public void Decair(double dtSegundos)
    {
        foreach (var jogadorId in _pontuacoes.Keys.ToList())
        {
            _pontuacoes[jogadorId] = Math.Max(0, _pontuacoes[jogadorId] - DecaimentoPorSegundo * dtSegundos);
        }
    }

    public double PontuacaoDe(int jogadorId) => _pontuacoes.GetValueOrDefault(jogadorId);

    public NivelDeSuspeita NivelDe(int jogadorId)
    {
        var pontuacao = PontuacaoDe(jogadorId);
        if (pontuacao >= LimiarMuitoSuspeito) return NivelDeSuspeita.MuitoSuspeito;
        if (pontuacao >= LimiarSuspeito) return NivelDeSuspeita.Suspeito;
        return NivelDeSuspeita.Normal;
    }

    /// <summary>Zera o histórico de um jogador — usar quando ele sai da sala, não quando é só desconfiança passageira.</summary>
    public void Esquecer(int jogadorId) => _pontuacoes.Remove(jogadorId);

    private void Somar(int jogadorId, double peso, string motivo)
    {
        var pontuacao = PontuacaoDe(jogadorId) + peso;
        _pontuacoes[jogadorId] = pontuacao;
        _eventos.Add(new EventoDeSuspeita(jogadorId, motivo, peso, pontuacao));
        if (_eventos.Count > TetoDeEventosGuardados) _eventos.RemoveAt(0);
    }
}
