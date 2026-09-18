import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as OnboardingSurface from '@/contexts/onboarding';

const { applyOnboardingAction, readOnboardingProgress, requireUser, requireClinicId, AuthError } =
  vi.hoisted(() => {
    class AuthErrorStub extends Error {
      constructor(readonly reason: string) {
        super(reason);
        this.name = 'AuthError';
      }
    }
    return {
      applyOnboardingAction: vi.fn(),
      readOnboardingProgress: vi.fn(),
      requireUser: vi.fn(),
      requireClinicId: vi.fn(),
      AuthError: AuthErrorStub,
    };
  });

vi.mock('@/contexts/onboarding', async () => {
  // O schema é o de PRODUÇÃO, de propósito: o que este arquivo prova é que a
  // borda usa o contrato real. Mockar a validação faria o teste provar a si mesmo.
  const real = await vi.importActual<typeof OnboardingSurface>('@/contexts/onboarding');
  return {
    onboardingActionSchema: real.onboardingActionSchema,
    applyOnboardingAction,
    readOnboardingProgress,
  };
});
vi.mock('@/lib/auth/tenant-context', () => ({ requireUser, requireClinicId, AuthError }));

import { fetchOnboardingProgress, submitOnboardingAction } from './onboarding-actions';

const SESSION_CLINIC = '11111111-1111-1111-1111-111111111111';
const SESSION_USER = '22222222-2222-2222-2222-222222222222';
const ATTACKER_TARGET = '33333333-3333-3333-3333-333333333333';

const progress = {
  tourState: 'in_progress' as const,
  tourStep: 1,
  tourFinishedAt: null,
  docsVisitedAt: null,
  checklistDismissedAt: null,
  rowVersion: 3,
  shouldAutoOpenTour: true,
};

describe('submitOnboardingAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUser.mockResolvedValue({ userId: SESSION_USER });
    requireClinicId.mockResolvedValue(SESSION_CLINIC);
    applyOnboardingAction.mockResolvedValue({ ok: true, progress, changed: true });
  });

  it('usa o escopo da SESSÃO, não o que veio no corpo', async () => {
    await submitOnboardingAction({ action: 'tour_start' });
    expect(applyOnboardingAction).toHaveBeenCalledWith(SESSION_CLINIC, SESSION_USER, {
      action: 'tour_start',
    });
  });

  it('recusa um corpo que tenta carregar clínica ou usuário de outra pessoa', async () => {
    for (const payload of [
      { action: 'tour_start', clinicId: ATTACKER_TARGET },
      { action: 'checklist_dismiss', userId: ATTACKER_TARGET },
    ]) {
      const result = await submitOnboardingAction(payload);
      expect(result).toEqual({ ok: false, reason: 'invalid' });
    }
    // O ponto não é só a resposta: a escrita nem foi tentada.
    expect(applyOnboardingAction).not.toHaveBeenCalled();
  });

  it('recusa ação desconhecida antes de tocar no banco', async () => {
    const result = await submitOnboardingAction({ action: 'tour_close' });
    expect(result).toEqual({ ok: false, reason: 'invalid' });
    expect(applyOnboardingAction).not.toHaveBeenCalled();
    // E também antes de resolver a identidade: validar primeiro evita gastar
    // uma consulta de sessão com lixo.
    expect(requireUser).not.toHaveBeenCalled();
  });

  it('traduz sessão inválida em `denied` em vez de deixar virar 500', async () => {
    requireUser.mockRejectedValue(new AuthError('TOKEN_INVALID'));
    const result = await submitOnboardingAction({ action: 'tour_start' });
    expect(result).toEqual({ ok: false, reason: 'denied' });
    expect(applyOnboardingAction).not.toHaveBeenCalled();
  });

  it('traduz ausência de clínica em `denied`', async () => {
    requireClinicId.mockRejectedValue(new AuthError('CLINIC_CONTEXT_REQUIRED'));
    expect(await submitOnboardingAction({ action: 'tour_start' })).toEqual({
      ok: false,
      reason: 'denied',
    });
  });

  it('deixa erro de infraestrutura subir — 500 é o destino certo dele', async () => {
    requireUser.mockRejectedValue(new Error('ECONNRESET'));
    await expect(submitOnboardingAction({ action: 'tour_start' })).rejects.toThrow('ECONNRESET');
  });

  it('propaga `stale` com o estado autoritativo para o cliente se recuperar', async () => {
    applyOnboardingAction.mockResolvedValue({ ok: false, reason: 'stale', progress });
    const result = await submitOnboardingAction({ action: 'tour_next', fromStep: 0 });
    expect(result).toEqual({ ok: false, reason: 'stale', progress });
  });
});

describe('fetchOnboardingProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUser.mockResolvedValue({ userId: SESSION_USER });
    requireClinicId.mockResolvedValue(SESSION_CLINIC);
    readOnboardingProgress.mockResolvedValue(progress);
  });

  it('lê pelo escopo da sessão', async () => {
    expect(await fetchOnboardingProgress()).toEqual(progress);
    expect(readOnboardingProgress).toHaveBeenCalledWith(SESSION_CLINIC, SESSION_USER);
  });

  it('devolve null sem sessão, em vez de um estado inventado', async () => {
    requireUser.mockRejectedValue(new AuthError('TOKEN_INVALID'));
    expect(await fetchOnboardingProgress()).toBeNull();
    expect(readOnboardingProgress).not.toHaveBeenCalled();
  });
});
