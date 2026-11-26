import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  guard: vi.fn(),
  listFactors: vi.fn(),
  verify: vi.fn(),
  set: vi.fn(),
  revalidate: vi.fn(),
}));

vi.mock('../_lib/guard', () => ({ guardAdminAccess: m.guard }));
vi.mock('@/lib/auth/mfa', () => ({ listFactors: m.listFactors, challengeAndVerify: m.verify }));
vi.mock('@/lib/auth/supabase-server', () => ({ createServerClient: async () => ({}) }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/cache', () => ({ revalidatePath: m.revalidate }));
vi.mock('@/lib/audit/request-context', () => ({ buildRequestContext: () => ({ ip: null }) }));
vi.mock('@/contexts/health-insurance', () => {
  class ConveniosPlatformError extends Error {
    constructor(
      message: string,
      readonly code: string,
    ) {
      super(message);
    }
  }
  return { ConveniosPlatformError, setConveniosModuleForClinic: m.set };
});

import { ConveniosPlatformError } from '@/contexts/health-insurance';

import { setConveniosModuleAction } from './convenios-module';

const CLINIC = '11111111-1111-4111-8111-111111111111';
const form = (o: Partial<Record<'clinicId' | 'enabled' | 'reason' | 'code', string>> = {}) => {
  const f = new FormData();
  f.set('clinicId', o.clinicId ?? CLINIC);
  f.set('enabled', o.enabled ?? 'true');
  f.set('reason', o.reason ?? 'contrato de Convênios assinado em 26/11');
  f.set('code', o.code ?? '123456');
  return f;
};

beforeEach(() => {
  vi.clearAllMocks();
  m.guard.mockResolvedValue(undefined);
  m.listFactors.mockResolvedValue([{ id: 'f1', status: 'verified' }]);
  m.verify.mockResolvedValue(undefined);
  m.set.mockResolvedValue({ clinicId: CLINIC, enabled: true, changed: true });
});

describe('setConveniosModuleAction (P1.13)', () => {
  it('sem super admin AAL2: o guard barra antes de tudo (nada é lido nem gravado)', async () => {
    m.guard.mockRejectedValue(new Error('NEXT_NOT_FOUND'));
    await expect(setConveniosModuleAction({ error: null }, form())).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
    expect(m.listFactors).not.toHaveBeenCalled();
    expect(m.set).not.toHaveBeenCalled();
  });

  it('motivo obrigatório e código de 6 dígitos', async () => {
    expect((await setConveniosModuleAction({ error: null }, form({ reason: 'ok' }))).error).toMatch(
      /motivo/u,
    );
    expect((await setConveniosModuleAction({ error: null }, form({ code: '12' }))).error).toMatch(
      /6 dígitos/u,
    );
    expect(m.set).not.toHaveBeenCalled();
  });

  it('MFA a cada mudança: sem TOTP configurado ou com código errado, nada é gravado', async () => {
    m.listFactors.mockResolvedValueOnce([]);
    expect((await setConveniosModuleAction({ error: null }, form())).error).toMatch(/TOTP/u);
    m.verify.mockRejectedValueOnce(new Error('Código inválido.'));
    expect((await setConveniosModuleAction({ error: null }, form())).error).toBe(
      'Código inválido.',
    );
    expect(m.set).not.toHaveBeenCalled();
  });

  it('liga com motivo, revalida a página e informa o resultado', async () => {
    const out = await setConveniosModuleAction({ error: null }, form());
    expect(out).toEqual({ error: null, done: 'enabled' });
    expect(m.set).toHaveBeenCalledWith(
      { clinicId: CLINIC, enabled: true, reason: 'contrato de Convênios assinado em 26/11' },
      { ip: null },
    );
    expect(m.revalidate).toHaveBeenCalledWith(`/admin/clinicas/${CLINIC}`);
  });

  it('desliga; pedir o estado atual não grava nada ("unchanged")', async () => {
    m.set.mockResolvedValueOnce({ clinicId: CLINIC, enabled: false, changed: true });
    expect(await setConveniosModuleAction({ error: null }, form({ enabled: 'false' }))).toEqual({
      error: null,
      done: 'disabled',
    });
    m.set.mockResolvedValueOnce({ clinicId: CLINIC, enabled: false, changed: false });
    expect((await setConveniosModuleAction({ error: null }, form({ enabled: 'false' }))).done).toBe(
      'unchanged',
    );
  });

  it('contrato sem Convênios ou indisponível na plataforma: a mensagem do serviço, sem detalhe interno', async () => {
    m.set.mockRejectedValueOnce(
      new ConveniosPlatformError(
        'A assinatura desta clínica não inclui Convênios agora.',
        'commercial',
      ),
    );
    expect((await setConveniosModuleAction({ error: null }, form())).error).toMatch(/assinatura/u);
    m.set.mockRejectedValueOnce(new Error('falha interna'));
    await expect(setConveniosModuleAction({ error: null }, form())).rejects.toThrow(
      'falha interna',
    );
  });
});
