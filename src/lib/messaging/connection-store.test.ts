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
const { transactionMock, executeMock } = vi.hoisted(() => ({
  transactionMock: vi.fn(),
  executeMock: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ dbAdmin: { transaction: transactionMock, execute: executeMock } }));
vi.mock('@/lib/audit/log', () => ({ logAudit: vi.fn(async () => 'audit-1') }));

import { logAudit } from '@/lib/audit/log';

import {
  deactivateTenantConnection,
  listConnectionsDueForMessagingHealth,
  loadConnectionForMessagingHealth,
  recordMessagingHealth,
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
    // A saúde de envio (0116) recomeça na reconexão; o connect a relê em seguida.
    expect(sqls[1]).toMatch(/messaging_health = NULL/);
    expect(sqls[1]).toMatch(/messaging_health_checked_at = NULL/);
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

describe('saúde de envio (0116)', () => {
  /** tx falso que guarda SQL E parâmetros: o estado e os códigos vão como parâmetro. */
  function makeParamTx(returns: unknown[][]) {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    let i = 0;
    const execute = vi.fn(async (q: SQL) => {
      queries.push(dialect.sqlToQuery(q));
      return returns[i++] ?? [];
    });
    return { tx: { execute }, queries };
  }

  const input = {
    clinicId: 'clinic-1',
    connectionId: 'conn-1',
    state: 'blocked' as const,
    codes: [141006, 141010],
    requestContext: ctx,
    userId: null,
  };

  it('available → blocked: trava a linha ativa da clínica, grava e audita a mudança', async () => {
    const { tx, queries } = makeParamTx([
      [{ messaging_health: 'available', messaging_health_codes: [] }],
      [],
    ]);
    runWithTx(tx);

    const res = await recordMessagingHealth(input);

    expect(res).toEqual({ recorded: true, changed: true, previous: 'available' });
    expect(queries[0]!.sql).toMatch(/for update/i);
    expect(queries[0]!.sql).toMatch(/active = true/);
    expect(queries[0]!.params).toEqual(['conn-1', 'clinic-1']);
    expect(queries[1]!.sql).toMatch(/messaging_health_codes = \$2::integer\[\]/);
    expect(queries[1]!.sql).toMatch(/messaging_health_checked_at = now\(\)/);
    expect(queries[1]!.params).toEqual(['blocked', '{141006,141010}', 'conn-1', 'clinic-1']);
    expect(vi.mocked(logAudit).mock.calls[0]![1]).toMatchObject({
      action: 'messaging.whatsapp.messaging_health_changed',
      resourceType: 'whatsapp_number',
      resourceId: 'conn-1',
      userId: null,
      before: { messagingHealth: 'available', codes: [] },
      after: { messagingHealth: 'blocked', codes: [141006, 141010] },
    });
  });

  it('mesma leitura: só anda o checked_at, sem auditoria', async () => {
    const { tx, queries } = makeParamTx([
      [{ messaging_health: 'blocked', messaging_health_codes: [141006, 141010] }],
      [],
    ]);
    runWithTx(tx);

    const res = await recordMessagingHealth(input);

    expect(res).toEqual({ recorded: true, changed: false, previous: 'blocked' });
    expect(queries).toHaveLength(2);
    expect(logAudit).not.toHaveBeenCalled();
  });

  it('códigos diferentes no mesmo estado contam como mudança', async () => {
    const { tx } = makeParamTx([
      [{ messaging_health: 'blocked', messaging_health_codes: [141006] }],
      [],
    ]);
    runWithTx(tx);

    expect((await recordMessagingHealth(input)).changed).toBe(true);
    expect(logAudit).toHaveBeenCalledTimes(1);
  });

  it('primeira leitura disponível não é fato a auditar; primeira bloqueada é', async () => {
    const first = makeParamTx([[{ messaging_health: null, messaging_health_codes: [] }], []]);
    runWithTx(first.tx);
    expect(await recordMessagingHealth({ ...input, state: 'available', codes: [] })).toEqual({
      recorded: true,
      changed: true,
      previous: null,
    });
    expect(logAudit).not.toHaveBeenCalled();

    const blocked = makeParamTx([[{ messaging_health: null, messaging_health_codes: [] }], []]);
    runWithTx(blocked.tx);
    await recordMessagingHealth(input);
    expect(logAudit).toHaveBeenCalledTimes(1);
  });

  it('conexão desativada entre a leitura e a gravação não é tocada', async () => {
    const { tx, queries } = makeParamTx([[]]);
    runWithTx(tx);

    expect(await recordMessagingHealth(input)).toEqual({
      recorded: false,
      changed: false,
      previous: null,
    });
    expect(queries).toHaveLength(1);
    expect(logAudit).not.toHaveBeenCalled();
  });

  it('código que não é inteiro positivo nunca chega ao literal do array', async () => {
    const { tx, queries } = makeParamTx([
      [{ messaging_health: null, messaging_health_codes: [] }],
      [],
    ]);
    runWithTx(tx);

    await recordMessagingHealth({ ...input, codes: [141006, -1, 1.5, Number.NaN] });
    expect(queries[1]!.params[1]).toBe('{141006}');
  });

  it('varredura diária: nunca lidas primeiro, depois as mais antigas, até o corte', async () => {
    executeMock.mockResolvedValueOnce([
      {
        id: 'conn-1',
        clinic_id: 'clinic-1',
        meta_phone_id: 'phone-1',
        token_encrypted: 'enc',
        messaging_health_checked_at: null,
      },
      {
        id: 'conn-2',
        clinic_id: 'clinic-2',
        meta_phone_id: 'phone-2',
        token_encrypted: 'enc-2',
        messaging_health_checked_at: '2026-10-07T10:30:00.000Z',
      },
    ]);

    const rows = await listConnectionsDueForMessagingHealth(
      100,
      new Date('2026-10-07T16:00:00.000Z'),
    );

    const query = dialect.sqlToQuery(executeMock.mock.calls[0]![0] as SQL);
    expect(query.sql).toMatch(/active = true/);
    expect(query.sql).toMatch(/messaging_health_checked_at IS NULL/);
    expect(query.sql).toMatch(/NULLS FIRST/);
    expect(query.params).toEqual(['2026-10-07T16:00:00.000Z', 100]);
    expect(rows.map((r) => r.messagingHealthCheckedAt)).toEqual([
      null,
      new Date('2026-10-07T10:30:00.000Z'),
    ]);
  });

  it('carga por clínica: só a conexão ativa, com a credencial cifrada', async () => {
    executeMock.mockResolvedValueOnce([]);
    expect(await loadConnectionForMessagingHealth('clinic-1')).toBeNull();
    const query = dialect.sqlToQuery(executeMock.mock.calls[0]![0] as SQL);
    expect(query.sql).toMatch(/clinic_id = \$1 AND active = true/);
    expect(query.params).toEqual(['clinic-1']);
  });
});
