import { beforeEach, describe, expect, it, vi } from 'vitest';

const { readOnboardingProgress, getCurrentUser, captureBackgroundError } = vi.hoisted(() => ({
  readOnboardingProgress: vi.fn(),
  getCurrentUser: vi.fn(),
  captureBackgroundError: vi.fn(),
}));

vi.mock('@/contexts/onboarding', () => ({ readOnboardingProgress }));
vi.mock('@/lib/auth/tenant-context', () => ({ getCurrentUser }));
vi.mock('@/lib/observability/capture', () => ({ captureBackgroundError }));

import { currentOnboardingProgress } from './onboarding-progress';

const CLINIC = '11111111-1111-1111-1111-111111111111';
const USER = '22222222-2222-2222-2222-222222222222';

const progress = {
  tourState: 'not_started' as const,
  tourStep: 0,
  tourFinishedAt: null,
  docsVisitedAt: null,
  checklistDismissedAt: null,
  rowVersion: 0,
  shouldAutoOpenTour: true,
};

/**
 * Esta função é chamada pelo LAYOUT do shell, por onde passa toda página
 * autenticada. O comportamento sob falha é o que este arquivo fixa — e ele foi
 * escrito depois de a falha acontecer de verdade.
 */
describe('currentOnboardingProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // `cache()` do React é passthrough fora de um request scope, então cada
    // chamada aqui reexecuta a função em vez de devolver memória da anterior.
    getCurrentUser.mockResolvedValue({ clinicId: CLINIC, userId: USER });
    readOnboardingProgress.mockResolvedValue(progress);
  });

  it('lê pelo escopo de quem está autenticado', async () => {
    expect(await currentOnboardingProgress()).toEqual(progress);
    expect(readOnboardingProgress).toHaveBeenCalledWith(CLINIC, USER);
  });

  it('não lê nada para quem não tem clínica', async () => {
    getCurrentUser.mockResolvedValue({ clinicId: null, userId: USER });
    expect(await currentOnboardingProgress()).toBeNull();
    expect(readOnboardingProgress).not.toHaveBeenCalled();
  });

  it('DEGRADA quando a leitura falha, em vez de derrubar o shell', async () => {
    // 19/09/2026: o Preview respondeu `500 em /dashboard` porque o banco por
    // trás dele não tinha a migration 0104. O erro de schema era real; o que
    // estava errado era o raio — uma tabela nova virou dependência dura de
    // agenda, consultório e caixa. Um tour não pode derrubar o produto.
    readOnboardingProgress.mockRejectedValue(new Error('relation does not exist'));
    expect(await currentOnboardingProgress()).toBeNull();
  });

  it('degradar NÃO é silêncio: a falha vai para a observabilidade', async () => {
    const falha = new Error('relation does not exist');
    readOnboardingProgress.mockRejectedValue(falha);
    await currentOnboardingProgress();
    expect(captureBackgroundError).toHaveBeenCalledWith(falha, {
      flow: 'onboarding.progress.read',
      clinicId: CLINIC,
    });
  });

  it('erro de AUTENTICAÇÃO continua subindo', async () => {
    // Só a leitura do onboarding é tolerante. Engolir uma falha de identidade
    // renderizaria o shell para quem talvez não devesse vê-lo.
    getCurrentUser.mockRejectedValue(new Error('sessão inválida'));
    await expect(currentOnboardingProgress()).rejects.toThrow('sessão inválida');
    expect(captureBackgroundError).not.toHaveBeenCalled();
  });
});
