import { describe, it, expect } from 'vitest';
import { __internal } from './env';

const { loadEnv } = __internal;

const asEnv = (obj: Record<string, string>) =>
  obj as unknown as NodeJS.ProcessEnv;

describe('env validation', () => {
  it('accepts empty env (all DB vars optional in C0)', () => {
    const parsed = loadEnv(asEnv({}));
    expect(parsed.NODE_ENV).toBe('development');
    expect(parsed.LOG_LEVEL).toBe('info');
  });

  it('treats empty strings from .env.local as undefined (so .optional() works)', () => {
    const parsed = loadEnv(
      asEnv({
        DATABASE_URL: '',
        DATABASE_URL_PROD: '',
        NEXT_PUBLIC_SUPABASE_URL: '',
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: '',
        SUPABASE_SECRET_KEY: '',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: '',
        SUPABASE_SERVICE_ROLE_KEY: '',
      }),
    );
    expect(parsed.DATABASE_URL).toBeUndefined();
    expect(parsed.NEXT_PUBLIC_SUPABASE_URL).toBeUndefined();
    expect(parsed.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).toBeUndefined();
  });

  it('accepts valid full env (new Supabase key naming)', () => {
    const parsed = loadEnv(
      asEnv({
        DATABASE_URL: 'postgres://user:pass@host:5432/db',
        DATABASE_URL_PROD: 'postgres://user:pass@host:5432/db',
        NEXT_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co',
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_xyz',
        SUPABASE_SECRET_KEY: 'sb_secret_xyz',
        NODE_ENV: 'production',
        LOG_LEVEL: 'warn',
      }),
    );
    expect(parsed.NODE_ENV).toBe('production');
    expect(parsed.LOG_LEVEL).toBe('warn');
    expect(parsed.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).toBe(
      'sb_publishable_xyz',
    );
  });

  it('accepts legacy Supabase key naming (anon/service_role)', () => {
    const parsed = loadEnv(
      asEnv({
        NEXT_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'legacy-anon',
        SUPABASE_SERVICE_ROLE_KEY: 'legacy-service-role',
      }),
    );
    expect(parsed.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe('legacy-anon');
  });

  it('rejects invalid NODE_ENV', () => {
    expect(() => loadEnv(asEnv({ NODE_ENV: 'banana' }))).toThrow(/NODE_ENV/);
  });

  it('rejects invalid LOG_LEVEL', () => {
    expect(() => loadEnv(asEnv({ LOG_LEVEL: 'verbose' }))).toThrow(/LOG_LEVEL/);
  });

  it('rejects malformed DATABASE_URL', () => {
    expect(() => loadEnv(asEnv({ DATABASE_URL: 'not-a-url' }))).toThrow(
      /DATABASE_URL/,
    );
  });
});
