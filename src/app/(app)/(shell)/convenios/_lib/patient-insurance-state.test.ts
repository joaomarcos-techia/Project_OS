import { describe, expect, it } from 'vitest';

import {
  canOfferCardManagement,
  isCardExpired,
  patientInsuranceState,
  type PatientInsuranceStateInput,
} from './patient-insurance-state';

const base: PatientInsuranceStateInput = {
  installed: true,
  commercial: null,
  enabled: true,
  records: 0,
};

describe('estado da aba Convênios na ficha do paciente', () => {
  it('sem as tabelas: não instalado, antes de qualquer outra regra', () => {
    expect(patientInsuranceState({ ...base, installed: false, commercial: 'trial' })).toBe(
      'not_installed',
    );
  });

  it('trial ou sem plano, sem registros: recurso contratável (nada operável)', () => {
    for (const commercial of [
      'trial',
      'trial_expired',
      'no_subscription',
      'plan_excludes',
    ] as const) {
      expect(patientInsuranceState({ ...base, commercial })).toBe('contractable');
    }
  });

  it('negativa com registros existentes vira consulta: o histórico nunca some', () => {
    expect(patientInsuranceState({ ...base, commercial: 'trial_expired', records: 3 })).toBe(
      'read_only',
    );
  });

  it('assinatura parada ou clínica suspensa: consulta, mesmo sem registros', () => {
    for (const commercial of [
      'clinic_suspended',
      'payment_pending',
      'subscription_cancelled',
      'period_expired',
      'period_unverified',
    ] as const) {
      expect(patientInsuranceState({ ...base, commercial })).toBe('read_only');
    }
  });

  it('assinatura ok, mas módulo não habilitado pelo Qoro: desabilitado (pagar não habilita)', () => {
    expect(patientInsuranceState({ ...base, enabled: false, records: 2 })).toBe('module_disabled');
  });

  it('tudo liberado: vazio ou com dados', () => {
    expect(patientInsuranceState(base)).toBe('empty');
    expect(patientInsuranceState({ ...base, records: 1 })).toBe('ready');
  });

  it('atalho de carteirinha só com tudo liberado E permissão de editar paciente', () => {
    expect(canOfferCardManagement('ready', true)).toBe(true);
    expect(canOfferCardManagement('empty', true)).toBe(true);
    expect(canOfferCardManagement('ready', false)).toBe(false);
    for (const s of ['contractable', 'read_only', 'module_disabled', 'not_installed'] as const) {
      expect(canOfferCardManagement(s, true)).toBe(false);
    }
  });

  it('carteirinha vencida pelo dia civil da clínica', () => {
    expect(isCardExpired('2026-11-13', '2026-11-14')).toBe(true);
    expect(isCardExpired('2026-11-14', '2026-11-14')).toBe(false);
    expect(isCardExpired(null, '2026-11-14')).toBe(false);
  });
});
