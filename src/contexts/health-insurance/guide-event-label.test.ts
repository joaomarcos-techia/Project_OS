import { describe, expect, it } from 'vitest';

import { guideEventLabel } from './guide-event-label';

describe('histórico da guia: texto do evento', () => {
  it('mudança de etapa mostra de → para', () => {
    expect(
      guideEventLabel({ fromStatus: 'reviewed', toStatus: 'approved', changedFields: ['status'] }),
    ).toBe('Conferida → Aprovada');
    expect(
      guideEventLabel({ fromStatus: null, toStatus: 'ready_for_review', changedFields: [] }),
    ).toBe('Para conferir');
  });

  it('ajuste da Consulta sem mudar de etapa diz o que mudou (não "Para conferir → Para conferir")', () => {
    expect(
      guideEventLabel({
        fromStatus: 'ready_for_review',
        toStatus: 'ready_for_review',
        changedFields: ['consulta_overrides'],
      }),
    ).toBe('Dados da consulta ajustados (etapa: Para conferir)');
  });

  it('outras alterações nomeiam os campos sem expor o nome da coluna', () => {
    expect(
      guideEventLabel({
        fromStatus: 'pending_data',
        toStatus: 'pending_data',
        changedFields: ['membership_id', 'issues', 'coluna_nova'],
      }),
    ).toBe('Guia alterada: carteirinha, pendências, outros dados (etapa: Falta dado)');
  });
});
