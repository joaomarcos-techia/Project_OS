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
  getUser: vi.fn(),
  hashedEmails: [] as string[],
}));
vi.mock('@/lib/env', () => ({ env: mocks.env }));
vi.mock('@/lib/db', () => ({
  dbAdmin: { select: mocks.select, transaction: mocks.transaction },
}));
vi.mock('@/lib/auth/supabase-server', () => ({
  createServerClient: async () => ({ auth: { getUser: mocks.getUser } }),
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
  ensureSignupDraftForVerifiedEmail,
  readOwnedSignupReference,
  readSignupDraft,
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
const signupRef = 'd'.repeat(64);

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

function deleteChain() {
  return vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) });
}

/** Texto de qualquer estrutura, inclusive o objeto `sql` do drizzle (circular). */
function textoDe(valor: unknown, vistos = new Set<unknown>()): string {
  if (typeof valor === 'string') return valor;
  if (valor === null || typeof valor !== 'object') return '';
  if (vistos.has(valor)) return '';
  vistos.add(valor);
  return Object.values(valor as Record<string, unknown>)
    .map((item) => textoDe(item, vistos))
    .join(' ');
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
    const removeExpiredOwner = deleteChain();
    const tx = {
      delete: removeExpiredOwner,
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
    const deleteWhere = removeExpiredOwner.mock.results[0]?.value.where.mock.calls[0]?.[0];
    const deleteSql = textoDe(deleteWhere);
    expect(deleteSql).toContain('billing_attempt_state');
    expect(deleteSql).toContain('billing_attempted_at');
    expect(deleteSql).toContain('asaas_customer_id');
    expect(deleteSql).toContain('asaas_subscription_id');
    // A leitura autenticada não renova prazo nenhum: se o idle nascesse menor
    // que o absoluto, o cadastro recém-redigitado morreria antes do checkout.
    expect(values.idleExpiresAt).toEqual(values.absoluteExpiresAt);
  });
});

describe('referência autoritativa do draft vinculado', () => {
  it('lê a referência somente pelo owner e pelo HMAC do e-mail verificado', async () => {
    mocks.select.mockReturnValue(selectChain([{ signupRef, credentialState: 'completed' }]));

    await expect(readOwnedSignupReference(context.userId, context.email)).resolves.toEqual({
      ok: true,
      signupRef,
      credentialState: 'completed',
    });
    expect(mocks.hashedEmails).toEqual([context.email]);
  });

  it('distingue ausência, identidade inválida e indisponibilidade', async () => {
    mocks.select.mockReturnValueOnce(selectChain([]));
    await expect(readOwnedSignupReference(context.userId, context.email)).resolves.toEqual({
      ok: false,
      reason: 'gone',
    });

    await expect(readOwnedSignupReference('invalid', 'invalid')).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    });

    mocks.select.mockImplementationOnce(() => {
      throw new Error('database unavailable');
    });
    await expect(readOwnedSignupReference(context.userId, context.email)).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    });
  });
});

describe('claim cross-device do draft verificado', () => {
  it('é idempotente quando o usuário já possui o draft', async () => {
    const owned = selectChain([{ rowVersion: 8 }]);
    const removeExpiredOwner = deleteChain();
    const tx = {
      delete: removeExpiredOwner,
      select: vi.fn().mockReturnValue(owned),
      update: vi.fn(),
    };
    mocks.transaction.mockImplementationOnce(
      async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    );

    await expect(
      claimSignupDraftByVerifiedEmail(context.userId, context.email, signupRef),
    ).resolves.toEqual({
      ok: true,
      rowVersion: 8,
    });
    expect(owned.for).toHaveBeenCalledWith('update');
    expect(tx.delete).toHaveBeenCalledOnce();
    expect(tx.delete.mock.invocationCallOrder[0]).toBeLessThan(
      tx.select.mock.invocationCallOrder[0]!,
    );
    const deleteWhere = removeExpiredOwner.mock.results[0]?.value.where.mock.calls[0]?.[0];
    const deleteSql = textoDe(deleteWhere);
    expect(deleteSql).toContain('billing_attempt_state');
    expect(deleteSql).toContain('billing_attempted_at');
    expect(deleteSql).toContain('asaas_customer_id');
    expect(deleteSql).toContain('asaas_subscription_id');
    expect(tx.update).not.toHaveBeenCalled();
  });

  it('vincula por e-mail verificado o draft mais recente ainda dentro do teto absoluto', async () => {
    const owned = selectChain([]);
    const candidate = orderedSelectChain([{ id: 'draft-id', rowVersion: 5 }]);
    const claimed = updateChain([{ rowVersion: 6 }]);
    const tx = {
      delete: deleteChain(),
      select: vi.fn().mockReturnValueOnce(owned).mockReturnValueOnce(candidate),
      update: vi.fn().mockReturnValue(claimed),
    };
    mocks.transaction.mockImplementationOnce(
      async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    );

    await expect(
      claimSignupDraftByVerifiedEmail(context.userId, context.email, signupRef),
    ).resolves.toEqual({
      ok: true,
      rowVersion: 6,
    });
    expect(candidate.orderBy).toHaveBeenCalledOnce();
    expect(candidate.for).toHaveBeenCalledWith('update');
    expect(claimed.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'email_verified',
        authUserId: context.userId,
        authAttemptState: 'completed',
        rowVersion: expect.anything(),
      }),
    );
  });

  it('procura o candidato pelo HMAC do e-mail verificado, nunca pelo endereço em claro', async () => {
    const owned = selectChain([]);
    const candidate = orderedSelectChain([{ id: 'draft-id', rowVersion: 5 }]);
    const tx = {
      delete: deleteChain(),
      select: vi.fn().mockReturnValueOnce(owned).mockReturnValueOnce(candidate),
      update: vi.fn().mockReturnValue(updateChain([{ rowVersion: 6 }])),
    };
    mocks.transaction.mockImplementationOnce(
      async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    );

    await claimSignupDraftByVerifiedEmail(context.userId, context.email, signupRef);

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
      delete: deleteChain(),
      select: vi.fn().mockReturnValueOnce(owned).mockReturnValueOnce(candidate),
      update: vi.fn(),
    };
    mocks.transaction.mockImplementationOnce(
      async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    );

    await expect(
      claimSignupDraftByVerifiedEmail(context.userId, context.email, signupRef),
    ).resolves.toEqual({
      ok: false,
      reason: 'gone',
    });
    expect(tx.update).not.toHaveBeenCalled();
  });

  it('devolve conflito quando o CAS do candidato perde a corrida, sem sobrescrever', async () => {
    const owned = selectChain([]);
    const candidate = orderedSelectChain([{ id: 'draft-id', rowVersion: 5 }]);
    const tx = {
      delete: deleteChain(),
      select: vi.fn().mockReturnValueOnce(owned).mockReturnValueOnce(candidate),
      update: vi.fn().mockReturnValue(updateChain([])),
    };
    mocks.transaction.mockImplementationOnce(
      async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    );

    await expect(
      claimSignupDraftByVerifiedEmail(context.userId, context.email, signupRef),
    ).resolves.toEqual({
      ok: false,
      reason: 'conflict',
    });
  });

  it('traduz a disputa do unique de owner em conflito, não em erro cru', async () => {
    mocks.transaction.mockRejectedValueOnce(Object.assign(new Error('unique'), { code: '23505' }));

    await expect(
      claimSignupDraftByVerifiedEmail(context.userId, context.email, signupRef),
    ).resolves.toEqual({
      ok: false,
      reason: 'conflict',
    });
  });

  it.each(['auth', 'identity'] as const)('fecha gate %s antes de tocar o DB', async (gate) => {
    if (gate === 'auth') mocks.env.SIGNUP_AUTH_ENABLED = false;
    if (gate === 'identity') mocks.env.SIGNUP_IDENTITY_ENABLED = false;

    await expect(
      claimSignupDraftByVerifiedEmail(context.userId, context.email, signupRef),
    ).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('recusa identidade não verificada pelo contrato antes da transação', async () => {
    await expect(
      claimSignupDraftByVerifiedEmail('invalid-user', 'invalid-email', signupRef),
    ).resolves.toEqual({ ok: false, reason: 'unavailable' });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.hashedEmails).toEqual([]);
  });
});

describe('garantia idempotente do vínculo no callback', () => {
  it('recusa referência inválida antes de consultar ou abrir transação', async () => {
    await expect(readSignupDraft(context.userId, 'invalid-ref')).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    });
    await expect(
      claimSignupDraftByVerifiedEmail(context.userId, context.email, 'invalid-ref'),
    ).resolves.toEqual({ ok: false, reason: 'unavailable' });
    await expect(
      ensureSignupDraftForVerifiedEmail(context.userId, context.email, 'invalid-ref'),
    ).resolves.toEqual({ ok: false, reason: 'unavailable' });
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('sem referência não consulta nem reivindica draft', async () => {
    await expect(
      Reflect.apply(ensureSignupDraftForVerifiedEmail, undefined, [context.userId, context.email]),
    ).resolves.toEqual({ ok: false, reason: 'unavailable' });
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.hashedEmails).toEqual([]);
  });

  it('aceita o draft já vinculado sem abrir outra transação', async () => {
    const now = new Date('2026-09-22T12:00:00Z');
    mocks.select.mockReturnValue(
      selectChain([
        {
          rowVersion: 8,
          ownerName: 'Ana',
          clinicName: 'Clínica',
          ...answers,
          idleExpiresAt: now,
          absoluteExpiresAt: now,
        },
      ]),
    );

    await expect(
      ensureSignupDraftForVerifiedEmail(context.userId, context.email, signupRef),
    ).resolves.toEqual({ ok: true, rowVersion: 8 });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('preserva falha operacional como retryable para a página de destino', async () => {
    mocks.select.mockImplementation(() => {
      throw new Error('database unavailable');
    });

    await expect(
      ensureSignupDraftForVerifiedEmail(context.userId, context.email, signupRef),
    ).resolves.toEqual({ ok: false, reason: 'unavailable' });
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
        offerTrialEndsAt: null,
      },
    });
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it('mostra o fim absoluto da oferta nova a partir do Auth, sem reiniciar ao reler', async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: userId, created_at: '2026-10-19T13:45:00.000Z' } },
      error: null,
    });
    mocks.select
      .mockReturnValueOnce(
        selectChain([{ rowVersion: 7, clinicName: 'Clínica Sintética', selectedPlanId: null }]),
      )
      .mockReturnValueOnce(
        selectChain([
          { id: planId, code: 'consultorio_2026', name: 'Consultório', amount: '197.00' },
        ]),
      );

    const result = await readSignupPlan(userId);
    expect(result).toMatchObject({
      ok: true,
      state: { offerTrialEndsAt: '2026-11-02T13:45:00.000Z', trialDays: 14 },
    });
    expect(mocks.getUser).toHaveBeenCalledOnce();
  });

  it('mostra apenas a oferta versionada no cadastro quando ela convive com planos legados ativos', async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: userId, created_at: '2026-10-19T13:45:00.000Z' } },
      error: null,
    });
    mocks.select
      .mockReturnValueOnce(
        selectChain([{ rowVersion: 7, clinicName: 'Clínica Sintética', selectedPlanId: null }]),
      )
      .mockReturnValueOnce(
        selectChain([
          { id: 'legacy', code: 'solo', name: 'Solo', amount: '149.00' },
          { id: planId, code: 'consultorio_2026', name: 'Consultório', amount: '197.00' },
          {
            id: 'new-clinic',
            code: 'clinica_2026_2',
            name: 'Clínica · 2 médicos',
            amount: '397.00',
          },
          {
            id: 'extra-clinic',
            code: 'clinica_2026_3',
            name: 'Clínica · 3 médicos',
            amount: '544.00',
          },
        ]),
      );

    const result = await readSignupPlan(userId);
    expect(result).toMatchObject({
      ok: true,
      state: {
        trialDays: 14,
        plans: [
          { code: 'consultorio_2026', priceCents: 19700 },
          { code: 'clinica_2026_2', priceCents: 39700 },
        ],
      },
    });
  });

  it('não oferece o prazo novo quando o marco Auth não pode ser comprovado', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    mocks.select
      .mockReturnValueOnce(
        selectChain([{ rowVersion: 7, clinicName: 'Clínica Sintética', selectedPlanId: null }]),
      )
      .mockReturnValueOnce(
        selectChain([
          { id: planId, code: 'consultorio_2026', name: 'Consultório', amount: '197.00' },
        ]),
      );
    await expect(readSignupPlan(userId)).resolves.toEqual({ ok: false, reason: 'unavailable' });
  });

  it('salva plano ativo por CAS sem mudar o prazo do draft', async () => {
    const available = selectChain([{ id: planId, code: 'consultorio_2026' }]);
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
    expect(update.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ idleExpiresAt: expect.anything() }),
    );
  });

  it('recusa plano legado pela API quando a nova oferta já está ativa', async () => {
    const tx = {
      select: vi
        .fn()
        .mockReturnValueOnce(selectChain([{ id: planId, code: 'solo' }]))
        .mockReturnValueOnce(selectChain([{ id: 'new-offer' }])),
      update: vi.fn(),
    };
    mocks.transaction.mockImplementationOnce(
      async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    );

    await expect(writeSignupPlan(userId, { rowVersion: 7, planId })).resolves.toEqual({
      ok: false,
      reason: 'invalid_plan',
    });
    expect(tx.update).not.toHaveBeenCalled();
  });

  it('recusa compra de médico extra pelo cadastro mesmo com plano adicional ativo', async () => {
    const tx = {
      select: vi.fn().mockReturnValueOnce(selectChain([{ id: planId, code: 'clinica_2026_3' }])),
      update: vi.fn(),
    };
    mocks.transaction.mockImplementationOnce(
      async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    );

    await expect(writeSignupPlan(userId, { rowVersion: 7, planId })).resolves.toEqual({
      ok: false,
      reason: 'invalid_plan',
    });
    expect(tx.update).not.toHaveBeenCalled();
  });

  it('preserva o cadastro legado quando a nova oferta ainda está inativa', async () => {
    const tx = {
      select: vi
        .fn()
        .mockReturnValueOnce(selectChain([{ id: planId, code: 'solo' }]))
        .mockReturnValueOnce(selectChain([])),
      update: vi.fn().mockReturnValue(updateChain([{ rowVersion: 8, selectedPlanId: planId }])),
    };
    mocks.transaction.mockImplementationOnce(
      async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    );

    await expect(writeSignupPlan(userId, { rowVersion: 7, planId })).resolves.toEqual({
      ok: true,
      rowVersion: 8,
      selectedPlanId: planId,
    });
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
      planRows: [{ id: planId, code: 'consultorio_2026' }],
      savedRows: [],
      liveRows: [{ rowVersion: 8, selectedPlanId: planId, billingAttemptState: null }],
      expected: { ok: true, rowVersion: 8, selectedPlanId: planId },
    },
    ...(['reserved', 'active', 'creation_unknown'] as const).map((billingAttemptState) => ({
      name: `retry idempotente bloqueado com billing ${billingAttemptState}`,
      planRows: [{ id: planId, code: 'consultorio_2026' }],
      savedRows: [],
      liveRows: [{ rowVersion: 8, selectedPlanId: planId, billingAttemptState }],
      expected: { ok: false, reason: 'conflict' },
    })),
    {
      name: 'retry idempotente depois de falha definitiva',
      planRows: [{ id: planId, code: 'consultorio_2026' }],
      savedRows: [],
      liveRows: [{ rowVersion: 8, selectedPlanId: planId, billingAttemptState: 'failed' }],
      expected: { ok: true, rowVersion: 8, selectedPlanId: planId },
    },
    {
      name: 'CAS perdido',
      planRows: [{ id: planId, code: 'consultorio_2026' }],
      savedRows: [],
      liveRows: [{ rowVersion: 9, selectedPlanId: planId }],
      expected: { ok: false, reason: 'conflict' },
    },
    {
      name: 'draft vencido',
      planRows: [{ id: planId, code: 'consultorio_2026' }],
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
