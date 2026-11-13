/**
 * ADR-072 (P4.1/P4.2): a forma de atendimento entra na criação; sem ela, nada muda
 * (particular). Convênio não tem preço por meio de pagamento nem valor ajustado para o
 * paciente — o valor é da operadora e o paciente só paga a coparticipação confirmada.
 */
import { describe, expect, it } from 'vitest';

import { CreateAppointmentSchema, CreateRecurringAppointmentsSchema, CreateWalkInSchema } from './types';

const base = {
  doctorId: '00000000-0000-4000-8000-000000000001',
  patientId: '00000000-0000-4000-8000-000000000002',
  procedureId: '00000000-0000-4000-8000-000000000003',
};

describe('billingMode na criação do atendimento', () => {
  it('ausente = particular implícito (o schema não inventa a modalidade)', () => {
    const v = CreateAppointmentSchema.parse({ ...base, scheduledAt: '2030-01-01T12:00:00Z' });
    expect(v.billingMode).toBeUndefined();
  });

  it('convênio é aceito no agendamento, no encaixe e na recorrência', () => {
    expect(CreateAppointmentSchema.parse({ ...base, scheduledAt: '2030-01-01T12:00:00Z', billingMode: 'convenio' }).billingMode).toBe('convenio');
    expect(CreateWalkInSchema.parse({ ...base, billingMode: 'convenio' }).billingMode).toBe('convenio');
    expect(
      CreateRecurringAppointmentsSchema.parse({ ...base, firstScheduledAt: '2030-01-01T12:00:00Z', intervalWeeks: 1, occurrences: 4, billingMode: 'convenio' }).billingMode,
    ).toBe('convenio');
  });

  it('convênio com preço por meio de pagamento ou valor ajustado é recusado', () => {
    const at = { ...base, scheduledAt: '2030-01-01T12:00:00Z', billingMode: 'convenio' as const };
    expect(() => CreateAppointmentSchema.parse({ ...at, commercialPaymentMethod: 'pix' })).toThrow(/convênio não tem preço/u);
    expect(() => CreateAppointmentSchema.parse({ ...at, pricingPolicyMode: 'payment_method_pricing' })).toThrow(/convênio não tem preço/u);
    expect(() => CreateAppointmentSchema.parse({ ...at, valorAjustado: true, valor: 10, valorAjusteMotivo: 'desconto combinado' })).toThrow(/valor ajustado/u);
    expect(() => CreateWalkInSchema.parse({ ...base, billingMode: 'convenio', commercialPaymentMethod: 'cash' })).toThrow(/convênio não tem preço/u);
  });

  it('valor desconhecido é recusado', () => {
    expect(() => CreateAppointmentSchema.parse({ ...base, scheduledAt: '2030-01-01T12:00:00Z', billingMode: 'cortesia' })).toThrow();
  });
});
