namespace MeuQueridoRei.Simulacao.Anticheat;

/// <summary>
/// Detecta posição impossível de alcançar desde o último tick — a mesma
/// disciplina que faz o servidor autoritativo já ser a defesa mais forte do
/// jogo (o cliente nunca decide o que aconteceu), só que explícita: em vez
/// de só ignorar silenciosamente, sinaliza quem tentou.
/// </summary>
public static class ValidadorDeMovimento
{
    /// <summary>
    /// Folga sobre a velocidade máxima da classe. Absorve lag real e o
    /// arredondamento do próprio protocolo, sem abrir margem de verdade
    /// para andar mais rápido do que qualquer chapéu permite.
    /// </summary>
    public const double FolgaDeLatencia = 1.35;

    /// <summary>
    /// Verdadeiro se a distância percorrida em <paramref name="dtSegundos"/>
    /// cabe na velocidade máxima permitida, já com a folga de latência.
    /// </summary>
    public static bool DistanciaEhPossivel(
        double xAntes,
        double yAntes,
        double xDepois,
        double yDepois,
        double velocidadeMaximaPermitida,
        double dtSegundos)
    {
        return ExcessoDeDistancia(xAntes, yAntes, xDepois, yDepois, velocidadeMaximaPermitida, dtSegundos) <= 0;
    }

    /// <summary>
    /// Quanto a distância percorrida excedeu o permitido — zero ou negativo
    /// quando o movimento é possível. Usado para pesar a suspeita: um
    /// excesso de dois pixels por causa de um pico de lag não pode custar o
    /// mesmo que atravessar o mapa num tick.
    /// </summary>
    public static double ExcessoDeDistancia(
        double xAntes,
        double yAntes,
        double xDepois,
        double yDepois,
        double velocidadeMaximaPermitida,
        double dtSegundos)
    {
        var dx = xDepois - xAntes;
        var dy = yDepois - yAntes;
        var distancia = Math.Sqrt(dx * dx + dy * dy);
        var maxima = velocidadeMaximaPermitida * dtSegundos * FolgaDeLatencia;
        return distancia - maxima;
    }
}
