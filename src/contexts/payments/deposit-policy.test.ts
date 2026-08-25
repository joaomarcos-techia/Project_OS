/**
 * saveDepositPolicy (ADR-049 1.2) — a Server Action que grava a regra de dinheiro.
 *
 * O que estes testes protegem:
 *   - o gate roda antes de qualquer escrita;
 *   - estado morto ("ligada" sem nenhum caso aplicável) é rejeitado ANTES do banco,
 *     e não só pelo CHECK — o operador precisa da mensagem, não de um erro de SQL;
 *   - a auditoria guarda a política ANTERIOR. Meses depois, "por que cobraram 50%
 *     desse paciente?" se responde pelo audit.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireCachedPermission: vi.fn(async () => {}),
  auditedMutation: vi.fn(),
  getDepositPolicy: vi.fn(),
}));

vi.mock('@/lib/auth/tenant-context', () => ({
  requireUser: vi.fn(async () => ({ userId: 'user-1' })),
  requireCachedPermission: mocks.requireCachedPermission,
  requireClinicId: vi.fn(async () => 'clinic-1'),
}));
vi.mock('@/lib/audit/request-context-from-headers', () => ({
  requestContext: vi.fn(async () => ({
    ip: null,
    userAgent: null,
    requestId: 'r',
    correlationId: 'r',
  })),
}));
vi.mock('@/lib/audit/mutation', () => ({ auditedMutation: mocks.auditedMutation }));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: vi.fn() } }));
vi.mock('@/lib/crypto', () => ({
  encryptForTenant: vi.fn(async () => 'CIPHERTEXT'),
  hashForLookup: vi.fn(async () => 'HASH'),
}));
vi.mock('@/lib/payments/account-store', () => ({
  upsertPaymentAccount: vi.fn(),
  deactivatePaymentAccount: vi.fn(),
}));
vi.mock('./queries', () => ({
  getDepositPolicy: mocks.getDepositPolicy,
  getPaymentAccountStatus: vi.fn(),
}));

import { metrics } from '@/lib/observability/metrics';

import { saveDepositPolicy } from './actions';
import { DEPOSIT_POLICY_OFF } from './policy';

const DESLIGADA = { ...DEPOSIT_POLICY_OFF, updatedAt: null };
const LIGADA = {
  enabled: true,
  percent: 50,
  cancellationWindowHours: 24,
  appliesToFirstVisit: true,
  appliesToReturn: true,
  updatedAt: '2026-08-24T10:00:00.000Z',
};

const entrada = {
  enabled: true,
  percent: 50,
  cancellationWindowHours: 24,
  appliesToFirstVisit: true,
  appliesToReturn: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireCachedPermission.mockImplementation(async () => {});
  // 1ª chamada = `before` (estado anterior); 2ª = retorno já gravado.
  mocks.getDepositPolicy.mockResolvedValueOnce(DESLIGADA).mockResolvedValueOnce(LIGADA);
  mocks.auditedMutation.mockImplementation((async (_opts: unknown, fn: (tx: unknown) => unknown) =>
    fn({
      insert: () => ({ values: () => ({ onConflictDoUpdate: async () => undefined }) }),
    })) as never);
});

describe('saveDepositPolicy', () => {
  it('audita a política ANTERIOR junto da mudança', async () => {
    await saveDepositPolicy(entrada);

    const [opts] = mocks.auditedMutation.mock.calls[0]! as [
      { action: string; resourceType: string; resourceId: string; before: unknown },
    ];
    expect(opts.action).toBe('payments.deposit_policy.updated');
    expect(opts.resourceType).toBe('clinic_deposit_policy');
    expect(opts.resourceId).toBe('clinic-1');
    expect(opts.before).toEqual(DESLIGADA);
  });

  it('devolve a política já gravada', async () => {
    await expect(saveDepositPolicy(entrada)).resolves.toEqual(LIGADA);
  });

  it('emite métrica com o estado da regra, sem dado de paciente', async () => {
    await saveDepositPolicy(entrada);

    expect(metrics.emit).toHaveBeenCalledWith('payments.deposit_policy.updated', {
      clinicId: 'clinic-1',
      enabled: true,
      percent: 50,
    });
  });

  it('recusa política ligada sem nenhum caso aplicável (estado morto)', async () => {
    await expect(
      saveDepositPolicy({ ...entrada, appliesToFirstVisit: false, appliesToReturn: false }),
    ).rejects.toThrow();
    expect(mocks.auditedMutation).not.toHaveBeenCalled();
  });

  it('desligada pode ter os dois escopos falsos — a regra só vale quando ligada', async () => {
    await expect(
      saveDepositPolicy({
        ...entrada,
        enabled: false,
        appliesToFirstVisit: false,
        appliesToReturn: false,
      }),
    ).resolves.toBeDefined();
    expect(mocks.auditedMutation).toHaveBeenCalledTimes(1);
  });

  it('recusa percentual fora de 1..100 e janela fora de 0..720', async () => {
    for (const invalido of [
      { ...entrada, percent: 0 },
      { ...entrada, percent: 101 },
      { ...entrada, percent: 12.5 },
      { ...entrada, cancellationWindowHours: -1 },
      { ...entrada, cancellationWindowHours: 721 },
    ]) {
      mocks.getDepositPolicy.mockResolvedValueOnce(DESLIGADA).mockResolvedValueOnce(LIGADA);
      await expect(saveDepositPolicy(invalido)).rejects.toThrow();
    }
    expect(mocks.auditedMutation).not.toHaveBeenCalled();
  });

  it('sem manage:financial não grava nada', async () => {
    const authError = Object.assign(new Error('forbidden'), { name: 'AuthError' });
    mocks.requireCachedPermission.mockRejectedValue(authError);

    await expect(saveDepositPolicy(entrada)).rejects.toBe(authError);
    expect(mocks.auditedMutation).not.toHaveBeenCalled();
  });
});
