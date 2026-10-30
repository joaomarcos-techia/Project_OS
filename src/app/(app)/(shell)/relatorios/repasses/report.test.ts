import { describe, expect, it } from 'vitest';

import { buildMonthlyPayoutReport, currentClinicMonth, resolveReportMonth } from './report';

const completed = [
  { appointmentId: 'a', completedAt: '2026-10-01T02:30:00.000Z', professionalName: 'Dra. A' },
  { appointmentId: 'b', completedAt: '2026-10-02T15:00:00.000Z', professionalName: 'Dr. B' },
  { appointmentId: 'c', completedAt: '2026-10-03T15:00:00.000Z', professionalName: 'Dra. C' },
];

describe('relatório mensal de repasses', () => {
  it('usa o mês local da clínica e rejeita mês adulterado', () => {
    const now = new Date('2026-10-01T02:30:00.000Z');
    expect(currentClinicMonth('America/Sao_Paulo', now)).toBe('2026-09');
    expect(resolveReportMonth('2026-10', 'America/Sao_Paulo')).toBe('2026-10');
    expect(resolveReportMonth('2026-13', 'America/Sao_Paulo')).toBe(
      currentClinicMonth('America/Sao_Paulo'),
    );
  });

  it('suspende após estorno, preserva revisão e não soma dados pendentes como pagos', () => {
    const report = buildMonthlyPayoutReport(completed, [
      {
        appointmentId: 'a',
        professionalId: 'p1',
        grossAmount: 150,
        providerFeeAmount: 5,
        netAmount: 145,
        payoutAmount: 75,
        calculationBasis: 'gross',
        status: 'cancelled',
        reviewVersion: null,
      },
      {
        appointmentId: 'b',
        professionalId: 'p2',
        grossAmount: 150,
        providerFeeAmount: 5,
        netAmount: 145,
        payoutAmount: 50,
        calculationBasis: 'gross',
        status: 'reviewed',
        reviewVersion: 2,
      },
      {
        appointmentId: 'c',
        professionalId: 'p3',
        grossAmount: 100,
        providerFeeAmount: null,
        netAmount: null,
        payoutAmount: null,
        calculationBasis: 'net',
        status: 'pending_economics',
        reviewVersion: null,
      },
    ]);
    expect(report.grossTotal).toBe(400);
    expect(report.effectiveTotal).toBe(50);
    expect(report.suspendedCount).toBe(1);
    expect(report.reviewedCount).toBe(1);
    expect(report.pendingCount).toBe(1);
    expect(report.lines[0]?.effectivePayout).toBe(0);
    expect(report.lines[1]?.reviewVersion).toBe(2);
    expect(report.lines[2]?.effectivePayout).toBeNull();
  });

  it('ignora repasse sem consulta comprovadamente concluída no mês', () => {
    const report = buildMonthlyPayoutReport(completed.slice(0, 1), [
      {
        appointmentId: 'fora',
        professionalId: 'p1',
        grossAmount: 999,
        providerFeeAmount: null,
        netAmount: null,
        payoutAmount: 500,
        calculationBasis: 'gross',
        status: 'calculated',
        reviewVersion: null,
      },
    ]);
    expect(report.lines).toEqual([]);
    expect(report.effectiveTotal).toBe(0);
  });
});
