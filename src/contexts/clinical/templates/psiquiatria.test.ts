import { describe, expect, it } from 'vitest';

import { getTemplate, listTemplates } from '.';
import { psiquiatriaTemplate } from './psiquiatria';

describe('template clínico de Psiquiatria', () => {
  it('fica disponível no catálogo público com a especialidade correta', () => {
    expect(getTemplate('psiquiatria')).toBe(psiquiatriaTemplate);
    expect(listTemplates()).toContainEqual({
      id: 'psiquiatria',
      nome: 'Psiquiatria',
      especialidade: 'Psiquiatria',
    });
  });

  it('usa somente os campos persistidos pelo prontuário, sem duplicatas', () => {
    const keys = psiquiatriaTemplate.fields.map(({ key }) => key);

    expect(keys).toEqual([
      'queixa_principal',
      'historia_doenca_atual',
      'exame_fisico',
      'hipotese_diagnostica',
      'conduta',
      'observacoes',
    ]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('orienta anamnese, exame do estado mental, avaliação de risco e plano terapêutico', () => {
    const fields = Object.fromEntries(
      psiquiatriaTemplate.fields.map(({ key, label, placeholder }) => [
        key,
        `${label} ${placeholder ?? ''}`,
      ]),
    );

    expect(fields.historia_doenca_atual).toMatch(/antecedentes psiquiátricos.*familiares/iu);
    expect(fields.historia_doenca_atual).toMatch(/álcool.*substâncias/iu);
    expect(fields.exame_fisico).toMatch(/estado mental/iu);
    expect(fields.exame_fisico).toMatch(/risco de suicídio.*plano.*meios.*tentativas/iu);
    expect(fields.hipotese_diagnostica).toMatch(/diagnósticos diferenciais.*CID/iu);
    expect(fields.conduta).toMatch(/plano de segurança.*manejo de crise/iu);
  });
});
