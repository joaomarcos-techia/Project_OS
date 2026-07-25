import { describe, expect, it } from 'vitest';

import { buildContentSecurityPolicy } from './content-security-policy';

function directive(policy: string, name: string): string {
  return policy.split('; ').find((part) => part.startsWith(`${name} `)) ?? '';
}

describe('buildContentSecurityPolicy', () => {
  it('permite o Vercel Toolbar somente em Preview', () => {
    const policy = buildContentSecurityPolicy('preview');

    expect(directive(policy, 'script-src')).toContain('https://vercel.live');
    expect(directive(policy, 'frame-src')).toContain('https://vercel.live');
  });

  it('não amplia a política de Production para vercel.live', () => {
    const policy = buildContentSecurityPolicy('production');

    expect(policy).not.toContain('https://vercel.live');
    expect(directive(policy, 'frame-src')).toBe("frame-src 'self'");
  });
});
