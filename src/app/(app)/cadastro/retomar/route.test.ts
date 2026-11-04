import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { nextConfig } from '../../../../../next.config';
import { SIGNUP_RECOVERY_CONTENT_SECURITY_POLICY } from '@/lib/http/signup-recovery-bridge';
import { GET } from './route';
describe('static recovery bridge', () => {
  it('serves no bearer, analytics, remote assets or GET mutation, with matching CSP hashes', async () => {
    const response = GET();
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-robots-tag')).toContain('noindex');
    const csp = response.headers.get('content-security-policy');
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    for (const match of html.matchAll(/<(?:script|style)>([\s\S]*?)<\/(?:script|style)>/gu))
      expect(csp).toContain(`'sha256-${createHash('sha256').update(match[1]!).digest('base64')}'`);
    expect(html).not.toMatch(/<script[^>]+src=|<img|https:\/\//u);
    expect(html).toContain("history.replaceState(null,'',location.pathname)");
    expect(html).toContain("button.addEventListener('click'");
    expect(html).toContain('Precisa de um novo e-mail?');
  });

  it('keeps the strict recovery headers after the global Next rule', async () => {
    const configured = await nextConfig.headers?.();
    expect(configured).toBeDefined();
    const headers = configured ?? [];
    const catchAllIndex = headers.findIndex((rule) => rule.source === '/(.*)');
    const recoveryIndex = headers.findIndex((rule) => rule.source === '/cadastro/retomar');
    expect(catchAllIndex).toBeGreaterThanOrEqual(0);
    expect(recoveryIndex).toBeGreaterThan(catchAllIndex);
    const recoveryHeaders = new Headers(
      headers[recoveryIndex]?.headers.map(({ key, value }) => [key, value]),
    );
    expect(recoveryHeaders.get('referrer-policy')).toBe('no-referrer');
    expect(recoveryHeaders.get('content-security-policy')).toBe(
      SIGNUP_RECOVERY_CONTENT_SECURITY_POLICY,
    );
    expect(recoveryHeaders.get('cache-control')).toContain('no-store');
    expect(recoveryHeaders.get('x-robots-tag')).toContain('noindex');
    expect(GET().headers.get('content-security-policy')).toBe(
      recoveryHeaders.get('content-security-policy'),
    );
  });
});
