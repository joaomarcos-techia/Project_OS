import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { hashEmail as HashEmail } from '@/lib/auth/email-hash';

const mocks = vi.hoisted(() => ({
  env: {
    SIGNUP_AUTH_ENABLED: true,
    SIGNUP_IDENTITY_ENABLED: true,
    LOGIN_HASH_PEPPER: 'synthetic-signup-draft-email-pepper',
    MAGIC_TOKEN_SECRET: 'synthetic-signup-draft-token-secret',
  },
  select: vi.fn(),
  transaction: vi.fn(),
  hashedEmails: [] as string[],
}));
vi.mock('@/lib/env', () => ({ env: mocks.env }));
vi.mock('@/lib/db', () => ({
  dbAdmin: { select: mocks.select, transaction: mocks.transaction },
}));
// Espia o HMAC sem trocá-lo: o que precisa ser provado é QUAL endereço vira
// chave de busca do draft, não o algoritmo — que continua o de produção.
vi.mock('@/lib/auth/email-hash', async (importOriginal) => {
  const actual = await importOriginal<{ hashEmail: typeof HashEmail }>();
  return {
    ...actual,
    hashEmail: (value: string) => {
      mocks.hashedEmails.push(value);
      return actual.hashEmail(value);
    },
  };
});

import {
  claimSignupDraftByVerifiedEmail,
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
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.env.SIGNUP_AUTH_ENABLED = true;
  mocks.env.SIGNUP_IDENTITY_ENABLED = true;
  mocks.hashedEmails.length = 0;
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

function orderedSelectChain(rows: unknown[]) {
  const chain = selectChain(rows);
  chain.orderBy.mockReturnValue(chain);
  return chain;
}

describe('signup draft contract', () => {
  it('aceita o recomeço explícito, normaliza nomes e mantém respostas fechadas', () => {
    const parsed = signupDraftMutationSchema.parse({
      ownerName: ' Ana ',
      clinicName: ' Clínica ',
      answers,
      accepted: true,
    });
    expect(parsed.ownerName).toBe('Ana');
    expect(parsed.clinicName).toBe('Clínica');
    expect(parsed.answers).toEqual(answers);
  });

  it.each([
    {},
    // `mode`/`rowVersion` eram o vínculo pelo cookie anônimo; não existem mais.
    {
      mode: 'link',
      rowVersion: 5,
      ownerName: 'Ana',
      clinicName: 'Clínica',
      answers,
      accepted: true,
    },
    { mode: 'restart', ownerName: 'Ana', clinicName: 'Clínica', answers, accepted: true },
    { rowVersion: 5, ownerName: 'Ana', clinicName: 'Clínica', answers, accepted: true },
    { ownerName: 'Ana', clinicName: 'Clínica', answers, accepted: false },
    { ownerName: 'Ana\n', clinicName: 'Clínica', answers, accepted: true },
    {
      ownerName: 'Ana',
      clinicName: 'Clínica',
      answers: { ...answers, discoverySource: 'texto livre' },
      accepted: true,
    },
    { ownerName: 'Ana', clinicName: 'Clínica', answers, accepted: true, role: 'owner' },
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
      ownerName: 'Ana',
      clinicName: 'Clínica',
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

  it('cria o recomeço com idle igual ao absoluto, para a redigitação não vencer em 15 min', async () => {
    const insertChain = {
      values: vi.fn(),
      returning: vi.fn().mockResolvedValue([{ rowVersion: 1 }]),
    };
    insertChain.values.mockReturnValue(insertChain);
    const tx = {
      delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
      select: vi.fn().mockReturnValue(selectChain([])),
      insert: vi.fn().mockReturnValue(insertChain),
    };
    mocks.transaction.mockImplementationOnce(
      async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    );

    await expect(
      writeSignupDraft({
        ...context,
        input: { ownerName: 'Ana', clinicName: 'Clínica', answers, accepted: true },
      }),
    ).resolves.toEqual({ ok: true, rowVersion: 1 });

    const values = insertChain.values.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(values.status).toBe('email_verified');
    expect(values.authUserId).toBe(context.userId);
    // A leitura autenticada não renova prazo nenhum: se o idle nascesse menor
    // que o absoluto, o cadastro recém-redigitado morreria antes do checkout.
    expect(values.idleExpiresAt).toEqual(values.absoluteExpiresAt);
  });
});

describe('claim cross-device do draft verificado', () => {
  it('é idempotente quando o usuário já possui o draft', async () => {
    const owned = selectChain([{ rowVersion: 8 }]);
    const tx = {
      select: vi.fn().mockReturnValue(owned),
      update: vi.fn(),
    };
    mocks.transaction.mockImplementationOnce(
      async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    );

    await expect(claimSignupDraftByVerifiedEmail(context.userId, context.email)).resolves.toEqual({
      ok: true,
      rowVersion: 8,
    });
    expect(owned.for).toHaveBeenCalledWith('update');
    expect(tx.update).not.toHaveBeenCalled();
  });

  it('vincula por e-mail verificado o draft mais recente ainda dentro do teto absoluto', async () => {
    const owned = selectChain([]);
    const candidate = orderedSelectChain([{ id: 'draft-id', rowVersion: 5 }]);
    const claimed = updateChain([{ rowVersion: 6 }]);
    const tx = {
      select: vi.fn().mockReturnValueOnce(owned).mockReturnValueOnce(candidate),
      update: vi.fn().mockReturnValue(claimed),
    };
    mocks.transaction.mockImplementationOnce(
      async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    );

    await expect(claimSignupDraftByVerifiedEmail(context.userId, context.email)).resolves.toEqual({
      ok: true,
      rowVersion: 6,
    });
    expect(candidate.orderBy).toHaveBeenCalledOnce();
    expect(candidate.for).toHaveBeenCalledWith('update');
    expect(claimed.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'email_verified',
        authUserId: context.userId,
        rowVersion: expect.anything(),
      }),
    );
  });

  it('procura o candidato pelo HMAC do e-mail verificado, nunca pelo endereço em claro', async () => {
    const owned = selectChain([]);
    const candidate = orderedSelectChain([{ id: 'draft-id', rowVersion: 5 }]);
    const tx = {
      select: vi.fn().mockReturnValueOnce(owned).mockReturnValueOnce(candidate),
      update: vi.fn().mockReturnValue(updateChain([{ rowVersion: 6 }])),
    };
    mocks.transaction.mockImplementationOnce(
      async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    );

    await claimSignupDraftByVerifiedEmail(context.userId, context.email);

    // Só o endereço devolvido por getUser() vira chave; nada além dele é
    // hasheado, e o claim não regrava e-mail, nome, resposta nem aceite.
    expect(mocks.hashedEmails).toEqual([context.email]);
    expect(tx.update.mock.results[0]?.value.set).toHaveBeenCalledWith(
      expect.not.objectContaining({ emailHash: expect.anything() }),
    );
  });

  it('não vincula nada quando nenhum draft vivo carrega aquele e-mail verificado', async () => {
    const owned = selectChain([]);
    const candidate = orderedSelectChain([]);
    const tx = {
      select: vi.fn().mockReturnValueOnce(owned).mockReturnValueOnce(candidate),
      update: vi.fn(),
    };
    mocks.transaction.mockImplementationOnce(
      async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    );

    await expect(claimSignupDraftByVerifiedEmail(context.userId, context.email)).resolves.toEqual({
      ok: false,
      reason: 'gone',
    });
    expect(tx.update).not.toHaveBeenCalled();
  });

  it('devolve conflito quando o CAS do candidato perde a corrida, sem sobrescrever', async () => {
    const owned = selectChain([]);
    const candidate = orderedSelectChain([{ id: 'draft-id', rowVersion: 5 }]);
    const tx = {
      select: vi.fn().mockReturnValueOnce(owned).mockReturnValueOnce(candidate),
      update: vi.fn().mockReturnValue(updateChain([])),
    };
    mocks.transaction.mockImplementationOnce(
      async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    );

    await expect(claimSignupDraftByVerifiedEmail(context.userId, context.email)).resolves.toEqual({
      ok: false,
      reason: 'conflict',
    });
  });

  it('traduz a disputa do unique de owner em conflito, não em erro cru', async () => {
    mocks.transaction.mockRejectedValueOnce(Object.assign(new Error('unique'), { code: '23505' }));

    await expect(claimSignupDraftByVerifiedEmail(context.userId, context.email)).resolves.toEqual({
      ok: false,
      reason: 'conflict',
    });
  });

  it.each(['auth', 'identity'] as const)('fecha gate %s antes de tocar o DB', async (gate) => {
    if (gate === 'auth') mocks.env.SIGNUP_AUTH_ENABLED = false;
    if (gate === 'identity') mocks.env.SIGNUP_IDENTITY_ENABLED = false;

    await expect(claimSignupDraftByVerifiedEmail(context.userId, context.email)).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('recusa identidade não verificada pelo contrato antes da transação', async () => {
    await expect(claimSignupDraftByVerifiedEmail('invalid-user', 'invalid-email')).resolves.toEqual(
      { ok: false, reason: 'unavailable' },
    );
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.hashedEmails).toEqual([]);
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
