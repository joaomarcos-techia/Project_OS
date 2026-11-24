/**
 * P2.5 — regras contratuais da operadora: lidas com padrões que não presumem nada a mais, e
 * nunca acima do teto do padrão TISS (100 guias por lote).
 */
import { describe, expect, it } from 'vitest';

import { insurerRules, TISS_MAX_GUIDES_PER_BATCH } from './insurer-rules';

describe('insurerRules (P2.5)', () => {
  it('sem nada registrado: exige o profissional, teto do padrão, sem prazo', () => {
    expect(insurerRules({})).toEqual({
      requireProfessionalCredential: true,
      maxGuidesPerBatch: 100,
      submissionDeadlineDays: null,
      // P8.4-r (regra 7): sem registro, desconhecida (nunca aceite presumido).
      extraItemsAfterSession: 'unknown',
    });
    expect(insurerRules(null)).toEqual(insurerRules({}));
    expect(TISS_MAX_GUIDES_PER_BATCH).toBe(100);
  });

  it('lê o que o contrato registrou', () => {
    expect(
      insurerRules({
        requireProfessionalCredential: false,
        maxGuidesPerBatch: 30,
        submissionDeadlineDays: 60,
        extraItemsAfterSession: 'forbids',
      }),
    ).toEqual({
      requireProfessionalCredential: false,
      maxGuidesPerBatch: 30,
      submissionDeadlineDays: 60,
      extraItemsAfterSession: 'forbids',
    });
    expect(insurerRules({ extraItemsAfterSession: 'accepts' }).extraItemsAfterSession).toBe('accepts');
  });

  it('valor fora do permitido nunca relaxa o padrão: volta ao teto e a "sem prazo"', () => {
    expect(insurerRules({ maxGuidesPerBatch: 500 }).maxGuidesPerBatch).toBe(100);
    expect(insurerRules({ maxGuidesPerBatch: 0 }).maxGuidesPerBatch).toBe(100);
    expect(insurerRules({ maxGuidesPerBatch: '20' }).maxGuidesPerBatch).toBe(20);
    expect(insurerRules({ submissionDeadlineDays: 0 }).submissionDeadlineDays).toBeNull();
    expect(insurerRules({ submissionDeadlineDays: '30' }).submissionDeadlineDays).toBeNull();
    expect(
      insurerRules({ requireProfessionalCredential: 'false' }).requireProfessionalCredential,
    ).toBe(true);
    // Valor desconhecido da regra P8.4-r não vira aceite.
    expect(insurerRules({ extraItemsAfterSession: 'sim' }).extraItemsAfterSession).toBe('unknown');
    expect(insurerRules({ extraItemsAfterSession: true }).extraItemsAfterSession).toBe('unknown');
  });
});
