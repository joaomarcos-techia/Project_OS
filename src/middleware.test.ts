/**
 * Regressão F-06 (auditoria forense 2026-06-10).
 *
 * O heal do middleware deletava cookies com `endsWith('-auth-token')` — que NÃO
 * casa os fragmentos `...-auth-token.0`, `.1` criados pelo @supabase/ssr quando
 * a sessão serializada passa de ~3180 bytes (gestor/owner com 21 permissions).
 * Resultado: usuário com drift era "deslogado" mas mantinha access+refresh
 * token válidos nos fragmentos.
 *
 * `isSupabaseAuthCookie` é o predicado usado pelo heal; este teste congela o
 * formato (base + sufixo `.N` opcional) que `getAccessTokenFromCookies`, no
 * mesmo arquivo, já reconhecia ao REMONTAR a sessão — as duas pontas precisam
 * casar o mesmo universo de cookies.
 */
import { describe, expect, it } from 'vitest';

import { isSupabaseAuthCookie } from './middleware';

describe('isSupabaseAuthCookie (F-06 — heal deve apagar TODOS os fragmentos)', () => {
  it('casa o cookie de sessão inteiro', () => {
    expect(isSupabaseAuthCookie('sb-abcdefgh-auth-token')).toBe(true);
  });

  it('casa fragmentos .0, .1 e índices multi-dígito', () => {
    expect(isSupabaseAuthCookie('sb-abcdefgh-auth-token.0')).toBe(true);
    expect(isSupabaseAuthCookie('sb-abcdefgh-auth-token.1')).toBe(true);
    expect(isSupabaseAuthCookie('sb-abcdefgh-auth-token.12')).toBe(true);
  });

  it('NÃO casa cookies sb- que não são a sessão', () => {
    expect(isSupabaseAuthCookie('sb-abcdefgh-auth-token-code-verifier')).toBe(false);
    expect(isSupabaseAuthCookie('sb-abcdefgh-refresh')).toBe(false);
  });

  it('NÃO casa cookies de outras origens', () => {
    expect(isSupabaseAuthCookie('_healed')).toBe(false);
    expect(isSupabaseAuthCookie('_claim_check_at')).toBe(false);
    expect(isSupabaseAuthCookie('auth-token')).toBe(false); // sem prefixo sb-
  });

  it('NÃO casa sufixo malformado', () => {
    expect(isSupabaseAuthCookie('sb-x-auth-token.')).toBe(false);
    expect(isSupabaseAuthCookie('sb-x-auth-token.x')).toBe(false);
  });
});
