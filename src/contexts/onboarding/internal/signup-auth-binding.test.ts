import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/env', () => ({
  env: { MAGIC_TOKEN_SECRET: 'segredo-sintetico-do-handoff' },
}));

import {
  bindLegacyVerifiedSignupAppMetadata,
  createPendingSignupAppMetadata,
  deriveSignupHandoffCode,
  isPendingSignupUserBound,
  markSignupPasswordSet,
  readPendingSignupReference,
  readSignupAuthBinding,
  readSignupPasswordState,
  rebindPendingSignupAppMetadata,
  verifySignupHandoffCode,
} from './signup-auth-binding';

const signupRef = 'a'.repeat(64);
const attemptEpoch = Date.parse('2026-09-23T12:00:00.000Z');

describe('vínculo Auth do cadastro autônomo', () => {
  it('prende a conta passwordless à referência server-only e faz a transição uma vez', () => {
    const pending = { app_metadata: createPendingSignupAppMetadata(signupRef) };
    expect(isPendingSignupUserBound(pending, signupRef)).toBe(true);
    expect(isPendingSignupUserBound(pending, 'b'.repeat(64))).toBe(false);
    expect(readSignupPasswordState(pending, signupRef)).toBe('pending');
    expect(readPendingSignupReference(pending)).toBe(signupRef);

    const rebound = {
      app_metadata: rebindPendingSignupAppMetadata(pending, 'b'.repeat(64)),
    };
    expect(readSignupPasswordState(rebound, 'b'.repeat(64))).toBe('pending');
    expect(readSignupPasswordState(rebound, signupRef)).toBeNull();

    const completed = { app_metadata: markSignupPasswordSet(pending, signupRef) };
    expect(readSignupPasswordState(completed, signupRef)).toBe('set');
    expect(readSignupAuthBinding(completed)).toEqual({
      signupRef,
      passwordState: 'set',
    });
    expect(readPendingSignupReference(completed)).toBeNull();
    expect(isPendingSignupUserBound(completed, signupRef)).toBe(false);
    expect(markSignupPasswordSet(completed, signupRef)).toEqual(completed.app_metadata);
  });

  it('preserva metadata alheia ao instalar o marker legado verificado', () => {
    const legacy = { app_metadata: { provider: 'email' } };
    const adopted = bindLegacyVerifiedSignupAppMetadata(legacy, signupRef);
    expect(adopted).toMatchObject({
      provider: 'email',
      qoro_self_service_signup: {
        version: 1,
        kind: 'self_service',
        signup_ref: signupRef,
        password_state: 'pending',
      },
    });
    expect(() => bindLegacyVerifiedSignupAppMetadata({ app_metadata: adopted }, signupRef)).toThrow(
      '[signup]',
    );
  });

  it('deriva código humano determinístico, fora da referência, e compara sem coerção', () => {
    const code = deriveSignupHandoffCode(signupRef, attemptEpoch);
    expect(code).toMatch(/^\d{8}$/u);
    expect(code).not.toBe(signupRef.slice(0, 8));
    expect(deriveSignupHandoffCode(signupRef, attemptEpoch)).toBe(code);
    expect(deriveSignupHandoffCode(signupRef, attemptEpoch + 1)).not.toBe(code);
    expect(deriveSignupHandoffCode('b'.repeat(64), attemptEpoch)).not.toBe(code);
    expect(verifySignupHandoffCode(signupRef, attemptEpoch, code)).toBe(true);
    expect(verifySignupHandoffCode(signupRef, attemptEpoch + 1, code)).toBe(false);
    expect(verifySignupHandoffCode(signupRef, attemptEpoch, `${code.slice(0, 7)}x`)).toBe(false);
    expect(verifySignupHandoffCode(signupRef, attemptEpoch, ` ${code}`)).toBe(false);
  });

  it('recusa metadata moldável pelo cliente ou referência fora do contrato', () => {
    expect(
      isPendingSignupUserBound(
        {
          app_metadata: {
            qoro_self_service_signup: {
              version: 1,
              kind: 'self_service',
              signup_ref: signupRef,
              password_state: 'forged',
            },
          },
        },
        signupRef,
      ),
    ).toBe(false);
    expect(() => createPendingSignupAppMetadata('curta')).toThrow('[signup]');
    expect(verifySignupHandoffCode('curta', attemptEpoch, '12345678')).toBe(false);
  });
});
