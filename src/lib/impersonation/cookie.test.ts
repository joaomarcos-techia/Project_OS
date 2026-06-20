import { describe, expect, it } from 'vitest';

import { readImpersonationCookie, signImpersonationCookie } from './cookie';

describe('impersonation cookie (C15) — assinatura HMAC', () => {
  const id = '11111111-1111-1111-1111-111111111111';

  it('roundtrip: sign → read devolve o id', () => {
    const cookie = signImpersonationCookie(id);
    expect(cookie).toContain(id);
    expect(readImpersonationCookie(cookie)).toBe(id);
  });

  it('cookie adulterado (assinatura inválida) → null', () => {
    const cookie = signImpersonationCookie(id);
    const tampered = `${cookie}00`;
    expect(readImpersonationCookie(tampered)).toBeNull();
  });

  it('id trocado mantendo assinatura antiga → null', () => {
    const cookie = signImpersonationCookie(id);
    const sig = cookie.split('.')[1];
    const forged = `22222222-2222-2222-2222-222222222222.${sig}`;
    expect(readImpersonationCookie(forged)).toBeNull();
  });

  it('valor ausente / sem separador → null', () => {
    expect(readImpersonationCookie(undefined)).toBeNull();
    expect(readImpersonationCookie('')).toBeNull();
    expect(readImpersonationCookie('semassinatura')).toBeNull();
  });
});
