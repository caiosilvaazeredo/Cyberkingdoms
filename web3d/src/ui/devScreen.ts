import { allBuildings } from '../building/buildingType';
import { categoryLabel, describeBuilding } from '../building/describe';
import {
  EXPECTED_FORMAT,
  clearAllOverrides,
  clearOverride,
  defaultModelUrl,
  hasOverride,
  repositoryPathFor,
  setOverride,
} from '../dev/spriteOverrides';
import { el, type Screen, type ScreenRouter } from './screens';

/**
 * Modo Dev: todas as construções, o que cada uma faz, e troca de modelo 3D.
 *
 * ## Por que a troca de modelo é da sessão, e a tela diz isso
 *
 * Um `.glb` tem de centenas de KB a vários MB. Guardá-lo no navegador
 * encheria o mesmo armazenamento onde mora a campanha, e — pior — faria o jogo
 * rodar com uma arte que não está no repositório: só você veria aquele
 * prédio. Então a troca vale enquanto a aba estiver aberta, e cada linha
 * mostra o caminho exato onde copiar o arquivo para valer de verdade.
 *
 * Prometer persistência que não existe seria a pior das duas opções: o jogador
 * perde o trabalho e só descobre no recarregamento.
 */

export interface DevScreenDeps {
  readonly router: ScreenRouter;
}

export function createDevScreen(deps: DevScreenDeps): Screen {
  const lista = el('div', { className: 'lista dev-lista' });
  const busca = el('input', {
    attrs: {
      id: 'campo-dev-busca',
      type: 'search',
      placeholder: 'filtrar por nome, categoria ou sprite',
      spellcheck: 'false',
      autocomplete: 'off',
    },
  }) as HTMLInputElement;

  const limparTudo = el('button', {
    className: 'secundario',
    text: 'RESTAURAR TODOS OS MODELOS',
    attrs: { type: 'button' },
  });
  limparTudo.addEventListener('click', () => {
    clearAllOverrides();
    montar();
  });

  const voltar = el('button', {
    className: 'secundario',
    text: 'VOLTAR',
    attrs: { type: 'button' },
  });
  voltar.addEventListener('click', () => void deps.router.pop());

  const root = el('section', {
    className: 'tela folha',
    attrs: { 'aria-label': 'Modo Dev' },
    children: [
      el('h1', { text: 'MODO DEV' }),
      el('p', {
        className: 'aviso-simulado',
        text:
          `Formato aceito: ${EXPECTED_FORMAT.label}. ${EXPECTED_FORMAT.detail} ` +
          EXPECTED_FORMAT.hint,
      }),
      el('p', {
        className: 'nota',
        text:
          'A troca de modelo vale só enquanto esta aba estiver aberta. Para ' +
          'valer de verdade, copie o arquivo para o caminho indicado em cada ' +
          'construção e recarregue.',
      }),
      el('label', { text: 'Filtrar', attrs: { for: 'campo-dev-busca' } }),
      busca,
      lista,
      limparTudo,
      voltar,
    ],
  });

  busca.addEventListener('input', montar);

  function montar(): void {
    const termo = busca.value.trim().toLowerCase();
    lista.textContent = '';

    const visiveis = allBuildings.filter((def) => {
      if (!termo) return true;
      return (
        def.name.toLowerCase().includes(termo) ||
        def.spriteId.toLowerCase().includes(termo) ||
        categoryLabel(def.category).toLowerCase().includes(termo)
      );
    });

    lista.appendChild(
      el('p', {
        className: 'nota',
        text: `${visiveis.length} de ${allBuildings.length} construções.`,
      }),
    );

    for (const def of visiveis) {
      lista.appendChild(cartao(def.id));
    }
  }

  function cartao(type: string): HTMLElement {
    const fatos = describeBuilding(type);
    const def = fatos.def;
    const trocado = hasOverride(def.spriteId);

    const arquivo = el('input', {
      attrs: { type: 'file', accept: '.glb,model/gltf-binary' },
    }) as HTMLInputElement;

    const aviso = el('span', { className: 'dev-aviso' });

    arquivo.addEventListener('change', () => {
      const f = arquivo.files?.[0];
      if (!f) return;
      // A extensão é checada aqui e não só no `accept`: o seletor do sistema
      // aceita "todos os arquivos" em vários navegadores, e um `.gltf` solto
      // carrega sem textura e sem erro — o prédio aparece branco e o
      // desenvolvedor culpa o modelo.
      if (!f.name.toLowerCase().endsWith(EXPECTED_FORMAT.extension)) {
        aviso.textContent = `Precisa ser ${EXPECTED_FORMAT.extension}. ${f.name} não serve.`;
        aviso.className = 'dev-aviso ruim';
        arquivo.value = '';
        return;
      }
      setOverride(def.spriteId, f);
      aviso.textContent = `Trocado por ${f.name} (só nesta sessão).`;
      aviso.className = 'dev-aviso ok';
      montar();
    });

    const restaurar = el('button', {
      className: 'secundario dev-restaurar',
      text: 'RESTAURAR',
      attrs: { type: 'button' },
    });
    restaurar.disabled = !trocado;
    restaurar.addEventListener('click', () => {
      clearOverride(def.spriteId);
      montar();
    });

    const linhas = (titulo: string, itens: readonly string[]): HTMLElement =>
      el('div', {
        className: 'dev-bloco',
        children: [
          el('strong', { text: titulo }),
          ...itens.map((t) => el('span', { text: t })),
        ],
      });

    return el('div', {
      className: trocado ? 'dev-item trocado' : 'dev-item',
      children: [
        el('h2', { text: `${def.name}${trocado ? ' · modelo trocado' : ''}` }),
        el('p', { className: 'dev-resumo', text: fatos.summary }),

        linhas('O que faz', fatos.effects),
        linhas('O que custa', fatos.costs),
        linhas('Exige', fatos.requirements),
        linhas('Progressão', fatos.progression),

        el('div', {
          className: 'dev-bloco',
          children: [
            el('strong', { text: 'Modelo 3D' }),
            el('span', { text: `sprite: ${def.spriteId}` }),
            el('span', { className: 'dev-caminho', text: defaultModelUrl(def.spriteId) }),
            el('span', {
              className: 'dev-caminho',
              text: `no repositório: ${repositoryPathFor(def.spriteId)}`,
            }),
          ],
        }),
        arquivo,
        aviso,
        restaurar,
      ],
    });
  }

  return {
    id: 'dev',
    root,
    onEnter: montar,
  };
}
