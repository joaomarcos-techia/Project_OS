/**
 * F2 — connection-store (seam privilegiado de escrita). Caso 4 do brief: a ordem
 * do upsert. `dbAdmin`/`logAudit` mockados; o `sql` real é compilado para texto
 * (PgDialect) para asserir UPDATE in-place vs INSERT e a desativação prévia.
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.hoisted: a fábrica do vi.mock é içada acima dos imports; expor o spy por aqui
// evita um `import { dbAdmin }` (origem de conexão proibida pelo arch:db-check).
const { transactionMock } = vi.hoisted(() => ({ transactionMock: vi.fn() }));
vi.mock('@/lib/db', () => ({ dbAdmin: { transaction: transactionMock } }));
vi.mock('@/lib/audit/log', () => ({ logAudit: vi.fn(async () => 'audit-1') }));

import { logAudit } from '@/lib/audit/log';

import {
  deactivateTenantConnection,
  upsertTenantConnection,
  type UpsertTenantConnectionInput,
} from './connection-store';

const dialect = new PgDialect();
const ctx = { ip: null, userAgent: null, requestId: 'r', correlationId: 'r' };

/** tx falso: registra o SQL compilado de cada execute e devolve filas pré-setadas. */
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

const baseInput: UpsertTenantConnectionInput = {
  clinicId: 'clinic-1',
  userId: 'user-1',
  provider: 'meta',
  phoneNumber: '+5511999991234',
  metaPhoneId: 'phone-1',
  metaBusinessId: 'waba-1',
  tokenEncrypted: 'enc(TOKEN)',
  coexistence: false,
  requestContext: ctx,
};

beforeEach(() => vi.clearAllMocks());

describe('upsertTenantConnection (Caso 4)', () => {
  it('número já existe (reconexão) → UPDATE in-place, sem INSERT, desativa outras', async () => {
    const { tx, sqls } = makeTx([[{ id: 'found-1' }], [], []]);
    runWithTx(tx);

    const res = await upsertTenantConnection(baseInput);

    expect(res.id).toBe('found-1'); // id da linha existente, não de um INSERT
    expect(tx.execute).toHaveBeenCalledTimes(3);
    expect(sqls[0]).toMatch(/select id/i);
    expect(sqls[0]).toMatch(/meta_phone_id/i);
    // UPDATE in-place reativa + bump de token_version
    expect(sqls[1]).toMatch(/update/i);
    expect(sqls[1]).toMatch(/token_version = token_version \+ 1/i);
    // desativa OUTRAS ativas (id <>)
    expect(sqls[2]).toMatch(/active = false/i);
    expect(sqls[2]).toMatch(/id <>/i);
    // jamais cria 2ª linha
    expect(sqls.join('\n')).not.toMatch(/insert into/i);

    expect(logAudit).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logAudit).mock.calls[0]![1]).toMatchObject({
      action: 'messaging.whatsapp.connected',
      resourceId: 'found-1',
    });
    // payload de audit mascarado, sem o número completo
    const after = vi.mocked(logAudit).mock.calls[0]![1].after as { phoneNumberMasked: string };
    expect(after.phoneNumberMasked).not.toBe('+5511999991234');
  });

  it('número novo → desativa ativas ANTES do INSERT da nova ativa', async () => {
    const { tx, sqls } = makeTx([[], [], [{ id: 'new-1' }]]);
    runWithTx(tx);

    const res = await upsertTenantConnection(baseInput);

    expect(res.id).toBe('new-1');
    expect(tx.execute).toHaveBeenCalledTimes(3);
    expect(sqls[0]).toMatch(/select id/i);
    expect(sqls[1]).toMatch(/active = false/i); // desativa antes
    expect(sqls[2]).toMatch(/insert into "?clinic_whatsapp_numbers"?/i);
    expect(logAudit).toHaveBeenCalledTimes(1);
  });
});

describe('deactivateTenantConnection', () => {
  it('com ativo → active=false + audit disconnected', async () => {
    const { tx, sqls } = makeTx([[{ id: 'num-1' }]]);
    runWithTx(tx);

    const res = await deactivateTenantConnection({
      clinicId: 'clinic-1',
      userId: 'user-1',
      requestContext: ctx,
    });

    expect(res.disconnected).toBe(true);
    expect(sqls[0]).toMatch(/active = false/i);
    expect(vi.mocked(logAudit).mock.calls[0]![1]).toMatchObject({
      action: 'messaging.whatsapp.disconnected',
    });
  });

  it('sem ativo → disconnected=false, sem audit', async () => {
    const { tx } = makeTx([[]]);
    runWithTx(tx);

    const res = await deactivateTenantConnection({
      clinicId: 'clinic-1',
      userId: 'user-1',
      requestContext: ctx,
    });

    expect(res.disconnected).toBe(false);
    expect(logAudit).not.toHaveBeenCalled();
  });
});
