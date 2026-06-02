import { describe, expect, it } from 'vitest';

import { ClinicalValidationError } from '../errors';
import { assertDoctorHasCrm, type DoctorSnapshot } from './doctor';

const base: DoctorSnapshot = { nome: 'Dra. Ana', crm: null, crmUf: null, especialidade: null };

describe('assertDoctorHasCrm (R6 — documento exige CRM)', () => {
  it('lança quando crm é null', () => {
    expect(() => assertDoctorHasCrm(base)).toThrow(ClinicalValidationError);
  });

  it('lança quando crm é string vazia', () => {
    expect(() => assertDoctorHasCrm({ ...base, crm: '   ' })).toThrow(ClinicalValidationError);
  });

  it('passa quando crm está presente', () => {
    expect(() => assertDoctorHasCrm({ ...base, crm: '123456', crmUf: 'SP' })).not.toThrow();
  });
});
