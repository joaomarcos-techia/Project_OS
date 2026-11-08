/**
 * account-store (seam privilegiado de escrita da conta de pagamento).
 *
 * `dbAdmin`/`logAudit` mockados; o `sql` real é compilado para texto (PgDialect)
 * para asserir as garantias que NÃO dá para verificar por tipo:
 *   - todo comando é escopado por `clinic_id` (dbAdmin ignora RLS);
 *   - desconectar só apaga a chave após desativar o webhook sem histórico;
 *   - o audit nunca recebe a chave nem o hash;
 *   - reenviar a mesma chave não escreve nada.
 */
import type { SQL } from 'drizzle-orm';
import { assertTrialPaidFeatureTx } from '@/lib/trial-access';
import { TrialAccessError } from '@/lib/trial-access/policy';
vi.mock('@/lib/trial-access', () => ({ assertTrialPaidFeatureTx: vi.fn(async () => {}) }));
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.hoisted: a fábrica do vi.mock é içada acima dos imports; expor o spy por aqui
// evita um `import { dbAdmin }` (origem de conexão proibida pelo arch:db-check).
const { transactionMock, withTenantMock, disableWebhookMock } = vi.hoisted(() => ({
  transactionMock: vi.fn(),
  withTenantMock: vi.fn(),
  disableWebhookMock: vi.fn(),
}));
vi.mock('@/lib/db', () => ({
  dbAdmin: { transaction: transactionMock },
}));
vi.mock('@/lib/db/tenant', () => ({ withTenant: withTenantMock }));
vi.mock('@/lib/audit/log', () => ({ logAudit: vi.fn(async () => 'audit-1') }));
vi.mock('@/lib/crypto', () => ({ decryptForTenant: vi.fn(async () => 'test-key') }));
vi.mock('./asaas', () => ({ createAsaasClient: () => ({ disableWebhook: disableWebhookMock }) }));

import { logAudit } from '@/lib/audit/log';

import {
  deactivatePaymentAccount,
  upsertPaymentAccount,
  withPaymentWebhookLock,
  type UpsertPaymentAccountInput,
} from './account-store';

const dialect = new PgDialect();
const ctx = { ip: null, userAgent: null, requestId: 'r', correlationId: 'r' };

function makeTx(returns: unknown[][]) {
  const sqls: string[] = [];
  let i = 0;
  const execute = vi.fn(async (q: SQL) => {
    sqls.push(dialect.sqlToQuery(q).sql);
    return returns[i++] ?? [];
  });
  return { tx: { execute }, sqls };
}

function runWithTx(tx: unknown) {
  transactionMock.mockImplementation(((fn: (t: unknown) => unknown) => fn(tx)) as never);
  withTenantMock.mockImplementation(((_clinicId: string, fn: (t: unknown) => unknown) =>
    fn({ execute: vi.fn(async () => []) })) as never);
}

const SECRET = '$aact_chave_em_claro_que_nunca_pode_aparecer';
const baseInput: UpsertPaymentAccountInput = {
  clinicId: 'clinic-1',
  userId: 'user-1',
  apiKeyEncrypted: 'enc(CHAVE)',
  apiKeyHash: 'hash-nova',
  accountName: 'Clínica Exemplo',
  webhookTokenEncrypted: 'enc(WEBHOOK_TOKEN)',
  requestContext: ctx,
};

beforeEach(() => {
  vi.clearAllMocks();
  disableWebhookMock.mockResolvedValue({ matched: 1 });
});

describe('upsertPaymentAccount', () => {
  it('trial denies persistence without rotating or saving a credential', async () => {
    const { tx } = makeTx([]);
    runWithTx(tx);
    vi.mocked(assertTrialPaidFeatureTx).mockRejectedValueOnce(new TrialAccessError('asaas'));
    await expect(upsertPaymentAccount(baseInput)).rejects.toMatchObject({
      code: 'trial_access_restricted',
    });
    expect(tx.execute).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });
  it('grava a chave cifrada, ativa a conta e audita na mesma tx', async () => {
    const { tx, sqls } = makeTx([[], [{ id: 'acc-1', key_version: 1 }]]);
    runWithTx(tx);

    await expect(upsertPaymentAccount(baseInput)).resolves.toEqual({ id: 'acc-1', changed: true });

    const insert = sqls[1] ?? '';
    expect(insert).toContain('INSERT INTO clinic_payment_accounts');
    expect(insert).toContain('ON CONFLICT (clinic_id, provider) DO UPDATE');
    expect(insert).toContain('key_version       = clinic_payment_accounts.key_version + 1');
    expect(insert).toContain('active            = true');
    expect(insert).toContain('disconnected_at   = NULL');
    expect(logAudit).toHaveBeenCalledTimes(1);
  });

  it('troca de conta invalida o webhook anterior (token novo, configured_at nulo)', async () => {
    const { tx, sqls } = makeTx([[], [{ id: 'acc-1', key_version: 2 }]]);
    runWithTx(tx);

    await upsertPaymentAccount(baseInput);

    const insert = sqls[1] ?? '';
    expect(insert).toContain('webhook_token_encrypted = EXCLUDED.webhook_token_encrypted');
    expect(insert).toContain('webhook_configured_at   = NULL');
  });

  it('escopa a leitura prévia por clinic_id (dbAdmin ignora RLS)', async () => {
    const { tx, sqls } = makeTx([[], [{ id: 'acc-1', key_version: 1 }]]);
    runWithTx(tx);

    await upsertPaymentAccount(baseInput);

    expect(sqls[0]).toContain('WHERE clinic_id =');
    expect(sqls[0]).toContain('AND provider =');
  });

  it('NUNCA manda a chave nem o hash para a auditoria', async () => {
    const { tx } = makeTx([[], [{ id: 'acc-1', key_version: 3 }]]);
    runWithTx(tx);

    await upsertPaymentAccount({ ...baseInput, apiKeyEncrypted: SECRET, apiKeyHash: 'hash-x' });

    const [, entry] = vi.mocked(logAudit).mock.calls[0]!;
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain('hash-x');
    expect(entry.action).toBe('payments.account.connected');
    expect(entry.after).toEqual({
      provider: 'asaas',
      accountName: 'Clínica Exemplo',
      keyVersion: 3,
    });
  });

  it('reenviar a MESMA chave de uma conta ativa não escreve nem audita', async () => {
    const { tx, sqls } = makeTx([
      [
        {
          id: 'acc-1',
          api_key_hash: 'hash-nova',
          active: true,
          accept_new_charges: true,
        },
      ],
    ]);
    runWithTx(tx);

    await expect(upsertPaymentAccount(baseInput)).resolves.toEqual({ id: 'acc-1', changed: false });

    expect(sqls).toHaveLength(1); // só o SELECT
    expect(logAudit).not.toHaveBeenCalled();
  });

  it('retoma a mesma conta pausada sem girar chave nem token do webhook', async () => {
    const { tx, sqls } = makeTx([
      [
        {
          id: 'acc-1',
          api_key_hash: 'hash-nova',
          key_version: 4,
          active: true,
          accept_new_charges: false,
        },
      ],
      [],
    ]);
    runWithTx(tx);

    await expect(upsertPaymentAccount(baseInput)).resolves.toEqual({ id: 'acc-1', changed: true });
    expect(sqls).toHaveLength(2);
    expect(sqls[1]).toContain('accept_new_charges = true');
    expect(sqls[1]).not.toContain('webhook_token_encrypted');
    expect(sqls[1]).not.toContain('key_version');
    expect(logAudit).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ action: 'payments.account.resumed' }),
    );
  });

  it('mesma chave numa conta DESCONECTADA reconecta (não é no-op)', async () => {
    const { tx, sqls } = makeTx([
      [{ id: 'acc-1', api_key_hash: 'hash-nova', active: false }],
      [{ id: 'acc-1', key_version: 2 }],
    ]);
    runWithTx(tx);

    await expect(upsertPaymentAccount(baseInput)).resolves.toEqual({ id: 'acc-1', changed: true });
    expect(sqls).toHaveLength(2);
    expect(logAudit).toHaveBeenCalledTimes(1);
  });
});

it('serializa a configuração remota do webhook com a pausa da conta', async () => {
  const { tx, sqls } = makeTx([[]]);
  withTenantMock.mockImplementation(((_clinicId: string, fn: (t: unknown) => unknown) =>
    fn(tx)) as never);
  const operation = vi.fn(async () => 'configured');
  await expect(withPaymentWebhookLock('clinic-1', operation)).resolves.toBe('configured');
  expect(sqls[0]).toContain('pg_advisory_xact_lock');
  expect(withTenantMock).toHaveBeenCalledWith('clinic-1', expect.any(Function));
  expect(transactionMock).not.toHaveBeenCalled();
  expect(operation).toHaveBeenCalledOnce();
});

describe('deactivatePaymentAccount', () => {
  it('pausa e preserva segredo/webhook quando há histórico de cobranças', async () => {
    const { tx, sqls } = makeTx([
      [{ id: 'acc-1', active: true, accept_new_charges: true }],
      [],
      [
        {
          id: 'acc-1',
          active: true,
          accept_new_charges: false,
          api_key_encrypted: 'ciphertext',
          webhook_ref: 'ref-1',
        },
      ],
      [{ present: 1 }],
    ]);
    runWithTx(tx);

    await expect(
      deactivatePaymentAccount({ clinicId: 'clinic-1', userId: 'user-1', requestContext: ctx }),
    ).resolves.toEqual({ changed: true, state: 'paused' });

    expect(sqls[1]).toContain('accept_new_charges = false');
    expect(sqls.join(' ')).not.toContain('api_key_encrypted = NULL');
    expect(disableWebhookMock).not.toHaveBeenCalled();
    expect(logAudit).toHaveBeenCalledTimes(1);
  });

  it('desativa webhook com readback antes de apagar a chave sem cobranças', async () => {
    const { tx, sqls } = makeTx([
      [{ id: 'acc-1', active: true, accept_new_charges: true }],
      [],
      [
        {
          id: 'acc-1',
          active: true,
          accept_new_charges: false,
          api_key_encrypted: 'ciphertext',
          webhook_ref: 'ref-1',
        },
      ],
      [],
      [],
    ]);
    runWithTx(tx);
    await expect(
      deactivatePaymentAccount({
        clinicId: 'clinic-1',
        userId: 'user-1',
        requestContext: ctx,
      }),
    ).resolves.toEqual({ changed: true, state: 'disconnected' });
    expect(disableWebhookMock).toHaveBeenCalledWith({
      pathname: '/api/webhooks/asaas/patient/ref-1',
    });
    expect(sqls[4]).toContain('api_key_encrypted = NULL');
    expect(sqls[4]).toContain('webhook_token_encrypted = NULL');
    expect(withTenantMock).toHaveBeenCalledOnce();
    expect(logAudit).toHaveBeenCalledTimes(2);
  });

  it('falha do Asaas mantém a pausa e não apaga a chave', async () => {
    const { tx, sqls } = makeTx([
      [{ id: 'acc-1', active: true, accept_new_charges: true }],
      [],
      [
        {
          id: 'acc-1',
          active: true,
          accept_new_charges: false,
          api_key_encrypted: 'ciphertext',
          webhook_ref: 'ref-1',
        },
      ],
      [],
    ]);
    runWithTx(tx);
    disableWebhookMock.mockRejectedValueOnce(new Error('provider unavailable'));
    await expect(
      deactivatePaymentAccount({
        clinicId: 'clinic-1',
        userId: 'user-1',
        requestContext: ctx,
      }),
    ).rejects.toThrow('provider unavailable');
    expect(sqls.join(' ')).not.toContain('api_key_encrypted = NULL');
    expect(logAudit).toHaveBeenCalledTimes(1);
  });

  it('é idempotente: nada ativo para desconectar não vira evento de auditoria', async () => {
    const { tx } = makeTx([[]]);
    runWithTx(tx);

    await expect(
      deactivatePaymentAccount({ clinicId: 'clinic-1', userId: 'user-1', requestContext: ctx }),
    ).resolves.toEqual({ changed: false, state: 'disconnected' });

    expect(logAudit).not.toHaveBeenCalled();
  });
});
