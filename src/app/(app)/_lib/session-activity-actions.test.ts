import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  authenticate: vi.fn(),
  readFootprint: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  signOut: vi.fn(),
  emit: vi.fn(),
}));

vi.mock('next/headers', () => ({ cookies: async () => ({ set: m.set, delete: m.del }) }));
vi.mock('@/lib/auth/tenant-context', () => ({ authenticate: m.authenticate }));
vi.mock('@/app/(app)/_lib/tiss-footprint', () => ({ readTissFootprintLazy: m.readFootprint }));
vi.mock('@/lib/auth/supabase-server', () => ({
  createServerClient: async () => ({ auth: { signOut: m.signOut } }),
}));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: m.emit } }));

import {
  SESSION_ACTIVITY_COOKIE,
  decodeSessionActivity,
  sessionActivitySecret,
} from '@/lib/auth/session-activity';

import { lockSessionAction, registerSessionActivityAction } from './session-activity-actions';

const identity = (o: { clinicId?: string | null; sessionId?: string | null } = {}) => ({
  ok: true,
  identity: {
    userId: 'u-1',
    clinicId: o.clinicId === undefined ? 'clinic-a' : o.clinicId,
    sessionId: o.sessionId === undefined ? 'sess-1' : o.sessionId,
  },
});
const written = () => {
  const call = m.set.mock.calls.find(([name]) => name === SESSION_ACTIVITY_COOKIE);
  return call ? decodeSessionActivity(call[1] as string, sessionActivitySecret()) : null;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('TISS_SECURITY_PROFILE_ENFORCE', 'true');
  vi.stubEnv('SUPABASE_SECRET_KEY', 'chave-sintetica-do-servidor-com-mais-de-32-caracteres');
  m.readFootprint.mockResolvedValue({ moduleEnabled: true, hasTissData: false });
});
afterEach(() => vi.unstubAllEnvs());

describe('registerSessionActivityAction (S2)', () => {
  it('1. sessão ativa no alcance: renova com o horário do servidor, usuário, sessão e scope=true', async () => {
    m.authenticate.mockResolvedValue(identity());
    await expect(registerSessionActivityAction()).resolves.toEqual({ ok: true, enforced: true });
    expect(written()).toMatchObject({ uid: 'u-1', sid: 'sess-1', scope: true });
    expect(m.set.mock.calls[0]![2]).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
    });
  });

  it('5. sessão já bloqueada: continua bloqueada (renovar nunca ressuscita) e nada é gravado', async () => {
    m.authenticate.mockResolvedValue({ ok: false, reason: 'SESSION_LOCKED' });
    await expect(registerSessionActivityAction()).resolves.toEqual({ ok: false, locked: true });
    expect(m.set).not.toHaveBeenCalled();
  });

  it('11. sessão revogada (epoch): recusa sem dizer "bloqueada" e sem gravar', async () => {
    m.authenticate.mockResolvedValue({ ok: false, reason: 'CLAIMS_OUTDATED' });
    await expect(registerSessionActivityAction()).resolves.toEqual({ ok: false, locked: false });
    expect(m.set).not.toHaveBeenCalled();
  });

  it('9/12. clínica sem Convênios: grava scope=false (fora do alcance, nunca bloqueia)', async () => {
    m.authenticate.mockResolvedValue(identity({ clinicId: 'clinic-b' }));
    m.readFootprint.mockResolvedValue({ moduleEnabled: false, hasTissData: false });
    await expect(registerSessionActivityAction()).resolves.toEqual({ ok: true, enforced: false });
    expect(written()).toMatchObject({ uid: 'u-1', scope: false });
    expect(m.readFootprint).toHaveBeenCalledWith('clinic-b');
  });

  it('10. rastro TISS ilegível (banco fora): a regra mais forte (scope=true)', async () => {
    m.authenticate.mockResolvedValue(identity());
    m.readFootprint.mockRejectedValue(new Error('db down'));
    await expect(registerSessionActivityAction()).resolves.toEqual({ ok: true, enforced: true });
    expect(written()).toMatchObject({ scope: true });
  });

  it('token sem session_id: não grava (a porta única segue fail-closed)', async () => {
    m.authenticate.mockResolvedValue(identity({ sessionId: null }));
    await expect(registerSessionActivityAction()).resolves.toEqual({ ok: false, locked: false });
    expect(m.set).not.toHaveBeenCalled();
  });

  it('perfil desligado: não grava nada', async () => {
    vi.stubEnv('TISS_SECURITY_PROFILE_ENFORCE', '');
    m.authenticate.mockResolvedValue(identity());
    await expect(registerSessionActivityAction()).resolves.toEqual({ ok: true, enforced: false });
    expect(m.set).not.toHaveBeenCalled();
  });
});

describe('lockSessionAction (S2)', () => {
  it('encerra a sessão local no Auth e apaga o registro de atividade', async () => {
    m.signOut.mockResolvedValue({ error: null });
    await expect(lockSessionAction()).resolves.toEqual({ ok: true });
    expect(m.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(m.del).toHaveBeenCalledWith(SESSION_ACTIVITY_COOKIE);
    expect(m.emit).toHaveBeenCalledWith('auth.session.locked', { reason: 'client_idle' });
  });

  it('falha no Auth não impede apagar o registro', async () => {
    m.signOut.mockRejectedValue(new Error('auth fora'));
    await expect(lockSessionAction()).resolves.toEqual({ ok: true });
    expect(m.del).toHaveBeenCalledWith(SESSION_ACTIVITY_COOKIE);
  });
});
