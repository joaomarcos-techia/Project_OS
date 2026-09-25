/**
 * POST /api/signup/runtime-fingerprint
 *
 * Read-only proof used by the destructive signup E2E before it creates an Auth
 * user or writes a draft. The caller must already know `MAGIC_TOKEN_SECRET` and
 * signs a short-lived nonce; the response exposes only Supabase project refs.
 *
 * The route intentionally does not exist from a caller's perspective in the
 * Vercel production environment. Preview and local runs remain available so an
 * E2E can prove that Auth and `dbAdmin` point to the expected DEV project before
 * the first external mutation.
 */
import { createHmac } from 'node:crypto';

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { safeEqual } from '@/lib/auth/secret-compare';
import { env } from '@/lib/env';
import { supabaseRefFromDatabaseUrl, supabaseRefFromUrl } from '@/lib/env-coherence';
import { readWebhookBodyCapped } from '@/lib/http/webhook-body';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 512;
const MAX_AGE_MS = 60_000;
const MAX_FUTURE_SKEW_MS = 10_000;
const SIGNATURE_HEADER = 'x-qoro-e2e-signature';

const requestSchema = z
  .object({
    timestamp: z.number().int().nonnegative(),
    nonce: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/u),
  })
  .strict();

function signaturePayload(timestamp: number, nonce: string): string {
  return `POST\n/api/signup/runtime-fingerprint\n${timestamp}\n${nonce}`;
}

function expectedSignature(secret: string, timestamp: number, nonce: string): string {
  return createHmac('sha256', secret).update(signaturePayload(timestamp, nonce)).digest('hex');
}

function json(body: unknown, status: number): Response {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function POST(req: Request): Promise<Response> {
  // Hide the diagnostic surface completely from production. Preview also runs
  // with NODE_ENV=production, so it is the only explicit production-mode
  // exception; an absent/unknown Vercel discriminator fails closed.
  const hiddenInThisEnvironment =
    env.VERCEL_ENV === 'production' ||
    (env.NODE_ENV === 'production' && env.VERCEL_ENV !== 'preview');
  if (hiddenInThisEnvironment) return json({ error: 'not_found' }, 404);

  const declared = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return json({ error: 'body_too_large' }, 413);
  }

  if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return json({ error: 'invalid_body' }, 400);
  }

  const raw = await readWebhookBodyCapped(req, MAX_BODY_BYTES);
  if (raw === null) return json({ error: 'body_too_large' }, 413);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }

  const input = requestSchema.safeParse(parsed);
  if (!input.success) return json({ error: 'invalid_body' }, 400);

  const secret = env.MAGIC_TOKEN_SECRET;
  if (!secret) return json({ error: 'unavailable' }, 503);

  const { timestamp, nonce } = input.data;
  const age = Date.now() - timestamp;
  const signature = req.headers.get(SIGNATURE_HEADER);
  const authenticated = safeEqual(signature, expectedSignature(secret, timestamp, nonce));
  const fresh = age >= -MAX_FUTURE_SKEW_MS && age <= MAX_AGE_MS;
  if (!authenticated || !fresh) return json({ error: 'unauthorized' }, 401);

  const authProjectRef = supabaseRefFromUrl(env.NEXT_PUBLIC_SUPABASE_URL);
  const databaseProjectRef = supabaseRefFromDatabaseUrl(env.DATABASE_URL);
  if (!authProjectRef || !databaseProjectRef) {
    return json({ error: 'environment_indeterminate' }, 503);
  }

  return json(
    {
      environment: env.VERCEL_ENV ?? 'local',
      authProjectRef,
      databaseProjectRef,
    },
    200,
  );
}
