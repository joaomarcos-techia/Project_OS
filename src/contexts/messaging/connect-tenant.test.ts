/**
 * F2 — Conexão self-service do WhatsApp pelo owner (connectMyClinicWhatsapp /
 * disconnectMyClinicWhatsapp). I/O mockado (auth + graph + cripto + seam de
 * persistência). Cobre os Casos 1–3 do brief; o Caso 4 (ordem do upsert) vive em
 * src/lib/messaging/connection-store.test.ts (SQL com tx mockada).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as EnvModule from '@/lib/env';

const mocks = vi.hoisted(() => ({ after: vi.fn() }));

vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock('next/server', () => ({ after: mocks.after }));
vi.mock('@/lib/audit/request-context', () => ({
  buildRequestContext: vi.fn(() => ({
    ip: null,
    userAgent: null,
    requestId: 'r',
    correlationId: 'r',
  })),
}));
vi.mock('@/lib/auth/tenant-context', () => ({
  requireUser: vi.fn(async () => ({ userId: 'user-1' })),
  requireFreshPermission: vi.fn(async () => {}),
  requireClinicId: vi.fn(async () => 'clinic-1'),
  requireSuperAdmin: vi.fn(async () => {}),
}));
vi.mock('@/lib/env', async (importActual) => {
  const actual = await importActual<typeof EnvModule>();
  return { ...actual, assertWhatsappOnboardingReady: vi.fn() };
});
// Ciphertext fixo que NÃO embute o plaintext (o token real é 'SECRET_TOKEN_VALUE').
vi.mock('@/lib/crypto', () => ({
  encryptForTenant: vi.fn(async () => 'CIPHERTEXT_BLOB'),
  decryptForTenant: vi.fn(async () => 'plain-token'),
}));
vi.mock('./internal/meta-onboarding', () => ({
  exchangeCodeForToken: vi.fn(async () => 'SECRET_TOKEN_VALUE'),
  validateTokenScopes: vi.fn(async () => ({ wabaIds: ['waba-1'] })),
  resolveWabaAndPhone: vi.fn(async () => ({
    wabaId: 'waba-1',
    phoneNumberId: 'phone-1',
    phoneNumber: '+5511999991234',
  })),
  registerPhoneNumber: vi.fn(async () => {}),
  subscribeAppToWaba: vi.fn(async () => {}),
  ensureMessageTemplates: vi.fn(async () => []),
  unsubscribeAppFromWaba: vi.fn(async () => {}),
}));
vi.mock('@/lib/messaging', () => ({
  upsertTenantConnection: vi.fn(async () => ({ id: 'num-1' })),
  deactivateTenantConnection: vi.fn(async () => ({
    disconnected: true,
    metaBusinessId: null,
    tokenCiphertext: null,
  })),
  recordConnectionFailure: vi.fn(async () => {}),
  loadActiveNumberForSend: vi.fn(async () => null),
}));

import { requireClinicId } from '@/lib/auth/tenant-context';
import { encryptForTenant } from '@/lib/crypto';
import {
  deactivateTenantConnection,
  recordConnectionFailure,
  upsertTenantConnection,
} from '@/lib/messaging';

import { connectMyClinicWhatsapp, disconnectMyClinicWhatsapp } from './actions';
import { MetaConnectError } from './errors';
import * as onboarding from './internal/meta-onboarding';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireClinicId).mockResolvedValue('clinic-1');
  vi.mocked(upsertTenantConnection).mockResolvedValue({ id: 'num-1' });
  vi.mocked(deactivateTenantConnection).mockResolvedValue({
    disconnected: true,
    metaBusinessId: null,
    tokenCiphertext: null,
  });
  vi.mocked(onboarding.exchangeCodeForToken).mockResolvedValue('SECRET_TOKEN_VALUE');
  vi.mocked(onboarding.resolveWabaAndPhone).mockResolvedValue({
    wabaId: 'waba-1',
    phoneNumberId: 'phone-1',
    phoneNumber: '+5511999991234',
  });
});

describe('connectMyClinicWhatsapp', () => {
  it('Caso 1: conecta válido → persiste cifrado + retorna número mascarado', async () => {
    const res = await connectMyClinicWhatsapp({
      code: 'CODE',
      registrationPin: '123456',
      wabaId: 'waba-1',
      phoneNumberId: 'phone-1',
    });

    // token em CLARO só vai para encryptForTenant
    expect(encryptForTenant).toHaveBeenCalledWith('clinic-1', 'SECRET_TOKEN_VALUE');
    expect(onboarding.registerPhoneNumber).toHaveBeenCalledWith(
      'phone-1',
      'SECRET_TOKEN_VALUE',
      '123456',
    );
    // webhook assinado
    expect(onboarding.subscribeAppToWaba).toHaveBeenCalledWith('waba-1', 'SECRET_TOKEN_VALUE');

    expect(upsertTenantConnection).toHaveBeenCalledTimes(1);
    expect(vi.mocked(onboarding.registerPhoneNumber).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(onboarding.subscribeAppToWaba).mock.invocationCallOrder[0]!,
    );
    expect(vi.mocked(onboarding.registerPhoneNumber).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(upsertTenantConnection).mock.invocationCallOrder[0]!,
    );
    const arg = vi.mocked(upsertTenantConnection).mock.calls[0]![0];
    expect(arg).toMatchObject({
      clinicId: 'clinic-1',
      userId: 'user-1',
      provider: 'meta',
      metaPhoneId: 'phone-1',
      metaBusinessId: 'waba-1',
      tokenEncrypted: 'CIPHERTEXT_BLOB',
    });
    // NUNCA o token em claro na persistência
    expect(JSON.stringify(arg)).not.toContain('SECRET_TOKEN_VALUE');
    expect(arg.tokenEncrypted).toBe('CIPHERTEXT_BLOB');

    // retorno mascarado, sem número completo
    expect(res.phoneNumberMasked).toMatch(/\*/);
    expect(res.phoneNumberMasked).not.toBe('+5511999991234');
    expect(res.id).toBe('num-1');
  });

  it('Caso 2: clinicId vem de requireClinicId() (sem param) — bloqueado não escreve', async () => {
    // a action NÃO aceita clinicId; isolamento = requireClinicId(). Se rejeitar
    // (usuário sem clínica / cross-tenant), nada é persistido.
    vi.mocked(requireClinicId).mockRejectedValueOnce(
      Object.assign(new Error('forbidden'), { name: 'AuthError' }),
    );

    await expect(
      connectMyClinicWhatsapp({ code: 'CODE', registrationPin: '123456', wabaId: 'waba-1' }),
    ).rejects.toThrow();
    expect(upsertTenantConnection).not.toHaveBeenCalled();
    expect(onboarding.exchangeCodeForToken).not.toHaveBeenCalled();
  });

  it('Caso 3: Meta falha → MetaConnectError, audita falha, NENHUMA escrita', async () => {
    vi.mocked(onboarding.exchangeCodeForToken).mockRejectedValueOnce(
      new MetaConnectError('[meta] auth rejected', { stage: 'authorization' }),
    );

    await expect(
      connectMyClinicWhatsapp({ code: 'CODE', registrationPin: '123456', wabaId: 'waba-1' }),
    ).rejects.toMatchObject({
      name: 'MetaConnectError',
      code: 'META_AUTH_FAILED',
    });
    expect(upsertTenantConnection).not.toHaveBeenCalled();
    expect(recordConnectionFailure).toHaveBeenCalledTimes(1);
    expect(recordConnectionFailure).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'META_AUTH_FAILED', errorStage: 'authorization' }),
    );
  });

  it('registro do número falha → não assina webhook nem persiste conexão', async () => {
    vi.mocked(onboarding.registerPhoneNumber).mockRejectedValueOnce(
      new MetaConnectError('[meta] register rejected', { stage: 'phone_registration' }),
    );

    await expect(
      connectMyClinicWhatsapp({ code: 'CODE', registrationPin: '123456', wabaId: 'waba-1' }),
    ).rejects.toMatchObject({ name: 'MetaConnectError', code: 'META_AUTH_FAILED' });

    expect(onboarding.subscribeAppToWaba).not.toHaveBeenCalled();
    expect(upsertTenantConnection).not.toHaveBeenCalled();
    expect(recordConnectionFailure).toHaveBeenCalledTimes(1);
    expect(recordConnectionFailure).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'META_AUTH_FAILED', errorStage: 'phone_registration' }),
    );
  });

  it('número já ativo em outra clínica (unique 23505) → MetaConnectError amigável', async () => {
    vi.mocked(upsertTenantConnection).mockRejectedValueOnce(
      Object.assign(new Error('dup'), { code: '23505' }),
    );
    await expect(
      connectMyClinicWhatsapp({ code: 'CODE', registrationPin: '123456', wabaId: 'waba-1' }),
    ).rejects.toMatchObject({
      name: 'MetaConnectError',
    });
  });

  // D78 — evento incompleto: sem `waba_id` não há resolução de menor privilégio.
  it('evento sem waba_id → signup_incomplete auditado, sem tocar a Meta nem persistir', async () => {
    await expect(
      connectMyClinicWhatsapp({ code: 'CODE', registrationPin: '123456' }),
    ).rejects.toMatchObject({
      name: 'MetaConnectError',
      code: 'META_AUTH_FAILED',
      stage: 'signup_incomplete',
    });

    expect(onboarding.exchangeCodeForToken).not.toHaveBeenCalled();
    expect(onboarding.resolveWabaAndPhone).not.toHaveBeenCalled();
    expect(onboarding.registerPhoneNumber).not.toHaveBeenCalled();
    expect(onboarding.subscribeAppToWaba).not.toHaveBeenCalled();
    expect(upsertTenantConnection).not.toHaveBeenCalled();
    expect(recordConnectionFailure).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'META_AUTH_FAILED', errorStage: 'signup_incomplete' }),
    );
  });

  // D78 — a allowlist do próprio token precisa chegar ao resolver; é ela que
  // impede adotar uma WABA que o cliente não outorgou.
  it('repassa ao resolver a WABA do evento e a allowlist lida do token', async () => {
    vi.mocked(onboarding.validateTokenScopes).mockResolvedValueOnce({
      wabaIds: ['waba-1', 'waba-2'],
    });

    await connectMyClinicWhatsapp({
      code: 'CODE',
      registrationPin: '123456',
      wabaId: 'waba-1',
      phoneNumberId: 'phone-1',
    });

    expect(onboarding.resolveWabaAndPhone).toHaveBeenCalledWith(
      'SECRET_TOKEN_VALUE',
      { wabaId: 'waba-1', phoneNumberId: 'phone-1' },
      { wabaIds: ['waba-1', 'waba-2'] },
    );
  });

  // D78 — toda falha de resolução da WABA/telefone precisa parar ANTES de
  // `register`, `subscribed_apps` e persistência. Um número escolhido por
  // engano seria ativado e assinado na Meta antes de qualquer revisão humana.
  it.each([
    ['account', '[meta] a WABA informada não foi concedida a este app'],
    ['account', '[meta] o número informado não pertence à WABA autorizada'],
    ['phone_ambiguous', '[meta] a WABA autorizada tem mais de um número'],
    ['provider_unavailable', '[meta] a Meta não respondeu de forma conclusiva sobre a WABA'],
  ] as const)(
    'resolução falha em %s → nenhum register, subscribe ou persistência',
    async (stage, message) => {
      vi.mocked(onboarding.resolveWabaAndPhone).mockRejectedValueOnce(
        new MetaConnectError(message, { stage }),
      );

      await expect(
        connectMyClinicWhatsapp({ code: 'CODE', registrationPin: '123456', wabaId: 'waba-1' }),
      ).rejects.toMatchObject({ name: 'MetaConnectError', stage });

      expect(onboarding.registerPhoneNumber).not.toHaveBeenCalled();
      expect(onboarding.subscribeAppToWaba).not.toHaveBeenCalled();
      expect(upsertTenantConnection).not.toHaveBeenCalled();
      expect(mocks.after).not.toHaveBeenCalled();
      expect(recordConnectionFailure).toHaveBeenCalledWith(
        expect.objectContaining({ errorCode: 'META_AUTH_FAILED', errorStage: stage }),
      );
    },
  );

  // D78 — rate limit no meio da resolução não pode virar recusa de conta nem
  // deixar efeito colateral na Meta.
  it('rate limit (429) durante a resolução: nada é registrado, assinado ou salvo', async () => {
    vi.mocked(onboarding.resolveWabaAndPhone).mockRejectedValueOnce(
      new MetaConnectError('[meta] a Meta não respondeu de forma conclusiva sobre a WABA', {
        stage: 'provider_unavailable',
        graphStatus: 429,
        graphCode: 4,
      }),
    );

    const err = await connectMyClinicWhatsapp({
      code: 'CODE',
      registrationPin: '123456',
      wabaId: 'waba-1',
    }).catch((e) => e);

    expect(err).toMatchObject({
      name: 'MetaConnectError',
      stage: 'provider_unavailable',
      graphStatus: 429,
      graphCode: 4,
    });
    expect(onboarding.registerPhoneNumber).not.toHaveBeenCalled();
    expect(onboarding.subscribeAppToWaba).not.toHaveBeenCalled();
    expect(upsertTenantConnection).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
    // A auditoria registra a etapa real: não é `account`.
    expect(recordConnectionFailure).toHaveBeenCalledWith(
      expect.objectContaining({ errorStage: 'provider_unavailable' }),
    );
  });

  /**
   * D78 — cada etapa crítica precisa parar o fluxo com a SUA etapa de auditoria,
   * sem executar as seguintes e sem persistir. Rate limit e resultado
   * desconhecido não podem virar "recusa" nem sumir na telemetria.
   */
  describe('rate limit e indeterminação por etapa', () => {
    const failAt = (
      step: 'exchange' | 'validate' | 'resolve' | 'register' | 'subscribe',
      stage: 'provider_rate_limited' | 'provider_unavailable' | 'provider_outcome_unknown',
      graphStatus: number | null,
    ) => {
      const error = new MetaConnectError('[meta] graph', { stage, graphStatus, graphCode: 4 });
      const target = {
        exchange: onboarding.exchangeCodeForToken,
        validate: onboarding.validateTokenScopes,
        resolve: onboarding.resolveWabaAndPhone,
        register: onboarding.registerPhoneNumber,
        subscribe: onboarding.subscribeAppToWaba,
      }[step];
      vi.mocked(target).mockRejectedValueOnce(error);
    };

    it.each([
      ['exchange', 'provider_rate_limited', 429],
      ['validate', 'provider_rate_limited', 429],
      ['resolve', 'provider_rate_limited', 429],
      ['register', 'provider_rate_limited', 429],
      ['subscribe', 'provider_rate_limited', 429],
      ['validate', 'provider_unavailable', 503],
      ['register', 'provider_outcome_unknown', 503],
      ['subscribe', 'provider_outcome_unknown', null],
    ] as const)('%s falha em %s: auditoria correta e nada persistido', async (step, stage, http) => {
      failAt(step, stage, http);

      const err = await connectMyClinicWhatsapp({
        code: 'CODE',
        registrationPin: '123456',
        wabaId: 'waba-1',
      }).catch((e) => e);

      expect(err).toMatchObject({ name: 'MetaConnectError', code: 'META_AUTH_FAILED', stage });
      expect(upsertTenantConnection).not.toHaveBeenCalled();
      expect(mocks.after).not.toHaveBeenCalled();
      expect(recordConnectionFailure).toHaveBeenCalledWith(
        expect.objectContaining({ errorCode: 'META_AUTH_FAILED', errorStage: stage }),
      );
    });

    it('falha no register não chega a assinar o webhook nem a persistir', async () => {
      failAt('register', 'provider_outcome_unknown', 503);

      await expect(
        connectMyClinicWhatsapp({ code: 'CODE', registrationPin: '123456', wabaId: 'waba-1' }),
      ).rejects.toMatchObject({ stage: 'provider_outcome_unknown' });

      expect(onboarding.subscribeAppToWaba).not.toHaveBeenCalled();
      expect(upsertTenantConnection).not.toHaveBeenCalled();
    });

    it('rate limit na troca de code não chega a validar escopos', async () => {
      failAt('exchange', 'provider_rate_limited', 429);

      await expect(
        connectMyClinicWhatsapp({ code: 'CODE', registrationPin: '123456', wabaId: 'waba-1' }),
      ).rejects.toMatchObject({ stage: 'provider_rate_limited' });

      expect(onboarding.validateTokenScopes).not.toHaveBeenCalled();
      expect(onboarding.resolveWabaAndPhone).not.toHaveBeenCalled();
      expect(onboarding.registerPhoneNumber).not.toHaveBeenCalled();
      expect(onboarding.subscribeAppToWaba).not.toHaveBeenCalled();
      expect(upsertTenantConnection).not.toHaveBeenCalled();
    });
  });

  it('PIN inválido não chama a Meta nem persiste conexão', async () => {
    await expect(connectMyClinicWhatsapp({ code: 'CODE', registrationPin: '123' })).rejects.toThrow(
      'PIN do WhatsApp',
    );
    expect(onboarding.exchangeCodeForToken).not.toHaveBeenCalled();
    expect(upsertTenantConnection).not.toHaveBeenCalled();
  });
});

describe('disconnectMyClinicWhatsapp', () => {
  it('sem número ativo: pula unsubscribe e desativa', async () => {
    const res = await disconnectMyClinicWhatsapp();
    expect(onboarding.unsubscribeAppFromWaba).not.toHaveBeenCalled();
    expect(deactivateTenantConnection).toHaveBeenCalledWith(
      expect.objectContaining({ clinicId: 'clinic-1', userId: 'user-1' }),
    );
    expect(res.disconnected).toBe(true);
  });

  it('com número ativo: desativa antes e agenda unsubscribe sem bloquear a resposta', async () => {
    vi.mocked(deactivateTenantConnection).mockResolvedValueOnce({
      disconnected: true,
      metaBusinessId: 'waba-1',
      tokenCiphertext: 'enc',
    });

    const res = await disconnectMyClinicWhatsapp();

    expect(res).toEqual({ disconnected: true });
    expect(deactivateTenantConnection).toHaveBeenCalled();
    expect(mocks.after).toHaveBeenCalledTimes(1);
    expect(onboarding.unsubscribeAppFromWaba).not.toHaveBeenCalled();

    const cleanup = mocks.after.mock.calls[0]![0] as () => Promise<void>;
    await cleanup();
    expect(onboarding.unsubscribeAppFromWaba).toHaveBeenCalledWith('waba-1', 'plain-token');
  });
});

/**
 * Provisionamento de templates no connect. O requisito central é NEGATIVO: a
 * conexão precisa continuar válida mesmo quando a Meta recusa os modelos — o
 * canal atende conversa de serviço sem template nenhum, e derrubar o connect
 * transformaria uma conexão boa em falha.
 */
describe('connect — provisionamento dos templates', () => {
  const connectInput = {
    code: 'code-1',
    registrationPin: '123456',
    wabaId: 'waba-1',
    phoneNumberId: 'phone-1',
  };

  it('agenda o provisionamento para depois da resposta', async () => {
    const result = await connectMyClinicWhatsapp(connectInput);
    expect(result).toMatchObject({ id: 'num-1' });

    // Nada de Graph de template no caminho síncrono: a clínica não espera.
    expect(onboarding.ensureMessageTemplates).not.toHaveBeenCalled();
    expect(mocks.after).toHaveBeenCalledTimes(1);

    await (mocks.after.mock.calls[0]![0] as () => Promise<void>)();
    expect(onboarding.ensureMessageTemplates).toHaveBeenCalledTimes(1);
    const [wabaId, token] = vi.mocked(onboarding.ensureMessageTemplates).mock.calls[0]!;
    expect(wabaId).toBe('waba-1');
    expect(token).toBe('SECRET_TOKEN_VALUE');
  });

  it('provisiona só depois de persistir a conexão', async () => {
    await connectMyClinicWhatsapp(connectInput);
    // `after` é registrado depois do upsert; se invertesse, um template criado
    // poderia sobreviver a uma conexão que falhou ao salvar.
    expect(vi.mocked(upsertTenantConnection).mock.invocationCallOrder[0]!).toBeLessThan(
      mocks.after.mock.invocationCallOrder[0]!,
    );
  });

  it('recusa de template não derruba a conexão', async () => {
    vi.mocked(onboarding.ensureMessageTemplates).mockResolvedValueOnce([
      { name: 'lembrete_confirmacao', status: 'failed' },
    ]);
    const result = await connectMyClinicWhatsapp(connectInput);
    expect(result).toMatchObject({ id: 'num-1' });

    // A conexão foi persistida e nenhuma falha foi registrada.
    expect(upsertTenantConnection).toHaveBeenCalledTimes(1);
    await expect(
      (mocks.after.mock.calls[0]![0] as () => Promise<void>)(),
    ).resolves.toBeUndefined();
    expect(recordConnectionFailure).not.toHaveBeenCalled();
  });

  it('não provisiona quando a fase Meta falha antes de persistir', async () => {
    vi.mocked(onboarding.subscribeAppToWaba).mockRejectedValueOnce(
      new MetaConnectError('[meta] subscribe rejected', { stage: 'webhook_subscription' }),
    );
    await expect(connectMyClinicWhatsapp(connectInput)).rejects.toMatchObject({
      name: 'MetaConnectError',
    });
    expect(mocks.after).not.toHaveBeenCalled();
    expect(onboarding.ensureMessageTemplates).not.toHaveBeenCalled();
  });
});
