import { describe, expect, it } from 'vitest';

import { buildActivationChecklist } from './data';

describe('buildActivationChecklist', () => {
  it('só considera a clínica pronta para agendar quando há procedimento ativo', () => {
    const withoutProcedure = buildActivationChecklist({
      hasDoctor: true,
      hasHours: true,
      hasPatient: true,
      hasProcedure: false,
      hasWhatsapp: true,
    });

    expect(withoutProcedure.complete).toBe(false);
    expect(withoutProcedure.items).toContainEqual(
      expect.objectContaining({
        key: 'procedure',
        done: false,
        href: '/configuracoes/procedimentos',
      }),
    );

    const complete = buildActivationChecklist({
      hasDoctor: true,
      hasHours: true,
      hasPatient: true,
      hasProcedure: true,
      hasWhatsapp: true,
    });
    expect(complete).toMatchObject({ done: 5, total: 5, complete: true });
  });
});
