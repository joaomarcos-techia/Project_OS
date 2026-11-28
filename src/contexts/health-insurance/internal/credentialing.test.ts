/**
 * P2.2 — regra do credenciamento por plano e vigência (pura, sem banco). A prova com o
 * banco, a cobertura e a guia está em `scripts/security/health-insurance-config-db.ts`.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  credentialIssues,
  requiresProfessionalCredential,
  type CredentialPolicy,
  type CredentialRow,
} from './credentialing';

const PJ: CredentialPolicy = { providerKind: 'PJ', requireProfessionalCredential: true };
const PLAN_A = 'plan-a';
const PLAN_B = 'plan-b';
const DOC = 'doc-1';
const row = (r: Partial<CredentialRow>): CredentialRow => ({
  planId: null,
  professionalId: null,
  validFrom: '2026-01-01',
  validUntil: null,
  status: 'active',
  ...r,
});
const codes = (
  rows: CredentialRow[],
  check: { planId: string | null; professionalId: string | null; date: string },
  policy = PJ,
) => credentialIssues(rows, check, policy).map((i) => i.code);

describe('credenciamento da clínica (P2.2)', () => {
  it('vários planos: credenciada em A e B, atendimento em B passa', () => {
    const rows = [
      row({ planId: PLAN_A }),
      row({ planId: PLAN_B }),
      row({ planId: PLAN_B, professionalId: DOC }),
    ];
    expect(codes(rows, { planId: PLAN_B, professionalId: DOC, date: '2026-11-13' })).toEqual([]);
  });

  it('credenciada só no plano A: atendimento no plano B tem pendência que diz o porquê', () => {
    const issues = credentialIssues(
      [row({ planId: PLAN_A })],
      { planId: PLAN_B, professionalId: null, date: '2026-11-13' },
      PJ,
    );
    expect(issues.map((i) => i.code)).toEqual(['CREDENTIAL_CLINIC_MISSING']);
    expect(issues[0]!.message).toContain('só em outros planos');
    expect(issues[0]!.owner).toBe('gestor');
  });

  it('operadora sem plano no atendimento: só "todos os planos" confere (nunca presume)', () => {
    expect(
      codes([row({ planId: PLAN_A })], { planId: null, professionalId: null, date: '2026-11-13' }),
    ).toEqual(['CREDENTIAL_CLINIC_MISSING']);
    expect(
      codes([row({ planId: null })], { planId: null, professionalId: null, date: '2026-11-13' }),
    ).toEqual([]);
  });

  it('"todos os planos" registrado de propósito cobre qualquer plano', () => {
    expect(
      codes([row({ planId: null })], { planId: PLAN_B, professionalId: null, date: '2026-11-13' }),
    ).toEqual([]);
  });

  it('vigência vencida e contrato futuro não valem; a mensagem mostra as vigências', () => {
    const expired = credentialIssues(
      [row({ planId: PLAN_A, validUntil: '2026-06-30' })],
      { planId: PLAN_A, professionalId: null, date: '2026-11-13' },
      PJ,
    );
    expect(expired[0]!.message).toContain('2026-01-01 a 2026-06-30');
    const future = credentialIssues(
      [row({ planId: PLAN_A, validFrom: '2027-01-01' })],
      { planId: PLAN_A, professionalId: null, date: '2026-11-13' },
      PJ,
    );
    expect(future[0]!.code).toBe('CREDENTIAL_CLINIC_MISSING');
    expect(future[0]!.message).toContain('2027-01-01 a sem fim');
  });

  it('reajuste de vigência: até a véspera vale a antiga, a partir da data vale a nova', () => {
    const rows = [
      row({ planId: PLAN_A, validUntil: '2026-11-30' }),
      row({ planId: PLAN_A, validFrom: '2026-12-01' }),
    ];
    expect(codes(rows, { planId: PLAN_A, professionalId: null, date: '2026-11-30' })).toEqual([]);
    expect(codes(rows, { planId: PLAN_A, professionalId: null, date: '2026-12-01' })).toEqual([]);
  });

  it('suspenso não vale, com a palavra SUSPENSO na pendência', () => {
    const issues = credentialIssues(
      [row({ planId: PLAN_A, status: 'suspended' })],
      { planId: PLAN_A, professionalId: null, date: '2026-11-13' },
      PJ,
    );
    expect(issues[0]!.message).toContain('SUSPENSO');
  });

  it('nenhum credenciamento: pendência da clínica', () => {
    expect(codes([], { planId: PLAN_A, professionalId: null, date: '2026-11-13' })).toEqual([
      'CREDENTIAL_CLINIC_MISSING',
    ]);
  });
});

describe('profissional habilitado (P2.2)', () => {
  it('PJ: clínica credenciada mas o profissional não → pendência do profissional', () => {
    const rows = [row({ planId: PLAN_A }), row({ planId: PLAN_A, professionalId: 'outro' })];
    expect(codes(rows, { planId: PLAN_A, professionalId: DOC, date: '2026-11-13' })).toEqual([
      'CREDENTIAL_PROFESSIONAL_MISSING',
    ]);
  });

  it('PJ: profissional habilitado só em outro plano não vale para este', () => {
    const rows = [row({ planId: PLAN_A }), row({ planId: PLAN_B, professionalId: DOC })];
    expect(codes(rows, { planId: PLAN_A, professionalId: DOC, date: '2026-11-13' })).toEqual([
      'CREDENTIAL_PROFESSIONAL_MISSING',
    ]);
  });

  it('PF: o credenciamento da clínica é o do profissional (sem segunda exigência)', () => {
    expect(
      codes(
        [row({ planId: PLAN_A })],
        { planId: PLAN_A, professionalId: DOC, date: '2026-11-13' },
        { providerKind: 'PF', requireProfessionalCredential: true },
      ),
    ).toEqual([]);
  });

  it('operadora que dispensa a habilitação individual (P2.5): só a clínica conta', () => {
    expect(
      codes(
        [row({ planId: PLAN_A })],
        { planId: PLAN_A, professionalId: DOC, date: '2026-11-13' },
        { providerKind: 'PJ', requireProfessionalCredential: false },
      ),
    ).toEqual([]);
  });

  it('a dispensa só existe quando a operadora diz false; ausente = exige', () => {
    expect(requiresProfessionalCredential({})).toBe(true);
    expect(requiresProfessionalCredential(null)).toBe(true);
    expect(requiresProfessionalCredential({ requireProfessionalCredential: false })).toBe(false);
    expect(requiresProfessionalCredential({ requireProfessionalCredential: 'false' })).toBe(true);
  });
});
