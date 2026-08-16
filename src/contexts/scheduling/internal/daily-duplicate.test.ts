import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';
import type { SQL } from 'drizzle-orm';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db/tenant', () => ({ withTenant: vi.fn() }));

import { SchedulingValidationError } from '../errors';
import { assertNoDailyDuplicate } from './daily-duplicate';

const dialect = new PgDialect();

const CLINIC = '11111111-1111-1111-1111-111111111111';
const PATIENT = '22222222-2222-2222-2222-222222222222';
const DOCTOR = '33333333-3333-3333-3333-333333333333';
const TZ = 'America/Sao_Paulo';

/** tx falso: registra a query e devolve as linhas combinadas. */
function fakeTx(rows: Array<{ local_date: string }> = []) {
  const calls: Array<{ text: string; params: unknown[] }> = [];
  const tx = {
    execute: (query: SQL) => {
      const q = dialect.sqlToQuery(query);
      calls.push({ text: q.sql, params: q.params });
      return Promise.resolve(rows);
    },
  } as never;
  return { tx, calls };
}

/** Três quartas semanais às 10h de São Paulo. */
const WEEKLY = [
  new Date('2026-09-02T13:00:00.000Z'),
  new Date('2026-09-09T13:00:00.000Z'),
  new Date('2026-09-16T13:00:00.000Z'),
];

describe('assertNoDailyDuplicate (DATA-007)', () => {
  it('série sem colisão passa', async () => {
    const { tx } = fakeTx([]);
    await expect(
      assertNoDailyDuplicate(tx, {
        clinicId: CLINIC,
        patientId: PATIENT,
        doctorId: DOCTOR,
        timeZone: TZ,
        occurrences: WEEKLY,
      }),
    ).resolves.toBeUndefined();
  });

  it('consulta TODAS as datas da série, não só a primeira — é o achado', async () => {
    const { tx, calls } = fakeTx([]);
    await assertNoDailyDuplicate(tx, {
      clinicId: CLINIC,
      patientId: PATIENT,
      doctorId: DOCTOR,
      timeZone: TZ,
      occurrences: WEEKLY,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.params).toEqual(
      expect.arrayContaining(['2026-09-02', '2026-09-09', '2026-09-16']),
    );
  });

  it('serializa concorrentes com FOR UPDATE e filtra só status ativos', async () => {
    const { tx, calls } = fakeTx([]);
    await assertNoDailyDuplicate(tx, {
      clinicId: CLINIC,
      patientId: PATIENT,
      doctorId: DOCTOR,
      timeZone: TZ,
      occurrences: WEEKLY,
    });
    expect(calls[0]!.text).toContain('FOR UPDATE');
    for (const status of ['agendado', 'confirmado', 'chegou', 'em_atendimento']) {
      expect(calls[0]!.text).toContain(status);
    }
    // Terminais não bloqueiam: uma consulta cancelada não impede reagendar.
    expect(calls[0]!.text).not.toContain('cancelado');
    expect(calls[0]!.text).not.toContain('faltou');
  });

  it('colisão numa ocorrência do MEIO aborta a série e nomeia a posição', async () => {
    const { tx } = fakeTx([{ local_date: '2026-09-09' }]);
    await expect(
      assertNoDailyDuplicate(tx, {
        clinicId: CLINIC,
        patientId: PATIENT,
        doctorId: DOCTOR,
        timeZone: TZ,
        occurrences: WEEKLY,
      }),
    ).rejects.toThrow(/2026-09-09.*ocorrência 2/u);
  });

  it('colisão na ÚLTIMA ocorrência também aborta', async () => {
    const { tx } = fakeTx([{ local_date: '2026-09-16' }]);
    await expect(
      assertNoDailyDuplicate(tx, {
        clinicId: CLINIC,
        patientId: PATIENT,
        doctorId: DOCTOR,
        timeZone: TZ,
        occurrences: WEEKLY,
      }),
    ).rejects.toBeInstanceOf(SchedulingValidationError);
  });

  it('duas ocorrências no MESMO dia civil colidem entre si, sem ir ao banco', async () => {
    const { tx, calls } = fakeTx([]);
    await expect(
      assertNoDailyDuplicate(tx, {
        clinicId: CLINIC,
        patientId: PATIENT,
        doctorId: DOCTOR,
        timeZone: TZ,
        occurrences: [WEEKLY[0]!, new Date('2026-09-02T18:00:00.000Z')],
      }),
    ).rejects.toThrow(/mesmo dia/u);
    expect(calls).toHaveLength(0);
  });

  it('a data civil é a do FUSO DA CLÍNICA, não UTC', async () => {
    // 02:00Z de 03/09 é 23:00 de 02/09 em São Paulo — o dia da regra é o local.
    const { tx, calls } = fakeTx([]);
    await assertNoDailyDuplicate(tx, {
      clinicId: CLINIC,
      patientId: PATIENT,
      doctorId: DOCTOR,
      timeZone: TZ,
      occurrences: [new Date('2026-09-03T02:00:00.000Z'), WEEKLY[1]!],
    });
    expect(calls[0]!.params).toEqual(expect.arrayContaining(['2026-09-02']));
  });

  it('ids e datas são bind params, nunca interpolados (CWE-89)', async () => {
    const { tx, calls } = fakeTx([]);
    await assertNoDailyDuplicate(tx, {
      clinicId: CLINIC,
      patientId: PATIENT,
      doctorId: DOCTOR,
      timeZone: TZ,
      occurrences: WEEKLY,
    });
    expect(calls[0]!.text).not.toContain(PATIENT);
    expect(calls[0]!.params).toEqual(expect.arrayContaining([CLINIC, PATIENT, DOCTOR]));
  });
});
