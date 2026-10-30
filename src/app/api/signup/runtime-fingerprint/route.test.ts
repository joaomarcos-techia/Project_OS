import { createHmac } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const AUTH_REF = 'abcdefghijklmnopqrst';
const DB_REF = 'uvwxyzabcdefghijklmn';
const SECRET = 'runtime-fingerprint-test-secret-32-bytes';
const NOW = 1_800_000_000_000;
const NONCE = 'a'.repeat(32);

const { envState } = vi.hoisted(() => ({
  envState: {
    value: {
      NODE_ENV: 'production' as 'development' | 'test' | 'production',
      VERCEL_ENV: 'preview' as 'preview' | 'production' | undefined,
      MAGIC_TOKEN_SECRET: 'runtime-fingerprint-test-secret-32-bytes' as string | undefined,
      NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
      DATABASE_URL:
        'postgresql://postgres.uvwxyzabcdefghijklmn:password@aws-0.pooler.supabase.com:6543/postgres',
      ASAAS_BASE_URL: 'https://sandbox.asaas.com/api/v3',
      ASAAS_API_KEY: 'sandbox-test-key' as string | undefined,
    },
  },
}));

vi.mock('@/lib/env', () => ({
  get env() {
    return envState.value;
  },
}));

import { POST } from './route';

function signature(timestamp: number, nonce: string, secret = SECRET): string {
  return createHmac('sha256', secret)
    .update(`POST\n/api/signup/runtime-fingerprint\n${timestamp}\n${nonce}`)
    .digest('hex');
}

function request(
  input: unknown = { timestamp: NOW, nonce: NONCE },
  options: { signature?: string; raw?: string; contentType?: string; contentLength?: string } = {},
): Request {
  const raw = options.raw ?? JSON.stringify(input);
  const headers = new Headers();
  if (options.contentType !== '') {
    headers.set('content-type', options.contentType ?? 'application/json');
  }
  if (options.signature !== '') {
    headers.set(
      'x-qoro-e2e-signature',
      options.signature ?? signature((input as { timestamp: number }).timestamp, NONCE),
    );
  }
  if (options.contentLength !== undefined) {
    headers.set('content-length', options.contentLength);
  }
  return new Request('https://preview.example/api/signup/runtime-fingerprint', {
    method: 'POST',
    headers,
    body: raw,
  });
}

describe('POST /api/signup/runtime-fingerprint', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    envState.value = {
      NODE_ENV: 'production',
      VERCEL_ENV: 'preview',
      MAGIC_TOKEN_SECRET: SECRET,
      NEXT_PUBLIC_SUPABASE_URL: `https://${AUTH_REF}.supabase.co`,
      DATABASE_URL: `postgresql://postgres.${DB_REF}:password@aws-0.pooler.supabase.com:6543/postgres`,
      ASAAS_BASE_URL: 'https://sandbox.asaas.com/api/v3',
      ASAAS_API_KEY: 'sandbox-test-key',
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns only the runtime environment and parsed Supabase refs for a valid proof', async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      environment: 'preview',
      authProjectRef: AUTH_REF,
      databaseProjectRef: DB_REF,
      asaasSandboxConfigured: true,
      asaasKeyConfigured: true,
    });
  });

  it('reports a production provider or missing key without revealing credentials', async () => {
    envState.value.ASAAS_BASE_URL = 'https://api.asaas.com/v3';
    envState.value.ASAAS_API_KEY = undefined;
    const response = await POST(request());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ asaasSandboxConfigured: false, asaasKeyConfigured: false });
    expect(JSON.stringify(body)).not.toContain('api.asaas.com');
  });

  it('labels a non-Vercel runtime as local', async () => {
    envState.value.NODE_ENV = 'development';
    envState.value.VERCEL_ENV = undefined;
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect((await response.json()).environment).toBe('local');
  });

  it('is unavailable in the Vercel production environment before body parsing', async () => {
    envState.value.VERCEL_ENV = 'production';
    const response = await POST(
      request(undefined, { raw: 'not-json', contentType: '', signature: '' }),
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'not_found' });
  });

  it('fails closed in production mode when the Vercel environment is indeterminate', async () => {
    envState.value.VERCEL_ENV = undefined;
    const response = await POST(request());
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'not_found' });
  });

  it.each([
    ['missing signature', ''],
    ['wrong signature', '0'.repeat(64)],
    ['malformed signature', 'short'],
  ])('rejects %s without exposing refs', async (_case, candidate) => {
    const response = await POST(request(undefined, { signature: candidate }));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'unauthorized' });
  });

  it.each([
    ['expired', NOW - 60_001],
    ['too far in the future', NOW + 10_001],
  ])('rejects a correctly signed but %s timestamp', async (_case, timestamp) => {
    const response = await POST(
      request({ timestamp, nonce: NONCE }, { signature: signature(timestamp, NONCE) }),
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'unauthorized' });
  });

  it.each([
    ['malformed JSON', undefined, { raw: '{' }],
    ['extra property', { timestamp: NOW, nonce: NONCE, target: 'prod' }, {}],
    ['short nonce', { timestamp: NOW, nonce: 'short' }, {}],
    ['fractional timestamp', { timestamp: NOW + 0.5, nonce: NONCE }, {}],
    ['wrong content type', undefined, { contentType: 'text/plain' }],
  ])('rejects a non-strict body: %s', async (_case, input, options) => {
    const response = await POST(request(input, options));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'invalid_body' });
  });

  it('caps both declared and actual request bytes', async () => {
    const declared = await POST(request(undefined, { contentLength: '513' }));
    expect(declared.status).toBe(413);

    const streamed = await POST(request(undefined, { raw: 'x'.repeat(513) }));
    expect(streamed.status).toBe(413);
  });

  it('fails closed when the signing secret is unavailable', async () => {
    envState.value.MAGIC_TOKEN_SECRET = undefined;
    const response = await POST(request());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'unavailable' });
  });

  it.each([
    ['Auth ref', { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' }],
    ['database ref', { DATABASE_URL: 'postgresql://postgres:password@localhost:5432/postgres' }],
  ])('fails closed when the %s cannot be determined', async (_case, override) => {
    envState.value = { ...envState.value, ...override };
    const response = await POST(request());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'environment_indeterminate' });
  });
});
