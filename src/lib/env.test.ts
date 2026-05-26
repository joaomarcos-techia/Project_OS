import { describe, it, expect } from 'vitest';
import { __internal } from './env';

const { loadEnv } = __internal;

const asEnv = (obj: Record<string, string>) =>
  obj as unknown as NodeJS.ProcessEnv;

// Minimal C1-valid env: DATABASE_URL + NEXT_PUBLIC_SUPABASE_URL + one Supabase key.
const baseValid: Record<string, string> = {
  DATABASE_URL: 'postgres://user:pass@host:5432/db?sslmode=require',
  NEXT_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_xyz',
};

describe('env validation (C1 contract)', () => {
  it('rejects empty env — DATABASE_URL now required', () => {
    expect(() => loadEnv(asEnv({}))).toThrow(/DATABASE_URL/);
  });

  it('rejects env missing NEXT_PUBLIC_SUPABASE_URL', () => {
    const { NEXT_PUBLIC_SUPABASE_URL: _drop, ...rest } = baseValid;
    expect(() => loadEnv(asEnv(rest))).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it('rejects env with no Supabase publishable/anon key', () => {
    const {
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: _drop,
      ...rest
    } = baseValid;
    expect(() => loadEnv(asEnv(rest))).toThrow(
      /PUBLISHABLE_KEY.*or.*ANON_KEY/,
    );
  });

  it('accepts legacy ANON_KEY in place of PUBLISHABLE_KEY', () => {
    const {
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: _drop,
      ...rest
    } = baseValid;
    const parsed = loadEnv(
      asEnv({ ...rest, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'legacy-anon' }),
    );
    expect(parsed.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe('legacy-anon');
  });

  it('accepts minimum valid env (dev defaults)', () => {
    const parsed = loadEnv(asEnv(baseValid));
    expect(parsed.NODE_ENV).toBe('development');
    expect(parsed.LOG_LEVEL).toBe('info');
    expect(parsed.DATABASE_URL).toContain('postgres://');
  });

  it('treats empty strings as undefined for optional fields', () => {
    const parsed = loadEnv(
      asEnv({
        ...baseValid,
        DATABASE_URL_PROD: '',
        SUPABASE_SECRET_KEY: '',
      }),
    );
    expect(parsed.DATABASE_URL_PROD).toBeUndefined();
    expect(parsed.SUPABASE_SECRET_KEY).toBeUndefined();
  });

  it('does NOT require DATABASE_URL_PROD at app load — scripts enforce it', () => {
    // env.ts deliberately omits prod-URL validation because the app never reads
    // DATABASE_URL_PROD; only db:migrate:prod / db:backup:prod do, and they call
    // scripts/_env.ts.assertProdContext(). Including a NODE_ENV=production check
    // here would break `next build` whenever DATABASE_URL_PROD is unset (the
    // current state: qoro-prod doesn't exist yet).
    const parsed = loadEnv(asEnv({ ...baseValid, NODE_ENV: 'production' }));
    expect(parsed.NODE_ENV).toBe('production');
    expect(parsed.DATABASE_URL_PROD).toBeUndefined();
  });

  it('accepts NODE_ENV=production with DATABASE_URL_PROD set', () => {
    const parsed = loadEnv(
      asEnv({
        ...baseValid,
        NODE_ENV: 'production',
        DATABASE_URL_PROD: 'postgres://u:p@prod-host:5432/db?sslmode=require',
      }),
    );
    expect(parsed.DATABASE_URL_PROD).toBe(
      'postgres://u:p@prod-host:5432/db?sslmode=require',
    );
  });

  it('rejects invalid NODE_ENV', () => {
    expect(() =>
      loadEnv(asEnv({ ...baseValid, NODE_ENV: 'banana' })),
    ).toThrow(/NODE_ENV/);
  });

  it('rejects invalid LOG_LEVEL', () => {
    expect(() =>
      loadEnv(asEnv({ ...baseValid, LOG_LEVEL: 'verbose' })),
    ).toThrow(/LOG_LEVEL/);
  });

  it('rejects malformed DATABASE_URL', () => {
    expect(() =>
      loadEnv(asEnv({ ...baseValid, DATABASE_URL: 'not-a-url' })),
    ).toThrow(/DATABASE_URL/);
  });

  it('accepts SUPABASE_PROJECT_ENV opt-in flag', () => {
    const parsed = loadEnv(asEnv({ ...baseValid, SUPABASE_PROJECT_ENV: 'prod' }));
    expect(parsed.SUPABASE_PROJECT_ENV).toBe('prod');
  });

  it('rejects invalid SUPABASE_PROJECT_ENV', () => {
    expect(() =>
      loadEnv(asEnv({ ...baseValid, SUPABASE_PROJECT_ENV: 'staging' })),
    ).toThrow(/SUPABASE_PROJECT_ENV/);
  });
});
