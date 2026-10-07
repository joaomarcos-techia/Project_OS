/**
 * Conexão da conta Asaas da clínica (connectPaymentAccount / disconnectPaymentAccount).
 * I/O mockado (auth + adapter + cripto + seam de persistência).
 *
 * O que estes testes protegem, e que nenhum tipo protege:
 *   - a chave em claro NÃO chega ao banco, à métrica nem ao retorno;
 *   - chave recusada e Asaas indisponível são erros DIFERENTES — e nenhum dos
 *     dois grava (guardar chave não verificada é o bug que a validação existe
 *     para impedir);
 *   - o gate de permissão roda ANTES de tocar no segredo ou chamar o provedor.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as CryptoModule from 'node:crypto';
import type * as AsaasModule from '@/lib/payments/asaas';

const cryptoMocks = vi.hoisted(() => ({ randomBytes: vi.fn() }));
vi.mock('node:crypto', async (importActual) => {
  const actual = await importActual<typeof CryptoModule>();
  return { ...actual, randomBytes: cryptoMocks.randomBytes.mockImplementation(actual.randomBytes) };
});

const mocks = vi.hoisted(() => ({
  getMyAccount: vi.fn(),
  createWebhook: vi.fn(),
  createAsaasClient: vi.fn(),
  getWebhookSetupTarget: vi.fn(),
  markWebhookConfigured: vi.fn(),
  requireCachedPermission: vi.fn(async () => {}),
  env: {
    DATABASE_URL: 'postgres://user:pass@localhost:5432/test',
    APP_BASE_URL: 'https://preview.qoro.test' as string | undefined,
    NODE_ENV: 'production' as const,
    VERCEL_ENV: 'preview' as 'preview' | 'production' | 'development' | undefined,
    VERCEL_AUTOMATION_BYPASS_SECRET: 'preview-bypass-secret' as string | undefined,
  },
}));

vi.mock('@/lib/auth/tenant-context', () => ({
  requireUser: vi.fn(async () => ({ userId: 'user-1' })),
  requireCachedPermission: mocks.requireCachedPermission,
  requireClinicId: vi.fn(async () => 'clinic-1'),
}));
vi.mock('@/lib/audit/request-context-from-headers', () => ({
  requestContext: vi.fn(async () => ({
    ip: null,
    userAgent: null,
    requestId: 'r',
    correlationId: 'r',
  })),
}));
// Ciphertext/hash fixos que NÃO embutem o plaintext — é isso que torna a asserção
// "a chave em claro não vazou" verificável de verdade.
vi.mock('@/lib/crypto', () => ({
  encryptForTenant: vi.fn(async () => 'CIPHERTEXT_BLOB'),
  hashForLookup: vi.fn(async () => 'HASH_BLOB'),
}));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: vi.fn() } }));
vi.mock('@/lib/env', () => ({ env: mocks.env }));
// As classes de erro precisam ser as REAIS (o código usa `instanceof`); só a
// fábrica do client é trocada.
vi.mock('@/lib/payments/asaas', async (importActual) => {
  const actual = await importActual<typeof AsaasModule>();
  return { ...actual, createAsaasClient: mocks.createAsaasClient };
});
vi.mock('@/lib/payments/account-store', () => ({
  upsertPaymentAccount: vi.fn(async () => ({ id: 'acc-1', changed: true })),
  deactivatePaymentAccount: vi.fn(async () => ({ changed: true, state: 'disconnected' })),
  withPaymentWebhookLock: vi.fn(async (_clinicId: string, operation: () => Promise<unknown>) =>
    operation(),
  ),
  getWebhookSetupTarget: mocks.getWebhookSetupTarget,
  markWebhookConfigured: mocks.markWebhookConfigured,
}));
vi.mock('./queries', () => ({
  getPaymentAccountStatus: vi.fn(async () => ({
    provider: 'asaas',
    hasApiKey: true,
    acceptNewCharges: true,
    webhookConfigured: true,
    accountName: 'Clínica Exemplo',
    keyVersion: 1,
    connectedAt: '2026-08-24T00:00:00.000Z',
  })),
}));

import { metrics } from '@/lib/observability/metrics';
import { encryptForTenant } from '@/lib/crypto';
import {
  BillingCircuitOpenError,
  BillingProviderError,
  BillingProviderUnreachableError,
} from '@/lib/payments/asaas';
import {
  deactivatePaymentAccount,
  upsertPaymentAccount,
  withPaymentWebhookLock,
} from '@/lib/payments/account-store';

import { connectPaymentAccount, disconnectPaymentAccount } from './actions';
import { PaymentCredentialRejectedError, PaymentProviderUnavailableError } from './errors';

const SECRET = '$aact_chave_secreta_da_clinica';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireCachedPermission.mockImplementation(async () => {});
  mocks.getMyAccount.mockResolvedValue({ name: 'Clínica Exemplo', email: 'ops@qoro.test' });
  mocks.createAsaasClient.mockReturnValue({ getMyAccount: mocks.getMyAccount });
  mocks.createWebhook.mockResolvedValue({ webhookId: 'webhook-1' });
  mocks.getWebhookSetupTarget.mockResolvedValue({
    clinicId: 'clinic-1',
    webhookRef: '11111111-1111-4111-8111-111111111111',
    webhookToken: 'webhook-token-da-clinica-com-32-chars',
    client: { createWebhook: mocks.createWebhook },
  });
  vi.mocked(upsertPaymentAccount).mockResolvedValue({ id: 'acc-1', changed: true });
  mocks.env.APP_BASE_URL = 'https://preview.qoro.test';
  mocks.env.VERCEL_ENV = 'preview';
  mocks.env.VERCEL_AUTOMATION_BYPASS_SECRET = 'preview-bypass-secret';
});

describe('connectPaymentAccount', () => {
  it('mantém gravação e configuração remota sob o mesmo lock da desconexão', async () => {
    const stages: string[] = [];
    vi.mocked(withPaymentWebhookLock).mockImplementationOnce(async (_clinicId, operation) => {
      stages.push('lock');
      const result = await operation();
      stages.push('unlock');
      return result;
    });
    vi.mocked(upsertPaymentAccount).mockImplementationOnce(async () => {
      stages.push('upsert');
      return { id: 'acc-1', changed: true };
    });
    mocks.createWebhook.mockImplementationOnce(async () => {
      stages.push('webhook');
      return { webhookId: 'webhook-1' };
    });

    await connectPaymentAccount({ apiKey: SECRET });

    expect(stages).toEqual(['lock', 'upsert', 'webhook', 'unlock']);
  });

  it('descarta token do webhook com quatro caracteres iguais ou sequência numérica', async () => {
    const repeated = Buffer.from(
      'AQEBAQEB' + 'AAAA' + 'BAQEBAQE'.repeat(3) + 'BAQEBAQ',
      'base64url',
    );
    const numeric = Buffer.from(
      'AQEBAQEB' + '12345' + 'BAQEBAQE'.repeat(3) + 'BAQEBA',
      'base64url',
    );
    const valid = Buffer.alloc(32, 1);
    cryptoMocks.randomBytes
      .mockReturnValueOnce(repeated)
      .mockReturnValueOnce(numeric)
      .mockReturnValueOnce(valid);

    await connectPaymentAccount({ apiKey: SECRET });

    expect(cryptoMocks.randomBytes).toHaveBeenCalledTimes(3);
    expect(encryptForTenant).toHaveBeenCalledWith('clinic-1', valid.toString('base64url'));
  });

  it('valida no Asaas com a chave recebida e grava apenas o ciphertext', async () => {
    await connectPaymentAccount({ apiKey: SECRET });

    expect(mocks.createAsaasClient).toHaveBeenCalledWith({ apiKey: SECRET });
    // attempts:1 — o operador está na tela; retry longo viraria meio minuto de espera.
    expect(mocks.getMyAccount).toHaveBeenCalledWith({ attempts: 1 });

    const [args] = vi.mocked(upsertPaymentAccount).mock.calls[0]!;
    expect(args.apiKeyEncrypted).toBe('CIPHERTEXT_BLOB');
    expect(args.apiKeyHash).toBe('HASH_BLOB');
    expect(args.accountName).toBe('Clínica Exemplo');
    expect(JSON.stringify(args)).not.toContain(SECRET);
  });

  it('não expõe a chave na métrica nem no retorno', async () => {
    const result = await connectPaymentAccount({ apiKey: SECRET });

    expect(JSON.stringify(result)).not.toContain(SECRET);
    const [name, fields] = vi
      .mocked(metrics.emit)
      .mock.calls.find(([event]) => event === 'payments.account.connected')!;
    expect(name).toBe('payments.account.connected');
    expect(JSON.stringify(fields)).not.toContain(SECRET);
    expect(fields).toEqual({ clinicId: 'clinic-1', changed: true });
  });

  it('inclui o bypass somente no webhook de Preview protegido', async () => {
    mocks.getMyAccount.mockResolvedValue({ name: 'Clínica Exemplo', email: 'ops@qoro.test' });

    await connectPaymentAccount({ apiKey: SECRET });

    expect(mocks.createWebhook).toHaveBeenCalledOnce();
    const [input] = mocks.createWebhook.mock.calls[0] as [{ url: string; events: string[] }];
    const url = new URL(input.url);
    expect(url.pathname).toBe('/api/webhooks/asaas/patient/11111111-1111-4111-8111-111111111111');
    expect(url.searchParams.get('x-vercel-protection-bypass')).toBe('preview-bypass-secret');
    expect(input.events).toEqual([
      'PAYMENT_RECEIVED',
      'PAYMENT_CONFIRMED',
      'PAYMENT_REFUNDED',
      'PAYMENT_PARTIALLY_REFUNDED',
      'PAYMENT_REFUND_IN_PROGRESS',
      'PAYMENT_REFUND_DENIED',
      'PAYMENT_OVERDUE',
      'PAYMENT_RECEIVED_IN_CASH_UNDONE',
      'PAYMENT_CHARGEBACK_REQUESTED',
      'PAYMENT_CHARGEBACK_DISPUTE',
      'PAYMENT_AWAITING_CHARGEBACK_REVERSAL',
      'CHECKOUT_PAID',
    ]);
    expect(mocks.markWebhookConfigured).toHaveBeenCalledWith('clinic-1');
  });

  it('não registra webhook condenado quando o Preview protegido está sem bypass', async () => {
    mocks.env.VERCEL_AUTOMATION_BYPASS_SECRET = undefined;

    const result = await connectPaymentAccount({ apiKey: SECRET });

    expect(mocks.createWebhook).not.toHaveBeenCalled();
    expect(mocks.markWebhookConfigured).not.toHaveBeenCalled();
    expect(result.webhookConfigurationIssue).toEqual(
      expect.objectContaining({
        code: 'qoro_missing_preview_bypass',
        location: expect.stringContaining('Configuração do Qoro'),
      }),
    );
  });

  it('informa quando APP_BASE_URL está ausente e onde a falha ocorreu', async () => {
    mocks.env.APP_BASE_URL = undefined;

    const result = await connectPaymentAccount({ apiKey: SECRET });

    expect(mocks.createWebhook).not.toHaveBeenCalled();
    expect(result.webhookConfigurationIssue).toEqual({
      code: 'qoro_missing_app_base_url',
      location: 'Configuração do Qoro, antes de chamar o Asaas',
      message: 'APP_BASE_URL não está disponível no runtime deste deploy.',
    });
  });

  it('informa quando a conta Asaas não devolve o e-mail exigido pelo webhook', async () => {
    mocks.getMyAccount.mockResolvedValue({ name: 'Clínica Exemplo', email: null });

    const result = await connectPaymentAccount({ apiKey: SECRET });

    expect(mocks.createWebhook).not.toHaveBeenCalled();
    expect(result.webhookConfigurationIssue).toEqual(
      expect.objectContaining({
        code: 'asaas_missing_account_email',
        location: expect.stringContaining('GET /myAccount'),
      }),
    );
  });

  it('mostra HTTP e códigos seguros quando o Asaas recusa POST /webhooks', async () => {
    mocks.createWebhook.mockRejectedValue(
      new BillingProviderError('corpo interno', 'billing_provider_error', 400, [
        'invalid_webhook_url',
      ]),
    );

    const result = await connectPaymentAccount({ apiKey: SECRET });

    expect(result.webhookConfigurationIssue).toEqual({
      code: 'asaas_webhook_rejected',
      location: 'API do Asaas, durante a configuração do webhook',
      message:
        'O Asaas recusou a criação ou atualização do webhook (HTTP 400; código(s): invalid_webhook_url). A chave já havia sido aceita em GET /myAccount.',
    });
    expect(JSON.stringify(result)).not.toContain('corpo interno');
  });

  it('distingue indisponibilidade durante POST /webhooks de recusa da chave', async () => {
    mocks.createWebhook.mockRejectedValue(new BillingProviderUnreachableError('timeout interno'));

    const result = await connectPaymentAccount({ apiKey: SECRET });

    expect(result.webhookConfigurationIssue).toEqual(
      expect.objectContaining({
        code: 'asaas_webhook_unavailable',
        location: expect.stringContaining('configuração do webhook'),
      }),
    );
    expect(JSON.stringify(result)).not.toContain('timeout interno');
  });

  it('reconcilia o webhook ao reenviar a mesma chave já configurada', async () => {
    vi.mocked(upsertPaymentAccount).mockResolvedValue({ id: 'acc-1', changed: false });

    const result = await connectPaymentAccount({ apiKey: SECRET });

    expect(mocks.createWebhook).toHaveBeenCalledOnce();
    expect(mocks.markWebhookConfigured).toHaveBeenCalledWith('clinic-1');
    expect(result.webhookConfigured).toBe(true);
    expect(result.webhookConfigurationIssue).toBeNull();
  });

  it('não anexa bypass fora do Preview', async () => {
    mocks.getMyAccount.mockResolvedValue({ name: 'Clínica Exemplo', email: 'ops@qoro.test' });
    mocks.env.VERCEL_ENV = 'production';

    await connectPaymentAccount({ apiKey: SECRET });

    const [input] = mocks.createWebhook.mock.calls[0] as [{ url: string }];
    expect(new URL(input.url).search).toBe('');
  });

  it('chave recusada pelo Asaas (4xx) NÃO grava nada', async () => {
    mocks.getMyAccount.mockRejectedValue(
      new BillingProviderError('asaas GET /myAccount → HTTP 401', 'billing_provider_error', 401, [
        'invalid_apiKey',
      ]),
    );

    await expect(connectPaymentAccount({ apiKey: SECRET })).rejects.toBeInstanceOf(
      PaymentCredentialRejectedError,
    );
    expect(upsertPaymentAccount).not.toHaveBeenCalled();
  });

  it('Asaas indisponível NÃO grava — chave não verificada não entra no banco', async () => {
    mocks.getMyAccount.mockRejectedValue(new BillingProviderUnreachableError('timeout'));

    await expect(connectPaymentAccount({ apiKey: SECRET })).rejects.toBeInstanceOf(
      PaymentProviderUnavailableError,
    );
    expect(upsertPaymentAccount).not.toHaveBeenCalled();
  });

  it('circuito aberto é tratado como indisponibilidade, não como chave errada', async () => {
    mocks.getMyAccount.mockRejectedValue(new BillingCircuitOpenError());

    await expect(connectPaymentAccount({ apiKey: SECRET })).rejects.toBeInstanceOf(
      PaymentProviderUnavailableError,
    );
    expect(upsertPaymentAccount).not.toHaveBeenCalled();
  });

  it('sem permissão: nem o Asaas é chamado, nem a chave é cifrada', async () => {
    const authError = Object.assign(new Error('forbidden'), { name: 'AuthError' });
    mocks.requireCachedPermission.mockRejectedValue(authError);

    await expect(connectPaymentAccount({ apiKey: SECRET })).rejects.toBe(authError);
    expect(mocks.createAsaasClient).not.toHaveBeenCalled();
    expect(upsertPaymentAccount).not.toHaveBeenCalled();
  });

  it('chave malformada é barrada antes de qualquer chamada externa', async () => {
    await expect(connectPaymentAccount({ apiKey: 'chave com espaco' })).rejects.toThrow();
    expect(mocks.createAsaasClient).not.toHaveBeenCalled();
    expect(upsertPaymentAccount).not.toHaveBeenCalled();
  });
});

describe('disconnectPaymentAccount', () => {
  it('delega ao seam privilegiado e emite métrica sem dado sensível', async () => {
    await disconnectPaymentAccount();

    expect(deactivatePaymentAccount).toHaveBeenCalledWith(
      expect.objectContaining({ clinicId: 'clinic-1', userId: 'user-1' }),
    );
    expect(metrics.emit).toHaveBeenCalledWith('payments.account.disconnected', {
      clinicId: 'clinic-1',
      changed: true,
    });
  });

  it('distingue pausa para reconciliação de desconexão efetiva', async () => {
    vi.mocked(deactivatePaymentAccount).mockResolvedValueOnce({ changed: true, state: 'paused' });
    await disconnectPaymentAccount();
    expect(metrics.emit).toHaveBeenCalledWith('payments.account.paused', {
      clinicId: 'clinic-1',
      changed: true,
    });
    expect(metrics.emit).not.toHaveBeenCalledWith(
      'payments.account.disconnected',
      expect.anything(),
    );
  });

  it('exige a mesma permissão do connect', async () => {
    const authError = Object.assign(new Error('forbidden'), { name: 'AuthError' });
    mocks.requireCachedPermission.mockRejectedValue(authError);

    await expect(disconnectPaymentAccount()).rejects.toBe(authError);
    expect(deactivatePaymentAccount).not.toHaveBeenCalled();
  });
});
