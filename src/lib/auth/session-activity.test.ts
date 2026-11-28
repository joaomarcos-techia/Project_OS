import { describe, expect, it } from 'vitest';

import {
  decideSessionLock,
  decodeSessionActivity,
  encodeSessionActivity,
  sessionClaimsFrom,
  sessionIdFromAccessToken,
  type SessionActivity,
} from './session-activity';

const SECRET = 'segredo-sintetico-de-teste-com-mais-de-32-caracteres';
const MIN = 60_000;
const NOW = Date.UTC(2026, 10, 26, 15, 0, 0);
const claims = (
  o: Partial<{ sub: string; sessionId: string | null; authAt: number | null }> = {},
) => ({
  sub: o.sub ?? 'user-a',
  sessionId: o.sessionId === undefined ? 'sess-1' : o.sessionId,
  authenticatedAt: o.authAt === undefined ? NOW - 60 * MIN : o.authAt,
});
const act = (o: Partial<SessionActivity> = {}): SessionActivity => ({
  uid: 'user-a',
  sid: 'sess-1',
  at: NOW - MIN,
  scope: true,
  ...o,
});

describe('cookie de atividade (S2 / requisito 83)', () => {
  it('ida e volta com assinatura; adulterado, truncado ou de outra chave não vale', () => {
    const v = encodeSessionActivity(act(), SECRET);
    expect(decodeSessionActivity(v, SECRET)).toEqual(act());
    const [payload, mac] = v.split('.');
    const forged = Buffer.from(JSON.stringify(act({ at: NOW }))).toString('base64url');
    expect(decodeSessionActivity(`${forged}.${mac}`, SECRET)).toBeNull();
    expect(decodeSessionActivity(`${payload}.`, SECRET)).toBeNull();
    expect(decodeSessionActivity(`${payload}.${mac}.x`, SECRET)).toBeNull();
    expect(decodeSessionActivity(v, `${SECRET}-outra`)).toBeNull();
    expect(decodeSessionActivity(undefined, SECRET)).toBeNull();
  });

  it('JSON assinado mas com formato errado não vale', () => {
    const bad = encodeSessionActivity(
      { ...act(), at: 'agora' } as unknown as SessionActivity,
      SECRET,
    );
    expect(decodeSessionActivity(bad, SECRET)).toBeNull();
  });
});

describe('decisão do servidor', () => {
  it('1. atividade há 1 min (médico digitando): segue', () => {
    expect(decideSessionLock({ activity: act(), claims: claims(), now: NOW })).toEqual({
      kind: 'active',
      source: 'cookie',
    });
  });

  it('3/5. 10 min sem atividade: bloqueia, mesmo com o token válido', () => {
    expect(
      decideSessionLock({ activity: act({ at: NOW - 10 * MIN }), claims: claims(), now: NOW }),
    ).toEqual({ kind: 'locked', reason: 'idle' });
    expect(
      decideSessionLock({
        activity: act({ at: NOW - 9 * MIN - 59_000 }),
        claims: claims(),
        now: NOW,
      }).kind,
    ).toBe('active');
  });

  it('12. fora do alcance do perfil TISS: nunca bloqueia', () => {
    expect(
      decideSessionLock({
        activity: act({ at: NOW - 600 * MIN, scope: false }),
        claims: claims(),
        now: NOW,
      }),
    ).toEqual({ kind: 'out_of_scope' });
  });

  it('6. login recente sem registro ainda: segue até a action gravar; login antigo sem registro: bloqueia', () => {
    expect(
      decideSessionLock({ activity: null, claims: claims({ authAt: NOW - 2 * MIN }), now: NOW }),
    ).toEqual({ kind: 'active', source: 'fresh_login' });
    expect(decideSessionLock({ activity: null, claims: claims(), now: NOW })).toEqual({
      kind: 'locked',
      reason: 'no_activity_record',
    });
    expect(
      decideSessionLock({ activity: null, claims: claims({ authAt: null }), now: NOW }).kind,
    ).toBe('locked');
  });

  it('11. registro de outra sessão (login anterior, sessão revogada) ou de outro usuário não vale', () => {
    const recent = act({ at: NOW - MIN });
    expect(
      decideSessionLock({ activity: recent, claims: claims({ sessionId: 'sess-2' }), now: NOW })
        .kind,
    ).toBe('locked');
    expect(
      decideSessionLock({ activity: recent, claims: claims({ sub: 'user-b' }), now: NOW }).kind,
    ).toBe('locked');
    expect(
      decideSessionLock({ activity: recent, claims: claims({ sessionId: null }), now: NOW }).kind,
    ).toBe('locked');
  });

  it('9. registro fora do alcance não destrava outro usuário (cookie de outra conta na mesma máquina)', () => {
    expect(
      decideSessionLock({
        activity: act({ uid: 'user-b', scope: false }),
        claims: claims(),
        now: NOW,
      }).kind,
    ).toBe('locked');
  });

  it('relógio: autenticação "no futuro" não vale como login recente', () => {
    expect(
      decideSessionLock({ activity: null, claims: claims({ authAt: NOW + 5 * MIN }), now: NOW })
        .kind,
    ).toBe('locked');
  });
});

describe('claims', () => {
  it('session_id e o maior amr.timestamp (em segundos no JWT)', () => {
    expect(
      sessionClaimsFrom({
        sub: 'u',
        session_id: 's',
        amr: [
          { method: 'password', timestamp: 1_700_000_000 },
          { method: 'totp', timestamp: 1_700_000_100 },
        ],
      }),
    ).toEqual({ sub: 'u', sessionId: 's', authenticatedAt: 1_700_000_100_000 });
    expect(sessionClaimsFrom({ sub: 'u' })).toEqual({
      sub: 'u',
      sessionId: null,
      authenticatedAt: null,
    });
  });

  it('session_id do access token recém-emitido', () => {
    const token = `h.${Buffer.from(JSON.stringify({ session_id: 'abc' })).toString('base64url')}.sig`;
    expect(sessionIdFromAccessToken(token)).toBe('abc');
    expect(sessionIdFromAccessToken('lixo')).toBeNull();
    expect(sessionIdFromAccessToken(undefined)).toBeNull();
  });
});
