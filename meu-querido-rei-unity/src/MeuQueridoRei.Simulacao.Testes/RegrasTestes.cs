using MeuQueridoRei.Simulacao;

namespace MeuQueridoRei.Simulacao.Testes;

/// <summary>
/// Port de <c>test/escala.test.ts</c> (a parte que não depende de arena/partida,
/// ainda não portados) — a mesma garantia: o que é por pessoa cresce com o
/// time, o que é por partida, não.
/// </summary>
public class RegrasTestes
{
    [Fact]
    public void NaoMudaNadaEmSeisPorLado()
    {
        Assert.Equal(Regras.PesoTotal, Regras.PesoTotalDe(Regras.PorTime));
        Assert.Equal(Regras.PesoTotal - Regras.PesoMinimo, Regras.PesoMaximoDe(Regras.PorTime));
        Assert.Equal(3, Regras.CarregadoresMaximos(Regras.PorTime));
        Assert.Equal(3, Regras.ChapeusDe(3, Regras.PorTime));
        Assert.Equal(4, Regras.CustoDaObraDe(4, Regras.PorTime));
    }

    [Fact]
    public void MantemAsTresFaixasDeCarregador()
    {
        Assert.Equal(1, Regras.CarregadoresPara(Regras.PesoMinimo));
        Assert.Equal(1, Regras.CarregadoresPara(60));
        Assert.Equal(2, Regras.CarregadoresPara(100));
        Assert.Equal(3, Regras.CarregadoresPara(150));
        Assert.Equal(3, Regras.CarregadoresPara(Regras.PesoTotal - Regras.PesoMinimo));
    }

    [Fact]
    public void NuncaPedeMenosDeUmNemMaisQueOTeto()
    {
        foreach (var porTime in new[] { 1, 6, 8, 16, 32 })
        {
            var pesos = new[] { 0, Regras.PesoMinimo, Regras.PesoMaximoDe(porTime), 1_000_000_000 };
            foreach (var peso in pesos)
            {
                var n = Regras.CarregadoresPara(peso, porTime);
                Assert.True(n >= 1);
                Assert.True(n <= Regras.CarregadoresMaximos(porTime));
            }
        }
    }

    [Fact]
    public void OTempoParaEstourarABalancaEOMesmoEmQualquerFormato()
    {
        double BolsasAte(int porTime) =>
            (Regras.PesoMaximoDe(porTime) - Regras.PesoTotalDe(porTime) / 2.0) / Regras.PesoPorBolsa;
        double PorPessoa(int porTime) => BolsasAte(porTime) / porTime;

        var baseValor = PorPessoa(Regras.PorTime);
        foreach (var porTime in new[] { 8, 16, 32 })
        {
            Assert.True(PorPessoa(porTime) > baseValor * 0.9);
            Assert.True(PorPessoa(porTime) < baseValor * 1.1);
        }
    }

    [Fact]
    public void OPesoTotalCresceEABolsaContinuaMovendoDoze()
    {
        Assert.Equal(12, Regras.PesoPorBolsa);
        Assert.True(Regras.PesoTotalDe(32) > Regras.PesoTotalDe(16));
        Assert.True(Regras.PesoTotalDe(16) > Regras.PesoTotalDe(8));
        Assert.True(Regras.PesoTotalDe(8) > Regras.PesoTotalDe(6));
    }

    [Fact]
    public void AEscoltaCresceComOTimeMasParaEmOito()
    {
        Assert.True(Regras.CarregadoresMaximos(16) > 3);
        Assert.Equal(8, Regras.CarregadoresMaximos(32));
        Assert.Equal(8, Regras.CarregadoresMaximos(1000));
    }

    [Fact]
    public void OArmarioDeChapeusCresce()
    {
        Assert.True(Regras.ChapeusDe(3, 32) > Regras.ChapeusDe(3, 6) * 4);
        Assert.True(Regras.ChapeusDe(1, 1) >= 1);
    }

    [Fact]
    public void FundamentosDeTempo()
    {
        // DT é a fração exata de um segundo — se virasse divisão inteira por
        // engano no port, isto pegaria (daria 0, não ~0.0333).
        Assert.True(Regras.Dt > 0.033 && Regras.Dt < 0.034);
        Assert.Equal(30, Regras.TicksPorSegundo);
    }

    [Fact]
    public void Perto_UsaDistanciaEuclidiana()
    {
        var a = new Ponto(0, 0);
        var b = new Ponto(30, 40); // 3-4-5 vezes dez: distância exata 50.
        Assert.True(Regras.Perto(a, b, 50));
        Assert.False(Regras.Perto(a, b, 49));
    }

    private readonly record struct Ponto(double X, double Y) : IPosicionavel;
}
