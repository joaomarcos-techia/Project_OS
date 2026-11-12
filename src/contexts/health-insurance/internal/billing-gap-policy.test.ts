import { describe, expect, it } from 'vitest';

import {
  classifyGuideIssues,
  decideBilling,
  errorCode,
  MAX_AUTOMATIC_ATTEMPTS,
  nextAttemptDelayMs,
  type BillingFacts,
  type GuideFact,
} from './billing-gap-policy';

const base: BillingFacts = {
  appointmentStatus: 'atendido',
  billingMode: 'convenio',
  hasPatient: true,
  hasProcedure: true,
  moduleEnabled: true,
  premiumDenial: null,
  coverage: { id: 'c1', status: 'ready', guideType: 'consulta' },
  guides: [],
};
const guide = (over: Partial<GuideFact> = {}): GuideFact => ({
  id: 'g1',
  status: 'ready_for_review',
  live: true,
  items: 1,
  issues: [],
  automatic: true,
  editedByUser: false,
  ...over,
});
const issue = (code: string, owner: 'gestor' | 'recepcao' | 'financeiro' | 'medico' = 'gestor') => ({
  code,
  field: 'x',
  message: 'm',
  owner,
});
const gapOf = (f: BillingFacts, opts = {}) => {
  const d = decideBilling(f, opts);
  if (d.action !== 'open_gap') throw new Error(`esperava pendência, veio ${d.action}`);
  return d.gap;
};

describe('decideBilling (P7.4)', () => {
  it('particular nunca entra no convênio; atendimento não concluído fecha como "não se aplica"', () => {
    expect(decideBilling({ ...base, billingMode: 'particular' })).toEqual({ action: 'ignore' });
    expect(decideBilling({ ...base, appointmentStatus: 'cancelado' })).toEqual({
      action: 'close_not_applicable',
    });
  });

  it('guia viva fora da edição fecha a pendência; guia emitida, em lote ou paga também', () => {
    for (const status of ['ready_for_review', 'reviewed', 'approved', 'exported', 'paid'] as const) {
      expect(decideBilling({ ...base, guides: [guide({ status })] })).toEqual({
        action: 'close_guide_ready',
        guideId: 'g1',
      });
    }
  });

  it('guia substituída: a substituta viva vale; a original substituída não segura nada', () => {
    const d = decideBilling({
      ...base,
      guides: [guide({ id: 'sub', status: 'approved' }), guide({ id: 'orig', status: 'replaced', live: false })],
    });
    expect(d).toEqual({ action: 'close_guide_ready', guideId: 'sub' });
  });

  it('guia fora da edição sem item é inconsistência para o suporte (nunca "pronta")', () => {
    const g = gapOf({ ...base, guides: [guide({ items: 0, status: 'reviewed' })] });
    expect([g.reason, g.owner, g.recovery]).toEqual(['guide_inconsistent', 'suporte', 'human']);
  });

  it('guia automática intocada em edição é reavaliada uma vez; depois, classificada pela pendência', () => {
    const pending = guide({ status: 'pending_data', items: 0, issues: [issue('CONTRACT_NOT_FOUND')] });
    expect(decideBilling({ ...base, guides: [pending] })).toEqual({ action: 'refresh_guide', guideId: 'g1' });
    const g = gapOf({ ...base, guides: [pending] }, { refreshTried: true });
    expect([g.reason, g.owner, g.guideId]).toEqual(['contract_missing', 'gestor', 'g1']);
  });

  it('guia mexida por um usuário não é sobrescrita pelo automático', () => {
    const g = gapOf({
      ...base,
      guides: [guide({ status: 'pending_data', editedByUser: true, issues: [issue('X', 'financeiro')] })],
    });
    expect([g.reason, g.owner, g.recovery]).toEqual(['guide_pending_data', 'financeiro', 'human']);
  });

  it('só guias canceladas: decisão do financeiro, sem guia nova automática', () => {
    const g = gapOf({ ...base, guides: [guide({ status: 'cancelled', live: false })] });
    expect([g.reason, g.owner, g.recovery]).toEqual(['guide_cancelled', 'financeiro', 'human']);
  });

  it.each([
    [{ coverage: null }, 'coverage_missing', 'recepcao'],
    [{ hasPatient: false }, 'coverage_missing', 'recepcao'],
    [{ coverage: { id: 'c', status: 'cancelled' as const, guideType: 'consulta' as const } }, 'coverage_cancelled', 'recepcao'],
    [{ coverage: { id: 'c', status: 'ready' as const, guideType: 'sp_sadt' as const } }, 'sp_sadt_manual', 'financeiro'],
    [{ coverage: { id: 'c', status: 'authorization_denied' as const, guideType: 'consulta' as const } }, 'authorization_denied', 'gestor'],
    [{ hasProcedure: false }, 'contract_missing', 'gestor'],
    [{ moduleEnabled: false }, 'module_disabled', 'gestor'],
  ])('sem guia: %o → %s (%s), recuperação humana', (over, reason, owner) => {
    const g = gapOf({ ...base, ...over });
    expect([g.reason, g.owner, g.recovery]).toEqual([reason, owner, 'human']);
  });

  it('autorização negada nunca vira guia; pendente de autorização vira guia em edição (nada presumido)', () => {
    expect(
      decideBilling({ ...base, coverage: { id: 'c', status: 'pending_authorization', guideType: 'consulta' } }),
    ).toEqual({ action: 'create_guide' });
  });

  it('dados completos e sem guia: cria; se a criação não resultou em guia, pendência (sem laço)', () => {
    expect(decideBilling(base)).toEqual({ action: 'create_guide' });
    expect(gapOf(base, { createTried: true }).reason).toBe('coverage_incomplete');
  });
});

describe('decideBilling — bloqueio comercial (D24)', () => {
  it.each(['trial', 'trial_expired', 'no_subscription', 'payment_pending', 'clinic_suspended', 'subscription_cancelled', 'plan_excludes'] as const)(
    '%s: nenhuma guia criada nem reavaliada; pendência automática do gestor, com a mensagem comercial',
    (premiumDenial) => {
      const create = gapOf({ ...base, premiumDenial });
      expect([create.reason, create.owner, create.recovery, create.guideId]).toEqual([
        'subscription_inactive',
        'gestor',
        'automatic',
        null,
      ]);
      expect(create.issues[0]!.code).toBe('SUBSCRIPTION_INACTIVE');
      expect(create.issues[0]!.message).not.toMatch(/sql|constraint|23514/i);
      const pending = gapOf({ ...base, premiumDenial, guides: [guide({ status: 'pending_data' })] });
      expect([pending.reason, pending.guideId]).toEqual(['subscription_inactive', 'g1']);
    },
  );

  it('guia já pronta fecha a pendência mesmo com a assinatura inativa (não é operação nova)', () => {
    expect(decideBilling({ ...base, premiumDenial: 'subscription_cancelled', guides: [guide()] })).toEqual({
      action: 'close_guide_ready',
      guideId: 'g1',
    });
  });

  it('particular e atendimento não concluído não dependem da assinatura', () => {
    expect(decideBilling({ ...base, billingMode: 'particular', premiumDenial: 'trial' })).toEqual({ action: 'ignore' });
    expect(decideBilling({ ...base, appointmentStatus: 'cancelado', premiumDenial: 'trial' })).toEqual({
      action: 'close_not_applicable',
    });
  });

  it('regularizada (premiumDenial null), a mesma situação cria a guia', () => {
    expect(decideBilling(base)).toEqual({ action: 'create_guide' });
  });
});

describe('classifyGuideIssues', () => {
  it('contrato > carteirinha > autorização > demais', () => {
    expect(classifyGuideIssues([issue('AUTHORIZATION_MISSING', 'recepcao'), issue('PROCEDURE_NOT_CONTRACTED')]))
      .toEqual({ reason: 'contract_missing', owner: 'gestor' });
    expect(classifyGuideIssues([issue('AUTHORIZATION_MISSING', 'recepcao'), issue('MEMBERSHIP_EXPIRED', 'recepcao')]))
      .toEqual({ reason: 'membership_invalid', owner: 'recepcao' });
    expect(classifyGuideIssues([issue('AUTHORIZATION_AMBIGUOUS', 'recepcao')]))
      .toEqual({ reason: 'authorization_pending', owner: 'recepcao' });
    expect(classifyGuideIssues([issue('PROVIDER_KIND_UNKNOWN', 'gestor')]))
      .toEqual({ reason: 'guide_pending_data', owner: 'gestor' });
  });
});

describe('nextAttemptDelayMs e errorCode', () => {
  it('falha técnica: 15 min dobrando (7ª = 16 h), para no teto de tentativas; dado: diário', () => {
    const min = 60_000;
    expect(nextAttemptDelayMs('failure', 1)).toBe(15 * min);
    expect(nextAttemptDelayMs('failure', 2)).toBe(30 * min);
    expect(nextAttemptDelayMs('failure', 7)).toBe(16 * 60 * min);
    expect(nextAttemptDelayMs('failure', MAX_AUTOMATIC_ATTEMPTS)).toBeNull();
    expect(nextAttemptDelayMs('data', 50)).toBe(24 * 60 * min);
  });

  it('código sem dado pessoal: SQLSTATE ou nome da classe, nunca a mensagem', () => {
    expect(errorCode({ code: '40P01', message: 'Paciente Fulano' })).toBe('pg_40p01');
    expect(errorCode({ cause: { code: '23505' } })).toBe('pg_23505');
    expect(errorCode(new TypeError('cpf 123.456.789-00'))).toBe('type_error');
    expect(errorCode(null)).toBe('error');
  });
});
