import { PILOT_INVITE_COOKIE } from '@/contexts/onboarding';

export function readPilotCookie(req: Request): string | null {
  const part = req.headers
    .get('cookie')
    ?.split(';')
    .map((p) => p.trim())
    .find((p) => p.startsWith(PILOT_INVITE_COOKIE + '='));
  const value = part?.slice(PILOT_INVITE_COOKIE.length + 1);
  return value && /^[a-f0-9]{64}$/u.test(value) ? value : null;
}
