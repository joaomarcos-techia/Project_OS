import { describe, expect, it } from 'vitest';

import {
  TOUR_LAST_STEP,
  TOUR_STEPS,
  onboardingActionSchema,
  tourStepAt,
} from './operational-onboarding';

/**
 * O-7 — contrato de ENTRADA do onboarding operacional.
 *
 * A máquina de estados em si (CAS, idempotência, RLS, constraints) é provada
 * contra Postgres real em `scripts/security/onboarding-progress-db.ts`: ela vive
 * em SQL, e um teste com banco mockado provaria o mock. O que sobra para aqui é
 * exatamente o que NÃO depende de banco — a fronteira que decide o que sequer
 * chega a virar escrita.
 */
describe('onboardingActionSchema', () => {
  it('aceita as ações do produto e recusa qualquer outra', () => {
    for (const action of [
      'tour_start',
      'tour_complete',
      'tour_skip',
      'tour_reopen',
      'docs_visited',
      'checklist_dismiss',
    ]) {
      expect(onboardingActionSchema.safeParse({ action }).success).toBe(true);
    }
    // `tour_close` parece plausível e não existe: fechar é pular.
    for (const action of ['tour_close', 'tour_reset', 'admin_override', '']) {
      expect(onboardingActionSchema.safeParse({ action }).success).toBe(false);
    }
  });

  it('RECUSA escopo vindo do cliente em vez de ignorá-lo em silêncio', () => {
    // O ataque é mandar o tenant/usuário de outra pessoa junto da ação. `.strict()`
    // transforma isso em recusa: se fosse `.strip()`, o campo seria descartado
    // sem ruído e ninguém saberia que alguém tentou.
    const smuggled = [
      { action: 'tour_start', clinicId: '11111111-1111-1111-1111-111111111111' },
      { action: 'tour_start', userId: '22222222-2222-2222-2222-222222222222' },
      { action: 'checklist_dismiss', clinic_id: 'outra-clinica' },
      { action: 'docs_visited', tourState: 'completed' },
    ];
    for (const payload of smuggled) {
      expect(onboardingActionSchema.safeParse(payload).success).toBe(false);
    }
  });

  it('limita fromStep ao tamanho real da lista de passos', () => {
    expect(onboardingActionSchema.safeParse({ action: 'tour_next', fromStep: 0 }).success).toBe(
      true,
    );
    expect(
      onboardingActionSchema.safeParse({ action: 'tour_next', fromStep: TOUR_LAST_STEP }).success,
    ).toBe(true);
    for (const fromStep of [-1, TOUR_LAST_STEP + 1, 99, 1.5, Number.NaN, '1']) {
      expect(onboardingActionSchema.safeParse({ action: 'tour_next', fromStep }).success).toBe(
        false,
      );
    }
  });

  it('exige fromStep em tour_next e tour_previous', () => {
    expect(onboardingActionSchema.safeParse({ action: 'tour_next' }).success).toBe(false);
    expect(onboardingActionSchema.safeParse({ action: 'tour_previous' }).success).toBe(false);
  });
});

describe('TOUR_STEPS', () => {
  it('aponta só para rotas internas do app', () => {
    for (const step of TOUR_STEPS) {
      // Um passo com URL absoluta viraria um link de saída dentro de um fluxo
      // guiado — e, se algum dia viesse de fora, um redirect aberto.
      expect(step.href.startsWith('/')).toBe(true);
      expect(step.href.startsWith('//')).toBe(false);
    }
  });

  it('não repete chaves', () => {
    const keys = TOUR_STEPS.map((step) => step.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('recorta índices fora da lista em vez de devolver undefined', () => {
    // O banco permite até 32 e a lista pode encolher numa release futura; sem o
    // recorte, uma linha antiga renderizaria `undefined.title`.
    expect(tourStepAt(-5)).toBe(TOUR_STEPS[0]);
    expect(tourStepAt(0)).toBe(TOUR_STEPS[0]);
    expect(tourStepAt(TOUR_LAST_STEP)).toBe(TOUR_STEPS[TOUR_LAST_STEP]);
    expect(tourStepAt(999)).toBe(TOUR_STEPS[TOUR_LAST_STEP]);
  });
});
