import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const reportData = readFileSync(resolve(__dirname, 'data.ts'), 'utf8');
const schedulingQueries = readFileSync(
  resolve(process.cwd(), 'src/contexts/scheduling/queries.ts'),
  'utf8',
);
const financialQueries = readFileSync(
  resolve(process.cwd(), 'src/contexts/financial/queries.ts'),
  'utf8',
);
const rollup = readFileSync(
  resolve(process.cwd(), 'src/app/api/cron/cash-flow-rollup/route.ts'),
  'utf8',
);
const pdf = readFileSync(resolve(process.cwd(), 'src/lib/pdf/relatorio.tsx'), 'utf8');

describe('report aggregation integrity', () => {
  it('agrega atendimentos por profissional no banco sem teto de 500', () => {
    expect(reportData).toContain('getAppointmentStatsByDoctor');
    expect(reportData).not.toContain('listAppointments');
    expect(reportData).not.toMatch(/limit:\s*500/);
    expect(schedulingQueries).toContain('.groupBy(appointments.doctorId)');
    expect(schedulingQueries).toContain('appointmentIds: sql<string[]>`array_agg');
  });

  it('processa todos os lotes e agrega o ledger por atendimento', () => {
    expect(reportData).toContain('start < appointmentIds.length');
    expect(financialQueries).toContain('getRecebimentosByAppointment');
    expect(financialQueries).toContain('.groupBy(lancamentos.appointmentId)');
    expect(financialQueries).toContain("when ${paymentTransactions.kind} = 'refund' then -");
  });

  it('atribui o dia financeiro no fuso da clínica', () => {
    expect(rollup).toContain('JOIN clinics c ON c.id = pt.clinic_id');
    expect(rollup).toContain("AT TIME ZONE coalesce(c.timezone, 'America/Sao_Paulo')");
    expect(rollup).not.toContain('(pt.occurred_at)::date');
  });

  it('não anuncia aproximação por limite no PDF', () => {
    expect(pdf).not.toContain('limitado aos 500');
  });
});
