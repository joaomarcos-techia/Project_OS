import { describe, expect, it, vi } from 'vitest';
// The tool fixture represents a paid clinic; the registry's denial has its own tests.
vi.mock('@/lib/entitlements', () => ({ assertOperationalModuleAccessTx: vi.fn(async () => {}) }));

import type { ToolContext } from './registry';
import { getTool, validateAndExecute } from './registry';
import './provide-clinic-info';

const clinic = {
  nome: 'Clínica Aurora',
  endereco: 'Rua das Flores, 100',
  timezone: 'America/Sao_Paulo',
};

function context(config: object | null): ToolContext {
  const limit = vi.fn().mockResolvedValue(config ? [config] : []);
  const tx = {
    execute: vi.fn().mockResolvedValue([clinic]),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({ limit }),
    }),
  };

  return {
    tx: tx as unknown as ToolContext['tx'],
    clinicId: '11111111-1111-1111-1111-111111111111',
    conversationId: '22222222-2222-2222-2222-222222222222',
    eventId: '33333333-3333-3333-3333-333333333333',
    aiRequestId: '44444444-4444-4444-4444-444444444444',
    patientId: null,
    patientNome: null,
    identityAmbiguous: false,
    verifiedPhone: '+5511999999999',
    currentMessage: 'Quais convênios vocês aceitam?',
    canScheduleAnonymous: false,
    maxDaysAhead: 30,
    clinicTimeZone: 'America/Sao_Paulo',
    pendingAppointmentProcedureName: null,
    canDisclosePayments: false,
  };
}

describe('provide_clinic_info — convênios', () => {
  it('expõe somente a lista cadastrada pela clínica', async () => {
    const result = await validateAndExecute(
      { name: 'provide_clinic_info', args: {} },
      context({
        workingHours: { seg_sex: '08:00-18:00' },
        especialidades: ['Cardiologia'],
        convenios: ['Unimed', 'Bradesco Saúde'],
      }),
    );

    expect(result).toEqual({
      ok: true,
      response: {
        ...clinic,
        operational_info: { onlineCareInfo: '', pediatricCareInfo: '', returnPolicyInfo: '' },
        patient_message: null,
        working_hours: { seg_sex: '08:00-18:00' },
        especialidades: ['Cardiologia'],
        convenios: ['Unimed', 'Bradesco Saúde'],
      },
    });
  });

  it('devolve lista vazia quando a informação não foi cadastrada', async () => {
    const result = await validateAndExecute(
      { name: 'provide_clinic_info', args: {} },
      context(null),
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.response).toMatchObject({ convenios: [] });
  });

  it('declara ao modelo que perguntas sobre convênio usam esta tool', () => {
    const tool = getTool('provide_clinic_info');
    expect(tool?.description).toContain('convênios aceitos');
    expect(tool?.description).toContain('informação não cadastrada');
  });
});
