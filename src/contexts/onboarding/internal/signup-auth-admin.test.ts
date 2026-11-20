import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUserById: vi.fn(),
  readAuthoritativeProfile: vi.fn(),
  readSignupDeliveryAttemptState: vi.fn(),
  readOwnedSignupReference: vi.fn(),
  resolveReady: vi.fn(),
  updateUserById: vi.fn(),
}));

vi.mock('@/lib/auth/supabase-admin', () => ({
  createAdminClient: () => ({
    auth: { admin: { getUserById: mocks.getUserById, updateUserById: mocks.updateUserById } },
  }),
}));
vi.mock('./signup-draft', () => ({
  readOwnedSignupReference: mocks.readOwnedSignupReference,
  resumeRetainedOwnedSignupDraft: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./signup-session', () => ({
  readSignupDeliveryAttemptState: mocks.readSignupDeliveryAttemptState,
}));
vi.mock('@/lib/auth/tenant-context', () => ({
  readAuthoritativeProfile: mocks.readAuthoritativeProfile,
}));
vi.mock('@/lib/auth/pretenant-onboarding', () => ({
  resolveReadyPreTenantOnboarding: mocks.resolveReady,
}));

import {
  createPendingSignupAppMetadata,
  markPasswordAuthenticatedSignupReady,
} from './signup-auth-binding';
import {
  validateLegacySignupDeliveryCandidate,
  ensurePasswordAuthenticatedSignupAuthBinding,
  ensureReadyOwnedSignupAuthBinding,
  ensureVerifiedSignupAuthBinding,
  resolveSignupDraftEntry,
  resolveReadyOwnedSignupOnboarding,
  validateVerifiedSignupAuthUserForClaim,
} from './signup-auth-admin';

const userId = '11111111-1111-4111-8111-111111111111';
const email = 'ana@example.test';
const oldRef = 'a'.repeat(64);
const newRef = 'b'.repeat(64);

function user(signupRef = oldRef) {
  return {
    id: userId,
    email,
    email_confirmed_at: '2026-09-23T12:00:00Z',
    app_metadata: createPendingSignupAppMetadata(signupRef),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUserById.mockResolvedValue({ data: { user: user() }, error: null });
  mocks.updateUserById.mockResolvedValue({ data: { user: user(newRef) }, error: null });
  mocks.readOwnedSignupReference.mockResolvedValue({
    ok: true,
    signupRef: newRef,
    credentialState: 'completed',
  });
  mocks.resolveReady.mockResolvedValue({
    ok: true,
    kind: 'pretenant',
    userId,
    email,
    signupRef: newRef,
    pendingSignupRef: null,
  });
  mocks.readAuthoritativeProfile.mockResolvedValue(null);
  mocks.readSignupDeliveryAttemptState.mockResolvedValue('pending');
});

describe('resolveReadyOwnedSignupOnboarding', () => {
  it('does not promote an untrusted initial password through password-login compatibility', async () => {
    mocks.getUserById.mockResolvedValue({
      data: { user: { ...user(), app_metadata: createPendingSignupAppMetadata(oldRef, true) } },
      error: null,
    });
    await expect(ensurePasswordAuthenticatedSignupAuthBinding({ userId, email })).resolves.toEqual({
      ok: false,
      reason: 'obfuscated',
    });
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });
  it('autoriza somente marker e linha concluída na mesma referência', async () => {
    await expect(resolveReadyOwnedSignupOnboarding()).resolves.toMatchObject({
      ok: true,
      kind: 'pretenant',
      signupRef: newRef,
    });
    expect(mocks.readOwnedSignupReference).toHaveBeenCalledWith(userId, email);
  });

  it.each([
    ['referência divergente', { ok: true, signupRef: oldRef, credentialState: 'completed' }],
    ['reserva ainda aberta', { ok: true, signupRef: newRef, credentialState: 'reserved' }],
    ['resultado ainda incerto', { ok: true, signupRef: newRef, credentialState: 'uncertain' }],
    ['linha ausente', { ok: false, reason: 'gone' }],
  ])('falha fechado para %s', async (_case, owned) => {
    mocks.readOwnedSignupReference.mockResolvedValue(owned);
    await expect(resolveReadyOwnedSignupOnboarding()).resolves.toEqual({
      ok: false,
      reason: 'credentials_invalid',
    });
  });

  it('propaga indisponibilidade da autoridade SQL sem degradar para acesso', async () => {
    mocks.readOwnedSignupReference.mockResolvedValue({ ok: false, reason: 'unavailable' });
    await expect(resolveReadyOwnedSignupOnboarding()).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    });
  });

  it('aceita draft recriado sem tentativa de e-mail somente com marker pronto correspondente', async () => {
    mocks.readOwnedSignupReference.mockResolvedValue({
      ok: true,
      signupRef: newRef,
      credentialState: null,
    });
    await expect(resolveReadyOwnedSignupOnboarding()).resolves.toMatchObject({
      ok: true,
      kind: 'pretenant',
      signupRef: newRef,
    });
  });
});

describe('resolveSignupDraftEntry', () => {
  it('envia Checkout vencido para conciliacao sem reabrir o formulario', async () => {
    mocks.readOwnedSignupReference.mockResolvedValue({
      ok: true,
      signupRef: newRef,
      credentialState: 'completed',
      checkoutRecovery: true,
    });
    await expect(resolveSignupDraftEntry()).resolves.toEqual({
      ok: true,
      kind: 'redirect',
      route: '/cadastro/pagamento?resultado=pending',
    });
    await expect(resolveReadyOwnedSignupOnboarding()).resolves.toMatchObject({
      ok: true,
      kind: 'pretenant',
      signupRef: newRef,
    });
  });

  it('oferece recomeço apenas à sessão pronta sem draft vivo', async () => {
    mocks.readOwnedSignupReference.mockResolvedValue({ ok: false, reason: 'gone' });
    await expect(resolveSignupDraftEntry()).resolves.toEqual({
      ok: true,
      kind: 'restart',
      userId,
      email,
    });
  });

  it('não abre recomeço com credencial pendente nem falha do banco', async () => {
    mocks.resolveReady.mockResolvedValueOnce({ ok: false, reason: 'credentials_pending' });
    await expect(resolveSignupDraftEntry()).resolves.toEqual({
      ok: false,
      reason: 'credentials_pending',
    });
    mocks.readOwnedSignupReference.mockResolvedValue({ ok: false, reason: 'unavailable' });
    await expect(resolveSignupDraftEntry()).resolves.toEqual({ ok: false, reason: 'unavailable' });
  });
});

describe('validateLegacySignupDeliveryCandidate', () => {
  const legacy = () => ({
    id: userId,
    email,
    email_confirmed_at: null,
    app_metadata: { provider: 'email' },
  });

  it('reconhece sem escrever uma conta antiga ligada a tentativa viva', async () => {
    mocks.getUserById.mockResolvedValue({ data: { user: legacy() }, error: null });

    await expect(
      validateLegacySignupDeliveryCandidate({
        userId,
        email,
        signupRef: newRef,
        attemptEpoch: Date.parse('2026-09-23T12:00:00.000Z'),
        stage: 'initial',
      }),
    ).resolves.toEqual({ ok: true, user: legacy() });
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it.each([
    [
      'tentativa substituida',
      () => mocks.readSignupDeliveryAttemptState.mockResolvedValue('stale'),
    ],
    [
      'profile existente',
      () => mocks.readAuthoritativeProfile.mockResolvedValue({ role: 'owner' }),
    ],
    [
      'e-mail ja confirmado',
      () =>
        mocks.getUserById.mockResolvedValue({
          data: { user: { ...legacy(), email_confirmed_at: '2026-09-23T12:00:00Z' } },
          error: null,
        }),
    ],
    [
      'convite',
      () =>
        mocks.getUserById.mockResolvedValue({
          data: { user: { ...legacy(), invited_at: '2026-09-23T12:00:00Z' } },
          error: null,
        }),
    ],
    [
      'conta banida',
      () =>
        mocks.getUserById.mockResolvedValue({
          data: { user: { ...legacy(), banned_until: '2099-01-01T00:00:00Z' } },
          error: null,
        }),
    ],
    [
      'marker ja existente',
      () =>
        mocks.getUserById.mockResolvedValue({
          data: { user: { ...legacy(), app_metadata: createPendingSignupAppMetadata(oldRef) } },
          error: null,
        }),
    ],
  ])('recusa %s sem alterar o Auth', async (_case, arrange) => {
    mocks.getUserById.mockResolvedValue({ data: { user: legacy() }, error: null });
    arrange();
    await expect(
      validateLegacySignupDeliveryCandidate({
        userId,
        email,
        signupRef: newRef,
        attemptEpoch: Date.parse('2026-09-23T12:00:00.000Z'),
        stage: 'resend',
      }),
    ).resolves.toEqual({ ok: false, reason: 'obfuscated' });
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it('falha fechada se a autoridade de profile estiver indisponivel', async () => {
    mocks.readAuthoritativeProfile.mockRejectedValue(new Error('db unavailable'));
    await expect(
      validateLegacySignupDeliveryCandidate({
        userId,
        email,
        signupRef: newRef,
        attemptEpoch: Date.parse('2026-09-23T12:00:00.000Z'),
        stage: 'initial',
      }),
    ).resolves.toEqual({ ok: false, reason: 'unavailable' });
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });
});

describe('ensurePasswordAuthenticatedSignupAuthBinding', () => {
  it('migra marker ausente pela referência do draft que o user já possui', async () => {
    const legacy = { ...user(), app_metadata: {} };
    const migrated = {
      ...legacy,
      app_metadata: markPasswordAuthenticatedSignupReady(legacy, newRef),
    };
    mocks.getUserById.mockResolvedValue({ data: { user: legacy }, error: null });
    mocks.updateUserById.mockResolvedValue({ data: { user: migrated }, error: null });

    await expect(ensurePasswordAuthenticatedSignupAuthBinding({ userId, email })).resolves.toEqual({
      ok: true,
    });
    expect(mocks.updateUserById).toHaveBeenCalledWith(userId, {
      app_metadata: migrated.app_metadata,
    });
  });

  it('reata marker pending antigo e o promove a set após a prova da senha', async () => {
    const migrated = {
      ...user(),
      app_metadata: markPasswordAuthenticatedSignupReady(user(), newRef),
    };
    mocks.updateUserById.mockResolvedValue({ data: { user: migrated }, error: null });

    await expect(ensurePasswordAuthenticatedSignupAuthBinding({ userId, email })).resolves.toEqual({
      ok: true,
    });
    expect(mocks.updateUserById).toHaveBeenCalledOnce();
  });

  it('não reata marker set divergente ao draft que sobrou de adoção parcial', async () => {
    const readyOld = markPasswordAuthenticatedSignupReady(user(), oldRef);
    mocks.getUserById.mockResolvedValue({
      data: { user: { ...user(), app_metadata: readyOld } },
      error: null,
    });

    await expect(ensurePasswordAuthenticatedSignupAuthBinding({ userId, email })).resolves.toEqual({
      ok: false,
      reason: 'obfuscated',
    });
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it('reata marker set ao draft novo sem tentativa de e-mail após expiração', async () => {
    const readyOld = markPasswordAuthenticatedSignupReady(user(), oldRef);
    const previous = { ...user(), app_metadata: readyOld };
    mocks.getUserById.mockResolvedValue({ data: { user: previous }, error: null });
    mocks.readOwnedSignupReference.mockResolvedValue({
      ok: true,
      signupRef: newRef,
      credentialState: null,
    });
    mocks.updateUserById.mockImplementationOnce(async (_id, attributes) => ({
      data: { user: { ...previous, app_metadata: attributes.app_metadata } },
      error: null,
    }));

    await expect(ensurePasswordAuthenticatedSignupAuthBinding({ userId, email })).resolves.toEqual({
      ok: true,
    });
    expect(mocks.updateUserById).toHaveBeenCalledWith(userId, {
      app_metadata: markPasswordAuthenticatedSignupReady(previous, newRef),
    });
  });

  it('cria marker ready após login quando o draft antigo já não existe', async () => {
    mocks.readOwnedSignupReference.mockResolvedValueOnce({ ok: false, reason: 'gone' });
    const legacy = { ...user(), app_metadata: {} };
    mocks.getUserById.mockResolvedValueOnce({ data: { user: legacy }, error: null });
    mocks.updateUserById.mockImplementationOnce(async (_id, attributes) => ({
      data: { user: { ...legacy, app_metadata: attributes.app_metadata } },
      error: null,
    }));
    await expect(ensurePasswordAuthenticatedSignupAuthBinding({ userId, email })).resolves.toEqual({
      ok: true,
    });
    const metadata = mocks.updateUserById.mock.calls[0]?.[1]?.app_metadata as Record<
      string,
      unknown
    >;
    expect(metadata).toMatchObject({
      qoro_self_service_signup: {
        version: 1,
        kind: 'self_service',
        password_state: 'set',
        signup_ref: expect.stringMatching(/^[a-f0-9]{64}$/u),
      },
    });
  });

  it('falha fechada para marker malformado', async () => {
    mocks.getUserById.mockResolvedValueOnce({
      data: { user: { ...user(), app_metadata: { qoro_self_service_signup: { broken: true } } } },
      error: null,
    });
    await expect(ensurePasswordAuthenticatedSignupAuthBinding({ userId, email })).resolves.toEqual({
      ok: false,
      reason: 'obfuscated',
    });
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });
});

describe('ensureReadyOwnedSignupAuthBinding', () => {
  it('recusa marker set divergente em vez de esconder uma adoção parcial', async () => {
    const readyOld = markPasswordAuthenticatedSignupReady(user(), oldRef);
    mocks.getUserById.mockResolvedValue({
      data: { user: { ...user(), app_metadata: readyOld } },
      error: null,
    });

    await expect(ensureReadyOwnedSignupAuthBinding({ userId, email })).resolves.toEqual({
      ok: false,
      reason: 'obfuscated',
    });
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it('não transforma marker pending em credencial pronta durante recovery', async () => {
    await expect(ensureReadyOwnedSignupAuthBinding({ userId, email })).resolves.toEqual({
      ok: false,
      reason: 'obfuscated',
    });
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it('emite recovery sem promover marker somente para pending exato e DB uncertain', async () => {
    mocks.readOwnedSignupReference.mockResolvedValue({
      ok: true,
      signupRef: oldRef,
      credentialState: 'uncertain',
    });

    await expect(ensureReadyOwnedSignupAuthBinding({ userId, email })).resolves.toEqual({
      ok: true,
      signupRef: oldRef,
    });
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  // P-29 (20/11/2026): quem confirmou pelo link e abandonou antes de criar a senha (ou a conta
  // legada cuja senha não confirmada o Auth apagou) fica com marker `pending` e DB `completed`.
  // O link de recovery prova o e-mail de novo; o grant curto deixa instalar a primeira senha.
  it('emite recovery sem promover marker para pending exato com DB completed', async () => {
    mocks.readOwnedSignupReference.mockResolvedValue({
      ok: true,
      signupRef: oldRef,
      credentialState: 'completed',
    });

    await expect(ensureReadyOwnedSignupAuthBinding({ userId, email })).resolves.toEqual({
      ok: true,
      signupRef: oldRef,
    });
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it.each([
    ['reserved', oldRef],
    ['uncertain', newRef],
    ['completed', newRef],
  ])('recusa recovery para marker pending com DB %s/ref %s', async (credentialState, signupRef) => {
    mocks.readOwnedSignupReference.mockResolvedValue({
      ok: true,
      signupRef,
      credentialState,
    });

    await expect(ensureReadyOwnedSignupAuthBinding({ userId, email })).resolves.toEqual({
      ok: false,
      reason: 'obfuscated',
    });
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it('falha fechado se a leitura da linha owned estiver indisponível', async () => {
    mocks.readOwnedSignupReference.mockResolvedValue({ ok: false, reason: 'unavailable' });

    await expect(ensureReadyOwnedSignupAuthBinding({ userId, email })).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    });
    expect(mocks.getUserById).not.toHaveBeenCalled();
  });

  it('recupera conta legada confirmada somente após o OTP e pelo draft possuído', async () => {
    const legacy = { ...user(), app_metadata: { provider: 'email' } };
    const ready = {
      ...legacy,
      app_metadata: markPasswordAuthenticatedSignupReady(legacy, newRef),
    };
    mocks.getUserById.mockResolvedValue({ data: { user: legacy }, error: null });
    mocks.updateUserById.mockResolvedValue({ data: { user: ready }, error: null });

    await expect(ensureReadyOwnedSignupAuthBinding({ userId, email })).resolves.toEqual({
      ok: true,
      signupRef: newRef,
    });
    expect(mocks.updateUserById).toHaveBeenCalledWith(userId, {
      app_metadata: ready.app_metadata,
    });
  });

  it('emite epoch do Auth para recovery quando marker set sobreviveu ao draft expirado', async () => {
    const updatedAt = '2026-09-23T12:34:56.000Z';
    const ready = {
      ...user(),
      updated_at: updatedAt,
      app_metadata: markPasswordAuthenticatedSignupReady(user(), oldRef),
    };
    mocks.readOwnedSignupReference.mockResolvedValueOnce({ ok: false, reason: 'gone' });
    mocks.getUserById.mockResolvedValueOnce({ data: { user: ready }, error: null });

    await expect(ensureReadyOwnedSignupAuthBinding({ userId, email })).resolves.toEqual({
      ok: true,
      signupRef: oldRef,
      orphanEpoch: Date.parse(updatedAt),
    });
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it('pending com draft expirado recebe o grant órfão de uso único, sem promover o marker', async () => {
    const updatedAt = '2026-09-23T12:34:56.000Z';
    mocks.readOwnedSignupReference.mockResolvedValueOnce({ ok: false, reason: 'gone' });
    mocks.getUserById.mockResolvedValueOnce({
      data: { user: { ...user(), updated_at: updatedAt } },
      error: null,
    });

    await expect(ensureReadyOwnedSignupAuthBinding({ userId, email })).resolves.toEqual({
      ok: true,
      signupRef: oldRef,
      orphanEpoch: Date.parse(updatedAt),
    });
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it('pending com draft expirado e epoch do Auth inválido falha fechado', async () => {
    mocks.readOwnedSignupReference.mockResolvedValueOnce({ ok: false, reason: 'gone' });
    mocks.getUserById.mockResolvedValueOnce({
      data: { user: { ...user(), updated_at: 'não é data' } },
      error: null,
    });

    await expect(ensureReadyOwnedSignupAuthBinding({ userId, email })).resolves.toEqual({
      ok: false,
      reason: 'obfuscated',
    });
  });

  it.each([
    ['não confirmada', { email_confirmed_at: null }],
    ['convidada', { invited_at: '2026-09-23T12:00:00Z' }],
    ['banida', { banned_until: '2099-01-01T00:00:00Z' }],
    ['de outro e-mail', { email: 'outra@example.test' }],
  ] as const)(
    'P-29: conta pending %s continua sem grant, com draft vivo ou expirado',
    async (_caso, override) => {
      for (const owned of [
        { ok: true, signupRef: oldRef, credentialState: 'completed' },
        { ok: false, reason: 'gone' },
      ]) {
        mocks.readOwnedSignupReference.mockResolvedValueOnce(owned);
        mocks.getUserById.mockResolvedValueOnce({
          data: { user: { ...user(), updated_at: '2026-09-23T12:34:56.000Z', ...override } },
          error: null,
        });
        await expect(ensureReadyOwnedSignupAuthBinding({ userId, email })).resolves.toEqual({
          ok: false,
          reason: 'obfuscated',
        });
      }
      expect(mocks.updateUserById).not.toHaveBeenCalled();
    },
  );
});

describe('ensureVerifiedSignupAuthBinding', () => {
  it('não escreve quando marker e referência já correspondem', async () => {
    mocks.readOwnedSignupReference.mockResolvedValueOnce({ ok: true, signupRef: oldRef });
    await expect(
      ensureVerifiedSignupAuthBinding({ userId, email, signupRef: oldRef }),
    ).resolves.toEqual({ ok: true });
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it('reata old-ref ao draft novo somente para a conta já confirmada', async () => {
    await expect(
      ensureVerifiedSignupAuthBinding({ userId, email, signupRef: newRef }),
    ).resolves.toEqual({ ok: true });
    expect(mocks.updateUserById).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({ app_metadata: createPendingSignupAppMetadata(newRef) }),
    );
  });

  it('instala marker pending legado somente depois que o draft pertence ao user', async () => {
    const legacy = { ...user(), app_metadata: { provider: 'email' } };
    const adopted = {
      ...legacy,
      app_metadata: {
        provider: 'email',
        ...createPendingSignupAppMetadata(newRef),
      },
    };
    mocks.getUserById.mockResolvedValue({ data: { user: legacy }, error: null });
    mocks.updateUserById.mockResolvedValue({ data: { user: adopted }, error: null });

    await expect(
      ensureVerifiedSignupAuthBinding({ userId, email, signupRef: newRef }),
    ).resolves.toEqual({ ok: true });
    expect(mocks.updateUserById).toHaveBeenCalledWith(userId, {
      app_metadata: adopted.app_metadata,
    });
  });

  it('não instala marker legado se o draft possuído for outro', async () => {
    mocks.getUserById.mockResolvedValue({
      data: { user: { ...user(), app_metadata: {} } },
      error: null,
    });
    mocks.readOwnedSignupReference.mockResolvedValue({ ok: true, signupRef: oldRef });
    await expect(
      ensureVerifiedSignupAuthBinding({ userId, email, signupRef: newRef }),
    ).resolves.toEqual({ ok: false, reason: 'obfuscated' });
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it.each([
    ['sem confirmação', { ...user(), email_confirmed_at: null }],
    [
      'senha já instalada',
      {
        ...user(),
        app_metadata: {
          qoro_self_service_signup: {
            version: 1,
            kind: 'self_service',
            signup_ref: oldRef,
            password_state: 'set',
          },
        },
      },
    ],
  ])('ofusca conta %s e não troca metadata', async (_case, found) => {
    mocks.getUserById.mockResolvedValue({ data: { user: found }, error: null });
    await expect(
      ensureVerifiedSignupAuthBinding({ userId, email, signupRef: newRef }),
    ).resolves.toEqual({ ok: false, reason: 'obfuscated' });
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it('trata corrida que não termina no ref pedido como indisponível', async () => {
    mocks.updateUserById.mockResolvedValue({ data: { user: user(oldRef) }, error: null });
    await expect(
      ensureVerifiedSignupAuthBinding({ userId, email, signupRef: newRef }),
    ).resolves.toEqual({ ok: false, reason: 'unavailable' });
  });
});

describe('validateVerifiedSignupAuthUserForClaim', () => {
  it('valida conta confirmada pending sem escrever metadata', async () => {
    await expect(validateVerifiedSignupAuthUserForClaim({ userId, email })).resolves.toEqual({
      ok: true,
      binding: 'pending',
    });
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it('aceita marker ausente para claim sem escrever antes da prova', async () => {
    mocks.getUserById.mockResolvedValueOnce({
      data: { user: { ...user(), app_metadata: {} } },
      error: null,
    });
    await expect(validateVerifiedSignupAuthUserForClaim({ userId, email })).resolves.toEqual({
      ok: true,
      binding: 'legacy',
    });
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it('ofusca conta com senha instalada', async () => {
    const completed = {
      ...user(),
      app_metadata: {
        qoro_self_service_signup: {
          version: 1,
          kind: 'self_service',
          signup_ref: oldRef,
          password_state: 'set',
        },
      },
    };
    mocks.getUserById.mockResolvedValue({ data: { user: completed }, error: null });
    await expect(validateVerifiedSignupAuthUserForClaim({ userId, email })).resolves.toEqual({
      ok: false,
      reason: 'obfuscated',
    });
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it('ofusca se um profile surgiu antes do claim', async () => {
    mocks.readAuthoritativeProfile.mockResolvedValue({ role: 'owner' });
    await expect(validateVerifiedSignupAuthUserForClaim({ userId, email })).resolves.toEqual({
      ok: false,
      reason: 'obfuscated',
    });
    expect(mocks.getUserById).not.toHaveBeenCalled();
  });
});
