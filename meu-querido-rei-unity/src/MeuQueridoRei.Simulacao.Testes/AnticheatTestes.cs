using MeuQueridoRei.Simulacao.Anticheat;

namespace MeuQueridoRei.Simulacao.Testes;

public class LimiteDeTaxaTestes
{
    [Fact]
    public void PermiteAteOLimitePorJanela()
    {
        var limite = new LimiteDeTaxa(limitePorSegundo: 3);
        Assert.True(limite.PermiteMensagem(0.0));
        Assert.True(limite.PermiteMensagem(0.1));
        Assert.True(limite.PermiteMensagem(0.2));
        Assert.False(limite.PermiteMensagem(0.3)); // quarta na mesma janela
    }

    [Fact]
    public void JanelaNovaLiberaDeNovo()
    {
        var limite = new LimiteDeTaxa(limitePorSegundo: 2);
        Assert.True(limite.PermiteMensagem(0.0));
        Assert.True(limite.PermiteMensagem(0.1));
        Assert.False(limite.PermiteMensagem(0.2));

        // Um segundo depois, janela nova — mesmo um cliente que só manda
        // rajadas legítimas (reconexão, várias trocas de chapéu) não fica
        // travado para sempre.
        Assert.True(limite.PermiteMensagem(1.0));
    }

    [Fact]
    public void ClienteHonestoNuncaBate()
    {
        // Trinta comandos por segundo (um por tick) mais um ping ocasional —
        // bem abaixo do padrão de 100/s que o servidor real usa.
        var limite = new LimiteDeTaxa();
        for (var i = 0; i < 31; i++)
        {
            Assert.True(limite.PermiteMensagem(i * (1.0 / 30)));
        }
    }
}

public class ValidadorDeMovimentoTestes
{
    [Fact]
    public void DistanciaDentroDaVelocidadeEhPermitida()
    {
        // Guerreiro anda a 195/s; em 1/30s ele alcança 6.5 unidades — bem
        // dentro do que a folga de latência permite.
        var possivel = ValidadorDeMovimento.DistanciaEhPossivel(
            xAntes: 0, yAntes: 0, xDepois: 6, yDepois: 0,
            velocidadeMaximaPermitida: 195, dtSegundos: 1.0 / 30);

        Assert.True(possivel);
    }

    [Fact]
    public void TeleporteEhRecusado()
    {
        var possivel = ValidadorDeMovimento.DistanciaEhPossivel(
            xAntes: 0, yAntes: 0, xDepois: 2000, yDepois: 0,
            velocidadeMaximaPermitida: 195, dtSegundos: 1.0 / 30);

        Assert.False(possivel);
    }

    [Fact]
    public void FolgaAbsorveUmPicoDeLagPequeno()
    {
        // Exatamente na velocidade máxima, sem a folga, já seria "impossível"
        // por causa de qualquer arredondamento — é para isso que a folga existe.
        var distanciaExata = 195 * (1.0 / 30);
        var possivel = ValidadorDeMovimento.DistanciaEhPossivel(
            xAntes: 0, yAntes: 0, xDepois: distanciaExata, yDepois: 0,
            velocidadeMaximaPermitida: 195, dtSegundos: 1.0 / 30);

        Assert.True(possivel);
    }

    [Fact]
    public void ExcessoDeDistanciaEhNegativoQuandoPossivel()
    {
        var excesso = ValidadorDeMovimento.ExcessoDeDistancia(
            xAntes: 0, yAntes: 0, xDepois: 1, yDepois: 0,
            velocidadeMaximaPermitida: 195, dtSegundos: 1.0 / 30);

        Assert.True(excesso < 0);
    }
}

public class AnticheatTestes
{
    [Fact]
    public void ComecaNormalParaTodoMundo()
    {
        var ac = new Anticheat.Anticheat();
        Assert.Equal(NivelDeSuspeita.Normal, ac.NivelDe(jogadorId: 1));
        Assert.Equal(0, ac.PontuacaoDe(1));
    }

    [Fact]
    public void UmUnicoEventoPequenoNaoBastaParaSinalizar()
    {
        var ac = new Anticheat.Anticheat();
        ac.RegistrarMovimentoImpossivel(jogadorId: 1, excessoDeDistancia: 1);
        Assert.Equal(NivelDeSuspeita.Normal, ac.NivelDe(1));
    }

    [Fact]
    public void EventosRepetidosSobemParaSuspeitoEDepoisMuitoSuspeito()
    {
        var ac = new Anticheat.Anticheat();
        for (var i = 0; i < 2; i++) ac.RegistrarMovimentoImpossivel(1, excessoDeDistancia: 50);
        Assert.Equal(NivelDeSuspeita.Suspeito, ac.NivelDe(1));

        for (var i = 0; i < 3; i++) ac.RegistrarMovimentoImpossivel(1, excessoDeDistancia: 300);
        Assert.Equal(NivelDeSuspeita.MuitoSuspeito, ac.NivelDe(1));
    }

    [Fact]
    public void UmExcessoEnormeNaoPesaAlemDoTeto()
    {
        var ac = new Anticheat.Anticheat();
        ac.RegistrarMovimentoImpossivel(1, excessoDeDistancia: 1);
        var pontuacaoPequena = ac.PontuacaoDe(1);

        var ac2 = new Anticheat.Anticheat();
        ac2.RegistrarMovimentoImpossivel(1, excessoDeDistancia: 999_999);
        var pontuacaoEnorme = ac2.PontuacaoDe(1);

        // Pesa mais, mas não sem limite — um valor absurdo (erro de rede,
        // não necessariamente cheat) não deveria zerar o jogador de um golpe.
        Assert.True(pontuacaoEnorme > pontuacaoPequena);
        Assert.True(pontuacaoEnorme <= 8 * 4);
    }

    [Fact]
    public void APontuacaoDecaiComOTempo()
    {
        var ac = new Anticheat.Anticheat();
        ac.RegistrarRajadaDeComando(1);
        ac.RegistrarRajadaDeComando(1);
        var antes = ac.PontuacaoDe(1);

        ac.Decair(dtSegundos: 5);
        var depois = ac.PontuacaoDe(1);

        Assert.True(depois < antes);
        Assert.True(depois >= 0);
    }

    [Fact]
    public void NaoDecaiAbaixoDeZero()
    {
        var ac = new Anticheat.Anticheat();
        ac.RegistrarRajadaDeComando(1);
        ac.Decair(dtSegundos: 1000);
        Assert.Equal(0, ac.PontuacaoDe(1));
    }

    [Fact]
    public void JogadoresNaoInterferemEntreSi()
    {
        var ac = new Anticheat.Anticheat();
        ac.RegistrarMovimentoImpossivel(1, excessoDeDistancia: 300);
        Assert.Equal(NivelDeSuspeita.Normal, ac.NivelDe(2));
    }

    [Fact]
    public void EsquecerRemoveOHistoricoDoJogador()
    {
        var ac = new Anticheat.Anticheat();
        ac.RegistrarMovimentoImpossivel(1, excessoDeDistancia: 300);
        Assert.NotEqual(NivelDeSuspeita.Normal, ac.NivelDe(1));

        ac.Esquecer(1);
        Assert.Equal(NivelDeSuspeita.Normal, ac.NivelDe(1));
        Assert.Equal(0, ac.PontuacaoDe(1));
    }

    [Fact]
    public void EventosGuardamOMotivoEAPontuacaoResultante()
    {
        var ac = new Anticheat.Anticheat();
        ac.RegistrarRajadaDeComando(jogadorId: 7);

        var evento = Assert.Single(ac.Eventos);
        Assert.Equal(7, evento.JogadorId);
        Assert.Equal("taxa de comando acima do esperado", evento.Motivo);
        Assert.Equal(evento.PontuacaoDepois, ac.PontuacaoDe(7));
    }
}
