import { describe, expect, it, vi } from 'vitest';

import {
  recordTissPasswordChange,
  tissPasswordAge,
  tissPasswordReuseError,
  type PasswordHistoryStore,
} from './password-lifecycle';
import { derivePasswordVerifier, type PasswordVerifier } from './tiss-policies';

const PEPPER = 'p'.repeat(40);
const ON = { TISS_SECURITY_PROFILE_ENFORCE: 'true', PASSWORD_HISTORY_PEPPER: PEPPER };
const inTiss = async () => ({ moduleEnabled: true, hasTissData: true });
const outTiss = async () => ({ moduleEnabled: false, hasTissData: false });

function memoryStore(initial: PasswordVerifier[] = [], lastChangedAt: Date | null = null) {
  const verifiers = [...initial];
  const store: PasswordHistoryStore = {
    read: vi.fn(async () => ({ verifiers: [...verifiers], lastChangedAt })),
    append: vi.fn(async (_u, v) => {
      verifiers.unshift(v);
    }),
  };
  return { store, verifiers };
}

describe('S4 — reuso das 10 últimas (requisito 82)', () => {
  it('perfil desligado: não lê histórico nem recusa', async () => {
    const { store } = memoryStore();
    expect(
      await tissPasswordReuseError('u1', 'c1', 'Senha1!', {
        readFootprint: inTiss,
        store,
        env: {},
      }),
    ).toBeNull();
    expect(store.read).not.toHaveBeenCalled();
  });

  it('no alcance: recusa senha que está no histórico; aceita senha nova', async () => {
    const old = await derivePasswordVerifier('Antiga1!', PEPPER);
    const { store } = memoryStore([old]);
    expect(
      await tissPasswordReuseError('u1', 'c1', 'Antiga1!', {
        readFootprint: inTiss,
        store,
        env: ON,
      }),
    ).toMatch(/diferente das 10 últimas/u);
    expect(
      await tissPasswordReuseError('u1', 'c1', 'Nova2025!', {
        readFootprint: inTiss,
        store,
        env: ON,
      }),
    ).toBeNull();
  });

  it('fora do alcance (clínica sem dado TISS): nada muda', async () => {
    const old = await derivePasswordVerifier('Antiga1!', PEPPER);
    const { store } = memoryStore([old]);
    expect(
      await tissPasswordReuseError('u1', 'c2', 'Antiga1!', {
        readFootprint: outTiss,
        store,
        env: ON,
      }),
    ).toBeNull();
  });

  it('sem pepper ou com o histórico ilegível: recusa com erro genérico (nunca "sem histórico")', async () => {
    const { store } = memoryStore();
    const noPepper = { TISS_SECURITY_PROFILE_ENFORCE: 'true' };
    expect(
      await tissPasswordReuseError('u1', 'c1', 'X1!aaaaa', {
        readFootprint: inTiss,
        store,
        env: noPepper,
      }),
    ).toMatch(/Não foi possível validar/u);
    const broken: PasswordHistoryStore = {
      read: vi.fn(async () => Promise.reject(new Error('db'))),
      append: vi.fn(),
    };
    expect(
      await tissPasswordReuseError('u1', 'c1', 'X1!aaaaa', {
        readFootprint: inTiss,
        store: broken,
        env: ON,
      }),
    ).toMatch(/Não foi possível validar/u);
  });

  it('registra a troca como verificador (nunca a senha) só no alcance', async () => {
    const { store, verifiers } = memoryStore();
    expect(
      await recordTissPasswordChange('u1', 'c1', 'Nova2025!', {
        readFootprint: inTiss,
        store,
        env: ON,
      }),
    ).toBe(true);
    expect(JSON.stringify(verifiers)).not.toContain('Nova2025!');
    expect(verifiers[0]).toMatchObject({ alg: 'scrypt' });
    expect(
      await recordTissPasswordChange('u1', 'c2', 'Nova2025!', {
        readFootprint: outTiss,
        store,
        env: ON,
      }),
    ).toBe(false);
  });
});

describe('S4 — prazo de 90 dias (requisito 81)', () => {
  const activated = '2026-12-01T00:00:00Z';
  const env = { ...ON, TISS_SECURITY_PROFILE_ACTIVATED_AT: activated };
  const at = (iso: string) => () => new Date(iso);

  it('carência: sem troca registrada, conta da ativação (90 dias), nunca troca imediata', async () => {
    const { store } = memoryStore([], null);
    expect(
      await tissPasswordAge('u1', 'c1', {
        readFootprint: inTiss,
        store,
        env,
        now: at('2027-01-15T00:00:00Z'),
      }),
    ).toMatchObject({ kind: 'ok' });
    expect(
      await tissPasswordAge('u1', 'c1', {
        readFootprint: inTiss,
        store,
        env,
        now: at('2027-03-05T00:00:00Z'),
      }),
    ).toEqual({ kind: 'must_change' });
  });

  it('troca registrada depois da ativação reinicia o prazo; aviso a partir do dia 75', async () => {
    const { store } = memoryStore([], new Date('2027-03-01T00:00:00Z'));
    expect(
      await tissPasswordAge('u1', 'c1', {
        readFootprint: inTiss,
        store,
        env,
        now: at('2027-05-20T00:00:00Z'),
      }),
    ).toMatchObject({ kind: 'warn' });
    expect(
      await tissPasswordAge('u1', 'c1', {
        readFootprint: inTiss,
        store,
        env,
        now: at('2027-06-05T00:00:00Z'),
      }),
    ).toEqual({ kind: 'must_change' });
  });

  it('fora do alcance, sem data de ativação ou leitura falhando: não decide (não tranca a equipe)', async () => {
    const { store } = memoryStore();
    expect(await tissPasswordAge('u1', 'c2', { readFootprint: outTiss, store, env })).toBeNull();
    expect(await tissPasswordAge('u1', 'c1', { readFootprint: inTiss, store, env: ON })).toBeNull();
    const broken: PasswordHistoryStore = {
      read: vi.fn(async () => Promise.reject(new Error('db'))),
      append: vi.fn(),
    };
    expect(
      await tissPasswordAge('u1', 'c1', { readFootprint: inTiss, store: broken, env }),
    ).toBeNull();
  });
});
