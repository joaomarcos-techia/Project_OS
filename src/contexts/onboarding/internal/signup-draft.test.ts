import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  env: { SIGNUP_AUTH_ENABLED: true, SIGNUP_IDENTITY_ENABLED: true },
  select: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock('@/lib/env', () => ({ env: mocks.env }));
vi.mock('@/lib/db', () => ({
  dbAdmin: { select: mocks.select, transaction: mocks.transaction },
}));

import {
  readSignupPlan,
  signupDraftMutationSchema,
  signupPlanMutationSchema,
  writeSignupDraft,
  writeSignupPlan,
} from './signup-draft';

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

function selectChain(rows: unknown[]) {
  const chain = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
    for: vi.fn(),
    limit: vi.fn(),
    orderBy: vi.fn(),
  };
  chain.from.mockReturnValue(chain);
  chain.innerJoin.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.for.mockReturnValue(chain);
  chain.limit.mockResolvedValue(rows);
  chain.orderBy.mockResolvedValue(rows);
  return chain;
}

function updateChain(rows: unknown[]) {
  const chain = { set: vi.fn(), where: vi.fn(), returning: vi.fn() };
  chain.set.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.returning.mockResolvedValue(rows);
  return chain;
}

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

describe('signup plan contract O-4', () => {
  const planId = '22222222-2222-4222-8222-222222222222';
  const userId = context.userId;

  it('aceita somente planId e rowVersion; preço, trial e campanha são server-side', () => {
    expect(signupPlanMutationSchema.parse({ rowVersion: 7, planId })).toEqual({
      rowVersion: 7,
      planId,
    });
    for (const extra of [
      { priceCents: 1 },
      { trialDays: 999 },
      { campaignCode: 'fundador' },
      { ownerName: 'Pessoa' },
    ]) {
      expect(signupPlanMutationSchema.safeParse({ rowVersion: 7, planId, ...extra }).success).toBe(
        false,
      );
    }
  });

  it('lê o draft do owner e converte numeric em centavos sem usar campanha', async () => {
    mocks.select
      .mockReturnValueOnce(
        selectChain([{ rowVersion: 7, clinicName: 'Clínica Sintética', selectedPlanId: null }]),
      )
      .mockReturnValueOnce(
        selectChain([
          {
            id: planId,
            code: 'essencial',
            name: 'Essencial',
            amount: '149.90',
          },
        ]),
      );

    await expect(readSignupPlan(userId)).resolves.toEqual({
      ok: true,
      state: {
        status: 'email_verified',
        rowVersion: 7,
        clinicName: 'Clínica Sintética',
        selectedPlanId: null,
        plans: [
          {
            id: planId,
            code: 'essencial',
            name: 'Essencial',
            priceCents: 14990,
            cycle: 'monthly',
          },
        ],
        trialDays: 7,
      },
    });
  });

  it('salva plano ativo por CAS e renova somente o idle do mesmo draft', async () => {
    const available = selectChain([{ id: planId }]);
    const update = updateChain([{ rowVersion: 8, selectedPlanId: planId }]);
    const tx = {
      select: vi.fn().mockReturnValue(available),
      update: vi.fn().mockReturnValue(update),
    };
    mocks.transaction.mockImplementationOnce(
      async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    );

    await expect(writeSignupPlan(userId, { rowVersion: 7, planId })).resolves.toEqual({
      ok: true,
      rowVersion: 8,
      selectedPlanId: planId,
    });
    expect(available.for).toHaveBeenCalledWith('share');
    expect(tx.update).toHaveBeenCalledTimes(1);
    expect(update.set).toHaveBeenCalledWith(
      expect.objectContaining({ selectedPlanId: planId, rowVersion: expect.anything() }),
    );
  });

  it.each([
    {
      name: 'plano inativo',
      planRows: [],
      savedRows: [],
      liveRows: [],
      expected: { ok: false, reason: 'invalid_plan' },
    },
    {
      name: 'retry idempotente',
      planRows: [{ id: planId }],
      savedRows: [],
      liveRows: [{ rowVersion: 8, selectedPlanId: planId }],
      expected: { ok: true, rowVersion: 8, selectedPlanId: planId },
    },
    {
      name: 'CAS perdido',
      planRows: [{ id: planId }],
      savedRows: [],
      liveRows: [{ rowVersion: 9, selectedPlanId: planId }],
      expected: { ok: false, reason: 'conflict' },
    },
    {
      name: 'draft vencido',
      planRows: [{ id: planId }],
      savedRows: [],
      liveRows: [],
      expected: { ok: false, reason: 'gone' },
    },
  ])(
    'resolve $name sem aceitar estado do cliente',
    async ({ planRows, savedRows, liveRows, expected }) => {
      const txSelect = vi.fn().mockReturnValueOnce(selectChain(planRows));
      if (planRows.length > 0 && savedRows.length === 0) {
        txSelect.mockReturnValueOnce(selectChain(liveRows));
      }
      const tx = {
        select: txSelect,
        update: vi.fn().mockReturnValue(updateChain(savedRows)),
      };
      mocks.transaction.mockImplementationOnce(
        async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
      );

      await expect(writeSignupPlan(userId, { rowVersion: 7, planId })).resolves.toEqual(expected);
    },
  );

  it('fecha gates e recusa owner/body inválidos antes de abrir transação', async () => {
    mocks.env.SIGNUP_AUTH_ENABLED = false;
    await expect(writeSignupPlan(userId, { rowVersion: 7, planId })).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    });
    mocks.env.SIGNUP_AUTH_ENABLED = true;
    await expect(writeSignupPlan('invalid-user', { rowVersion: 7, planId })).rejects.toThrow(
      '[signup] invalid_plan_owner',
    );
    await expect(writeSignupPlan(userId, { rowVersion: 7, planId, priceCents: 1 })).rejects.toThrow(
      '[signup] invalid_plan',
    );
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
