import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  env: { SIGNUP_AUTH_ENABLED: true, SIGNUP_IDENTITY_ENABLED: true },
  transaction: vi.fn(),
}));
vi.mock('@/lib/env', () => ({ env: mocks.env }));
vi.mock('@/lib/db', () => ({ dbAdmin: { transaction: mocks.transaction } }));

import { signupDraftMutationSchema, writeSignupDraft } from './signup-draft';

const answers = {
  professionalsBand: '2_5',
  weeklyAppointmentsBand: '21_50',
  currentTooling: 'outro_sistema',
  discoverySource: 'indicacao_colega',
} as const;
const context = {
  userId: '11111111-1111-4111-8111-111111111111',
  email: 'verified@example.invalid',
  rawToken: 'a'.repeat(43),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.env.SIGNUP_AUTH_ENABLED = true;
  mocks.env.SIGNUP_IDENTITY_ENABLED = true;
});

describe('signup draft contract', () => {
  it.each([
    {
      mode: 'link',
      rowVersion: 5,
      ownerName: ' Ana ',
      clinicName: ' Clínica ',
      answers,
      accepted: true,
    },
    { mode: 'restart', ownerName: 'Ana', clinicName: 'Clínica', answers, accepted: true },
  ])('aceita %s, normaliza nomes e mantém respostas fechadas', (input) => {
    const parsed = signupDraftMutationSchema.parse(input);
    expect(parsed.ownerName).toBe('Ana');
    expect(parsed.clinicName).toBe('Clínica');
    expect(parsed.answers).toEqual(answers);
  });

  it.each([
    {},
    { mode: 'link', ownerName: 'Ana', clinicName: 'Clínica', answers, accepted: true },
    {
      mode: 'restart',
      rowVersion: 5,
      ownerName: 'Ana',
      clinicName: 'Clínica',
      answers,
      accepted: true,
    },
    { mode: 'restart', ownerName: 'Ana', clinicName: 'Clínica', answers, accepted: false },
    { mode: 'restart', ownerName: 'Ana\n', clinicName: 'Clínica', answers, accepted: true },
    {
      mode: 'restart',
      ownerName: 'Ana',
      clinicName: 'Clínica',
      answers: { ...answers, discoverySource: 'texto livre' },
      accepted: true,
    },
    {
      mode: 'restart',
      ownerName: 'Ana',
      clinicName: 'Clínica',
      answers,
      accepted: true,
      role: 'owner',
    },
  ])('recusa entrada fora do contrato sem transação %#', async (input) => {
    expect(signupDraftMutationSchema.safeParse(input).success).toBe(false);
    await expect(writeSignupDraft({ ...context, input })).rejects.toThrow('[signup] invalid_draft');
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each(['auth', 'identity'] as const)(
    'fecha gate %s antes de validar ou tocar DB',
    async (gate) => {
      if (gate === 'auth') mocks.env.SIGNUP_AUTH_ENABLED = false;
      if (gate === 'identity') mocks.env.SIGNUP_IDENTITY_ENABLED = false;
      await expect(writeSignupDraft({ ...context, input: {} })).resolves.toEqual({
        ok: false,
        reason: 'unavailable',
      });
      expect(mocks.transaction).not.toHaveBeenCalled();
    },
  );

  it('mapeia disputa unique direta ou embrulhada pelo Drizzle e propaga outros erros', async () => {
    const valid = {
      mode: 'restart',
      ownerName: 'Ana',
      clinicName: 'ClÃ­nica',
      answers,
      accepted: true,
    } as const;
    const unique = Object.assign(new Error('unique'), { code: '23505' });
    mocks.transaction.mockRejectedValueOnce(unique);
    await expect(writeSignupDraft({ ...context, input: valid })).resolves.toEqual({
      ok: false,
      reason: 'conflict',
    });

    mocks.transaction.mockRejectedValueOnce(
      Object.assign(new Error('query failed'), { cause: unique }),
    );
    await expect(writeSignupDraft({ ...context, input: valid })).resolves.toEqual({
      ok: false,
      reason: 'conflict',
    });

    const unavailable = new Error('database unavailable');
    mocks.transaction.mockRejectedValueOnce(unavailable);
    await expect(writeSignupDraft({ ...context, input: valid })).rejects.toBe(unavailable);
  });
});
