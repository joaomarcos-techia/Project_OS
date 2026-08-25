/**
 * account-store (seam privilegiado de escrita da conta de pagamento).
 *
 * `dbAdmin`/`logAudit` mockados; o `sql` real é compilado para texto (PgDialect)
 * para asserir as garantias que NÃO dá para verificar por tipo:
 *   - todo comando é escopado por `clinic_id` (dbAdmin ignora RLS);
 *   - desconectar APAGA a chave, não só marca inativo;
 *   - o audit nunca recebe a chave nem o hash;
 *   - reenviar a mesma chave não escreve nada.
 */
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.hoisted: a fábrica do vi.mock é içada acima dos imports; expor o spy por aqui
// evita um `import { dbAdmin }` (origem de conexão proibida pelo arch:db-check).
const { transactionMock } = vi.hoisted(() => ({ transactionMock: vi.fn() }));
vi.mock('@/lib/db', () => ({ dbAdmin: { transaction: transactionMock } }));
vi.mock('@/lib/audit/log', () => ({ logAudit: vi.fn(async () => 'audit-1') }));

import { logAudit } from '@/lib/audit/log';

import {
  deactivatePaymentAccount,
  upsertPaymentAccount,
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

beforeEach(() => vi.clearAllMocks());

describe('upsertPaymentAccount', () => {
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
    const { tx, sqls } = makeTx([[{ id: 'acc-1', api_key_hash: 'hash-nova', active: true }]]);
    runWithTx(tx);

    await expect(upsertPaymentAccount(baseInput)).resolves.toEqual({ id: 'acc-1', changed: false });

    expect(sqls).toHaveLength(1); // só o SELECT
    expect(logAudit).not.toHaveBeenCalled();
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

describe('deactivatePaymentAccount', () => {
  it('APAGA a chave em vez de apenas marcar inativa', async () => {
    const { tx, sqls } = makeTx([[{ id: 'acc-1' }]]);
    runWithTx(tx);

    await expect(
      deactivatePaymentAccount({ clinicId: 'clinic-1', userId: 'user-1', requestContext: ctx }),
    ).resolves.toEqual({ changed: true });

    const update = sqls[0] ?? '';
    expect(update).toContain('api_key_encrypted = NULL');
    expect(update).toContain('api_key_hash = NULL');
    // Sem conta, nenhum webhook daquela clínica pode ser aceito.
    expect(update).toContain('webhook_token_encrypted = NULL');
    expect(update).toContain('active = false');
    expect(update).toContain('WHERE clinic_id =');
    expect(logAudit).toHaveBeenCalledTimes(1);
  });

  it('é idempotente: nada ativo para desconectar não vira evento de auditoria', async () => {
    const { tx } = makeTx([[]]);
    runWithTx(tx);

    await expect(
      deactivatePaymentAccount({ clinicId: 'clinic-1', userId: 'user-1', requestContext: ctx }),
    ).resolves.toEqual({ changed: false });

    expect(logAudit).not.toHaveBeenCalled();
  });
});
