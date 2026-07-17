import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A1 (auditoria de APIs) — auth das rotas `/api/health/**`.
 *
 * `getCurrentUser` lê cookie; `env` valida no load do módulo. Ambos são mockados
 * para manter o teste puro sobre `Request`.
 */
const { getCurrentUser } = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
const envMock = vi.hoisted(() => ({ value: { CRON_SECRET: 'x'.repeat(32) } }));

vi.mock('@/lib/auth/tenant-context', () => ({ getCurrentUser }));
vi.mock('@/lib/env', () => ({
  get env() {
    return envMock.value;
  },
}));

import { healthAuthLevel } from './health-auth';

const SECRET = 'x'.repeat(32);
const req = (headers: Record<string, string> = {}): Request =>
  new Request('https://qoro.app/api/health', { headers });

beforeEach(() => {
  vi.clearAllMocks();
  envMock.value = { CRON_SECRET: SECRET };
  getCurrentUser.mockResolvedValue(null);
});

describe('healthAuthLevel', () => {
  it('Bearer correto → monitoring', async () => {
    expect(await healthAuthLevel(req({ authorization: `Bearer ${SECRET}` }))).toBe('monitoring');
  });

  it('sem header → denied', async () => {
    expect(await healthAuthLevel(req())).toBe('denied');
  });

  it('Bearer errado (mesmo tamanho) → denied', async () => {
    expect(await healthAuthLevel(req({ authorization: `Bearer ${'y'.repeat(32)}` }))).toBe('denied');
  });

  it('secret sem o prefixo Bearer → denied', async () => {
    expect(await healthAuthLevel(req({ authorization: SECRET }))).toBe('denied');
  });

  it('super_admin com AAL2 → super_admin, sem precisar de Bearer', async () => {
    getCurrentUser.mockResolvedValue({ isSuperAdmin: true, aal: 'aal2' });
    expect(await healthAuthLevel(req())).toBe('super_admin');
  });

  it('super_admin sem AAL2 → não escala; cai no Bearer', async () => {
    getCurrentUser.mockResolvedValue({ isSuperAdmin: true, aal: 'aal1' });
    expect(await healthAuthLevel(req())).toBe('denied');
    expect(await healthAuthLevel(req({ authorization: `Bearer ${SECRET}` }))).toBe('monitoring');
  });

  it('usuário comum logado → não vira super_admin', async () => {
    getCurrentUser.mockResolvedValue({ isSuperAdmin: false, aal: 'aal2' });
    expect(await healthAuthLevel(req())).toBe('denied');
  });

  it('getCurrentUser lançando (sessão inválida) → não quebra; cai no Bearer', async () => {
    getCurrentUser.mockRejectedValue(new Error('no session'));
    expect(await healthAuthLevel(req({ authorization: `Bearer ${SECRET}` }))).toBe('monitoring');
  });

  // A regressão que este teste existe para travar: `Bearer ${undefined}` vira a
  // string "Bearer undefined" e autenticaria qualquer um quando o secret não
  // está configurado (CRON_SECRET é optional() no schema).
  it('CRON_SECRET ausente → "Bearer undefined" NÃO autentica', async () => {
    envMock.value = { CRON_SECRET: undefined as unknown as string };
    expect(await healthAuthLevel(req({ authorization: 'Bearer undefined' }))).toBe('denied');
    expect(await healthAuthLevel(req({ authorization: 'Bearer ' }))).toBe('denied');
    expect(await healthAuthLevel(req())).toBe('denied');
  });

  it('CRON_SECRET ausente → super_admin ainda entra', async () => {
    envMock.value = { CRON_SECRET: undefined as unknown as string };
    getCurrentUser.mockResolvedValue({ isSuperAdmin: true, aal: 'aal2' });
    expect(await healthAuthLevel(req())).toBe('super_admin');
  });
});
