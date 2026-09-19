import { beforeEach, describe, expect, it, vi } from 'vitest';

const { env, update, select, set } = vi.hoisted(() => ({
  env: {
    SIGNUP_AUTH_ENABLED: true,
    SIGNUP_IDENTITY_ENABLED: true,
    MAGIC_TOKEN_SECRET: 'synthetic-signup-only-secret',
    LOGIN_HASH_PEPPER: 'synthetic-signup-only-email-pepper',
  },
  update: vi.fn(),
  select: vi.fn(),
  set: vi.fn(),
}));
vi.mock('@/lib/env', () => ({ env }));
vi.mock('@/lib/db', () => ({ dbAdmin: { update, select } }));

import {
  abortSignupAuthAttempt,
  finishSignupAuthAttempt,
  finishSignupResendAttempt,
  reserveSignupAuthAttempt,
  reserveSignupResendAttempt,
  signupAuthSchema,
  signupResendSchema,
} from './signup-session';

const token = 'a'.repeat(43);
const valid = {
  rowVersion: 3,
  email: 'synthetic@example.invalid',
  password: 'Abcdef1!',
  accepted: true,
};
const validResend = {
  rowVersion: 5,
  email: valid.email,
  accepted: true,
};
beforeEach(() => {
  vi.clearAllMocks();
  env.SIGNUP_AUTH_ENABLED = true;
  env.SIGNUP_IDENTITY_ENABLED = true;
  set.mockReturnValue({ where: () => ({ returning: async () => [{ rowVersion: 4 }] }) });
  update.mockReturnValue({ set });
  select.mockReturnValue({ from: () => ({ where: () => ({ limit: async () => [] }) }) });
});

describe('senha e contrato inicial', () => {
  it.each([
    'abcdef1!',
    'ABCDEF1!',
    'Abcdefg!',
    'Aa1!abc',
    'Aa1!ab😀',
    'Aa1!abc\n',
    'Aa1!abc\u0085',
    ' Aa1!aaa ',
    'Aa1     ',
    '',
    'Áá１!aaaa',
    'Abc1!' + 'a'.repeat(68),
  ])('recusa senha fora da política sem DB/Auth', async (password) => {
    expect(signupAuthSchema.safeParse({ ...valid, password }).success).toBe(false);
    await expect(reserveSignupAuthAttempt(token, { ...valid, password })).rejects.toThrow(
      '[signup] invalid_auth',
    );
    expect(update).not.toHaveBeenCalled();
  });
  it.each(['Abcdef1!', 'Abcdef12', 'Aa1ááááá', 'Aa1' + 'a'.repeat(69)])(
    'aceita maiúscula, minúscula e número sem exigir símbolo nem normalizar',
    (password) => {
      expect(signupAuthSchema.parse({ ...valid, password }).password).toBe(password);
    },
  );
  it.each([
    { accepted: false },
    { accepted: undefined },
    { rowVersion: 0 },
    { rowVersion: 2_147_483_646 },
    { email: 'invalid' },
    { authUserId: 'forged' },
    { ownerName: 'not part of this request' },
    { captchaToken: '' },
    { captchaToken: 'x'.repeat(2049) },
  ])('recusa envelope inválido %j', async (overrides) => {
    await expect(reserveSignupAuthAttempt(token, { ...valid, ...overrides })).rejects.toThrow(
      '[signup] invalid_auth',
    );
    expect(update).not.toHaveBeenCalled();
  });
  it.each(['auth', 'identity', 'token'])('fecha gate/token antes do DB: %s', async (kind) => {
    if (kind === 'auth') env.SIGNUP_AUTH_ENABLED = false;
    if (kind === 'identity') env.SIGNUP_IDENTITY_ENABLED = false;
    expect(await reserveSignupAuthAttempt(kind === 'token' ? 'invalid' : token, valid)).toEqual({
      ok: false,
      reason: kind === 'token' ? 'gone' : 'unavailable',
    });
    expect(update).not.toHaveBeenCalled();
  });
  it('reserva só metadados da intenção, sem credenciais/PII retornadas', async () => {
    expect(await reserveSignupAuthAttempt(token, { ...valid, captchaToken: 'fresh' })).toEqual({
      ok: true,
      rowVersion: 4,
    });
    const fields = set.mock.calls[0]?.[0];
    expect(fields).toMatchObject({
      status: 'email_pending',
      authAttemptKind: 'initial',
      authAttemptState: 'reserved',
    });
    expect(Object.keys(fields).sort()).toEqual([
      'authAttemptKind',
      'authAttemptState',
      'authAttemptedAt',
      'idleExpiresAt',
      'rowVersion',
      'status',
    ]);
    expect(Object.values(fields)).not.toContain(valid.password);
    expect(Object.values(fields)).not.toContain(valid.email);
  });
  it.each(['completed', 'uncertain'] as const)(
    'finalização %s estende a espera somente até o teto absoluto',
    async (outcome) => {
      expect(await finishSignupAuthAttempt(token, 4, outcome)).toEqual({
        ok: true,
        rowVersion: 4,
      });
      expect(Object.keys(set.mock.calls[0]?.[0]).sort()).toEqual([
        'authAttemptState',
        'idleExpiresAt',
        'rowVersion',
      ]);
    },
  );
  it.each([0, 1.5, 2_147_483_647])('recusa versão de resultado inválida %s', async (version) => {
    await expect(finishSignupAuthAttempt(token, version, 'completed')).rejects.toThrow(
      '[signup] invalid_auth_result',
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('devolve a reserva ao estado anterior, sem tocar em prazo nem em staging', async () => {
    expect(await abortSignupAuthAttempt(token, 4)).toEqual({ ok: true, rowVersion: 4 });

    const fields = set.mock.calls[0]?.[0] as Record<string, unknown>;
    // Exatamente o estado de antes da reserva: etapa de volta e tentativa
    // zerada. Os CHECKs de 0099 exigem staging/aceite intactos, e a 0100 aceita
    // a tentativa toda nula — por isso nada disso é regravado aqui.
    expect(Object.keys(fields).sort()).toEqual([
      'authAttemptKind',
      'authAttemptState',
      'authAttemptedAt',
      'rowVersion',
      'status',
    ]);
    expect(fields.status).toBe('identity_pending');
    expect(fields.authAttemptKind).toBeNull();
    expect(fields.authAttemptState).toBeNull();
    expect(fields.authAttemptedAt).toBeNull();
    // Abortar não é atividade humana nova: nenhum dos dois prazos se move.
    expect(fields).not.toHaveProperty('idleExpiresAt');
    expect(fields).not.toHaveProperty('absoluteExpiresAt');
    expect(Object.values(fields)).not.toContain(valid.password);
    expect(Object.values(fields)).not.toContain(valid.email);
  });

  it('distingue linha viva de linha morta quando o CAS de devolução não casa', async () => {
    set.mockReturnValue({ where: () => ({ returning: async () => [] }) });

    select.mockReturnValue({
      from: () => ({ where: () => ({ limit: async () => [{ rowVersion: 9 }] }) }),
    });
    expect(await abortSignupAuthAttempt(token, 4)).toEqual({ ok: false, reason: 'conflict' });

    select.mockReturnValue({ from: () => ({ where: () => ({ limit: async () => [] }) }) });
    expect(await abortSignupAuthAttempt(token, 4)).toEqual({ ok: false, reason: 'gone' });
  });

  it.each([0, 1.5, 2_147_483_647])('recusa versão de devolução inválida %s', async (version) => {
    await expect(abortSignupAuthAttempt(token, version)).rejects.toThrow(
      '[signup] invalid_auth_result',
    );
    expect(update).not.toHaveBeenCalled();
  });

  it.each(['auth', 'identity'] as const)(
    'fecha gate %s antes de devolver reserva',
    async (gate) => {
      if (gate === 'auth') env.SIGNUP_AUTH_ENABLED = false;
      if (gate === 'identity') env.SIGNUP_IDENTITY_ENABLED = false;
      expect(await abortSignupAuthAttempt(token, 4)).toEqual({
        ok: false,
        reason: 'unavailable',
      });
      expect(update).not.toHaveBeenCalled();
    },
  );

  it('trata token malformado como sessão inexistente, sem tocar no banco', async () => {
    expect(await abortSignupAuthAttempt('curto-demais', 4)).toEqual({
      ok: false,
      reason: 'gone',
    });
    expect(update).not.toHaveBeenCalled();
  });
});

describe('reenvio explícito', () => {
  it.each([
    { rowVersion: undefined },
    { accepted: false },
    { rowVersion: 0 },
    { rowVersion: 2_147_483_646 },
    { email: 'invalid' },
    { password: 'Abcdef1!' },
    { authUserId: 'forged' },
    { captchaToken: '' },
    { captchaToken: 'x'.repeat(2049) },
  ])('recusa envelope fora do contrato sem DB: %j', async (overrides) => {
    const input = { ...validResend, ...overrides };
    expect(signupResendSchema.safeParse(input).success).toBe(false);
    await expect(reserveSignupResendAttempt(token, input)).rejects.toThrow(
      '[signup] invalid_resend',
    );
    expect(update).not.toHaveBeenCalled();
  });

  it.each(['auth', 'identity', 'token'])('fecha gate/token antes do DB: %s', async (kind) => {
    if (kind === 'auth') env.SIGNUP_AUTH_ENABLED = false;
    if (kind === 'identity') env.SIGNUP_IDENTITY_ENABLED = false;
    await expect(
      reserveSignupResendAttempt(kind === 'token' ? 'invalid' : token, validResend),
    ).resolves.toEqual({
      ok: false,
      reason: kind === 'token' ? 'gone' : 'unavailable',
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('reserva somente metadados resend e não renova TTL', async () => {
    await expect(reserveSignupResendAttempt(token, validResend)).resolves.toEqual({
      ok: true,
      rowVersion: 4,
    });
    const fields = set.mock.calls[0]?.[0];
    expect(fields).toMatchObject({ authAttemptKind: 'resend', authAttemptState: 'reserved' });
    expect(Object.keys(fields).sort()).toEqual([
      'authAttemptKind',
      'authAttemptState',
      'authAttemptedAt',
      'rowVersion',
    ]);
    expect(Object.values(fields)).not.toContain(validResend.email);
  });

  it('devolve cooldown calculado sem segunda escrita', async () => {
    set.mockReturnValueOnce({ where: () => ({ returning: async () => [] }) });
    select.mockReturnValueOnce({
      from: () => ({ where: () => ({ limit: async () => [{ retryAfter: 37 }] }) }),
    });
    await expect(reserveSignupResendAttempt(token, validResend)).resolves.toEqual({
      ok: false,
      reason: 'cooldown',
      retryAfter: 37,
    });
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('distingue conflito vivo de sessão morta depois do CAS', async () => {
    set.mockReturnValue({ where: () => ({ returning: async () => [] }) });
    const rows = [[], [{ rowVersion: 6 }]];
    select.mockImplementation(() => ({
      from: () => ({ where: () => ({ limit: async () => rows.shift() ?? [] }) }),
    }));
    await expect(reserveSignupResendAttempt(token, validResend)).resolves.toEqual({
      ok: false,
      reason: 'conflict',
    });
    select.mockImplementation(() => ({
      from: () => ({ where: () => ({ limit: async () => [] }) }),
    }));
    await expect(reserveSignupResendAttempt(token, validResend)).resolves.toEqual({
      ok: false,
      reason: 'gone',
    });
  });

  it.each(['completed', 'uncertain'] as const)(
    'finalização resend %s só muda estado e versão',
    async (outcome) => {
      await expect(finishSignupResendAttempt(token, 6, outcome)).resolves.toEqual({
        ok: true,
        rowVersion: 4,
      });
      expect(Object.keys(set.mock.calls[0]?.[0]).sort()).toEqual([
        'authAttemptState',
        'rowVersion',
      ]);
    },
  );

  it.each([0, 1.5, 2_147_483_647])('recusa versão final inválida %s', async (version) => {
    await expect(finishSignupResendAttempt(token, version, 'completed')).rejects.toThrow(
      '[signup] invalid_resend_result',
    );
    expect(update).not.toHaveBeenCalled();
  });
});
