import { describe, expect, it } from 'vitest';

import { MemoryStore } from '../src/net/localServer';
import {
  SPEED_RANGE,
  SettingsStore,
  defaultSettings,
  sanitizeSettings,
} from '../src/net/settings';
import { QualityGovernor } from '../src/render/quality';

describe('Saneamento das preferências', () => {
  it('nada vira o padrão', () => {
    expect(sanitizeSettings(null)).toEqual(defaultSettings);
    expect(sanitizeSettings('lixo')).toEqual(defaultSettings);
    expect(sanitizeSettings(42)).toEqual(defaultSettings);
  });

  it('velocidade fora da faixa é presa nas pontas', () => {
    expect(sanitizeSettings({ cameraSpeed: 99 }).cameraSpeed).toBe(SPEED_RANGE.max);
    expect(sanitizeSettings({ cameraSpeed: -3 }).cameraSpeed).toBe(SPEED_RANGE.min);
  });

  it('velocidade inválida não congela a câmera', () => {
    // `localStorage` é do usuário: dá para editar à mão. `Number(null)` é 0, e
    // 0 travaria o arrasto e o teclado numa tela que não explica nada.
    for (const ruim of [NaN, Infinity, null, undefined, '1.5', {}]) {
      const s = sanitizeSettings({ cameraSpeed: ruim });
      expect(s.cameraSpeed).toBe(defaultSettings.cameraSpeed);
      expect(s.cameraSpeed).toBeGreaterThan(0);
    }
  });

  it('qualidade desconhecida cai no automático', () => {
    expect(sanitizeSettings({ quality: 'ultra' }).quality).toBe('auto');
    expect(sanitizeSettings({ quality: 'alto' }).quality).toBe('alto');
  });

  it('campos ausentes não apagam os outros', () => {
    const s = sanitizeSettings({ wind: false });
    expect(s.wind).toBe(false);
    expect(s.quality).toBe(defaultSettings.quality);
    expect(s.cameraSpeed).toBe(defaultSettings.cameraSpeed);
  });
});

describe('Guarda das preferências', () => {
  it('grava e relê', () => {
    const store = new MemoryStore();
    new SettingsStore(store).update({ quality: 'baixo', wind: false });
    const outro = new SettingsStore(store);
    expect(outro.current.quality).toBe('baixo');
    expect(outro.current.wind).toBe(false);
  });

  it('JSON corrompido não impede o jogo de abrir', () => {
    const store = new MemoryStore();
    store.setItem('ck.settings', '{{{ não é json');
    expect(new SettingsStore(store).current).toEqual(defaultSettings);
  });

  it('avisa quem estiver ouvindo', () => {
    // O mundo 3D fica montado enquanto o jogador vai ao menu e volta; sem o
    // aviso, o ajuste só valeria na próxima abertura do jogo.
    const store = new SettingsStore(new MemoryStore());
    const vistos: boolean[] = [];
    const cancelar = store.subscribe((s) => vistos.push(s.wind));

    store.update({ wind: false });
    store.update({ wind: true });
    cancelar();
    store.update({ wind: false });

    expect(vistos).toEqual([false, true]);
  });

  it('restaurar volta tudo ao padrão de uma vez', () => {
    const store = new SettingsStore(new MemoryStore());
    store.update({ quality: 'alto', wind: false, cameraSpeed: 2, invertDrag: true });
    expect(store.reset()).toEqual(defaultSettings);
  });
});

describe('Qualidade fixada pelo jogador', () => {
  it('travada, a classe não se mexe por mais ruim que fique o quadro', () => {
    // Quem fixa "alto" num aparelho fraco quer alto. Um governador que
    // "corrige" a escolha em silêncio é um ajuste que não ajusta nada.
    const g = new QualityGovernor('alto');
    g.setLocked('alto');
    for (let i = 0; i < 200; i++) g.sample(0.1); // 10 FPS
    expect(g.tier).toBe('alto');
    expect(g.isLocked).toBe(true);
  });

  it('solta, volta a obedecer ao medidor', () => {
    const g = new QualityGovernor('alto');
    g.setLocked('alto');
    g.setLocked(null);
    for (let i = 0; i < 20; i++) g.sample(0.1);
    expect(g.tier).not.toBe('alto');
  });

  it('travar numa classe diferente avisa quem redesenha', () => {
    const trocas: string[] = [];
    const g = new QualityGovernor('alto', (t) => trocas.push(t));
    g.setLocked('baixo');
    expect(trocas).toEqual(['baixo']);
    // Travar de novo na mesma classe não redesenha à toa.
    g.setLocked('baixo');
    expect(trocas).toEqual(['baixo']);
  });
});
