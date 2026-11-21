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
      }),
    ).toEqual({
      requireProfessionalCredential: false,
      maxGuidesPerBatch: 30,
      submissionDeadlineDays: 60,
    });
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
  });
});
