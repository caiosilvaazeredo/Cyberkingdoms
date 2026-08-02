# Como rodar o CyberKingdoms

Guia completo para clonar, rodar, testar e publicar o jogo.

---

## 1. Pré-requisitos

| Ferramenta | Versão | Para quê |
|---|---|---|
| **Flutter SDK** | 3.35 ou superior | Obrigatório |
| **Dart** | 3.9.0 ou superior | Vem junto com o Flutter |
| **Android Studio** ou **Xcode** | recente | Só para rodar em celular |
| **Node.js** | 20+ | Só para re-renderizar sprites |

Confira a instalação:

```sh
flutter --version
flutter doctor
```

`flutter doctor` vai reclamar do que falta para cada plataforma. Para rodar só
no navegador, basta a linha do Chrome estar verde.

### Instalando o Flutter

- **Windows / macOS / Linux**: siga https://docs.flutter.dev/get-started/install
- Depois de descompactar, adicione `flutter/bin` ao `PATH`.

### Já tem Flutter, mas mais antigo

```sh
flutter upgrade
```

O Dart 3.9 é piso de verdade, não capricho: `shared_preferences` e
`path_provider` — este último puxado pelo Firebase — declaram `^3.9.0`. Não dá
para baixar a exigência do projeto sem regredir esses pacotes junto. Um Flutter
com Dart 3.8 falha assim, ainda no `pub get`:

```
The current Dart SDK version is 3.8.1.
Because cyberkingdoms requires SDK version ^3.9.0, version solving failed.
```

Se aparecer **`Waiting for another flutter command to release the startup
lock...`** e não sair do lugar, sobrou um processo travado. Feche os terminais e
qualquer IDE com o projeto aberto; se persistir, apague o arquivo de trava:

```sh
# Windows (PowerShell)
Remove-Item "$env:LOCALAPPDATA\..\..\flutter\bin\cache\lockfile" -ErrorAction SilentlyContinue
# ou, mais direto, apague <pasta-do-flutter>\bin\cache\lockfile

# macOS / Linux
rm -f "$(dirname "$(dirname "$(which flutter)")")/bin/cache/lockfile"
```

---

## 2. Clonar e preparar

```sh
git clone https://github.com/caiosilvaazeredo/Cyberkingdoms.git
cd Cyberkingdoms
git checkout claude/cyberkingdoms-mmo-procedural-nfl20z

flutter pub get
```

`flutter pub get` baixa as dependências. Rode de novo sempre que o
`pubspec.yaml` mudar.

---

## 3. Rodar o jogo

### No navegador (jeito mais rápido de ver funcionando)

```sh
flutter run -d chrome
```

### Num celular Android

1. Ative **Opções do desenvolvedor** e **Depuração USB** no aparelho.
2. Conecte por USB e autorize o computador.
3. Confirme que o aparelho aparece:

```sh
flutter devices
flutter run
```

### Num emulador

```sh
flutter emulators                      # lista os emuladores
flutter emulators --launch <id>        # abre um
flutter run
```

### No iOS

Precisa de macOS com Xcode. Abra `ios/Runner.xcworkspace` uma vez para
configurar a assinatura, depois:

```sh
flutter run -d <id-do-iphone>
```

### Atalhos úteis com o app rodando

| Tecla | Efeito |
|---|---|
| `r` | Hot reload — aplica a mudança sem perder o estado |
| `R` | Hot restart — reinicia o app |
| `q` | Encerra |

---

## 4. Testes

```sh
flutter test                       # a suíte inteira (251 testes)
flutter test test/quest_test.dart  # um arquivo só
flutter test --reporter=expanded   # saída detalhada
```

Os testes cobrem:

| Arquivo | O que valida |
|---|---|
| `world_gen_test.dart` | Determinismo da seed, distribuição de biomas, 5 capitais + 15 satélites, rotas, e a regra de que nenhum tile é pavimentado |
| `survival_test.dart` | As tabelas de Fome/Sede do GDD, incluindo o exemplo resolvido do documento |
| `economy_test.dart` | Cadeia produtiva de 3 camadas, mercados, inventário |
| `building_test.dart` | Regras de construção, terreno, produção diária |
| `quest_test.dart` | Campanha principal, recompensas, persistência |
| `campaign_test.dart` | Reset diário, viagem, combate, política, save/load |
| `ui_flow_test.dart` | Navegação entre telas e criação de campanha |
| `audio_test.dart` | Todo som referenciado existe, está declarado e é usado |
| `ux_test.dart` | Overflow em 5 tamanhos de tela, escala de texto, alvos de toque, contraste, tipografia |
| `golden_test.dart` | Capturas de tela versionadas de 10 telas |
| `world_render_test.dart` | Render isométrico do mundo: cobertura da tela, sprites carregados, contorno do terreno, arte de toda feature gerada, custo por nível de zoom |

### Capturas de tela

As imagens em `test/goldens/` são geradas pelos próprios testes — sem browser,
sem emulador. É a única forma prática de inspecionar a interface aqui: o Flutter
web com CanvasKit desenha tudo num `<canvas>`, então automação de navegador não
enxerga nem consegue clicar em nada.

```sh
flutter test test/golden_test.dart                  # compara com o commitado
flutter test test/golden_test.dart --update-goldens # regrava depois de mudar a UI
```

A aba Mundo não entra por aí: o `GameWidget` do Flame pinta a partir do próprio
laço de render, que nunca roda num widget test, e a captura saía preta. O
`world_render_test.dart` contorna isso instanciando o jogo e chamando `render`
num canvas próprio — mesmo código de projeção, culling e ancoragem que roda no
celular:

```sh
flutter test test/world_render_test.dart --update-goldens
```

As imagens entram no controle de versão de propósito: assim uma regressão visual
aparece no diff do PR em vez de passar despercebida.

Análise estática:

```sh
flutter analyze
```

Deve terminar com `No issues found!`.

---

## 5. Gerar builds

### Android

```sh
flutter build apk --release              # APK único
flutter build appbundle --release        # AAB para a Play Store
```

Saída em `build/app/outputs/`.

### iOS

```sh
flutter build ipa --release
```

### Web

```sh
flutter build web --release
```

Saída em `build/web/`. Para servir localmente:

```sh
cd build/web && python3 -m http.server 8080
```

> **Nota:** se a máquina não tiver acesso ao CDN do Google, use
> `flutter build web --release --no-web-resources-cdn`. Isso empacota o
> CanvasKit junto em vez de buscá-lo em `gstatic.com`.

---

## 6. Conectar o Firebase (opcional)

O jogo roda **inteiro offline** sem nenhuma configuração. Para ligar a
sincronização em nuvem no projeto `cyberkingdoms-f1142`:

```sh
dart pub global activate flutterfire_cli
flutterfire configure --project=cyberkingdoms-f1142
```

O comando pede login no Google, registra os apps Android/iOS/Web no console do
Firebase e **sobrescreve** `lib/firebase_options.dart` com as chaves reais.

Enquanto isso não é feito, o arquivo é um placeholder com
`isConfigured = false` e o app usa o armazenamento local — sem erro, sem tela
quebrada.

---

## 7. Regerar o áudio (raramente necessário)

A trilha e os efeitos de combate são sintetizados, não gravados:

```sh
pip install numpy soundfile
python3 tools/audio-synth/synth.py assets/audio
```

O gerador é determinístico — a mesma invocação produz exatamente os mesmos
arquivos, então regerar não polui o diff sem motivo.

## 8. Re-renderizar os sprites (raramente necessário)

Os sprites em `assets/sprites/` já estão versionados. Só refaça se adicionar
kits 3D novos da Kenney:

```sh
cd tools/sprite-renderer
npm install
node render.mjs ../../assets/sprites <pasta-com-glb> [<outra-pasta>...]
```

O script usa Chromium headless e three.js para renderizar cada `.glb` em
projeção isométrica 2:1. Ajuste `executablePath` em `render.mjs` se o Chromium
estiver em outro caminho na sua máquina.

Um kit novo quase sempre precisa da pasta `Textures/` ao lado dos `.glb`: sem
ela o modelo renderiza sem cor e ninguém avisa — o script só reclama no console
do navegador. Se os sprites saírem cinzas, é isso.

---

## 9. Problemas comuns

**`Unable to load asset: assets/ui/bars/...`**
A declaração de assets do Flutter **não é recursiva**. Cada subpasta precisa da
própria linha em `pubspec.yaml`. Se adicionar `assets/ui/algo/`, declare-a.

**`Because cyberkingdoms requires SDK version ^3.9.0, version solving failed`**
O Flutter instalado é antigo demais. `flutter upgrade` resolve. Ver a seção 1.

**`MissingPluginException`**
Rode `flutter clean && flutter pub get` e recompile. Acontece quando o
registrador de plugins fica defasado depois de mexer nas dependências.

**O chão do mundo aparece xadrez, ou com faixas pretas entre os tiles**
A arte do chão precisa cobrir o tile inteiro. Um modelo menor que 1x1, ou um
adereço sobre fundo transparente, deixa o bloco de terra aparecendo por baixo.
Ver o comentário em `_grass` (`lib/game/sprite_catalog.dart`), que registra as
duas tentativas que falharam por esse motivo.

**Texto aparece como quadradinhos**
Alguma parte da UI está usando a fonte `KenneyInput`, que só tem glifos de
ícones (U+E000+) e nenhuma letra. Use `KenneyFuture` ou `KenneyFutureNarrow`.

**`flutter run` não acha o aparelho**
`flutter devices` lista o que está visível. No Android, confirme a autorização
de depuração USB que aparece na tela do celular.

**Texto de botão sai como retângulos**
Um `TextStyle` dentro de `ButtonStyle` **substitui** o do tema em vez de herdar.
Todo `textStyle:` de botão precisa declarar `fontFamily: CyberTheme.bodyFont`.
Há um teste que varre `lib/` procurando por isso.

**Não sai som no navegador**
Navegadores bloqueiam áudio até o usuário interagir com a página. O primeiro
toque destrava; até lá o jogo roda em silêncio de propósito.

**Build web mostra tela branca**
Abra o console do navegador. Se aparecer erro buscando `canvaskit.js` de
`gstatic.com`, recompile com `--no-web-resources-cdn`.

---

## 10. Onde mexer no quê

| Quero mudar... | Vá em... |
|---|---|
| Balanceamento de Fome/Sede | `lib/domain/survival/survival_tables.dart` |
| Itens, preços, receitas | `lib/domain/economy/` |
| Tipos de construção | `lib/domain/building/building_type.dart` |
| Módulos e níveis de construção | `lib/domain/building/building_module.dart` |
| Quests da campanha | `lib/domain/campaign/quest.dart` |
| Geração do mundo, biomas | `lib/domain/world/world_gen.dart` |
| O que nasce em cada bioma | `_scatterFeature` em `lib/domain/world/world_gen.dart` |
| Arte de cada feature do terreno | `_featureSprites` em `lib/game/sprite_catalog.dart` |
| O bloco de grama do chão | `_grass` em `lib/game/sprite_catalog.dart` |
| Regras do reset diário | `lib/domain/campaign/daily_tick.dart` |
| Cores e tipografia | `lib/core/theme.dart` |
| Telas | `lib/ui/screens/` |
| Sons e onde tocam | `lib/core/audio/audio_service.dart` |
| Arte de cada construção | campo `spriteId` em `lib/domain/building/building_type.dart` |
| Como o mundo é desenhado | `lib/game/world_game.dart` |
| Trilha e efeitos de combate | `tools/audio-synth/synth.py` |

Toda alteração de regra deve vir com teste. A suíte roda em ~30 segundos.
