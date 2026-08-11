import { describe, expect, it } from 'vitest';

import {
  STUDY_UPKEEP,
  allCertificates,
  allProfessions,
  canEnrol,
  canPractise,
  certificateDef,
  dailyWage,
  professionForWork,
  studyDaysFor,
  type Certificate,
} from '../src/career/profession';
import { Campaign } from '../src/campaign/campaign';
import { runDailyTick } from '../src/campaign/dailyTick';
import { AttributeSet, type Attribute } from '../src/character/attributes';
import { SurvivalTables, workById } from '../src/survival/survival';

/**
 * Profissões, qualificação e estudo.
 *
 * Esta é uma **extensão do cliente TypeScript**: o Dart não tem profissões, e
 * por isso ela não aparece no contrato entre os dois motores. O que estes
 * testes garantem é que a extensão não pode ser burlada e não quebra o reset.
 */

const atributos = (valores: Partial<Record<Attribute, number>> = {}): AttributeSet =>
  new AttributeSet({
    strength: 6,
    perception: 6,
    luck: 6,
    intelligence: 6,
    endurance: 6,
    status: 6,
    ...valores,
  });

const nenhum = new Set<Certificate>();

describe('Qualificação', () => {
  it('toda profissão exerce um trabalho que existe', () => {
    // Um `work` errado passaria despercebido até alguém escolher a vaga e o
    // reset lançar. A tabela de sobrevivência é a autoridade.
    for (const p of allProfessions) {
      expect(() => workById(p.work)).not.toThrow();
    }
  });

  it('não há duas profissões disputando o mesmo trabalho', () => {
    // `professionForWork` devolve a primeira; duas para o mesmo trabalho
    // tornaria o salário dependente da ordem da lista.
    const trabalhos = allProfessions.map((p) => p.work);
    expect(new Set(trabalhos).size).toBe(trabalhos.length);
  });

  it('as vagas de entrada não pedem certificado', () => {
    // O jogo tem de ser jogável no minuto zero, sem crédito e sem curso.
    const abertas = allProfessions.filter(
      (p) => p.requires === null && p.minLevel === 'survivor',
    );
    expect(abertas.length).toBeGreaterThanOrEqual(2);
  });

  it('vaga sem o certificado é recusada, com o motivo', () => {
    const quimico = allProfessions.find((p) => p.id === 'quimico')!;
    const r = canPractise(quimico, { certificates: nenhum, level: 'elite' });
    expect(r.ok).toBe(false);
    // O nome vem do catálogo, e não de uma cópia aqui: uma passada de nomes
    // não deveria quebrar um teste sobre qualificação.
    if (!r.ok) expect(r.reason).toContain(certificateDef('chemistry').label);
  });

  it('certificado sem o nível também é recusado', () => {
    const eletricista = allProfessions.find((p) => p.id === 'eletricista')!;
    const comCurso = new Set<Certificate>(['basic', 'industrial']);
    expect(canPractise(eletricista, { certificates: comCurso, level: 'farmer' }).ok).toBe(
      false,
    );
    expect(
      canPractise(eletricista, { certificates: comCurso, level: 'industrialist' }).ok,
    ).toBe(true);
  });

  it('profissão qualificada paga mais que a de entrada', () => {
    // Sem isso o curso seria dinheiro jogado fora, e ninguém estudaria.
    const catador = allProfessions.find((p) => p.id === 'catador')!;
    const quimico = allProfessions.find((p) => p.id === 'quimico')!;
    expect(dailyWage(quimico, 40)).toBeGreaterThan(dailyWage(catador, 40));
  });

  it('o salário sobe com o piso que o governador definiu', () => {
    // É o que amarra carreira e política: quem estudou tem mais a ganhar com
    // um governo que paga bem.
    const quimico = allProfessions.find((p) => p.id === 'quimico')!;
    expect(dailyWage(quimico, 80)).toBe(dailyWage(quimico, 40) * 2);
  });

  it('todo trabalho da tabela tem uma profissão', () => {
    // Um trabalho sem profissão apareceria no painel sem salário e sem
    // explicação de como destravá-lo.
    for (const w of [
      'dump',
      'publicFarming',
      'oil',
      'rareEarth',
      'hydroponics',
      'bioreactors',
      'textiles',
      'hardware',
      'laboratory',
      'gunsmith',
    ]) {
      expect(professionForWork(w), `sem profissão: ${w}`).not.toBeNull();
    }
  });
});

describe('Estudo', () => {
  it('a corrente de certificados não tem requisito quebrado', () => {
    const ids = new Set(allCertificates.map((c) => c.id));
    for (const c of allCertificates) {
      for (const r of c.requires) expect(ids.has(r)).toBe(true);
    }
  });

  it('o atributo favorecido encurta o curso, mas nunca zera', () => {
    // Curso de zero dia seria só um botão de comprar certificado, e a decisão
    // — abrir mão de dias de salário — sumiria.
    const quimica = certificateDef('chemistry');
    const burro = studyDaysFor(quimica, atributos({ intelligence: 3 }));
    const genio = studyDaysFor(quimica, atributos({ intelligence: 12 }));
    expect(genio).toBeLessThan(burro);
    expect(genio).toBeGreaterThanOrEqual(1);
  });

  it('matrícula exige o curso anterior, dinheiro, e um curso por vez', () => {
    const industrial = certificateDef('industrial');

    expect(
      canEnrol(industrial, {
        certificates: nenhum,
        credits: 99999,
        attributes: atributos(),
        studying: false,
      }),
    ).toMatchObject({ ok: false });

    const comBasico = new Set<Certificate>(['basic']);
    expect(
      canEnrol(industrial, {
        certificates: comBasico,
        credits: 10,
        attributes: atributos(),
        studying: false,
      }),
    ).toMatchObject({ ok: false });

    expect(
      canEnrol(industrial, {
        certificates: comBasico,
        credits: 99999,
        attributes: atributos(),
        studying: true,
      }),
    ).toMatchObject({ ok: false });

    expect(
      canEnrol(industrial, {
        certificates: comBasico,
        credits: 99999,
        attributes: atributos(),
        studying: false,
      }),
    ).toMatchObject({ ok: true });
  });

  it('não dá para se matricular no que já se tem', () => {
    expect(
      canEnrol(certificateDef('basic'), {
        certificates: new Set<Certificate>(['basic']),
        credits: 99999,
        attributes: atributos(),
        studying: false,
      }),
    ).toMatchObject({ ok: false });
  });

  it('estudar custa mais que descansar e menos que o lixão', () => {
    // Custar zero faria o curso ser sempre melhor que folgar, e a decisão
    // desapareceria.
    expect(STUDY_UPKEEP.hunger).toBeGreaterThan(SurvivalTables.idleBase.hunger);
    expect(STUDY_UPKEEP.hunger).toBeLessThan(
      SurvivalTables.idleBase.hunger + workById('dump').upkeep.hunger,
    );
  });
});

describe('Curso dentro do reset diário', () => {
  const campanha = (): Campaign =>
    Campaign.create({
      id: 'curso',
      seedLabel: 'contrato-dart-ts',
      characterName: 'Estudante',
      now: 0,
    });

  it('o curso avança por reset e entrega o certificado no fim', () => {
    const c = campanha();
    c.character.studyingCertificate = 'basic';
    c.character.studyDaysRemaining = 2;

    const dia1 = runDailyTick(c, { publicWork: 'dump' });
    expect(c.character.certificates.has('basic')).toBe(false);
    expect(dia1.events.some((e) => e.includes('Estudando'))).toBe(true);

    const dia2 = runDailyTick(c, { publicWork: 'dump' });
    expect(c.character.certificates.has('basic')).toBe(true);
    expect(dia2.events.some((e) => e.includes('CERTIFICADO'))).toBe(true);
    expect(c.character.isStudying).toBe(false);
  });

  it('o dia de curso não paga salário nem produz', () => {
    // O curso consome o dia de trabalho. Receber salário estudando faria o
    // curso ser gratuito, e a escolha deixaria de existir.
    const c = campanha();
    c.character.studyingCertificate = 'basic';
    c.character.studyDaysRemaining = 2;
    const antes = c.character.credits;

    const r = runDailyTick(c, { publicWork: 'dump' });

    expect(r.produced).toEqual({});
    expect(c.character.credits).toBeLessThanOrEqual(antes);
    expect(r.events.some((e) => e.includes('salário'))).toBe(false);
  });

  it('o custo do curso entra na conta do dia, discriminado', () => {
    const c = campanha();
    c.character.studyingCertificate = 'basic';
    c.character.studyDaysRemaining = 1;

    const r = runDailyTick(c, {});
    expect(r.upkeep.lines.some((l) => l.label === 'Curso')).toBe(true);
    expect(r.upkeep.total.hunger).toBeGreaterThan(SurvivalTables.idleBase.hunger);
  });

  it('o certificado sobrevive ao save', () => {
    const c = campanha();
    c.character.certificates.add('basic');
    c.character.studyingCertificate = 'agro';
    c.character.studyDaysRemaining = 2;

    const volta = Campaign.fromJson(c.toJson());
    expect(volta.character.certificates.has('basic')).toBe(true);
    expect(volta.character.studyingCertificate).toBe('agro');
    expect(volta.character.studyDaysRemaining).toBe(2);
  });

  it('certificado desconhecido no save é descartado, não derruba a campanha', () => {
    // Um curso removido numa versão futura não pode matar campanhas antigas.
    const c = campanha();
    const json = c.toJson();
    (json.character as Record<string, unknown>).certificates = ['basic', 'inventado'];
    (json.character as Record<string, unknown>).studyingCertificate = 'inventado';

    const volta = Campaign.fromJson(json);
    expect(volta.character.certificateList).toEqual(['basic']);
    expect(volta.character.studyingCertificate).toBeNull();
  });
});
