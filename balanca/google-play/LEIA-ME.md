# Google Play — TWA (Trusted Web Activity)

O jogo já é uma PWA instalável (`public/manifest.webmanifest`, `public/sw.js`,
`public/pwa/`) — isto aqui é só o embrulho Android que faz a Play aceitar o
site como um app de verdade. Nada do jogo muda.

O que já está pronto neste diretório é um **ponto de partida**, não algo para
rodar direto: os dois passos abaixo (domínio + chave de assinatura) só existem
depois que você rodar isto na sua máquina.

## 1. Confirme o domínio

`twa-manifest.json` está com `balanca-do-reino.onrender.com` — o nome padrão
que o Render dá ao serviço `balanca-do-reino` do `render.yaml`. Se o jogo
estiver atrás de um domínio próprio, troque `host`, `iconUrl`, `maskableIconUrl`
e `webManifestUrl` para ele antes de continuar — TWA e Digital Asset Links são
por domínio exato, `www.` incluso ou não conforme o caso.

## 2. Instale o Bubblewrap e gere o projeto Android

```
npm install -g @bubblewrap/cli
cd google-play
bubblewrap build --manifest twa-manifest.json
```

Na primeira vez ele oferece instalar o próprio JDK e o Android SDK — deixe
instalar (não precisa ter o Android Studio para isto funcionar). O comando
gera um projeto Gradle completo nesta pasta.

## 3. Gere a chave de assinatura

```
keytool -genkey -v -keystore android.keystore -alias reino-de-migalhas \
  -keyalg RSA -keysize 2048 -validity 10000
```

Guarde a senha — sem ela não dá para publicar uma atualização no mesmo
pacote depois. Pegue o SHA256 da chave:

```
keytool -list -v -keystore android.keystore -alias reino-de-migalhas
```

## 4. Prove que o site e o app são do mesmo dono

Abra `public/.well-known/assetlinks.json` (na raiz do projeto do jogo, não
aqui) e troque `SUBSTITUA_PELO_SHA256_DA_SUA_CHAVE_DE_ASSINATURA` pelo valor
do passo 3. Publique o jogo de novo — o arquivo passa a ser servido em
`/.well-known/assetlinks.json` automaticamente, porque tudo em `public/` vai
para a build.

Confirme com a ferramenta oficial do Google antes de gastar um upload:
<https://developers.google.com/digital-asset-links/tools/generator>

Sem isto certo, o app abre com a barra de endereço do navegador visível — o
TWA some no meio do carregamento, sem erro nenhum para explicar por quê.

## 5. Build final e teste

```
bubblewrap build
```

Gera o `.aab` (o formato que a Play Store pede) e um `.apk` para testar num
aparelho ou emulador antes de subir.

## 6. Play Console — o que só a sua conta consegue fazer

- Conta de desenvolvedor: **US$ 25**, taxa única.
- Ficha da loja: descrição, capturas de tela, ícone (já tem em
  `public/pwa/icone-512.png`), categoria.
- Classificação indicativa: questionário IARC — o mesmo formato que a Steam
  usa, então as respostas servem para os dois.
- **Teste fechado obrigatório**: contas novas da Play precisam de pelo menos
  12 testadores ativos por 14 dias seguidos antes de liberar produção. Vale
  começar isso cedo — é o item do processo que mais demora, e não depende de
  nada técnico.
- Depois do teste fechado: promover para produção.
