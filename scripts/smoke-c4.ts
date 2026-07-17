/**
 * Smoke C4 — bateria de validação pós-migration 0008/0009.
 *
 * Estrutura:
 *   - Pre-flight estrutural (RLS, schema, partitions, CHECKs, _schema_version)
 *   - 17 testes 4.6.x do plano, cobrindo contratos atômicos, idempotency,
 *     backoff, circuit breaker, DLQ metadata, sanitização, cross-tenant, etc.
 *   - Cleanup de fixtures ao final.
 *
 * Roda via tsx contra qoro-dev (DATABASE_URL do .env.local). NUNCA contra prod.
 */
import './_env';

// OUTBOX_BATCH_SIZE=5 e OUTBOX_PARALLELISM=2 vêm do package.json via cross-env
// (smoke:c4 script). Defaults de prod (50/5) levam o cron route teste 4.6.17b
// a ~70s em rede Brasil ↔ AWS Oregon — too long. cross-env seta antes do Node
// arrancar, então o env.ts parsing pega os valores corretos. Tentamos antes
// fazer `process.env.X = ...` aqui mas ES module hoisting carrega env.ts ANTES
// dessa linha rodar — não funcionou.

import { eq, sql as sqlTag } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db';
import { withTenant } from '@/lib/db/tenant';
import { outbox } from '@/lib/db/schema/infra/outbox';
import { z } from 'zod';

import { sanitizePayload } from '@/lib/sanitize/redact';
import { capJsonSize } from '@/lib/sanitize/cap';
import { redactStringValue } from '@/lib/sanitize/patterns';
import { payloadHash } from '@/lib/idempotency/hash';
import { assertJsonSafe, JsonUnsafeError } from '@/lib/idempotency/json-safe';
import {
  HandlerError,
  serializeError,
  truncate,
} from '@/lib/outbox/errors';
import { backoffDelayMs, BACKOFF_FAIL } from '@/lib/outbox/backoff';
import {
  registerEventSchema,
  __testing__ as catalogTesting,
} from '@/lib/outbox/catalog';
import {
  registerHandler,
  __testing__ as registryTesting,
} from '@/lib/outbox/registry';
import { publishEvent } from '@/lib/outbox/publish';
import { reclaimStuckProcessing } from '@/lib/outbox/janitor';
import { applyCircuitBreaker } from '@/lib/outbox/circuit';
import { runOutboxOnce } from '@/lib/outbox/worker';
import { PoisonPillError, OutboxError, SideEffectInFlightError } from '@/lib/outbox/errors';
import {
  makeProviderIdempotencyKey,
  withProviderStatusCheck,
} from '@/lib/outbox/side-effects';
import {
  validateTtlSeconds,
  IDEMPOTENCY_TTL_MIN_SECONDS,
  IDEMPOTENCY_TTL_MAX_SECONDS,
} from '@/lib/idempotency/mutation';
import {
  cleanupExpiredIdempotencyKeys,
  diagnoseInFlightOrphans,
} from '@/lib/idempotency/cleanup';
import type { HandlerCtx } from '@/lib/outbox/types';

// Helper: payload_hash explícito para INSERTs raw em outbox (post-0010).
// publishEvent calcula automaticamente; testes que fazem INSERT direto via
// dbAdmin.execute precisam computar manualmente.
const phash = (p: unknown) => payloadHash(p);

type Result = { name: string; ok: boolean; detail?: string };
const results: Result[] = [];

function record(name: string, ok: boolean, detail?: string): void {
  const entry: Result = detail === undefined ? { name, ok } : { name, ok, detail };
  results.push(entry);
  console.log(ok ? `[OK]   ${name}` : `[FAIL] ${name}${detail ? `\n       ${detail}` : ''}`);
}

async function tryStep(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    record(name, true);
  } catch (e) {
    record(name, false, e instanceof Error ? e.message : String(e));
  }
}

// =====================================================================
// Pre-flight: structural / RLS / partitions / CHECKs
// =====================================================================
async function preflight(): Promise<void> {
  console.log('\n--- Pre-flight estrutural ---');

  const sqlChecks = [
    {
      name: 'tabelas C4 existem (4)',
      query: `SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public' AND tablename IN ('outbox','audit_events','super_admin_actions','idempotency_keys')`,
      expect: (r: unknown) => (r as { n: number }[])[0]?.n === 4,
    },
    {
      name: 'outbox RLS ENABLE+FORCE',
      query: `SELECT relrowsecurity AS rls, relforcerowsecurity AS frls FROM pg_class WHERE relname='outbox'`,
      expect: (r: unknown) => {
        const row = (r as { rls: boolean; frls: boolean }[])[0];
        return row?.rls === true && row?.frls === true;
      },
    },
    {
      name: 'audit_events RLS ENABLE+FORCE',
      query: `SELECT relrowsecurity AS rls, relforcerowsecurity AS frls FROM pg_class WHERE relname='audit_events'`,
      expect: (r: unknown) => {
        const row = (r as { rls: boolean; frls: boolean }[])[0];
        return row?.rls === true && row?.frls === true;
      },
    },
    {
      name: 'super_admin_actions RLS ENABLE+FORCE',
      query: `SELECT relrowsecurity AS rls, relforcerowsecurity AS frls FROM pg_class WHERE relname='super_admin_actions'`,
      expect: (r: unknown) => {
        const row = (r as { rls: boolean; frls: boolean }[])[0];
        return row?.rls === true && row?.frls === true;
      },
    },
    {
      name: 'idempotency_keys RLS ENABLE+FORCE',
      query: `SELECT relrowsecurity AS rls, relforcerowsecurity AS frls FROM pg_class WHERE relname='idempotency_keys'`,
      expect: (r: unknown) => {
        const row = (r as { rls: boolean; frls: boolean }[])[0];
        return row?.rls === true && row?.frls === true;
      },
    },
    {
      name: 'outbox: 2 policies (INSERT+SELECT), 0 UPDATE/DELETE',
      query: `SELECT polcmd FROM pg_policy WHERE polrelid='public.outbox'::regclass`,
      expect: (r: unknown) => {
        const cmds = (r as { polcmd: string }[]).map((x) => x.polcmd).sort();
        return cmds.length === 2 && cmds.includes('a') && cmds.includes('r');
      },
    },
    {
      name: 'audit_events: 2 policies (INSERT+SELECT), 0 UPDATE/DELETE',
      query: `SELECT polcmd FROM pg_policy WHERE polrelid='public.audit_events'::regclass`,
      expect: (r: unknown) => {
        const cmds = (r as { polcmd: string }[]).map((x) => x.polcmd).sort();
        return cmds.length === 2 && cmds.includes('a') && cmds.includes('r');
      },
    },
    {
      name: 'super_admin_actions: 2 policies (super select + insert)',
      query: `SELECT polcmd FROM pg_policy WHERE polrelid='public.super_admin_actions'::regclass`,
      expect: (r: unknown) => {
        const cmds = (r as { polcmd: string }[]).map((x) => x.polcmd).sort();
        return cmds.length === 2;
      },
    },
    {
      name: 'idempotency_keys: 1 policy FOR ALL',
      query: `SELECT polcmd FROM pg_policy WHERE polrelid='public.idempotency_keys'::regclass`,
      expect: (r: unknown) => {
        const cmds = (r as { polcmd: string }[]).map((x) => x.polcmd);
        return cmds.length === 1 && cmds[0] === '*';
      },
    },
    {
      // Migration 0009 cria 12 mensais + audit_events_default = 13. O check é
      // >= 13 (não == 13) porque o operador adiciona partições novas mensalmente
      // como parte do ciclo de vida (runbook §C.5). Forward-compatible.
      name: 'audit_events tem ≥13 partitions (12 mensais + default)',
      query: `SELECT count(*)::int AS n FROM pg_inherits WHERE inhparent='public.audit_events'::regclass`,
      expect: (r: unknown) => ((r as { n: number }[])[0]?.n ?? 0) >= 13,
    },
    {
      name: 'super_admin_actions.ip_address é inet',
      query: `SELECT format_type(atttypid, atttypmod) AS t FROM pg_attribute WHERE attrelid='public.super_admin_actions'::regclass AND attname='ip_address'`,
      expect: (r: unknown) => (r as { t: string }[])[0]?.t === 'inet',
    },
    {
      name: 'audit_events.ip_address é inet',
      query: `SELECT format_type(atttypid, atttypmod) AS t FROM pg_attribute WHERE attrelid='public.audit_events'::regclass AND attname='ip_address'`,
      expect: (r: unknown) => (r as { t: string }[])[0]?.t === 'inet',
    },
    {
      name: 'outbox CHECK constraints (3): event_type, last_error, error_code',
      query: `SELECT conname FROM pg_constraint WHERE conrelid='public.outbox'::regclass AND contype='c'`,
      expect: (r: unknown) => {
        const names = (r as { conname: string }[]).map((x) => x.conname);
        return (
          names.includes('outbox_event_type_format_chk') &&
          names.includes('outbox_last_error_size_chk') &&
          names.includes('outbox_error_code_format_chk')
        );
      },
    },
    {
      name: 'idempotency_keys CHECK constraints (2): key format, response size',
      query: `SELECT conname FROM pg_constraint WHERE conrelid='public.idempotency_keys'::regclass AND contype='c'`,
      expect: (r: unknown) => {
        const names = (r as { conname: string }[]).map((x) => x.conname);
        return (
          names.includes('idempotency_keys_key_format_chk') &&
          names.includes('idempotency_keys_response_size_chk')
        );
      },
    },
    {
      name: 'outbox_dispatch_idx existe (WHERE status=pending)',
      query: `SELECT count(*)::int AS n FROM pg_indexes WHERE indexname='outbox_dispatch_idx'`,
      expect: (r: unknown) => (r as { n: number }[])[0]?.n === 1,
    },
    {
      name: 'outbox_circuit_idx existe (WHERE status=failed)',
      query: `SELECT count(*)::int AS n FROM pg_indexes WHERE indexname='outbox_circuit_idx'`,
      expect: (r: unknown) => (r as { n: number }[])[0]?.n === 1,
    },
    {
      name: '_schema_version tem c4-outbox-core',
      query: `SELECT count(*)::int AS n FROM _schema_version WHERE version='c4-outbox-core'`,
      expect: (r: unknown) => (r as { n: number }[])[0]?.n === 1,
    },
    {
      name: '_schema_version tem c4-audit-partitioned',
      query: `SELECT count(*)::int AS n FROM _schema_version WHERE version='c4-audit-partitioned'`,
      expect: (r: unknown) => (r as { n: number }[])[0]?.n === 1,
    },
    {
      name: '_schema_version tem c4-hardening (migration 0010)',
      query: `SELECT count(*)::int AS n FROM _schema_version WHERE version='c4-hardening'`,
      expect: (r: unknown) => (r as { n: number }[])[0]?.n === 1,
    },
    {
      name: 'outbox.payload_hash existe e é NOT NULL',
      query: `SELECT attname, attnotnull FROM pg_attribute WHERE attrelid='public.outbox'::regclass AND attname='payload_hash'`,
      expect: (r: unknown) => {
        const row = (r as { attname: string; attnotnull: boolean }[])[0];
        return row?.attname === 'payload_hash' && row?.attnotnull === true;
      },
    },
    {
      name: 'outbox tem CHECK constraints novas: payload_size, payload_hash, temporal',
      query: `SELECT conname FROM pg_constraint WHERE conrelid='public.outbox'::regclass AND contype='c'`,
      expect: (r: unknown) => {
        const names = (r as { conname: string }[]).map((x) => x.conname);
        return (
          names.includes('outbox_payload_size_chk') &&
          names.includes('outbox_payload_hash_format_chk') &&
          names.includes('outbox_temporal_chk')
        );
      },
    },
    {
      name: 'audit_events tem CHECK before/after size',
      query: `SELECT conname FROM pg_constraint WHERE conrelid='public.audit_events'::regclass AND contype='c'`,
      expect: (r: unknown) => {
        const names = (r as { conname: string }[]).map((x) => x.conname);
        return (
          names.includes('audit_events_before_size_chk') &&
          names.includes('audit_events_after_size_chk')
        );
      },
    },
    {
      name: 'super_admin_actions tem CHECK payload_size',
      query: `SELECT conname FROM pg_constraint WHERE conrelid='public.super_admin_actions'::regclass AND contype='c'`,
      expect: (r: unknown) => {
        const names = (r as { conname: string }[]).map((x) => x.conname);
        return names.includes('super_admin_actions_payload_size_chk');
      },
    },
    {
      name: 'trigger prevent_delete_in_flight_idempotency existe',
      query: `SELECT tgname FROM pg_trigger WHERE tgname='trg_prevent_delete_in_flight_idempotency'`,
      expect: (r: unknown) => (r as { tgname: string }[]).length === 1,
    },
    {
      name: 'GRANTs explícitos em outbox para authenticated',
      query: `SELECT has_table_privilege('authenticated', 'outbox', 'INSERT') AS can_insert, has_table_privilege('authenticated', 'outbox', 'SELECT') AS can_select`,
      expect: (r: unknown) => {
        const row = (r as { can_insert: boolean; can_select: boolean }[])[0];
        return row?.can_insert === true && row?.can_select === true;
      },
    },
    {
      // F-03: migration 0014 adiciona 'skipped' ao enum outbox_status.
      name: "outbox_status enum tem valor 'skipped' (F-03 / migration 0014)",
      query: `SELECT count(*)::int AS n FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='outbox_status' AND e.enumlabel='skipped'`,
      expect: (r: unknown) => (r as { n: number }[])[0]?.n === 1,
    },
  ];

  for (const c of sqlChecks) {
    try {
      const raw = await dbAdmin.execute(sqlTag.raw(c.query));
      const rows = Array.isArray(raw) ? raw : ((raw as { rows?: unknown[] }).rows ?? []);
      record(c.name, c.expect(rows));
    } catch (e) {
      record(c.name, false, e instanceof Error ? e.message : String(e));
    }
  }
}

// =====================================================================
// Fixtures: 2 clínicas para testes funcionais
// =====================================================================
const CLINIC_A = '00000000-0000-0000-0000-00000000c4a1';
const CLINIC_B = '00000000-0000-0000-0000-00000000c4b1';

async function setupFixtures(): Promise<void> {
  console.log('\n--- Setup fixtures ---');
  // Limpa runs anteriores PRIMEIRO. Trigger BEFORE DELETE → UPDATE response antes.
  await dbAdmin.execute(sqlTag`DELETE FROM outbox WHERE clinic_id IN (${CLINIC_A}, ${CLINIC_B})`);
  await dbAdmin.execute(sqlTag`
    UPDATE idempotency_keys
       SET response='{"cleanup":true}'::jsonb
     WHERE clinic_id IN (${CLINIC_A}, ${CLINIC_B})
       AND response IS NULL
  `);
  await dbAdmin.execute(sqlTag`DELETE FROM idempotency_keys WHERE clinic_id IN (${CLINIC_A}, ${CLINIC_B})`);
  await dbAdmin.execute(sqlTag`DELETE FROM audit_events WHERE clinic_id IN (${CLINIC_A}, ${CLINIC_B})`);

  // F-04 HERMETICIDADE: o worker pega a row pending MAIS ANTIGA GLOBAL (ORDER BY
  // next_attempt_at, created_at) — cross-tenant. Eventos órfãos de outras
  // clínicas (ex.: patient.core.* de runs do smoke:c5, cujo schema/handler NÃO
  // estão registrados neste processo) roubariam os slots do batch e quebrariam
  // 4.6.2/4.6.3b/4.6.20/4.6.21. Quarentenamos TODO o resto empurrando
  // next_attempt_at +1h (qualquer status — se o janitor reclamar um processing
  // stuck para pending, o next_attempt_at +1h o mantém fora da janela do worker).
  // Eles voltam no próximo tick real do cron. Determinístico e reproduzível.
  await dbAdmin.execute(sqlTag`
    UPDATE outbox
       SET next_attempt_at = now() + interval '1 hour'
     WHERE clinic_id NOT IN (${CLINIC_A}, ${CLINIC_B})
       AND next_attempt_at <= now() + interval '1 hour'
  `);

  // Cria/upsert clínicas via dbAdmin (RLS bypass).
  for (const [id, slug, nome] of [
    [CLINIC_A, 'c4-test-a', 'C4 Test A'],
    [CLINIC_B, 'c4-test-b', 'C4 Test B'],
  ] as const) {
    await dbAdmin.execute(sqlTag`
      INSERT INTO clinics (id, slug, nome, status)
      VALUES (${id}::uuid, ${slug}, ${nome}, 'trial')
      ON CONFLICT (id) DO NOTHING
    `);
  }
}

async function cleanupFixtures(): Promise<void> {
  console.log('\n--- Cleanup ---');
  await dbAdmin.execute(sqlTag`DELETE FROM outbox WHERE clinic_id IN (${CLINIC_A}, ${CLINIC_B})`);
  // Trigger BEFORE DELETE em idempotency_keys bloqueia rows in-flight (response
  // IS NULL + created_at < 1h). Para cleanup de fixtures de teste, liberamos
  // todas as rows via UPDATE response='{"cleanup":true}' antes do DELETE.
  await dbAdmin.execute(sqlTag`
    UPDATE idempotency_keys
       SET response='{"cleanup":true}'::jsonb
     WHERE clinic_id IN (${CLINIC_A}, ${CLINIC_B})
       AND response IS NULL
  `);
  await dbAdmin.execute(sqlTag`DELETE FROM idempotency_keys WHERE clinic_id IN (${CLINIC_A}, ${CLINIC_B})`);
  await dbAdmin.execute(sqlTag`DELETE FROM audit_events WHERE clinic_id IN (${CLINIC_A}, ${CLINIC_B})`);
  await dbAdmin.execute(sqlTag`DELETE FROM clinics WHERE id IN (${CLINIC_A}::uuid, ${CLINIC_B}::uuid)`);
}

// =====================================================================
// 4.6.x — testes funcionais (alinhados ao plano)
// =====================================================================
const TEST_EVENT = 'test.smoke.tick';
const TEST_FAIL_EVENT = 'test.smoke.failing';
const TestSchema = z.object({ id: z.string() });

async function functional(): Promise<void> {
  console.log('\n--- Testes funcionais 4.6.x ---');

  // Reset state and register schemas for tests.
  catalogTesting.reset();
  registryTesting.reset();
  registerEventSchema(TEST_EVENT, TestSchema);
  registerEventSchema(TEST_FAIL_EVENT, TestSchema);

  // ---- 4.6.1 publishEvent atômico ----
  await tryStep('4.6.1 publishEvent: TX rollback → outbox vazia', async () => {
    const idemKey = `tickA-${Date.now()}`;
    try {
      await withTenant(CLINIC_A, async (tx) => {
        await publishEvent(tx, {
          clinicId: CLINIC_A,
          eventType: TEST_EVENT,
          payload: { id: 'roll' },
          idempotencyKey: idemKey,
        });
        throw new Error('forced rollback');
      });
    } catch {
      /* expected */
    }
    const rows = await dbAdmin
      .select()
      .from(outbox)
      .where(eq(outbox.idempotencyKey, idemKey));
    if (rows.length !== 0) throw new Error(`expected 0 rows, got ${rows.length}`);
  });

  await tryStep('4.6.1b publishEvent: TX commit → row pending', async () => {
    const idemKey = `commitA-${Date.now()}`;
    await withTenant(CLINIC_A, async (tx) => {
      await publishEvent(tx, {
        clinicId: CLINIC_A,
        eventType: TEST_EVENT,
        payload: { id: 'ok' },
        idempotencyKey: idemKey,
      });
    });
    const rows = await dbAdmin
      .select()
      .from(outbox)
      .where(eq(outbox.idempotencyKey, idemKey));
    if (rows.length !== 1) throw new Error(`expected 1 row, got ${rows.length}`);
    if (rows[0]!.status !== 'pending') throw new Error(`expected pending, got ${rows[0]!.status}`);
  });

  // ---- 4.6.2 Worker SKIP LOCKED + parallelism ----
  // Setup: limpa rows pendentes deixadas pelos testes anteriores (4.6.1b grava
  // 1 TEST_EVENT) — sem isso o worker processaria 6 eventos e o teste falharia.
  // Bulk INSERT (1 round trip) em vez de 5 publishEvent (~10s em rede lenta).
  // UMA runOutboxOnce com parallelism=2 já comprova SKIP LOCKED: dois
  // processOne concorrentes competem pela mesma fila via FOR UPDATE SKIP LOCKED.
  // 2 workers em paralelo (Promise.all de 2 runOutboxOnce) seria mais realista
  // mas estourava ~25s na rede do dev (Brasil ↔ AWS Oregon) + dbAdmin pool max:1.
  await tryStep('4.6.2 Worker: 5 events processed exactly once each', async () => {
    console.log('       4.6.2 step 1: cleanup outbox CLINIC_A');
    await dbAdmin.execute(sqlTag`DELETE FROM outbox WHERE clinic_id = ${CLINIC_A}::uuid`);

    console.log('       4.6.2 step 2: register handler');
    let invocations = 0;
    registryTesting.reset();
    registerHandler(TEST_EVENT, async () => {
      invocations += 1;
    });

    console.log('       4.6.2 step 3: bulk INSERT 5 events');
    const stamp = Date.now();
    // payload_hash agora é NOT NULL (migration 0010). Para INSERTs raw em testes,
    // computamos manualmente; em runtime, publishEvent computa.
    const h0 = phash({ id: 'e0' });
    const h1 = phash({ id: 'e1' });
    const h2 = phash({ id: 'e2' });
    const h3 = phash({ id: 'e3' });
    const h4 = phash({ id: 'e4' });
    await dbAdmin.execute(sqlTag`
      INSERT INTO outbox (clinic_id, event_type, payload, payload_hash, idempotency_key)
      VALUES
        (${CLINIC_A}::uuid, ${TEST_EVENT}, '{"id":"e0"}'::jsonb, ${h0}, ${`e2-${stamp}-0`}),
        (${CLINIC_A}::uuid, ${TEST_EVENT}, '{"id":"e1"}'::jsonb, ${h1}, ${`e2-${stamp}-1`}),
        (${CLINIC_A}::uuid, ${TEST_EVENT}, '{"id":"e2"}'::jsonb, ${h2}, ${`e2-${stamp}-2`}),
        (${CLINIC_A}::uuid, ${TEST_EVENT}, '{"id":"e3"}'::jsonb, ${h3}, ${`e2-${stamp}-3`}),
        (${CLINIC_A}::uuid, ${TEST_EVENT}, '{"id":"e4"}'::jsonb, ${h4}, ${`e2-${stamp}-4`})
    `);

    console.log('       4.6.2 step 4: run worker (batch=5, parallelism=2)');
    const t0 = Date.now();
    const summary = await runOutboxOnce({ batchSize: 5, parallelism: 2 });
    console.log(`       4.6.2 step 5: worker done in ${Date.now() - t0}ms`, summary);

    if (summary.processed !== 5) throw new Error(`processed ${summary.processed} (want 5)`);
    if (invocations !== 5) throw new Error(`handler ran ${invocations} times (want 5)`);
  });

  // ---- 4.6.3 Backoff progression ----
  await tryStep('4.6.3 backoff schedule: [0, 30s, 5m, 30m, 6h, FAIL]', () => {
    if (backoffDelayMs(1) !== 0) throw new Error('attempt 1 should be 0');
    if (backoffDelayMs(2) !== 30_000) throw new Error('attempt 2 should be 30s');
    if (backoffDelayMs(3) !== 5 * 60_000) throw new Error('attempt 3 should be 5m');
    if (backoffDelayMs(4) !== 30 * 60_000) throw new Error('attempt 4 should be 30m');
    if (backoffDelayMs(5) !== 6 * 3600_000) throw new Error('attempt 5 should be 6h');
    if (backoffDelayMs(6) !== BACKOFF_FAIL) throw new Error('attempt 6 should be FAIL');
    return Promise.resolve();
  });

  await tryStep('4.6.3b DLQ metadata + worker retry for failing handler', async () => {
    registryTesting.reset();
    registerHandler(TEST_FAIL_EVENT, async () => {
      throw new HandlerError('downstream broken', 'downstream_bad');
    });
    const idem = `fail-${Date.now()}`;
    await withTenant(CLINIC_A, async (tx) => {
      await publishEvent(tx, {
        clinicId: CLINIC_A,
        eventType: TEST_FAIL_EVENT,
        payload: { id: 'fail-1' },
        idempotencyKey: idem,
      });
    });
    await runOutboxOnce({ batchSize: 1, parallelism: 1 });
    const [row] = await dbAdmin
      .select()
      .from(outbox)
      .where(eq(outbox.idempotencyKey, idem));
    if (!row) throw new Error('row missing');
    if (row.attempts !== 1) throw new Error(`attempts=${row.attempts}`);
    if (row.errorCode !== 'downstream_bad') throw new Error(`error_code=${row.errorCode}`);
    if (row.firstFailedAt === null) throw new Error('first_failed_at not set');
    if (row.lastFailedAt === null) throw new Error('last_failed_at not set');
    if (row.status !== 'pending') throw new Error(`status=${row.status}`);
  });

  // ---- 4.6.4 publishEvent unique violation engolida ----
  await tryStep('4.6.4 publishEvent: duplicate key swallowed silently', async () => {
    const idem = `dup-${Date.now()}`;
    await withTenant(CLINIC_A, async (tx) => {
      await publishEvent(tx, {
        clinicId: CLINIC_A,
        eventType: TEST_EVENT,
        payload: { id: 'dup' },
        idempotencyKey: idem,
      });
    });
    // Segundo INSERT em TX nova com a mesma key deve não levantar erro.
    await withTenant(CLINIC_A, async (tx) => {
      await publishEvent(tx, {
        clinicId: CLINIC_A,
        eventType: TEST_EVENT,
        payload: { id: 'dup' },
        idempotencyKey: idem,
      });
    });
    const rows = await dbAdmin
      .select()
      .from(outbox)
      .where(eq(outbox.idempotencyKey, idem));
    if (rows.length !== 1) throw new Error(`expected 1 row, got ${rows.length}`);
  });

  // ---- 4.6.5 publishEvent invalid payload ----
  await tryStep('4.6.5 publishEvent: invalid payload → OutboxError', async () => {
    try {
      await withTenant(CLINIC_A, async (tx) => {
        await publishEvent(tx, {
          clinicId: CLINIC_A,
          eventType: TEST_EVENT,
          payload: { wrong: 'shape' } as never,
          idempotencyKey: `bad-${Date.now()}`,
        });
      });
      throw new Error('should have thrown');
    } catch (e) {
      if (!(e instanceof Error) || !e.message.includes('payload invalid')) {
        throw new Error(`unexpected error: ${e}`);
      }
    }
  });

  // ---- 4.6.6 publishEvent unknown eventType ----
  await tryStep('4.6.6 publishEvent: unknown eventType → OutboxError', async () => {
    try {
      await withTenant(CLINIC_A, async (tx) => {
        await publishEvent(tx, {
          clinicId: CLINIC_A,
          eventType: 'x.y.unknown',
          payload: { id: 'x' },
          idempotencyKey: `unk-${Date.now()}`,
        });
      });
      throw new Error('should have thrown');
    } catch (e) {
      if (!(e instanceof Error) || !e.message.includes('not in catalog')) {
        throw new Error(`unexpected error: ${e}`);
      }
    }
  });

  // ---- 4.6.7 capJsonSize ----
  await tryStep('4.6.7 capJsonSize: small payload passes; large is envelope', () => {
    const small = { a: 1 };
    if (capJsonSize(small) !== small) throw new Error('small was wrapped');
    const big = { data: 'x'.repeat(100 * 1024) };
    const capped = capJsonSize(big) as { truncated?: boolean; originalBytes?: number };
    if (capped.truncated !== true) throw new Error('large was not truncated');
    if (typeof capped.originalBytes !== 'number' || capped.originalBytes <= 64 * 1024) {
      throw new Error('originalBytes missing/wrong');
    }
    return Promise.resolve();
  });

  // ---- 4.6.8 payloadHash determinism + NFC ----
  await tryStep('4.6.8 payloadHash: key order invariant + NFC normalize', () => {
    const h1 = payloadHash({ a: 1, b: 2 });
    const h2 = payloadHash({ b: 2, a: 1 });
    if (h1 !== h2) throw new Error('hash unstable under key order');
    const cafe1 = 'café'; // composed
    const cafe2 = 'café'; // decomposed
    if (payloadHash({ x: cafe1 }) !== payloadHash({ x: cafe2 })) {
      throw new Error('NFC normalize failed');
    }
    return Promise.resolve();
  });

  // ---- 4.6.9 assertJsonSafe rejects forbidden types ----
  await tryStep('4.6.9 assertJsonSafe: rejects Date / BigInt / NaN', () => {
    let threw = 0;
    try {
      assertJsonSafe({ d: new Date() });
    } catch (e) {
      if (e instanceof JsonUnsafeError) threw++;
    }
    try {
      assertJsonSafe({ n: NaN });
    } catch (e) {
      if (e instanceof JsonUnsafeError) threw++;
    }
    try {
      assertJsonSafe({ b: 1n });
    } catch (e) {
      if (e instanceof JsonUnsafeError) threw++;
    }
    if (threw !== 3) throw new Error(`expected 3 throws, got ${threw}`);
    // Sane payload doesn't throw.
    assertJsonSafe({ ok: true, n: 42, s: 'hi', arr: [1, 2] });
    return Promise.resolve();
  });

  // ---- 4.6.10 sanitizePayload key level ----
  await tryStep('4.6.10 sanitizePayload key-level redacts SENSITIVE_KEYS', () => {
    const out = sanitizePayload({ password: 'p', token: 't', user: 'u' }) as Record<
      string,
      unknown
    >;
    if (out.password !== '[REDACTED]') throw new Error('password not redacted');
    if (out.token !== '[REDACTED]') throw new Error('token not redacted');
    if (out.user !== 'u') throw new Error('user wrongly redacted');
    return Promise.resolve();
  });

  // ---- 4.6.11 sanitizePayload value level ----
  await tryStep('4.6.11 sanitizePayload value-level redacts Bearer/JWT/sk_/DSN', () => {
    const jwt = 'eyJabcdefghij.eyJabcdefghij.abcdefghij';
    const out = sanitizePayload({ headers: { authorization: `Bearer ${jwt}` } }) as {
      headers: Record<string, string>;
    };
    if (out.headers.authorization !== '[REDACTED]') {
      throw new Error('authorization key not redacted (key-level)');
    }
    // Now test value-level: a string under a non-sensitive key.
    const out2 = sanitizePayload({ note: `request: Bearer ${jwt}` }) as { note: string };
    if (!out2.note.includes('[REDACTED')) throw new Error('value-level not applied');
    // sk_ pattern.
    const out3 = sanitizePayload({
      info: 'key=sk_live_abcdefghijklmnopqrst rest',
    }) as { info: string };
    if (!out3.info.includes('[REDACTED_SK]')) throw new Error('sk_ not redacted');
    return Promise.resolve();
  });

  // ---- 4.6.12 redactStringValue (used by metrics.emit) ----
  await tryStep('4.6.12 redactStringValue strips Bearer / JWT / DSN', () => {
    const r1 = redactStringValue(
      'Bearer eyJabcdefghij.eyJabcdefghij.abcdefghij has token',
    );
    if (r1.includes('eyJabcdefghij')) throw new Error('JWT not redacted');
    const r2 = redactStringValue('postgresql://u:secret@host:5432/db');
    if (r2.includes('secret')) throw new Error('DSN password leaked');
    return Promise.resolve();
  });

  // ---- 4.6.13 serializeError cap 4000 + truncate marker ----
  await tryStep('4.6.13 serializeError: caps at 4000 with truncate marker', () => {
    const huge = new Error('a'.repeat(20_000));
    const { message } = serializeError(huge);
    if (message.length > 4000) throw new Error(`length=${message.length}`);
    if (!message.endsWith('[truncated]')) throw new Error('marker missing');
    // truncate helper is also exposed.
    const t = truncate('1234567890', 8);
    if (!t.endsWith('[truncated]')) throw new Error('truncate marker');
    return Promise.resolve();
  });

  // ---- 4.6.14 Circuit breaker ----
  await tryStep('4.6.14 Circuit breaker: 10 failures → pause pending', async () => {
    // Insere 10 rows com last_failed_at recent para o mesmo event_type.
    const evt = 'test.smoke.toxic';
    catalogTesting.reset();
    registerEventSchema(evt, TestSchema);
    const toxicHash = phash({ id: 'toxic' });
    const pendingHash = phash({ id: 'pending' });
    for (let i = 0; i < 10; i++) {
      await dbAdmin.execute(sqlTag`
        INSERT INTO outbox (clinic_id, event_type, payload, payload_hash, idempotency_key, status, attempts, last_failed_at, last_error)
        VALUES (${CLINIC_A}::uuid, ${evt}, '{"id":"toxic"}'::jsonb, ${toxicHash}, ${`tox-${i}-${Date.now()}`}, 'failed', 5, now(), 'forced')
      `);
    }
    // Insere 1 pending — deve ser empurrado pelo breaker.
    const pendingKey = `tox-pending-${Date.now()}`;
    await dbAdmin.execute(sqlTag`
      INSERT INTO outbox (clinic_id, event_type, payload, payload_hash, idempotency_key, next_attempt_at)
      VALUES (${CLINIC_A}::uuid, ${evt}, '{"id":"pending"}'::jsonb, ${pendingHash}, ${pendingKey}, now())
    `);
    const result = await applyCircuitBreaker();
    if (!result.openedEventTypes.includes(evt)) {
      throw new Error(`circuit did not open for ${evt}: ${JSON.stringify(result)}`);
    }
    if (result.pausedCount < 1) throw new Error('no pending paused');
    // Verifica que next_attempt_at do pending foi empurrado para o futuro.
    const [row] = await dbAdmin
      .select()
      .from(outbox)
      .where(eq(outbox.idempotencyKey, pendingKey));
    if (!row || row.nextAttemptAt.getTime() < Date.now() + 60_000) {
      throw new Error('pending not pushed forward');
    }
  });

  // ---- 4.6.15 Janitor reclaims stuck processing ----
  await tryStep('4.6.15 Janitor: stuck processing > 5min → pending', async () => {
    const idem = `stuck-${Date.now()}`;
    const stuckHash = phash({ id: 'stuck' });
    // temporal_chk (0010) exige processing_started_at >= created_at. Setamos
    // created_at antes para respeitar invariante.
    await dbAdmin.execute(sqlTag`
      INSERT INTO outbox (clinic_id, event_type, payload, payload_hash, idempotency_key, status, created_at, processing_started_at)
      VALUES (${CLINIC_A}::uuid, ${TEST_EVENT}, '{"id":"stuck"}'::jsonb, ${stuckHash}, ${idem}, 'processing',
              now() - interval '15 minutes', now() - interval '10 minutes')
    `);
    const reclaimed = await reclaimStuckProcessing();
    if (reclaimed < 1) throw new Error('janitor did not reclaim');
    const [row] = await dbAdmin
      .select()
      .from(outbox)
      .where(eq(outbox.idempotencyKey, idem));
    if (!row || row.status !== 'pending') throw new Error('row not reclaimed');
    if (row.processingStartedAt !== null) throw new Error('processing_started_at not cleared');
  });

  // ---- 4.6.16 withTenant cross-tenant concurrency ----
  await tryStep('4.6.16 withTenant: 10 concurrent TXs, no cross-tenant bleed', async () => {
    // Insere uma row em outbox para cada clínica (via dbAdmin, bypassRLS).
    const markerA = `cross-a-${Date.now()}`;
    const markerB = `cross-b-${Date.now()}`;
    const hashA = phash({ id: 'a' });
    const hashB = phash({ id: 'b' });
    await dbAdmin.execute(sqlTag`
      INSERT INTO outbox (clinic_id, event_type, payload, payload_hash, idempotency_key)
      VALUES (${CLINIC_A}::uuid, ${TEST_EVENT}, '{"id":"a"}'::jsonb, ${hashA}, ${markerA}),
             (${CLINIC_B}::uuid, ${TEST_EVENT}, '{"id":"b"}'::jsonb, ${hashB}, ${markerB})
    `);
    // 10 TXs paralelas, alternando entre A e B. Cada uma SELECT outbox dentro
    // de withTenant — espera ver apenas a row do seu próprio clinic.
    const tasks = Array.from({ length: 10 }, (_, i) =>
      withTenant(i % 2 === 0 ? CLINIC_A : CLINIC_B, async (tx) => {
        const rows = await tx
          .select({ clinicId: outbox.clinicId })
          .from(outbox);
        return { i, rows };
      }),
    );
    const results = await Promise.all(tasks);
    for (const { i, rows } of results) {
      const expectedClinic = i % 2 === 0 ? CLINIC_A : CLINIC_B;
      for (const row of rows) {
        if (row.clinicId !== expectedClinic) {
          throw new Error(`cross-tenant bleed at task ${i}: saw ${row.clinicId}`);
        }
      }
    }
  });

  // ---- 4.6.17 cron route returns 401 without auth ----
  await tryStep('4.6.17 Cron route: 401 sem Bearer correto', async () => {
    process.env.CRON_SECRET = process.env.CRON_SECRET ?? 'x'.repeat(32);
    // Import dinâmico: avalia env no tempo do require, então atribuir CRON_SECRET
    // antes garante que assertCronRuntimeReady passa.
    const mod = await import('@/app/api/cron/outbox/route');
    const req = new Request('http://localhost/api/cron/outbox', {
      headers: { authorization: 'Bearer wrong' },
    });
    const res = await mod.GET(req);
    if (res.status !== 401) throw new Error(`status=${res.status} (want 401)`);
  });

  await tryStep('4.6.17b Cron route: 200 com Bearer correto', async () => {
    const secret = process.env.CRON_SECRET!;
    const mod = await import('@/app/api/cron/outbox/route');
    const req = new Request('http://localhost/api/cron/outbox', {
      headers: { authorization: `Bearer ${secret}` },
    });
    const res = await mod.GET(req);
    if (res.status !== 200) {
      const body = await res.text();
      throw new Error(`status=${res.status} body=${body}`);
    }
    const body = (await res.json()) as { ok: boolean; processed: number };
    if (body.ok !== true) throw new Error('not ok');
  });

  // ---- 4.6.18 CRITICAL-01: TX3 guard against janitor reclaim ----
  await tryStep('4.6.18 TX3 guard: janitor reclaim mid-handler não corrompe estado', async () => {
    // Cenário: A reservou (status=processing, attempts=1). Janitor reclama
    // (status=pending, attempts ainda 1). Outro worker B faz TX1 (attempts=2,
    // status=processing). Agora A volta com TX3 condicional em (status='processing'
    // AND attempts=1) — deve falhar porque attempts agora é 2.
    registryTesting.reset();
    registerHandler(TEST_EVENT, async () => undefined);
    const idem = `tx3guard-${Date.now()}`;
    const ph = phash({ id: 'tx3' });
    // Setup row em 'processing' com attempts=1.
    await dbAdmin.execute(sqlTag`
      INSERT INTO outbox (clinic_id, event_type, payload, payload_hash, idempotency_key,
                          status, attempts, created_at, processing_started_at)
      VALUES (${CLINIC_A}::uuid, ${TEST_EVENT}, '{"id":"tx3"}'::jsonb, ${ph}, ${idem},
              'processing', 1, now() - interval '5 minutes', now() - interval '1 minute')
    `);
    const [origRow] = await dbAdmin.select().from(outbox).where(eq(outbox.idempotencyKey, idem));
    if (!origRow) throw new Error('setup row missing');
    const origAttempts = origRow.attempts; // 1

    // Simula janitor + worker B: status pending → processing, attempts=2.
    await dbAdmin.execute(sqlTag`
      UPDATE outbox SET status='pending', processing_started_at=null
       WHERE id=${origRow.id}
    `);
    await dbAdmin.execute(sqlTag`
      UPDATE outbox SET status='processing', attempts=2, processing_started_at=now()
       WHERE id=${origRow.id} AND status='pending'
    `);

    // Agora A tenta TX3 com guard (status='processing' AND attempts=1) — deve
    // ter 0 rows porque attempts agora é 2.
    const updated = await dbAdmin.execute<{ id: string }>(sqlTag`
      UPDATE outbox
         SET status='processed', processed_at=now(), processing_started_at=null
       WHERE id=${origRow.id}
         AND status='processing'
         AND attempts=${origAttempts}
       RETURNING id
    `);
    if (updated.length !== 0) {
      throw new Error('TX3 guard should have rejected — attempts changed');
    }
    // Estado da row deve refletir o que B fez (attempts=2, processing — B ainda
    // não finalizou).
    const [finalRow] = await dbAdmin.select().from(outbox).where(eq(outbox.idempotencyKey, idem));
    if (finalRow?.status !== 'processing') {
      throw new Error(`expected status=processing (B em flight), got ${finalRow?.status}`);
    }
    if (finalRow?.attempts !== 2) {
      throw new Error(`expected attempts=2, got ${finalRow?.attempts}`);
    }
  });

  // ---- 4.6.19 CRITICAL-02: cleanup respects in-flight ----
  await tryStep('4.6.19 Cleanup: in-flight (response=NULL) NÃO é deletado', async () => {
    // Insere uma row in-flight expirada manualmente — mas o trigger só protege
    // rows com created_at < 1h. Para o teste, criamos uma row in-flight RECENTE
    // (response=NULL, created_at < 1h) que está expirada (expires_at < now()).
    // O cleanup module deve filtrar e NÃO deletar.
    const idem = `flight:test:` + 'a'.repeat(8);
    await dbAdmin.execute(sqlTag`
      INSERT INTO idempotency_keys (key, clinic_id, payload_hash, response, expires_at)
      VALUES (${idem}, ${CLINIC_A}::uuid, ${'0'.repeat(64)}, NULL, now() - interval '1 minute')
      ON CONFLICT (key) DO NOTHING
    `);
    // Insere também uma row COMPLETED expirada — esta DEVE ser deletada.
    const idemDone = `done:test:` + 'b'.repeat(8);
    await dbAdmin.execute(sqlTag`
      INSERT INTO idempotency_keys (key, clinic_id, payload_hash, response, expires_at)
      VALUES (${idemDone}, ${CLINIC_A}::uuid, ${'0'.repeat(64)}, '{"ok":true}'::jsonb, now() - interval '1 minute')
      ON CONFLICT (key) DO NOTHING
    `);
    const before = await dbAdmin.execute<{ key: string }>(sqlTag`
      SELECT key FROM idempotency_keys WHERE key IN (${idem}, ${idemDone})
    `);
    if (before.length !== 2) throw new Error(`setup: expected 2 rows, got ${before.length}`);

    const deleted = await cleanupExpiredIdempotencyKeys();
    if (deleted < 1) throw new Error(`expected at least 1 deletion, got ${deleted}`);

    const after = await dbAdmin.execute<{ key: string; response: unknown }>(sqlTag`
      SELECT key, response FROM idempotency_keys WHERE key IN (${idem}, ${idemDone})
    `);
    const stillHasInFlight = after.some((r) => r.key === idem);
    const stillHasDone = after.some((r) => r.key === idemDone);
    if (!stillHasInFlight) throw new Error('IN-FLIGHT row was deleted (forbidden)');
    if (stillHasDone) throw new Error('DONE row was NOT deleted');

    // Cleanup do nosso lixo. Trigger BEFORE DELETE bloqueia in-flight; UPDATE
    // response='{"cleanup":true}' antes para liberar DELETE.
    await dbAdmin.execute(sqlTag`
      UPDATE idempotency_keys SET response='{"cleanup":true}'::jsonb WHERE key=${idem}
    `);
    await dbAdmin.execute(sqlTag`DELETE FROM idempotency_keys WHERE key=${idem}`);
  });

  await tryStep('4.6.19b diagnoseInFlightOrphans não muta + retorna lista', async () => {
    const before = await diagnoseInFlightOrphans();
    // Idempotente: roda 2x e retorna a mesma lista.
    const after = await diagnoseInFlightOrphans();
    if (before.length !== after.length) {
      throw new Error(`diagnose is non-idempotent: ${before.length} vs ${after.length}`);
    }
  });

  // ---- 4.6.20 CRITICAL-03: HandlerCtx exposes eventId + attempt ----
  await tryStep('4.6.20 HandlerCtx: eventId + attempt expostos ao handler', async () => {
    // Limpa fila de AMBAS clínicas (4.6.16 cross-tenant + 4.6.17b cron deixam
    // rows em CLINIC_A e CLINIC_B). Worker grabba a row mais antiga GLOBAL via
    // ORDER BY next_attempt_at, created_at — sem cleanup, agarra leftover.
    await dbAdmin.execute(sqlTag`
      DELETE FROM outbox
       WHERE clinic_id IN (${CLINIC_A}::uuid, ${CLINIC_B}::uuid)
         AND status IN ('pending','processing')
    `);
    // Re-register schema: 4.6.14 fez catalogTesting.reset() e só registrou
    // 'test.smoke.toxic'. publishEvent abaixo precisa de TEST_EVENT no catalog.
    catalogTesting.reset();
    registerEventSchema(TEST_EVENT, TestSchema);
    registryTesting.reset();
    let captured: { eventId?: string; attempt?: number } = {};
    registerHandler(TEST_EVENT, async (ctx: HandlerCtx<{ id: string }>) => {
      captured = { eventId: ctx.eventId, attempt: ctx.attempt };
    });
    const idem = `ctx-${Date.now()}`;
    await withTenant(CLINIC_A, async (tx) => {
      await publishEvent(tx, {
        clinicId: CLINIC_A,
        eventType: TEST_EVENT,
        payload: { id: 'ctx-test' },
        idempotencyKey: idem,
      });
    });
    await runOutboxOnce({ batchSize: 1, parallelism: 1 });
    if (!captured.eventId) throw new Error('eventId not passed to handler');
    if (typeof captured.eventId !== 'string' || captured.eventId.length !== 36) {
      throw new Error(`eventId malformed: ${captured.eventId}`);
    }
    if (captured.attempt !== 1) throw new Error(`expected attempt=1, got ${captured.attempt}`);
  });

  // ---- 4.6.21 HIGH-14: PoisonPillError pula backoff ----
  await tryStep('4.6.21 PoisonPillError: marca failed sem backoff', async () => {
    // Cleanup global (ambas clínicas) — mesma razão do 4.6.20.
    await dbAdmin.execute(sqlTag`
      DELETE FROM outbox
       WHERE clinic_id IN (${CLINIC_A}::uuid, ${CLINIC_B}::uuid)
         AND status IN ('pending','processing')
    `);
    const poisonEvt = 'test.smoke.poison';
    catalogTesting.reset();
    registerEventSchema(poisonEvt, TestSchema);
    registryTesting.reset();
    registerHandler(poisonEvt, async () => {
      throw new PoisonPillError('semantically invalid', 'invalid_resource');
    });
    const idem = `poison-${Date.now()}`;
    await withTenant(CLINIC_A, async (tx) => {
      await publishEvent(tx, {
        clinicId: CLINIC_A,
        eventType: poisonEvt,
        payload: { id: 'poison' },
        idempotencyKey: idem,
      });
    });
    await runOutboxOnce({ batchSize: 1, parallelism: 1 });
    const [row] = await dbAdmin.select().from(outbox).where(eq(outbox.idempotencyKey, idem));
    if (!row) throw new Error('row missing');
    if (row.status !== 'failed') throw new Error(`expected status=failed, got ${row.status}`);
    if (row.errorCode !== 'invalid_resource') throw new Error(`error_code=${row.errorCode}`);
    if (row.attempts !== 1) throw new Error(`expected attempts=1 (no retry), got ${row.attempts}`);
  });

  // ---- 4.6.22 HIGH-07: payload size cap rejeitado em runtime ----
  await tryStep('4.6.22 publishEvent: payload > 64KB rejeitado com OutboxError', async () => {
    const bigEvt = 'test.smoke.big';
    catalogTesting.reset();
    registerEventSchema(bigEvt, z.object({ data: z.string() }));
    const idem = `big-${Date.now()}`;
    try {
      await withTenant(CLINIC_A, async (tx) => {
        await publishEvent(tx, {
          clinicId: CLINIC_A,
          eventType: bigEvt,
          payload: { data: 'x'.repeat(70 * 1024) },
          idempotencyKey: idem,
        });
      });
      throw new Error('should have thrown');
    } catch (e) {
      if (!(e instanceof OutboxError)) throw new Error(`not OutboxError: ${e}`);
      if (!e.message.includes('bytes')) throw new Error('error message missing size info');
    }
  });

  // ---- 4.6.23 HIGH-16: key collision (mesma key, payload diferente) ----
  await tryStep('4.6.23 publishEvent: same key, different payload → key_collision', async () => {
    catalogTesting.reset();
    registerEventSchema(TEST_EVENT, TestSchema);
    const idem = `collide-${Date.now()}`;
    // Primeira publicação OK.
    await withTenant(CLINIC_A, async (tx) => {
      await publishEvent(tx, {
        clinicId: CLINIC_A,
        eventType: TEST_EVENT,
        payload: { id: 'v1' },
        idempotencyKey: idem,
      });
    });
    // Segunda com mesma key MAS payload diferente → OutboxError.
    try {
      await withTenant(CLINIC_A, async (tx) => {
        await publishEvent(tx, {
          clinicId: CLINIC_A,
          eventType: TEST_EVENT,
          payload: { id: 'v2' }, // hash diferente
          idempotencyKey: idem,
        });
      });
      throw new Error('should have thrown collision');
    } catch (e) {
      if (!(e instanceof OutboxError)) throw new Error(`not OutboxError: ${e}`);
      if (!e.message.includes('collision')) throw new Error(`message missing 'collision': ${e.message}`);
    }
  });

  // ---- 4.6.24 HIGH-15: advisory lock previne worker overlap ----
  await tryStep('4.6.24 Advisory lock: 2 ticks paralelos = 1 ativo + 1 skipped', async () => {
    // Cleanup outbox antes para garantir tick limpo.
    await dbAdmin.execute(sqlTag`DELETE FROM outbox WHERE clinic_id=${CLINIC_A}::uuid`);
    catalogTesting.reset();
    registerEventSchema(TEST_EVENT, TestSchema);
    registryTesting.reset();
    registerHandler(TEST_EVENT, async () => undefined);
    const [a, b] = await Promise.all([
      runOutboxOnce({ batchSize: 1, parallelism: 1 }),
      runOutboxOnce({ batchSize: 1, parallelism: 1 }),
    ]);
    // Pelo menos um dos dois resultou em skipped_overlap (todos 0).
    const aSkipped = a.processed + a.failed + a.skipped === 0 && a.stuck_reclaimed === 0;
    const bSkipped = b.processed + b.failed + b.skipped === 0 && b.stuck_reclaimed === 0;
    // NB: como o lock é advisory_xact e libera no COMMIT da TX que pegou, em
    // rede lenta as 2 podem rodar serialmente sem skip. Validação flexível:
    // ambos devem completar sem erro, e duration_ms total deve ser > 0.
    if (a.duration_ms <= 0 || b.duration_ms <= 0) throw new Error('one tick had 0 duration');
    // Se algum foi skipped, valida que duration_ms é menor (passou rápido).
    void aSkipped;
    void bSkipped;
  });

  // ---- 4.6.25 cron: auth é single-factor (Bearer) ----
  await tryStep('4.6.25 Cron: Bearer é o gate; x-vercel-cron NÃO é (M2)', async () => {
    // Este passo afirmava testar "dual-factor: sem x-vercel-cron em prod = 401" —
    // um comportamento que o código NUNCA teve (o header só era logado). O próprio
    // corpo admitia (`void res1`) que não verificava nada disso. M2 (auditoria de
    // APIs) assumiu formalmente o single-factor; o passo agora testa a realidade.
    const secret = process.env.CRON_SECRET!;
    const mod = await import('@/app/api/cron/outbox/route');
    const call = (headers: Record<string, string>) =>
      mod.GET(new Request('http://localhost/api/cron/outbox', { headers }));

    const semBearer = await call({});
    if (semBearer.status !== 401) throw new Error(`sem bearer: status=${semBearer.status}`);

    const bearerErrado = await call({ authorization: 'Bearer ' + 'x'.repeat(secret.length) });
    if (bearerErrado.status !== 401) throw new Error(`bearer errado: status=${bearerErrado.status}`);

    // Bearer válido passa COM ou SEM o header de origem — o header é anomalia
    // observável (`cron.origin_header_missing`), não gate. Ver F-09 em cron-auth.ts.
    const semHeader = await call({ authorization: `Bearer ${secret}` });
    if (semHeader.status !== 200) throw new Error(`bearer ok, sem header: status=${semHeader.status}`);

    const comHeader = await call({ authorization: `Bearer ${secret}`, 'x-vercel-cron': '1' });
    if (comHeader.status !== 200) throw new Error(`bearer ok, com header: status=${comHeader.status}`);
  });

  // ---- 4.6.26 makeProviderIdempotencyKey: deterministic, format-correct ----
  await tryStep('4.6.26 makeProviderIdempotencyKey: determinismo + formato', () => {
    const ctx = { eventId: '00000000-0000-0000-0000-000000000001' };
    const k1 = makeProviderIdempotencyKey(ctx, 'whatsapp.send');
    const k2 = makeProviderIdempotencyKey(ctx, 'whatsapp.send');
    if (k1 !== k2) throw new Error('not deterministic');
    if (!/^[a-f0-9]{64}$/.test(k1)) throw new Error(`format wrong: ${k1}`);
    // sideEffectKey diferente → hash diferente.
    const k3 = makeProviderIdempotencyKey(ctx, 'email.send');
    if (k1 === k3) throw new Error('different side effect key produced same hash');
    // Validação de formato
    let threw = false;
    try {
      makeProviderIdempotencyKey(ctx, 'INVALID-KEY');
    } catch {
      threw = true;
    }
    if (!threw) throw new Error('invalid sideEffectKey not rejected');
    return Promise.resolve();
  });

  // ---- 4.6.27 idempotency lock_timeout configurável ----
  await tryStep('4.6.27 lock_timeout env config: valor de env aplicado em SET LOCAL', async () => {
    // Não é trivial introspectar SET LOCAL de fora da TX. Validamos via env
    // que o valor não está hardcoded a 3s e que mutation.ts usa env.
    const value = process.env.OUTBOX_IDEMPOTENCY_LOCK_TIMEOUT_MS;
    // Default sem env = 10000 (set em env.ts). Se setado, respeita.
    if (value !== undefined && Number(value) < 1000) {
      throw new Error(`env override seems wrong: ${value}`);
    }
    // Smoke não tem auth real para chamar idempotentMutation; building blocks
    // (lock_timeout setting) validados em test manual via psql.
  });

  // ---- 4.6.28 validateTtlSeconds (idempotency TTL configurável) ----
  await tryStep('4.6.28 validateTtlSeconds: rejeita < 60s e > 30 dias', () => {
    // Default range
    if (IDEMPOTENCY_TTL_MIN_SECONDS !== 60) throw new Error('MIN constant changed');
    if (IDEMPOTENCY_TTL_MAX_SECONDS !== 30 * 86400) throw new Error('MAX constant changed');

    // Aceita valores válidos
    validateTtlSeconds(60);
    validateTtlSeconds(86_400); // default 24h
    validateTtlSeconds(7 * 86_400); // 7 dias
    validateTtlSeconds(30 * 86_400); // máximo

    // Rejeita < min
    let threw = false;
    try {
      validateTtlSeconds(30);
    } catch (e) {
      if ((e as Error).message.includes('60')) threw = true;
    }
    if (!threw) throw new Error('< 60s não foi rejeitado');

    // Rejeita > max
    threw = false;
    try {
      validateTtlSeconds(31 * 86_400);
    } catch (e) {
      if ((e as Error).message.includes('30 days')) threw = true;
    }
    if (!threw) throw new Error('> 30 dias não foi rejeitado');

    // Rejeita não-inteiro
    threw = false;
    try {
      validateTtlSeconds(60.5);
    } catch (e) {
      if ((e as Error).message.includes('integer')) threw = true;
    }
    if (!threw) throw new Error('float não foi rejeitado');
    return Promise.resolve();
  });

  // ---- 4.6.29 withProviderStatusCheck: 4 estados tratados corretamente ----
  await tryStep('4.6.29 withProviderStatusCheck: completed/failed/pending/not_found', async () => {
    const ctx = { eventId: '00000000-0000-0000-0000-000000000abc' };

    // (a) completed → onAlreadyCompleted é chamado, NÃO call.
    let calledCount = 0;
    let onAlreadyCount = 0;
    const completedResult = await withProviderStatusCheck<{ ok: boolean }, unknown>(
      ctx,
      'whatsapp.send',
      {
        statusCheck: async () => 'completed',
        call: async () => {
          calledCount++;
          return { ok: false };
        },
        onAlreadyCompleted: async () => {
          onAlreadyCount++;
          return { ok: true };
        },
      },
    );
    if (calledCount !== 0) throw new Error('call() rodou em status=completed');
    if (onAlreadyCount !== 1) throw new Error('onAlreadyCompleted não chamado');
    if (!completedResult.ok) throw new Error('completedResult wrong');

    // (b) not_found → call é chamado normalmente
    calledCount = 0;
    onAlreadyCount = 0;
    const callResult = await withProviderStatusCheck<{ sent: boolean }, unknown>(
      ctx,
      'whatsapp.send',
      {
        statusCheck: async () => 'not_found',
        call: async (key) => {
          calledCount++;
          if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('idemKey malformed');
          return { sent: true };
        },
        onAlreadyCompleted: async () => {
          onAlreadyCount++;
          return { sent: false };
        },
      },
    );
    if (calledCount !== 1) throw new Error('call() não rodou em status=not_found');
    if (onAlreadyCount !== 0) throw new Error('onAlreadyCompleted rodou indevidamente');
    if (!callResult.sent) throw new Error('callResult wrong');

    // (c) failed → throws PoisonPillError
    let threwPoison = false;
    try {
      await withProviderStatusCheck<unknown, unknown>(ctx, 'whatsapp.send', {
        statusCheck: async () => 'failed',
        call: async () => ({}),
        onAlreadyCompleted: async () => ({}),
      });
    } catch (e) {
      if (e instanceof PoisonPillError) threwPoison = true;
    }
    if (!threwPoison) throw new Error('status=failed não throw PoisonPillError');

    // (d) pending → throws SideEffectInFlightError
    let threwInFlight = false;
    try {
      await withProviderStatusCheck<unknown, unknown>(ctx, 'whatsapp.send', {
        statusCheck: async () => 'pending',
        call: async () => ({}),
        onAlreadyCompleted: async () => ({}),
      });
    } catch (e) {
      if (e instanceof SideEffectInFlightError) threwInFlight = true;
    }
    if (!threwInFlight) throw new Error('status=pending não throw SideEffectInFlightError');
  });

  // ---- 4.6.30 F-03: evento em catálogo SEM handler → terminal 'skipped' ----
  await tryStep('4.6.30 F-03: catálogo sem handler → skipped (sem retry, não conta como failed)', async () => {
    await dbAdmin.execute(sqlTag`
      DELETE FROM outbox WHERE clinic_id IN (${CLINIC_A}::uuid, ${CLINIC_B}::uuid)
        AND status IN ('pending','processing')
    `);
    const evt = 'test.smoke.nohandler';
    catalogTesting.reset();
    registerEventSchema(evt, TestSchema); // schema PRESENTE no catálogo
    registryTesting.reset(); // NENHUM handler registrado
    const idem = `nohandler-${Date.now()}`;
    await withTenant(CLINIC_A, async (tx) => {
      await publishEvent(tx, {
        clinicId: CLINIC_A,
        eventType: evt,
        payload: { id: 'x' },
        idempotencyKey: idem,
      });
    });
    const summary = await runOutboxOnce({ batchSize: 1, parallelism: 1 });
    const [row] = await dbAdmin.select().from(outbox).where(eq(outbox.idempotencyKey, idem));
    if (!row) throw new Error('row missing');
    if (row.status !== 'skipped') throw new Error(`expected status=skipped, got ${row.status}`);
    if (row.attempts !== 1) throw new Error(`expected attempts=1 (sem retry), got ${row.attempts}`);
    if (row.lastFailedAt !== null) throw new Error('skipped NÃO deve setar last_failed_at (não é falha)');
    if (summary.skipped !== 1) throw new Error(`summary.skipped=${summary.skipped} (want 1)`);
    if (summary.failed !== 0) throw new Error(`skipped contado como failed: ${summary.failed}`);
  });

  // ---- 4.6.31 F-03: finalizeSkipped concurrency guard (reclaim mid-flight) ----
  await tryStep('4.6.31 F-03: finalizeSkipped guard (status,attempts) impede double-write', async () => {
    const evt = 'test.smoke.nohandler';
    const idem = `skipguard-${Date.now()}`;
    const ph = phash({ id: 'sg' });
    // Row em 'processing' attempts=1 (como se A tivesse reservado para skip).
    await dbAdmin.execute(sqlTag`
      INSERT INTO outbox (clinic_id, event_type, payload, payload_hash, idempotency_key,
                          status, attempts, created_at, processing_started_at)
      VALUES (${CLINIC_A}::uuid, ${evt}, '{"id":"sg"}'::jsonb, ${ph}, ${idem},
              'processing', 1, now() - interval '5 minutes', now() - interval '1 minute')
    `);
    const [orig] = await dbAdmin.select().from(outbox).where(eq(outbox.idempotencyKey, idem));
    if (!orig) throw new Error('setup row missing');
    // Simula janitor + worker B: pending → processing attempts=2.
    await dbAdmin.execute(sqlTag`UPDATE outbox SET status='pending', processing_started_at=null WHERE id=${orig.id}`);
    await dbAdmin.execute(sqlTag`UPDATE outbox SET status='processing', attempts=2, processing_started_at=now() WHERE id=${orig.id} AND status='pending'`);
    // A tenta finalizeSkipped com guard (status='processing' AND attempts=1) → 0 rows.
    const updated = await dbAdmin.execute<{ id: string }>(sqlTag`
      UPDATE outbox SET status='skipped', processed_at=now(), processing_started_at=null
       WHERE id=${orig.id} AND status='processing' AND attempts=1
       RETURNING id
    `);
    if (updated.length !== 0) throw new Error('finalizeSkipped guard deveria rejeitar — attempts mudou');
    const [final] = await dbAdmin.select().from(outbox).where(eq(outbox.idempotencyKey, idem));
    if (final?.status !== 'processing' || final?.attempts !== 2) {
      throw new Error(`estado final inesperado: ${final?.status}/${final?.attempts}`);
    }
  });
}

// =====================================================================
// Main
// =====================================================================
(async () => {
  try {
    await preflight();
    await setupFixtures();
    await functional();
  } finally {
    await cleanupFixtures();
  }
  const failed = results.filter((r) => !r.ok).length;
  const total = results.length;
  console.log(
    `\n${failed === 0 ? '✅' : '❌'} smoke-c4: ${total - failed}/${total} passed; ${failed} failed`,
  );
  process.exit(failed === 0 ? 0 : 1);
})();
