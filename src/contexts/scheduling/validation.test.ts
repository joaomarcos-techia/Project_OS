import { describe, expect, it } from 'vitest';

import {
  CreateAppointmentSchema,
  CreateHolidaySchema,
  CreateProcedureSchema,
  SetAvailabilitySchema,
} from './types';

const baseAppt = {
  doctorId: '11111111-1111-1111-1111-111111111111',
  procedureId: '22222222-2222-2222-2222-222222222222',
  scheduledAt: '2026-06-01T14:00:00-03:00',
};

describe('CreateAppointmentSchema — valor_ajustado integrity', () => {
  it('accepts a plain appointment (valor herda do procedure)', () => {
    expect(CreateAppointmentSchema.safeParse(baseAppt).success).toBe(true);
  });

  it('rejects valor_ajustado=true without valor AND motivo', () => {
    expect(CreateAppointmentSchema.safeParse({ ...baseAppt, valorAjustado: true }).success).toBe(
      false,
    );
    expect(
      CreateAppointmentSchema.safeParse({ ...baseAppt, valorAjustado: true, valor: 150 }).success,
    ).toBe(false);
  });

  it('accepts valor_ajustado=true with valor AND motivo', () => {
    const r = CreateAppointmentSchema.safeParse({
      ...baseAppt,
      valorAjustado: true,
      valor: 150,
      valorAjusteMotivo: 'desconto convênio',
    });
    expect(r.success).toBe(true);
  });

  it('rejects a non-datetime scheduledAt', () => {
    expect(
      CreateAppointmentSchema.safeParse({ ...baseAppt, scheduledAt: '2026-06-01' }).success,
    ).toBe(false);
  });
});

describe('CreateHolidaySchema — partial window (M18)', () => {
  it('accepts a full-day holiday (no times)', () => {
    expect(CreateHolidaySchema.safeParse({ date: '2026-12-25' }).success).toBe(true);
  });

  it('accepts a partial window (both times)', () => {
    expect(
      CreateHolidaySchema.safeParse({ date: '2026-12-24', startTime: '12:00', endTime: '18:00' })
        .success,
    ).toBe(true);
  });

  it('rejects only one of start/end time', () => {
    expect(CreateHolidaySchema.safeParse({ date: '2026-12-24', startTime: '12:00' }).success).toBe(
      false,
    );
  });
});

describe('SetAvailabilitySchema', () => {
  const base = {
    doctorId: '11111111-1111-1111-1111-111111111111',
    weekday: 1,
    startTime: '09:00',
    endTime: '12:00',
  };
  it('accepts a valid window', () => {
    expect(SetAvailabilitySchema.safeParse(base).success).toBe(true);
  });
  it('rejects weekday out of range', () => {
    expect(SetAvailabilitySchema.safeParse({ ...base, weekday: 7 }).success).toBe(false);
  });
  it('rejects malformed time', () => {
    expect(SetAvailabilitySchema.safeParse({ ...base, startTime: '25:00' }).success).toBe(false);
  });
});

describe('CreateProcedureSchema — bounds', () => {
  const base = { codigo: 'C001', descricao: 'Consulta', valorPadrao: 200, duracaoPadraoMin: 30 };
  it('accepts a valid procedure', () => {
    expect(CreateProcedureSchema.safeParse(base).success).toBe(true);
  });
  it('rejects duration over 480 min', () => {
    expect(CreateProcedureSchema.safeParse({ ...base, duracaoPadraoMin: 481 }).success).toBe(false);
  });
  it('rejects negative valor', () => {
    expect(CreateProcedureSchema.safeParse({ ...base, valorPadrao: -1 }).success).toBe(false);
  });
});
