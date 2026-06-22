/**
 * Smoke Admin Config — Platform Settings / Kill-switches / Heartbeat / Broadcast.
 *
 * Roda contra qoro-dev (DATABASE_URL do .env.local). Prova o que o teste manual
 * não cobre — em especial o kill-switch `ai_agent.mode=fallback_only` degradando
 * o agente SEM chamar o Gemini (stub de fetch conta as chamadas).
 *
 * Checks:
 *   1 RLS: as 3 tabelas globais com ENABLE+FORCE
 *   2 write-boundary: dbAdmin (service_role) escreve platform_settings;
 *     authenticated (withTenant) é BLOQUEADO pela RLS
 *   3 reader: fail-safe (chave ausente → default) + round-trip via meta
 *   4 heartbeat: recordHeartbeat faz UPSERT idempotente (1 linha)
 *   5 broadcast: getActiveAnnouncement ignora aviso EXPIRADO
 *   6 KILL-SWITCH IA: ai_agent.mode=fallback_only → resposta OPERATIONAL_FALLBACK,
 *     custo ZERO, ZERO chamada ao Gemini (degradação sem LLM)
 *
 * Restaura ai_agent.mode ao estado anterior no cleanup (flag é GLOBAL).
 * NB: requer SUPABASE_SECRET_KEY do mesmo projeto + migration 0029 aplicada.
 */
import { assertDevContext } from './_env';

import { randomUUID } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';

import { __testing__ as aiCircuitTesting } from '@/lib/ai/circuit-breaker';
import { decryptForTenant, encryptForTenant } from '@/lib/crypto';
import { dbAdmin } from '@/lib/db';
import { withTenant } from '@/lib/db/tenant';
import { cronHeartbeats } from '@/lib/db/schema/infra/cron-heartbeats';
import { platformAnnouncements } from '@/lib/db/schema/infra/platform-announcements';
import { platformSettings, type PlatformSettingRow } from '@/lib/db/schema/infra/platform-settings';
import type { ParsedInboundMessage } from '@/lib/messaging';
import { runOutboxOnce } from '@/lib/outbox/worker';
import { getPlatformSetting, getPlatformSettingsMeta } from '@/lib/platform-settings';
import { getActiveAnnouncement } from '@/lib/platform-announcements';
import { recordHeartbeat } from '@/lib/cron-heartbeat';

import '@/lib/db/schema';
import '@/app/api/cron/outbox/handlers';

import { OPERATIONAL_FALLBACK } from '@/contexts/ai-agent/prompts/system';
import { persistInbound } from '@/contexts/messaging/internal/inbound';

assertDevContext();

// --- harness -----------------------------------------------------------------
type Result = { name: string; ok: boolean; detail?: string };
const results: Result[] = [];
function record(name: string, ok: boolean, detail?: string): void {
  results.push(detail === undefined ? { name, ok } : { name, ok, detail });
  console.log(ok ? `[OK]   ${name}` : `[FAIL] ${name}${detail ? `\n       ${detail}` : ''}`);
}
function fmtErr(e: unknown): string {
  return e instanceof Error ? (e.stack ?? e.message) : String(e);
}
async function tryStep(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    record(name, true);
  } catch (e) {
    record(name, false, fmtErr(e));
  }
}
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

// --- fetch stub: conta chamadas ao Gemini (deve ficar 0 em fallback_only) ----
type FetchFn = typeof globalThis.fetch;
const realFetch: FetchFn = globalThis.fetch;
let geminiCalls = 0;
globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
  const u = String(url);
  if (u.includes('generativelanguage.googleapis.com')) {
    geminiCalls += 1;
    return new Response(
      JSON.stringify({ candidates: [{ content: { parts: [{ text: 'NAO DEVERIA' }] } }], usageMetadata: {} }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  if (u.includes('graph.facebook.com')) {
    return new Response(JSON.stringify({ messages: [{ id: `wamid.${randomUUID()}` }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  return realFetch(url, init);
}) as FetchFn;

// --- fixtures ----------------------------------------------------------------
const TEST_KEY = `smoke.admin-config.${Date.now().toString(36)}`;
const HB_JOB = `smoke-admin-config-${Date.now().toString(36)}`;
const createdClinics: string[] = [];
const createdAnnouncements: string[] = [];
let priorAiMode: PlatformSettingRow | undefined;

async function createClinic(): Promise<string> {
  const slug = `admin-config${Date.now().toString(36)}`.slice(0, 30).toLowerCase();
  const rows = await dbAdmin.execute<{ id: string }>(
    sql`INSERT INTO clinics (slug, nome, endereco, status) VALUES (${slug}, 'Smoke Admin Config', 'Rua Admin Config, 16', 'active') RETURNING id`,
  );
  createdClinics.push(rows[0]!.id);
  return rows[0]!.id;
}
async function connectNumber(clinicId: string, phoneId: string, phone: string): Promise<void> {
  const token = await encryptForTenant(clinicId, 'TEST_TOKEN');
  await dbAdmin.execute(sql`
    INSERT INTO clinic_whatsapp_numbers (clinic_id, provider, phone_number, meta_phone_id, token_encrypted, verified_at, active)
    VALUES (${clinicId}, 'meta', ${phone}, ${phoneId}, ${token}, now(), true)`);
}
async function deliverTurn(clinicId: string, phoneId: string, from: string, text: string): Promise<string> {
  const msg: ParsedInboundMessage = {
    providerMessageId: `wamid.admin-config.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 6)}`,
    fromNumber: from,
    toPhoneId: phoneId,
    toNumber: '551140000000',
    text,
    timestamp: String(Math.floor(Date.now() / 1000)),
  };
  await persistInbound(clinicId, 'meta', msg);
  const ev = await dbAdmin.execute<{ id: string }>(
    sql`SELECT id FROM outbox WHERE idempotency_key = ${`inbound:meta:${msg.providerMessageId}`}`,
  );
  await runOutboxOnce({ batchSize: 10, parallelism: 1 });
  return ev[0]!.id;
}
async function outcomeOf(eventId: string): Promise<string | null> {
  const r = await dbAdmin.execute<{ payload: { outcome?: string } }>(
    sql`SELECT payload FROM outbox WHERE idempotency_key = ${`ai-turn:${eventId}`} LIMIT 1`,
  );
  return r[0]?.payload?.outcome ?? null;
}

const RUN = Date.now().toString().slice(-9);

async function main(): Promise<void> {
  aiCircuitTesting.reset();

  // 1. RLS estrutural
  await tryStep('1 RLS: 3 tabelas globais ENABLE+FORCE', async () => {
    const r = await dbAdmin.execute<{ relname: string; en: boolean; fo: boolean }>(sql`
      SELECT relname, relrowsecurity AS en, relforcerowsecurity AS fo
        FROM pg_class
       WHERE relname IN ('platform_settings','cron_heartbeats','platform_announcements')`);
    assert(r.length === 3, `esperado 3 tabelas, veio ${r.length}`);
    assert(r.every((x) => x.en && x.fo), 'todas devem ter RLS ENABLE+FORCE');
  });

  const clinicA = await createClinic();

  // 2. write-boundary: service_role escreve; authenticated bloqueado
  await tryStep('2 write-boundary: dbAdmin grava; authenticated (RLS) bloqueado', async () => {
    await dbAdmin
      .insert(platformSettings)
      .values({ key: TEST_KEY, value: true })
      .onConflictDoUpdate({ target: platformSettings.key, set: { value: true } });
    let blocked = false;
    try {
      await withTenant(clinicA, (tx) =>
        tx.insert(platformSettings).values({ key: `${TEST_KEY}.x`, value: true }),
      );
    } catch {
      blocked = true;
    }
    assert(blocked, 'authenticated NÃO pode escrever platform_settings (RLS)');
  });

  // 3. reader fail-safe + round-trip
  await tryStep('3 reader: fail-safe default + round-trip via meta', async () => {
    const def = await getPlatformSetting<string>('smoke.admin-config.nao-existe', 'DEFAULT');
    assert(def === 'DEFAULT', `chave ausente deveria devolver default, veio ${JSON.stringify(def)}`);
    const meta = await getPlatformSettingsMeta([TEST_KEY]);
    assert(meta.length === 1 && meta[0]!.value === true, 'round-trip do valor jsonb');
  });

  // 4. heartbeat UPSERT idempotente
  await tryStep('4 heartbeat: UPSERT idempotente (1 linha por job)', async () => {
    await recordHeartbeat(HB_JOB, 'success', { n: 1 });
    let r = await dbAdmin.select().from(cronHeartbeats).where(eq(cronHeartbeats.job, HB_JOB));
    assert(r.length === 1 && r[0]!.lastStatus === 'success', 'heartbeat success gravado');
    await recordHeartbeat(HB_JOB, 'skipped');
    r = await dbAdmin.select().from(cronHeartbeats).where(eq(cronHeartbeats.job, HB_JOB));
    assert(r.length === 1 && r[0]!.lastStatus === 'skipped', 'segundo tick mantém 1 linha (UPSERT)');
  });

  // 5. broadcast: getActiveAnnouncement ignora expirado
  await tryStep('5 broadcast: aviso EXPIRADO não é retornado', async () => {
    const [act] = await dbAdmin
      .insert(platformAnnouncements)
      .values({ message: `SMOKE Admin Config ativo ${RUN}`, level: 'info', active: true })
      .returning({ id: platformAnnouncements.id });
    const [exp] = await dbAdmin
      .insert(platformAnnouncements)
      .values({
        message: `SMOKE Admin Config expirado ${RUN}`,
        level: 'info',
        active: true,
        endsAt: new Date(Date.now() - 3_600_000),
      })
      .returning({ id: platformAnnouncements.id });
    createdAnnouncements.push(act!.id, exp!.id);
    const got = await getActiveAnnouncement();
    assert(got !== null, 'deveria haver um aviso vigente');
    assert(got!.id !== exp!.id, 'aviso expirado NÃO pode ser retornado');
  });

  // 6. KILL-SWITCH: ai_agent.mode=fallback_only → fallback sem Gemini
  await tryStep('6 IA fallback_only: OPERATIONAL_FALLBACK, custo 0, ZERO Gemini', async () => {
    // snapshot p/ restaurar (flag é global) + seta fallback_only via service_role
    priorAiMode = (await dbAdmin.select().from(platformSettings).where(eq(platformSettings.key, 'ai_agent.mode')))[0];
    await dbAdmin
      .insert(platformSettings)
      .values({ key: 'ai_agent.mode', value: 'fallback_only' })
      .onConflictDoUpdate({ target: platformSettings.key, set: { value: 'fallback_only' } });

    await dbAdmin.execute(sql`INSERT INTO ai_clinic_config (clinic_id) VALUES (${clinicA})`);
    const phoneId = `P16_${Date.now().toString(36)}`;
    await connectNumber(clinicA, phoneId, `5516${RUN}`);

    const before = geminiCalls;
    const ev = await deliverTurn(clinicA, phoneId, `5519${RUN}`, 'oi quero agendar uma consulta');

    assert(geminiCalls === before, `Gemini NÃO pode ser chamado em fallback_only (calls=${geminiCalls - before})`);
    assert((await outcomeOf(ev)) === 'fallback', 'outcome deveria ser fallback');

    const out = await dbAdmin.execute<{ ct: string; cost: string | null; model: string | null }>(sql`
      SELECT content_encrypted AS ct, cost_usd AS cost, model
        FROM ai_messages
       WHERE clinic_id = ${clinicA} AND direction = 'out'
       ORDER BY created_at DESC LIMIT 1`);
    assert(out.length === 1, 'deveria ter persistido a resposta out');
    const text = await decryptForTenant(clinicA, out[0]!.ct);
    assert(text === OPERATIONAL_FALLBACK, `resposta deveria ser o fallback operacional, veio: ${text.slice(0, 40)}`);
    assert(Number(out[0]!.cost ?? 0) === 0, 'custo deveria ser 0 (sem LLM)');
    assert(out[0]!.model === null, 'model deveria ser null (sem LLM)');
  });
}

async function cleanup(): Promise<void> {
  globalThis.fetch = realFetch;
  // restaura ai_agent.mode (flag GLOBAL — não deixar fallback_only do smoke)
  try {
    if (priorAiMode) {
      await dbAdmin
        .update(platformSettings)
        .set({ value: priorAiMode.value })
        .where(eq(platformSettings.key, 'ai_agent.mode'));
    } else {
      await dbAdmin.delete(platformSettings).where(eq(platformSettings.key, 'ai_agent.mode'));
    }
  } catch {
    /* best-effort */
  }
  for (const op of [
    () => dbAdmin.delete(platformSettings).where(eq(platformSettings.key, TEST_KEY)),
    () => dbAdmin.delete(cronHeartbeats).where(eq(cronHeartbeats.job, HB_JOB)),
    ...createdAnnouncements.map((id) => () => dbAdmin.delete(platformAnnouncements).where(eq(platformAnnouncements.id, id))),
    ...createdClinics.map((id) => () => dbAdmin.execute(sql`DELETE FROM clinics WHERE id = ${id}`)),
  ]) {
    try {
      await op();
    } catch {
      /* best-effort */
    }
  }
}

main()
  .catch((e) => record('main', false, fmtErr(e)))
  .finally(async () => {
    await cleanup();
    const failed = results.filter((r) => !r.ok);
    console.log(`\n=== smoke-admin-config: ${results.length - failed.length}/${results.length} passed ===`);
    process.exit(failed.length === 0 ? 0 : 1);
  });
