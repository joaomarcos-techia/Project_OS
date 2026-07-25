import { beforeEach, describe, expect, it, vi } from 'vitest';

const { financialApiV1 } = vi.hoisted(() => ({
  financialApiV1: {
    listOpenCollectionCaseClinicIds: vi.fn(async () => ['c1']),
    resolveSettledCollectionCases: vi.fn(async () => 0),
    listDunningCandidates: vi.fn(),
    upsertCollectionCase: vi.fn(async () => {}),
  },
}));

vi.mock('@/contexts/financial', () => ({
  financialApiV1,
  routeDunning: (days: number) => {
    if (days >= 31) return { mode: 'manual', stage: 'd30_manual' };
    if (days >= 15) return { mode: 'manual', stage: 'd15_review' };
    return { mode: 'automatic', stages: days >= 7 ? [3, 7] : [3] };
  },
}));
vi.mock('@/contexts/scheduling', () => ({
  schedulingApiV1: { listReminderCandidates: vi.fn(async () => []) },
}));
vi.mock('../infra/repository', () => ({ enqueue: vi.fn(async () => 'job-1') }));
vi.mock('../infra/tz', () => ({
  clinicLocalToUtc: vi.fn(() => new Date('2026-07-24T12:00:00.000Z')),
  localDateYMD: vi.fn(() => '2026-07-24'),
}));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: vi.fn() } }));

import * as repo from '../infra/repository';
import { enqueueDunningDue } from './enqueue';

const candidate = {
  clinicId: 'c1',
  lancamentoId: 'l1',
  patientId: 'p1',
  valor: 600,
  dueDate: '2026-07-01',
  daysOverdue: 7,
  procedureNome: 'Consulta',
  timezone: 'America/Sao_Paulo',
};

beforeEach(() => vi.clearAllMocks());

describe('enqueueDunningDue', () => {
  it('envia o saldo residual nos estagios automaticos', async () => {
    financialApiV1.listDunningCandidates.mockResolvedValue([candidate]);

    const result = await enqueueDunningDue();

    expect(result).toEqual({ scanned: 1, enqueued: 2 });
    expect(financialApiV1.resolveSettledCollectionCases).toHaveBeenCalledWith('c1');
    expect(repo.enqueue).toHaveBeenCalledTimes(2);
    expect(vi.mocked(repo.enqueue).mock.calls[0]?.[1]).toMatchObject({
      payload: { valor: 600, stage: 3 },
    });
  });

  it('encaminha acima de 30 dias para fila humana sem criar mensagem', async () => {
    const old = { ...candidate, daysOverdue: 45 };
    financialApiV1.listDunningCandidates.mockResolvedValue([old]);

    const result = await enqueueDunningDue();

    expect(result).toEqual({ scanned: 1, enqueued: 0 });
    expect(financialApiV1.upsertCollectionCase).toHaveBeenCalledWith(old, 'd30_manual');
    expect(repo.enqueue).not.toHaveBeenCalled();
  });
});
