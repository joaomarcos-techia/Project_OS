/**
 * P11.1 — list_insurance_options: só nomes das operadoras/planos ATIVOS da clínica do contexto verificado; módulo
 * desligado = "é com a recepção" (nunca "não atendemos"); falha ao consultar = fail-closed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Tx } from '@/lib/db';

import { getTool, type ToolContext } from './registry';
import './list-insurance-options';

const mocks = vi.hoisted(() => ({
  getSchedulingInsuranceOptions: vi.fn(),
  emit: vi.fn(),
}));

vi.mock('@/contexts/health-insurance', async () => ({
  ...(await vi.importActual<object>('@/contexts/health-insurance/agent-insurance')),
  getSchedulingInsuranceOptions: mocks.getSchedulingInsuranceOptions,
}));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: mocks.emit } }));

const CLINIC_A = '11111111-1111-1111-1111-111111111111';
const ctx: ToolContext = {
  tx: {} as Tx,
  clinicId: CLINIC_A,
  conversationId: '22222222-2222-2222-2222-222222222222',
  eventId: '33333333-3333-3333-3333-333333333333',
  aiRequestId: '44444444-4444-4444-4444-444444444444',
  patientId: '99999999-9999-9999-9999-999999999999',
  patientNome: null,
  identityAmbiguous: false,
  verifiedPhone: '+5511999990000',
  currentMessage: 'vocês atendem Unimed?',
  canScheduleAnonymous: false,
  maxDaysAhead: 30,
  clinicTimeZone: 'America/Sao_Paulo',
  pendingAppointmentProcedureName: null,
  canDisclosePayments: false,
};

const tool = () => getTool('list_insurance_options')!;

beforeEach(() => vi.clearAllMocks());

describe('list_insurance_options', () => {
  it('lista só nomes (sem ids) das operadoras ativas da clínica do contexto, nunca de outra', async () => {
    mocks.getSchedulingInsuranceOptions.mockResolvedValue({
      enabled: true,
      insurers: [
        { id: 'ins-1', name: 'Unimed Sintética', plans: [{ id: 'pl-1', name: 'Enfermaria' }] },
      ],
    });
    const out = await tool().handler({}, ctx);
    expect(mocks.getSchedulingInsuranceOptions).toHaveBeenCalledWith(CLINIC_A);
    expect(out).toEqual({
      status: 'insurance_options',
      insurers: [{ name: 'Unimed Sintética', plans: ['Enfermaria'] }],
      patient_message: expect.stringContaining('Unimed Sintética'),
    });
    expect(JSON.stringify(out)).not.toContain('ins-1');
    expect(tool().outputSchema.safeParse(out).success).toBe(true);
  });

  it('o modelo não escolhe a clínica: a entrada é vazia e argumentos extras são descartados', () => {
    expect(tool().inputSchema.safeParse({ clinic_id: 'outra' }).data).toEqual({});
  });

  it.each([
    ['sem schema', null],
    ['módulo desligado', { enabled: false, insurers: [] }],
    ['nenhuma operadora ativa', { enabled: true, insurers: [] }],
  ])('%s: "é com a recepção", sem dizer que a clínica não atende', async (_l, value) => {
    mocks.getSchedulingInsuranceOptions.mockResolvedValue(value);
    const out = await tool().handler({}, ctx);
    expect(out).toMatchObject({ status: 'insurance_not_available' });
    expect((out as { patient_message: string }).patient_message).toMatch(/recepção/);
    expect((out as { patient_message: string }).patient_message).not.toMatch(/não atende/);
  });

  it('indisponibilidade do banco: fail-closed com frase segura e métrica, sem lançar', async () => {
    mocks.getSchedulingInsuranceOptions.mockRejectedValue(new Error('connection refused'));
    const out = await tool().handler({}, ctx);
    expect(out).toMatchObject({ status: 'insurance_unavailable' });
    expect(mocks.emit).toHaveBeenCalledWith(
      'ai_agent.insurance.check_failed',
      expect.objectContaining({ clinicId: CLINIC_A, tool: 'list_insurance_options' }),
    );
  });
});
