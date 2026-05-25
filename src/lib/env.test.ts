import { describe, it, expect } from 'vitest';
import { __internal } from './env';

const { loadEnv } = __internal;

describe('env validation', () => {
  it('accepts empty env (all DB vars optional in C0)', () => {
    const parsed = loadEnv({} as NodeJS.ProcessEnv);
    expect(parsed.NODE_ENV).toBe('development');
    expect(parsed.LOG_LEVEL).toBe('info');
  });

  it('accepts valid full env', () => {
    const parsed = loadEnv({
      DATABASE_URL: 'postgres://user:pass@host:5432/db',
      DATABASE_URL_PROD: 'postgres://user:pass@host:5432/db',
      NEXT_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'service-key',
      NODE_ENV: 'production',
      LOG_LEVEL: 'warn',
    } as NodeJS.ProcessEnv);
    expect(parsed.NODE_ENV).toBe('production');
    expect(parsed.LOG_LEVEL).toBe('warn');
  });

  it('rejects invalid NODE_ENV', () => {
    expect(() =>
      loadEnv({ NODE_ENV: 'banana' } as unknown as NodeJS.ProcessEnv),
    ).toThrow(/NODE_ENV/);
  });

  it('rejects invalid LOG_LEVEL', () => {
    expect(() =>
      loadEnv({ LOG_LEVEL: 'verbose' } as unknown as NodeJS.ProcessEnv),
    ).toThrow(/LOG_LEVEL/);
  });

  it('rejects malformed DATABASE_URL', () => {
    expect(() =>
      loadEnv({ DATABASE_URL: 'not-a-url' } as NodeJS.ProcessEnv),
    ).toThrow(/DATABASE_URL/);
  });
});
