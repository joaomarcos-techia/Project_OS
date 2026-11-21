import { describe, expect, it } from 'vitest';

import { signupPasswordProblems } from '@/lib/auth/signup-password';

import {
  INACTIVITY_LIMIT_MS,
  derivePasswordVerifier,
  isRecentlyUsedPassword,
  isUserActivityRequest,
  passwordAgeDecision,
  sessionActivityDecision,
  tissPasswordProblems,
} from './tiss-policies';

const PEPPER = 'p'.repeat(32);
const headers = (h: Record<string, string>) => ({ get: (n: string) => h[n] ?? null });
const d = (s: string) => new Date(`${s}T12:00:00Z`);

describe('R67 — composição da senha', () => {
  it('exige símbolo além da regra atual; nunca afrouxa a regra atual', () => {
    expect(tissPasswordProblems('Senha123')).toEqual(['symbol']);
    expect(tissPasswordProblems('Senha12#')).toEqual([]);
    expect(tissPasswordProblems('Senha12€')).toEqual([]);
    for (const p of ['abc', 'senha12#', 'SENHA12#', 'Senha #1x', '']) {
      expect(tissPasswordProblems(p)).toEqual(expect.arrayContaining(signupPasswordProblems(p)));
    }
  });
});

describe('R81 — prazo de troca', () => {
  const activated = d('2026-12-01');
  it('conta da ativação para quem nunca trocou (carência de 90 dias)', () => {
    expect(
      passwordAgeDecision({
        lastChangedAt: null,
        profileActivatedAt: activated,
        now: d('2027-01-30'),
      }),
    ).toEqual({ kind: 'ok', daysLeft: 30 });
    expect(
      passwordAgeDecision({
        lastChangedAt: null,
        profileActivatedAt: activated,
        now: d('2027-02-15'),
      }).kind,
    ).toBe('warn');
    expect(
      passwordAgeDecision({
        lastChangedAt: null,
        profileActivatedAt: activated,
        now: d('2027-03-02'),
      }).kind,
    ).toBe('must_change');
  });
  it('troca antiga, anterior à ativação, não força troca imediata', () => {
    expect(
      passwordAgeDecision({
        lastChangedAt: d('2025-01-01'),
        profileActivatedAt: activated,
        now: activated,
      }).kind,
    ).toBe('ok');
  });
  it('troca recente reinicia o prazo', () => {
    expect(
      passwordAgeDecision({
        lastChangedAt: d('2027-03-01'),
        profileActivatedAt: activated,
        now: d('2027-03-02'),
      }),
    ).toEqual({ kind: 'ok', daysLeft: 89 });
  });
});

describe('R82 — histórico com verificador irreversível', () => {
  it('detecta reuso, aceita senha nova, e o verificador não contém a senha', async () => {
    const v = await derivePasswordVerifier('Antiga12#', PEPPER);
    expect(JSON.stringify(v)).not.toContain('Antiga12#');
    expect(await isRecentlyUsedPassword('Antiga12#', [v], PEPPER)).toBe(true);
    expect(await isRecentlyUsedPassword('Nova1234#', [v], PEPPER)).toBe(false);
    expect(await isRecentlyUsedPassword('Antiga12#', [v], 'q'.repeat(32))).toBe(false);
  });
  it('mesma senha gera verificadores diferentes (sal aleatório)', async () => {
    const [a, b] = await Promise.all([
      derivePasswordVerifier('X1y2z3#w', PEPPER),
      derivePasswordVerifier('X1y2z3#w', PEPPER),
    ]);
    expect(a.hash).not.toBe(b.hash);
  });
  it('recusa pepper curto', async () => {
    await expect(derivePasswordVerifier('X1y2z3#w', 'curto')).rejects.toThrow(/pepper/u);
  });
});

describe('R83 — inatividade', () => {
  it('só interação humana renova; polling e pedido sem marca não renovam', () => {
    expect(isUserActivityRequest(headers({ 'x-qoro-activity': '1' }))).toBe(true);
    expect(
      isUserActivityRequest(headers({ 'x-qoro-activity': '1', 'x-qoro-background': '1' })),
    ).toBe(false);
    expect(isUserActivityRequest(headers({}))).toBe(false);
  });
  it('bloqueia aos 10 minutos e avisa aos 9; bloqueio é definitivo até reautenticar', () => {
    const last = new Date('2026-11-11T10:00:00Z');
    const at = (ms: number) => new Date(last.getTime() + ms);
    expect(
      sessionActivityDecision({ lastActivityAt: last, lockedAt: null, now: at(8 * 60_000) }),
    ).toBe('active');
    expect(
      sessionActivityDecision({ lastActivityAt: last, lockedAt: null, now: at(9 * 60_000) }),
    ).toBe('warn');
    expect(
      sessionActivityDecision({
        lastActivityAt: last,
        lockedAt: null,
        now: at(INACTIVITY_LIMIT_MS),
      }),
    ).toBe('locked');
    expect(
      sessionActivityDecision({
        lastActivityAt: at(INACTIVITY_LIMIT_MS),
        lockedAt: at(1),
        now: at(INACTIVITY_LIMIT_MS),
      }),
    ).toBe('locked');
  });
});
