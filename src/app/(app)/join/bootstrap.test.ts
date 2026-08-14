import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  headersMock,
  assertJoinAllowed,
  getClientIp,
  getInviteStatus,
  guardedUpdateInvite,
  listOnboardingPlans,
  parseStepState,
  resolveOpenInvite,
  emit,
} = vi.hoisted(() => ({
  headersMock: vi.fn(),
  assertJoinAllowed: vi.fn(),
  getClientIp: vi.fn(),
  getInviteStatus: vi.fn(),
  guardedUpdateInvite: vi.fn(),
  listOnboardingPlans: vi.fn(),
  parseStepState: vi.fn(),
  resolveOpenInvite: vi.fn(),
  emit: vi.fn(),
}));

vi.mock('next/headers', () => ({ headers: headersMock }));
vi.mock('@/lib/auth/rate-limit', () => ({ assertJoinAllowed, getClientIp }));
vi.mock('@/contexts/onboarding', () => ({
  getInviteStatus,
  guardedUpdateInvite,
  listOnboardingPlans,
  parseStepState,
  resolveOpenInvite,
}));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit } }));

import { bootstrapJoinAction } from './bootstrap';

const TOKEN = 'a'.repeat(43);

describe('bootstrapJoinAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    headersMock.mockResolvedValue(new Headers());
    getClientIp.mockReturnValue('198.51.100.10');
    assertJoinAllowed.mockResolvedValue({ ok: true });
  });

  it('abre o convite pendente recebido no fragmento e não retorna o token', async () => {
    const initialState = { currentStep: 'clinic', completed: [] };
    resolveOpenInvite.mockResolvedValue({
      id: 'invite-1',
      status: 'pending',
      version: 4,
      metadata: { suggestedPlanId: 'plan-1' },
      stepState: {},
      email: 'gestor@example.test',
    });
    guardedUpdateInvite.mockResolvedValue({ id: 'invite-1', version: 5 });
    parseStepState.mockReturnValue(initialState);
    listOnboardingPlans.mockResolvedValue([{ id: 'plan-1', name: 'Essencial' }]);

    await expect(bootstrapJoinAction(TOKEN)).resolves.toEqual({
      kind: 'ready',
      initialState,
      suggestedEmail: 'gestor@example.test',
      suggestedPlanId: 'plan-1',
      plans: [{ id: 'plan-1', name: 'Essencial' }],
    });

    expect(guardedUpdateInvite).toHaveBeenCalledWith('invite-1', 4, {
      status: 'started',
      startedAt: expect.any(Date),
    });
    expect(emit).toHaveBeenCalledWith('onboarding.started', { inviteId: 'invite-1' });
  });

  it('rejeita fragmento inválido antes de consultar o convite', async () => {
    await expect(bootstrapJoinAction('short')).resolves.toEqual({
      kind: 'invalid',
      reason: 'Este convite é inválido, expirou ou já foi utilizado.',
    });

    expect(resolveOpenInvite).not.toHaveBeenCalled();
  });

  it('mantém a tela pós-ativação sem revelar o token', async () => {
    resolveOpenInvite.mockResolvedValue(null);
    getInviteStatus.mockResolvedValue({ status: 'completed' });

    await expect(bootstrapJoinAction(TOKEN)).resolves.toEqual({ kind: 'completed' });
  });
});
