using MeuQueridoRei.Simulacao;

namespace MeuQueridoRei.Simulacao.Testes;

/// <summary>
/// Não existe <c>classes.test.ts</c> no original para portar 1:1 — estes
/// testes cobrem o que <c>classes.ts</c> promete: o bônus de nível clampado
/// entre 1 e 3, e a fera sobrepondo a classe por baixo sem apagá-la.
/// </summary>
public class ClassesTestes
{
    [Fact]
    public void TodasAsClassesTemPerfil()
    {
        foreach (var classe in Classes.Todas)
        {
            var perfil = Classes.Perfil(classe);
            Assert.Equal(classe, perfil.Id);
            Assert.False(string.IsNullOrWhiteSpace(perfil.Nome));
        }
    }

    [Fact]
    public void SoAsClassesDeOficioTemOficio()
    {
        Assert.Null(Classes.Perfil(Classe.Aldeao).Oficio);
        Assert.Null(Classes.Perfil(Classe.Guerreiro).Oficio);
        Assert.Equal(Oficio.Ouro, Classes.Perfil(Classe.Minerador).Oficio);
        Assert.Equal(Oficio.Madeira, Classes.Perfil(Classe.Lenhador).Oficio);
        Assert.Equal(Oficio.Minerio, Classes.Perfil(Classe.Saqueador).Oficio);
    }

    [Theory]
    [InlineData(0, 1.0)]  // abaixo do piso, clampa em 1
    [InlineData(1, 1.0)]
    [InlineData(2, 1.15)]
    [InlineData(3, 1.30)]
    [InlineData(4, 1.30)] // acima do teto, clampa em 3
    public void BonusDoNivelClampaEntreUmETres(int nivel, double esperado)
    {
        Assert.Equal(esperado, Classes.BonusDoNivel(nivel), precision: 6);
    }

    [Fact]
    public void VidaMaximaCrescemComONivel()
    {
        var nivel1 = Classes.VidaMaxima(Classe.Guerreiro, 1);
        var nivel3 = Classes.VidaMaxima(Classe.Guerreiro, 3);
        Assert.True(nivel3 > nivel1);
        // 175 de base, bônus de 1.30 no nível 3: 227.5 arredondado.
        Assert.Equal(228, nivel3);
    }

    [Fact]
    public void VidaMaximaDe_UsaAFeraQuandoTransformado()
    {
        var comoGente = Classes.VidaMaximaDe(Classe.Aldeao, 1, fera: null);
        var comoTroll = Classes.VidaMaximaDe(Classe.Aldeao, 1, fera: Fera.Troll);

        Assert.Equal(Classes.VidaMaxima(Classe.Aldeao, 1), comoGente);
        Assert.Equal(Classes.PerfilDeFera(Fera.Troll).Vida, comoTroll);
        Assert.NotEqual(comoGente, comoTroll);
    }

    [Fact]
    public void EstoqueInicialCobreTodasAsClassesComChapeu()
    {
        foreach (var classe in Classes.ClassesComChapeu)
        {
            Assert.True(Classes.EstoqueInicial[classe] > 0);
        }
        Assert.Equal(0, Classes.EstoqueInicial[Classe.Aldeao]);
    }
}
