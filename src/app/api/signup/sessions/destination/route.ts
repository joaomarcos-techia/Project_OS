import { NextResponse } from 'next/server';

import { readSignupCodeDestination } from '@/contexts/onboarding';
import { assertSignupReadAllowed, getClientIp } from '@/lib/auth/rate-limit';
import { env } from '@/lib/env';

import { readSignupCookie } from '../../cookie';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  const json = (body: object, status: number) =>
    NextResponse.json(body, {
      status,
      headers: { 'Cache-Control': 'no-store, private', 'Referrer-Policy': 'no-referrer' },
    });
  if (!env.SIGNUP_AUTH_ENABLED || !env.SIGNUP_IDENTITY_ENABLED)
    return json({ error: 'unavailable' }, 503);
  if (request.headers.get('sec-fetch-site') !== 'same-origin')
    return json({ error: 'blocked' }, 403);
  const limit = await assertSignupReadAllowed(getClientIp(request.headers));
  if (!limit.ok) return json({ error: 'rate_limited' }, 429);
  const token = readSignupCookie(request);
  if (!token) return json({ error: 'gone' }, 410);
  try {
    const email = await readSignupCodeDestination(token);
    return email ? json({ email }, 200) : json({ error: 'gone' }, 410);
  } catch {
    return json({ error: 'unavailable' }, 503);
  }
}
