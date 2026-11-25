import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ dbAdmin: { execute: vi.fn() } }));
const warn = vi.fn();
vi.mock('@/lib/observability/logger', () => ({
  logger: { warn: (...a: unknown[]) => warn(...a) },
}));

import {
  checkLoginByAuditTrail,
  decideFromRecentFailures,
  LOGIN_AUDIT_FALLBACK,
} from './login-attempts-fallback';

describe('fallback do limite de login pela trilha login_attempts (S8, req. 69)', () => {
  it('o teto por e-mail é 5 em 15 minutos, o máximo que o requisito 69 admite', () => {
    expect(LOGIN_AUDIT_FALLBACK).toEqual({
      windowMinutes: 15,
      maxFailuresPerEmail: 5,
      maxFailuresPerIp: 10,
    });
  });

  it('libera abaixo dos tetos e bloqueia ao atingi-los', () => {
    expect(decideFromRecentFailures({ byEmail: 4, byIp: 9 })).toBe('allowed');
    expect(decideFromRecentFailures({ byEmail: 5, byIp: 0 })).toBe('blocked');
    expect(decideFromRecentFailures({ byEmail: 0, byIp: 10 })).toBe('blocked');
  });

  it('contagem inválida bloqueia (nunca libera por dado estranho)', () => {
    expect(decideFromRecentFailures({ byEmail: Number.NaN, byIp: 0 })).toBe('blocked');
  });

  it('usa a mesma contagem para qualquer instância (vem do banco, não da memória)', async () => {
    const query = vi.fn().mockResolvedValue({ byEmail: 5, byIp: 1 });
    await expect(checkLoginByAuditTrail('hash', '203.0.113.7', query)).resolves.toBe('blocked');
    await expect(checkLoginByAuditTrail('hash', '203.0.113.7', query)).resolves.toBe('blocked');
    expect(query).toHaveBeenCalledWith('hash', '203.0.113.7');
  });

  it('banco indisponível: FECHA (unavailable), sem lançar e sem dado pessoal no log', async () => {
    const query = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED pessoa@example.test'));
    await expect(checkLoginByAuditTrail('hash', '203.0.113.7', query)).resolves.toBe('unavailable');
    expect(warn).toHaveBeenCalledWith('auth.ratelimit.audit_fallback_failed', { reason: 'Error' });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('example.test');
  });
});
