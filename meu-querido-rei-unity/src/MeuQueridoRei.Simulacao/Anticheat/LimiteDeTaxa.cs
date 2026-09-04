namespace MeuQueridoRei.Simulacao.Anticheat;

/// <summary>
/// Janela fixa de um segundo — port do limitador que já existe em
/// <c>src/server/index.ts</c> (100 mensagens por segundo, por socket).
///
/// Mais simples que balde furado, e a diferença não importa aqui: o
/// objetivo é frear uma rajada, não policiar o milésimo de segundo exato em
/// que a mensagem chegou.
/// </summary>
public sealed class LimiteDeTaxa(int limitePorSegundo = 100)
{
    private int _mensagensNaJanela;
    private double _inicioDaJanelaSegundos;
    private bool _iniciado;

    /// <summary>
    /// Chamada uma vez por mensagem recebida. Devolve <c>false</c> quando a
    /// mensagem deve ser descartada — sem sequer decodificar o corpo dela,
    /// que é exatamente o custo que este limite existe para evitar.
    /// </summary>
    public bool PermiteMensagem(double agoraEmSegundos)
    {
        if (!_iniciado || agoraEmSegundos - _inicioDaJanelaSegundos >= 1.0)
        {
            _inicioDaJanelaSegundos = agoraEmSegundos;
            _mensagensNaJanela = 0;
            _iniciado = true;
        }
        _mensagensNaJanela++;
        return _mensagensNaJanela <= limitePorSegundo;
    }
}
