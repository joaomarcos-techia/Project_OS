/**
 * Varredura do restante (ADR-051 1.5b.3) — o gatilho.
 *
 * Prova o que a varredura garante além de disparar: uma clínica com problema não
 * derruba a cobrança das outras, e o filtro de "já cobrado" olha o kind certo.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listClinicsWithDepositEnabled: vi.fn(),
  listRemainderCandidates: vi.fn(),
  findChargedAppointmentIds: vi.fn(),
  createRemainderCharge: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: vi.fn() } }));
vi.mock('@/contexts/scheduling', () => ({
  schedulingApiV1: { listRemainderCandidates: mocks.listRemainderCandidates },
}));
vi.mock('./charge-store', () => ({
  findChargedAppointmentIds: mocks.findChargedAppointmentIds,
}));
vi.mock('./deposit-scan', () => ({
  listClinicsWithDepositEnabled: mocks.listClinicsWithDepositEnabled,
}));
vi.mock('./remainder-charge', () => ({ createRemainderCharge: mocks.createRemainderCharge }));

import { runRemainderScan } from './remainder-scan';

const candidate = (over: Record<string, unknown> = {}) => ({
  clinicId: 'clinic-1',
  appointmentId: 'apt-1',
  patientId: 'pac-1',
  scheduledAt: '2026-08-25T13:00:00.000Z',
  valor: 200,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listClinicsWithDepositEnabled.mockResolvedValue(['clinic-1']);
  mocks.listRemainderCandidates.mockResolvedValue([candidate()]);
  mocks.findChargedAppointmentIds.mockResolvedValue(new Set());
  mocks.createRemainderCharge.mockResolvedValue(undefined);
});

describe('runRemainderScan', () => {
  it('sem clínica com sinal ligado, não pergunta nada à agenda', async () => {
    mocks.listClinicsWithDepositEnabled.mockResolvedValue([]);

    await expect(runRemainderScan()).resolves.toMatchObject({ clinics: 0, candidates: 0 });
    expect(mocks.listRemainderCandidates).not.toHaveBeenCalled();
  });

  it('cobra o candidato e conta no resumo', async () => {
    await expect(runRemainderScan()).resolves.toMatchObject({
      clinics: 1,
      candidates: 1,
      charged: 1,
      failed: 0,
    });
  });

  it('filtra por cobrança de RESTANTE, não pelo sinal', async () => {
    // Olhar o kind errado faria o scan pular todo atendimento que teve sinal —
    // ou seja, exatamente os que precisam do restante.
    await runRemainderScan();

    expect(mocks.findChargedAppointmentIds).toHaveBeenCalledWith(
      'clinic-1',
      ['apt-1'],
      'remainder',
    );
  });

  it('quem já tem cobrança do restante é pulado', async () => {
    mocks.findChargedAppointmentIds.mockResolvedValue(new Set(['apt-1']));

    await expect(runRemainderScan()).resolves.toMatchObject({ charged: 0 });
    expect(mocks.createRemainderCharge).not.toHaveBeenCalled();
  });

  it('uma clínica com problema não trava as outras', async () => {
    mocks.listClinicsWithDepositEnabled.mockResolvedValue(['clinic-1', 'clinic-2']);
    mocks.listRemainderCandidates.mockResolvedValue([
      candidate({ clinicId: 'clinic-1', appointmentId: 'apt-1' }),
      candidate({ clinicId: 'clinic-2', appointmentId: 'apt-2' }),
    ]);
    mocks.createRemainderCharge.mockImplementation(async (ctx: { clinicId: string }) => {
      if (ctx.clinicId === 'clinic-1') throw new Error('gateway fora');
    });

    await expect(runRemainderScan()).resolves.toMatchObject({ charged: 1, failed: 1 });
  });

  it('agrupa por clínica: uma consulta de já-cobrados por clínica, não por item', async () => {
    mocks.listRemainderCandidates.mockResolvedValue([
      candidate({ appointmentId: 'apt-1' }),
      candidate({ appointmentId: 'apt-2' }),
      candidate({ appointmentId: 'apt-3' }),
    ]);

    await runRemainderScan();

    expect(mocks.findChargedAppointmentIds).toHaveBeenCalledTimes(1);
    expect(mocks.findChargedAppointmentIds).toHaveBeenCalledWith(
      'clinic-1',
      ['apt-1', 'apt-2', 'apt-3'],
      'remainder',
    );
  });

  it('repassa a janela de varredura para o read-model', async () => {
    await runRemainderScan({ completedWithinHours: 12, maxCandidates: 50 });

    expect(mocks.listRemainderCandidates).toHaveBeenCalledWith(['clinic-1'], {
      completedWithinHours: 12,
      limit: 50,
    });
  });
});
