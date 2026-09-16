import { describe, expect, it } from 'vitest';

import { PUBLIC_ENV_REGISTRY } from '../../../scripts/security/public-env-registry';
import { __internal } from '@/lib/env';

describe('registro público do Turnstile', () => {
  it('registra somente as três site keys públicas', () => {
    const turnstilePublic = Object.entries(PUBLIC_ENV_REGISTRY).filter(([name]) =>
      name.includes('TURNSTILE'),
    );
    expect(turnstilePublic.map(([name]) => name).sort()).toEqual([
      'NEXT_PUBLIC_TURNSTILE_SITE_KEY',
      'NEXT_PUBLIC_TURNSTILE_SITE_KEY_DEV',
      'NEXT_PUBLIC_TURNSTILE_SITE_KEY_LOCAL',
    ]);
    expect(turnstilePublic.every(([, entry]) => entry.exposure === 'public-by-design')).toBe(true);
  });

  it('mantém a secret no schema do servidor e fora do registro público', () => {
    const parsed = __internal.EnvSchema.safeParse({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://test:test@localhost:5432/test?sslmode=require',
      NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
      TURNSTILE_SECRET_KEY: 'server-only-turnstile-secret',
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.TURNSTILE_SECRET_KEY).toBe('server-only-turnstile-secret');
    expect(Object.keys(PUBLIC_ENV_REGISTRY)).not.toContain('NEXT_PUBLIC_TURNSTILE_SECRET_KEY');
    expect(Object.keys(PUBLIC_ENV_REGISTRY)).not.toContain('TURNSTILE_SECRET_KEY');
  });
});
