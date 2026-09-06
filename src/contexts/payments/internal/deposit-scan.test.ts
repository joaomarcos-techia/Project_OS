/**
 * Varredura do sinal (ADR-049 1.3b) — o gatilho.
 *
 * O que estes testes protegem:
 *   - o custo do tick é proporcional ao que muda (não varre nada quando ninguém
 *     ligou a política; uma consulta de "já cobrado" por clínica, não por
 *     agendamento);
 *   - **uma clínica quebrada não trava a cobrança das outras** — que é a diferença
 *     entre um incidente numa conta e um incidente na plataforma.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  listDepositCandidates: vi.fn(),
  findChargedAppointmentIds: vi.fn(),
  createDepositCharge: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ dbAdmin: { execute: mocks.execute } }));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: vi.fn() } }));
vi.mock('@/contexts/scheduling', () => ({
  schedulingApiV1: { listDepositCandidates: mocks.listDepositCandidates },
}));
vi.mock('./charge-store', () => ({
  findChargedAppointmentIds: mocks.findChargedAppointmentIds,
}));
vi.mock('./deposit-charge', () => ({ createDepositCharge: mocks.createDepositCharge }));

import { metrics } from '@/lib/observability/metrics';

import { listClinicsWithPendingRefundIntents, runDepositScan } from './deposit-scan';

const candidate = (clinicId: string, appointmentId: string) => ({
  clinicId,
  appointmentId,
  patientId: `pac-${appointmentId}`,
  scheduledAt: '2026-09-10T14:00:00.000Z',
  valor: 300,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.execute.mockResolvedValue([{ clinic_id: 'clinic-a' }]);
  mocks.listDepositCandidates.mockResolvedValue([candidate('clinic-a', 'apt-1')]);
  mocks.findChargedAppointmentIds.mockResolvedValue(new Set<string>());
  mocks.createDepositCharge.mockResolvedValue(undefined);
});

describe('runDepositScan', () => {
  it('cobra o candidato e resume o que fez', async () => {
    await expect(runDepositScan()).resolves.toEqual({
      clinics: 1,
      candidates: 1,
      charged: 1,
      failed: 0,
    });
    expect(mocks.createDepositCharge).toHaveBeenCalledWith({
      clinicId: 'clinic-a',
      appointment: {
        appointmentId: 'apt-1',
        patientId: 'pac-apt-1',
        valor: 300,
        scheduledAt: '2026-09-10T14:00:00.000Z',
      },
    });
  });

  it('nenhuma clínica com a política ligada: não pergunta nada à agenda', async () => {
    mocks.execute.mockResolvedValue([]);

    await expect(runDepositScan()).resolves.toEqual({
      clinics: 0,
      candidates: 0,
      charged: 0,
      failed: 0,
    });
    expect(mocks.listDepositCandidates).not.toHaveBeenCalled();
  });

  it('pula o que já tem cobrança — sem gastar chamada ao gateway', async () => {
    mocks.listDepositCandidates.mockResolvedValue([
      candidate('clinic-a', 'apt-1'),
      candidate('clinic-a', 'apt-2'),
    ]);
    mocks.findChargedAppointmentIds.mockResolvedValue(new Set(['apt-1']));

    await expect(runDepositScan()).resolves.toMatchObject({ candidates: 2, charged: 1 });
    expect(mocks.createDepositCharge).toHaveBeenCalledTimes(1);
    expect(mocks.createDepositCharge.mock.calls[0]![0].appointment.appointmentId).toBe('apt-2');
  });

  it('consulta "já cobrado" UMA vez por clínica, não uma por agendamento', async () => {
    mocks.listDepositCandidates.mockResolvedValue([
      candidate('clinic-a', 'apt-1'),
      candidate('clinic-a', 'apt-2'),
      candidate('clinic-b', 'apt-3'),
    ]);
    mocks.execute.mockResolvedValue([{ clinic_id: 'clinic-a' }, { clinic_id: 'clinic-b' }]);

    await runDepositScan();

    expect(mocks.findChargedAppointmentIds).toHaveBeenCalledTimes(2);
    expect(mocks.findChargedAppointmentIds).toHaveBeenCalledWith('clinic-a', ['apt-1', 'apt-2']);
    expect(mocks.findChargedAppointmentIds).toHaveBeenCalledWith('clinic-b', ['apt-3']);
  });

  it('uma clínica que falha NÃO trava a cobrança das outras', async () => {
    mocks.listDepositCandidates.mockResolvedValue([
      candidate('clinic-a', 'apt-1'),
      candidate('clinic-b', 'apt-2'),
    ]);
    mocks.execute.mockResolvedValue([{ clinic_id: 'clinic-a' }, { clinic_id: 'clinic-b' }]);
    mocks.createDepositCharge.mockRejectedValueOnce(new Error('asaas fora do ar'));

    await expect(runDepositScan()).resolves.toEqual({
      clinics: 2,
      candidates: 2,
      charged: 1,
      failed: 1,
    });
    expect(metrics.emit).toHaveBeenCalledWith(
      'payments.deposit.scan_error',
      expect.objectContaining({ clinicId: 'clinic-a', appointmentId: 'apt-1' }),
    );
  });

  it('repassa a janela de varredura para a agenda', async () => {
    await runDepositScan({ createdWithinHours: 6, maxCandidates: 10 });

    expect(mocks.listDepositCandidates).toHaveBeenCalledWith(['clinic-a'], {
      createdWithinHours: 6,
      limit: 10,
    });
  });
});

describe('reconciliação de estornos pendentes', () => {
  it('descobre clínicas pelo trabalho pendente, sem depender da política ainda estar ligada', async () => {
    mocks.execute.mockResolvedValue([{ clinic_id: 'clinic-refund' }]);

    await expect(listClinicsWithPendingRefundIntents(50)).resolves.toEqual(['clinic-refund']);
    expect(mocks.listDepositCandidates).not.toHaveBeenCalled();
  });
});
