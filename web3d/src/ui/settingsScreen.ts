import {
  SPEED_RANGE,
  qualityLabels,
  type GameSettings,
  type QualityChoice,
  type SettingsStore,
} from '../net/settings';
import { el, type Screen, type ScreenRouter } from './screens';

/**
 * Configurações.
 *
 * ## Sem "salvar" e sem "cancelar"
 *
 * Cada mudança vale e é gravada na hora. Num celular o jogador sai desta tela
 * pelo botão físico de voltar, que não passa por botão nenhum de confirmação:
 * um formulário com "salvar" perderia a alteração exatamente no caminho mais
 * usado. E como tudo aqui tem efeito imediato e visível, confirmar não
 * acrescenta segurança nenhuma — só um toque.
 *
 * ## Cada ajuste faz alguma coisa
 *
 * São cinco porque cinco é o que o jogo hoje sabe obedecer. Uma tela cheia de
 * chaves decorativas é pior que uma tela curta: o jogador mexe, não vê
 * diferença, e passa a desconfiar de todas as outras. Áudio e idioma entram
 * quando existirem.
 */

export interface SettingsDeps {
  readonly store: SettingsStore;
  readonly router: ScreenRouter;
}

const QUALIDADES: readonly QualityChoice[] = ['auto', 'baixo', 'medio', 'alto'];

/** Um par de botões ligado/desligado, com o estado no `aria-pressed`. */
function interruptor(
  rotulo: string,
  explicacao: string,
  ligado: boolean,
  onChange: (valor: boolean) => void,
): { root: HTMLElement; set(valor: boolean): void } {
  const botao = el('button', {
    className: 'escolha interruptor',
    attrs: {
      type: 'button',
      role: 'switch',
      'aria-checked': String(ligado),
      'aria-pressed': String(ligado),
    },
    children: [
      el('strong', { text: rotulo }),
      el('span', { text: explicacao }),
      el('span', { className: 'estado', text: ligado ? 'ligado' : 'desligado' }),
    ],
  });

  const set = (valor: boolean): void => {
    botao.setAttribute('aria-checked', String(valor));
    botao.setAttribute('aria-pressed', String(valor));
    const estado = botao.querySelector('.estado');
    if (estado) estado.textContent = valor ? 'ligado' : 'desligado';
  };

  botao.addEventListener('click', () => {
    const novo = botao.getAttribute('aria-checked') !== 'true';
    set(novo);
    onChange(novo);
  });

  return { root: botao, set };
}

export function createSettingsScreen(deps: SettingsDeps): Screen {
  // ------------------------------------------------------------- qualidade
  const qualidade = el('div', { className: 'escolhas linha-chips' });
  const chips = new Map<QualityChoice, HTMLButtonElement>();

  for (const escolha of QUALIDADES) {
    const chip = el('button', {
      className: 'chip',
      text: qualityLabels[escolha],
      attrs: { type: 'button', 'aria-pressed': 'false' },
    });
    chip.addEventListener('click', () => {
      deps.store.update({ quality: escolha });
      pintarQualidade(escolha);
    });
    chips.set(escolha, chip);
    qualidade.appendChild(chip);
  }

  function pintarQualidade(atual: QualityChoice): void {
    for (const [id, chip] of chips) {
      chip.setAttribute('aria-pressed', String(id === atual));
    }
  }

  // -------------------------------------------------------------- câmera
  const velocidade = el('input', {
    attrs: {
      id: 'campo-velocidade',
      type: 'range',
      min: String(SPEED_RANGE.min),
      max: String(SPEED_RANGE.max),
      step: '0.1',
    },
  }) as HTMLInputElement;
  const velocidadeValor = el('span', { className: 'valor-faixa' });

  velocidade.addEventListener('input', () => {
    const v = Number(velocidade.value);
    velocidadeValor.textContent = `${v.toFixed(1)}×`;
    deps.store.update({ cameraSpeed: v });
  });

  const inverter = interruptor(
    'Inverter o arrasto',
    'Ligado, o dedo move a câmera. Desligado, arrasta o chão sob o dedo.',
    false,
    (v) => deps.store.update({ invertDrag: v }),
  );

  const vento = interruptor(
    'Vento na grama',
    'Desligar economiza GPU e ajuda quem se incomoda com movimento constante.',
    true,
    (v) => deps.store.update({ wind: v }),
  );

  const estatisticas = interruptor(
    'Mostrar diagnóstico',
    'Bioma, número de lâminas e classe do aparelho no painel.',
    true,
    (v) => deps.store.update({ showStats: v }),
  );

  // -------------------------------------------------------------- rodapé
  const restaurar = el('button', {
    className: 'secundario',
    text: 'RESTAURAR PADRÕES',
    attrs: { type: 'button' },
  });
  restaurar.addEventListener('click', () => aplicar(deps.store.reset()));

  const voltar = el('button', {
    className: 'secundario',
    text: 'VOLTAR',
    attrs: { type: 'button' },
  });
  voltar.addEventListener('click', () => void deps.router.pop());

  const root = el('section', {
    className: 'tela folha',
    attrs: { 'aria-label': 'Configurações' },
    children: [
      el('h1', { text: 'CONFIGURAÇÕES' }),
      el('p', {
        className: 'nota',
        text: 'Tudo vale na hora e fica gravado. Não há o que confirmar.',
      }),

      el('h2', { text: 'Qualidade' }),
      qualidade,
      el('p', {
        className: 'nota',
        text: 'No automático o jogo mede o tempo de quadro e ajusta sozinho. Fixar trava a classe, inclusive quando ela não couber.',
      }),

      el('h2', { text: 'Câmera' }),
      el('label', {
        text: 'Velocidade do arrasto e do teclado',
        attrs: { for: 'campo-velocidade' },
      }),
      el('div', {
        className: 'faixa',
        children: [velocidade, velocidadeValor],
      }),
      inverter.root,

      el('h2', { text: 'Cena' }),
      vento.root,
      estatisticas.root,

      restaurar,
      voltar,
    ],
  });

  function aplicar(s: GameSettings): void {
    pintarQualidade(s.quality);
    velocidade.value = String(s.cameraSpeed);
    velocidadeValor.textContent = `${s.cameraSpeed.toFixed(1)}×`;
    inverter.set(s.invertDrag);
    vento.set(s.wind);
    estatisticas.set(s.showStats);
  }

  return {
    id: 'config',
    root,
    // Relê a cada entrada em vez de confiar no que ficou pintado: outra tela
    // pode ter mexido, e um save de outra versão pode ter caído no padrão ao
    // ser saneado.
    onEnter: () => aplicar(deps.store.current),
  };
}
