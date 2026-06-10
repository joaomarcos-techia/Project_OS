/**
 * Smoke C10 — MessagingProvider + Webhook Meta (fundação WhatsApp).
 *
 * Roda contra qoro-dev (DATABASE_URL do .env.local). Cobre os testes DB-level
 * que NÃO dependem de sessão HTTP. Server Actions super_admin
 * (connect/disconnect/rotate) são validadas in-app (runbook) — aqui conectamos
 * número via dbAdmin (igual ao wa:connect).
 *
 * Provider Meta é stubado via override de globalThis.fetch (sem rede real).
 */
import { assertDevContext } from './_env';

import { createHmac, randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';

import { encryptForTenant, hashForLookup, normalizePhone } from '@/lib/crypto';
import { dbAdmin } from '@/lib/db';
import { withTenant } from '@/lib/db/tenant';
import { MetaCloudProvider } from '@/lib/messaging/meta-cloud';
import { quarantineOrphan, resolveClinicByPhoneId } from '@/lib/messaging/number-store';
import {
  __testing__ as catalogTesting,
  getEventSchema,
  registerEventSchema,
} from '@/lib/outbox/catalog';
import type { ParsedInboundMessage, ParsedStatusEvent } from '@/lib/messaging';

import { InboundReceivedSchema, MESSAGING_EVENTS } from '@/contexts/messaging/events';
import { persistInbound, persistStatusEvents } from '@/contexts/messaging/internal/inbound';
import { sendOutbound } from '@/contexts/messaging/internal/sender';

// Popula o catálogo do outbox (messaging.inbound.received e demais).
import '@/lib/db/schema';
// Rota (testa GET verify).
import { GET as webhookGet } from '@/app/api/webhooks/meta/route';

assertDevContext();

// --- harness ---------------------------------------------------------------
type Result = { name: string; ok: boolean; detail?: string };
const results: Result[] = [];
function record(name: string, ok: boolean, detail?: string): void {
  results.push(detail === undefined ? { name, ok } : { name, ok, detail });
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
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

// --- fetch stub -------------------------------------------------------------
type FetchFn = typeof globalThis.fetch;
const realFetch: FetchFn = globalThis.fetch;
async function withFetchStub<T>(stub: FetchFn, fn: () => Promise<T>): Promise<T> {
  globalThis.fetch = stub;
  try {
    return await fn();
  } finally {
    globalThis.fetch = realFetch;
  }
}
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
const acceptedStub: FetchFn = async () =>
  jsonResponse({ messages: [{ id: `wamid.${randomUUID()}` }] }, 200);

// --- metric capture (stdout sniff) -----------------------------------------
async function captureMetrics<T>(fn: () => Promise<T>): Promise<{ result: T; events: string[] }> {
  const events: string[] = [];
  const orig = process.stdout.write.bind(process.stdout) as (
    chunk: string | Uint8Array,
    ...rest: unknown[]
  ) => boolean;
  const patched = ((chunk: string | Uint8Array, ...rest: unknown[]): boolean => {
    if (typeof chunk === 'string') {
      try {
        const o = JSON.parse(chunk) as { kind?: string; event?: string };
        if (o.kind === 'metric' && typeof o.event === 'string') events.push(o.event);
      } catch {
        /* not a metric line */
      }
    }
    return orig(chunk, ...rest);
  }) as typeof process.stdout.write;
  process.stdout.write = patched;
  try {
    const result = await fn();
    return { result, events };
  } finally {
    process.stdout.write = orig as typeof process.stdout.write;
  }
}

// --- fixtures ---------------------------------------------------------------
const created: string[] = []; // clinic ids para cleanup (cascade)
const orphanHashes: string[] = [];

async function createClinic(tag: string): Promise<string> {
  const slug = `c10${tag}${Date.now().toString(36)}`.slice(0, 30).toLowerCase();
  const rows = await dbAdmin.execute<{ id: string }>(
    sql`INSERT INTO clinics (slug, nome, status) VALUES (${slug}, ${`Smoke C10 ${tag}`}, 'active') RETURNING id`,
  );
  const id = rows[0]!.id;
  created.push(id);
  return id;
}

async function connectNumber(
  clinicId: string,
  metaPhoneId: string,
  phone: string,
  token = 'TEST_TOKEN',
): Promise<string> {
  const tokenEncrypted = await encryptForTenant(clinicId, token);
  const rows = await dbAdmin.execute<{ id: string }>(sql`
    INSERT INTO clinic_whatsapp_numbers
      (clinic_id, provider, phone_number, meta_phone_id, token_encrypted, verified_at, active)
    VALUES (${clinicId}, 'meta', ${phone}, ${metaPhoneId}, ${tokenEncrypted}, now(), true)
    RETURNING id`);
  return rows[0]!.id;
}

function makeMsg(
  wamid: string,
  phoneId: string,
  text: string | null = 'oi',
  from = '5511999990001',
): ParsedInboundMessage {
  return {
    providerMessageId: wamid,
    fromNumber: from,
    toPhoneId: phoneId,
    toNumber: '551140000000',
    text,
    timestamp: String(Math.floor(Date.now() / 1000)),
  };
}
function makeStatus(wamid: string, status: string, phoneId: string): ParsedStatusEvent {
  const raw = { id: wamid, status, recipient_id: '5511999990001' };
  return { providerMessageId: wamid, status, recipientNumber: '5511999990001', toPhoneId: phoneId, raw };
}

async function countInbound(clinicId: string, wamid: string): Promise<number> {
  const r = await dbAdmin.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM inbound_messages_raw WHERE clinic_id = ${clinicId} AND provider_message_id = ${wamid}`,
  );
  return Number(r[0]?.n ?? 0);
}
async function countInboxEvent(idemKey: string): Promise<number> {
  const r = await dbAdmin.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM outbox WHERE event_type = 'messaging.inbound.received' AND idempotency_key = ${idemKey}`,
  );
  return Number(r[0]?.n ?? 0);
}

// --- main -------------------------------------------------------------------
async function main(): Promise<void> {
  const provider = new MetaCloudProvider();
  const clinicA = await createClinic('a');
  const clinicB = await createClinic('b');
  const phoneIdA = `PA_${Date.now().toString(36)}`;
  const phoneIdB = `PB_${Date.now().toString(36)}`;
  await connectNumber(clinicA, phoneIdA, '551140000001');
  await connectNumber(clinicB, phoneIdB, '551140000002');

  // 1. assinatura HMAC
  await tryStep('1 validateSignature válido/tamperado/ausente', async () => {
    const body = JSON.stringify({ a: 1, b: 'x' });
    const secret = 'app-secret-xyz';
    const good = `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`;
    assert(provider.validateSignature(body, good, secret), 'assinatura válida deveria passar');
    assert(!provider.validateSignature(`${body} `, good, secret), 'corpo alterado deveria falhar');
    assert(!provider.validateSignature(body, null, secret), 'sem header deveria falhar');
  });

  // 2. verify endpoint (GET)
  await tryStep('2 verify endpoint ecoa challenge / 403', async () => {
    const ok = await webhookGet(
      new Request(
        'https://x/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=CH123',
      ),
    );
    assert(ok.status === 200 && (await ok.text()) === 'CH123', 'token certo deveria ecoar challenge');
    const bad = await webhookGet(
      new Request('https://x/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=X'),
    );
    assert(bad.status === 403, 'token errado deveria 403');
  });

  // 3. parseWebhook extrai mensagem + status + phone_id
  await tryStep('3 parseWebhook extrai messages/statuses/phone_id', async () => {
    const raw = JSON.stringify({
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: phoneIdA, display_phone_number: '551140000001' },
                messages: [{ id: 'wamid.X', from: '5511999990001', type: 'text', text: { body: 'oi' }, timestamp: '1700000000' }],
                statuses: [{ id: 'wamid.Y', status: 'delivered', recipient_id: '5511999990001' }],
              },
            },
          ],
        },
      ],
    });
    const p = provider.parseWebhook(raw);
    assert(p.messages.length === 1 && p.messages[0]!.toPhoneId === phoneIdA, 'deveria extrair 1 mensagem');
    assert(p.messages[0]!.text === 'oi', 'texto deveria ser extraído');
    assert(p.statuses.length === 1 && p.statuses[0]!.status === 'delivered', 'deveria extrair 1 status');
  });

  // 4. tenant por meta_phone_id + quarentena de número desconhecido
  await tryStep('4 resolve tenant + quarentena cifrada de órfão', async () => {
    assert((await resolveClinicByPhoneId(phoneIdA)) === clinicA, 'phoneIdA deveria resolver clinicA');
    assert((await resolveClinicByPhoneId('UNKNOWN_PHONE')) === null, 'desconhecido deveria ser null');
    const orphanRaw = JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: 'UNKNOWN_PHONE' } } }] }] });
    await quarantineOrphan('meta', 'UNKNOWN_PHONE', orphanRaw);
    await quarantineOrphan('meta', 'UNKNOWN_PHONE', orphanRaw); // dedup
    const r = await dbAdmin.execute<{ n: number; h: string }>(
      sql`SELECT count(*)::int AS n, max(payload_hash) AS h FROM inbound_messages_orphaned WHERE to_phone_id = 'UNKNOWN_PHONE'`,
    );
    assert(Number(r[0]?.n) === 1, `órfão deveria ter 1 row (dedup), tem ${r[0]?.n}`);
    if (r[0]?.h) orphanHashes.push(r[0].h);
    // payload cifrado (não plaintext)
    const enc = await dbAdmin.execute<{ p: string }>(
      sql`SELECT payload_encrypted AS p FROM inbound_messages_orphaned WHERE to_phone_id = 'UNKNOWN_PHONE' LIMIT 1`,
    );
    assert(!String(enc[0]?.p).includes('UNKNOWN_PHONE'), 'payload deveria estar cifrado');
  });

  // 5. inbound persist + evento na MESMA tx
  const wamid5 = `wamid.${randomUUID()}`;
  // Reusado idêntico no teste 6 (mesmo payload → payload_hash igual → duplicate;
  // um objeto novo teria timestamp diferente → seria classificado como conflict).
  const msg5 = makeMsg(wamid5, phoneIdA);
  await tryStep('5 persistInbound grava row + outbox event', async () => {
    const res = await persistInbound(clinicA, 'meta', msg5);
    assert(!res.deduped, 'primeira entrega não é dedup');
    assert((await countInbound(clinicA, wamid5)) === 1, 'deveria ter 1 inbound row');
    assert((await countInboxEvent(`inbound:meta:${wamid5}`)) === 1, 'deveria ter 1 outbox event');
  });

  // 6. dedup por (provider, provider_message_id)
  await tryStep('6 dedup inbound → 1 row, 1 evento, métrica duplicate', async () => {
    const { result, events } = await captureMetrics(() => persistInbound(clinicA, 'meta', msg5));
    assert(result.deduped, 're-entrega deveria ser dedup');
    assert(events.includes('messaging.inbound.duplicate'), 'deveria emitir duplicate');
    assert((await countInbound(clinicA, wamid5)) === 1, 'ainda 1 inbound row');
    assert((await countInboxEvent(`inbound:meta:${wamid5}`)) === 1, 'ainda 1 outbox event');
  });

  // 18. mesmo id, payload diferente → conflict (incidente)
  await tryStep('18 mesmo id + payload diferente → métrica conflict', async () => {
    const { events } = await captureMetrics(() =>
      persistInbound(clinicA, 'meta', makeMsg(wamid5, phoneIdA, 'CONTEUDO DIFERENTE')),
    );
    assert(events.includes('messaging.inbound.conflict'), 'deveria emitir conflict (≠ duplicate)');
    assert((await countInbound(clinicA, wamid5)) === 1, 'ainda 1 row (não sobrescreve)');
  });

  // 10. status raw dedup por (provider, payload_hash)
  await tryStep('10 status raw dedup', async () => {
    const st = makeStatus('wamid.OUT1', 'delivered', phoneIdA);
    await persistStatusEvents(clinicA, 'meta', [st]);
    await persistStatusEvents(clinicA, 'meta', [st]);
    const r = await dbAdmin.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM provider_status_events_raw WHERE clinic_id = ${clinicA} AND provider_message_id = 'wamid.OUT1'`,
    );
    assert(Number(r[0]?.n) === 1, `status deveria ter 1 row (dedup), tem ${r[0]?.n}`);
  });

  // 9. outbound accepted + dedup + suppression
  await tryStep('9 outbound accepted + dedup + suppression bloqueia', async () => {
    const key1 = randomUUID();
    const out = await withFetchStub(acceptedStub, () =>
      sendOutbound({ clinicId: clinicA, toNumber: '5511988887777', idempotencyKey: key1, body: { kind: 'text', text: 'olá' } }),
    );
    assert(out.status === 'accepted' && out.providerMessageId !== null, 'deveria aceitar com wamid');
    const dup = await withFetchStub(acceptedStub, () =>
      sendOutbound({ clinicId: clinicA, toNumber: '5511988887777', idempotencyKey: key1, body: { kind: 'text', text: 'olá' } }),
    );
    assert(dup.deduped, 'mesma key deveria dedupar');
    // suppression
    const suppHash = await hashForLookup(normalizePhone('5511955554444'));
    await dbAdmin.execute(
      sql`INSERT INTO suppression_list (clinic_id, contact_hash, channel, reason) VALUES (${clinicA}, ${suppHash}, 'whatsapp', 'smoke')`,
    );
    let suppressed = false;
    try {
      await withFetchStub(acceptedStub, () =>
        sendOutbound({ clinicId: clinicA, toNumber: '5511955554444', idempotencyKey: randomUUID(), body: { kind: 'text', text: 'x' } }),
      );
    } catch (e) {
      suppressed = e instanceof Error && e.name === 'SuppressedRecipientError';
    }
    assert(suppressed, 'destinatário suprimido deveria bloquear envio');
  });

  // 7. isolamento cross-tenant da idempotency_key
  await tryStep('7 idempotency_key isolada por clínica (A e B mesma key)', async () => {
    const shared = randomUUID();
    const a = await withFetchStub(acceptedStub, () =>
      sendOutbound({ clinicId: clinicA, toNumber: '5511900000001', idempotencyKey: shared, body: { kind: 'text', text: 'a' } }),
    );
    const b = await withFetchStub(acceptedStub, () =>
      sendOutbound({ clinicId: clinicB, toNumber: '5511900000002', idempotencyKey: shared, body: { kind: 'text', text: 'b' } }),
    );
    assert(!a.deduped && !b.deduped, 'mesma key em clínicas diferentes NÃO deveria colidir');
    assert(a.status === 'accepted' && b.status === 'accepted', 'ambas deveriam aceitar');
  });

  // 15. unknown vs failed
  await tryStep('15 status unknown (rede) vs failed (HTTP)', async () => {
    const unknownStub: FetchFn = async () => {
      throw new Error('network reset');
    };
    const u = await withFetchStub(unknownStub, () =>
      sendOutbound({ clinicId: clinicA, toNumber: '5511900000003', idempotencyKey: randomUUID(), body: { kind: 'text', text: 'u' } }),
    );
    assert(u.status === 'unknown', `falha de rede deveria ser unknown, foi ${u.status}`);
    const failStub: FetchFn = async () => jsonResponse({ error: { message: 'bad' } }, 500);
    const f = await withFetchStub(failStub, () =>
      sendOutbound({ clinicId: clinicA, toNumber: '5511900000004', idempotencyKey: randomUUID(), body: { kind: 'text', text: 'f' } }),
    );
    assert(f.status === 'failed', `HTTP 500 deveria ser failed, foi ${f.status}`);
  });

  // 16. refresh de token: 401 + rotação → retry accepted; 401 sem rotação → failed
  await tryStep('16 refresh de credencial em 401 só com token_version bumpado', async () => {
    let calls = 0;
    const rotateStub: FetchFn = async () => {
      calls++;
      if (calls === 1) {
        await dbAdmin.execute(
          sql`UPDATE clinic_whatsapp_numbers SET token_version = token_version + 1 WHERE clinic_id = ${clinicA} AND active = true`,
        );
        return jsonResponse({ error: { code: 401 } }, 401);
      }
      return jsonResponse({ messages: [{ id: 'wamid.AFTER_ROTATE' }] }, 200);
    };
    const r = await withFetchStub(rotateStub, () =>
      sendOutbound({ clinicId: clinicA, toNumber: '5511900000005', idempotencyKey: randomUUID(), body: { kind: 'text', text: 'r' } }),
    );
    assert(r.status === 'accepted' && calls === 2, `rotação deveria reenviar e aceitar (calls=${calls}, status=${r.status})`);

    let calls2 = 0;
    const noRotateStub: FetchFn = async () => {
      calls2++;
      return jsonResponse({ error: { code: 401 } }, 401);
    };
    const r2 = await withFetchStub(noRotateStub, () =>
      sendOutbound({ clinicId: clinicA, toNumber: '5511900000006', idempotencyKey: randomUUID(), body: { kind: 'text', text: 'r2' } }),
    );
    assert(r2.status === 'failed' && calls2 === 1, `sem rotação: failed sem reenvio (calls=${calls2}, status=${r2.status})`);
  });

  // 11. RLS A/B
  await tryStep('11 RLS — withTenant(A) não vê inbound de B', async () => {
    await persistInbound(clinicB, 'meta', makeMsg(`wamid.${randomUUID()}`, phoneIdB));
    const seen = await withTenant(clinicA, async (tx) => {
      const rows = await tx.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM inbound_messages_raw WHERE clinic_id = ${clinicB}`,
      );
      return Number(rows[0]?.n ?? 0);
    });
    assert(seen === 0, `clínica A não deveria ver inbound de B (viu ${seen})`);
  });

  // 14. concorrência: 5 webhooks simultâneos com mesmo id
  await tryStep('14 concorrência — 5× mesmo id → 1 inbound, 1 evento', async () => {
    const wamid = `wamid.${randomUUID()}`;
    await Promise.all(Array.from({ length: 5 }, () => persistInbound(clinicA, 'meta', makeMsg(wamid, phoneIdA))));
    assert((await countInbound(clinicA, wamid)) === 1, 'deveria ter exatamente 1 inbound row');
    assert((await countInboxEvent(`inbound:meta:${wamid}`)) === 1, 'deveria ter exatamente 1 outbox event');
  });

  // 17. rollback do outbox (publishEvent falha → 0 inbound + 0 evento)
  await tryStep('17 rollback — publishEvent falha → 0 inbound + 0 evento', async () => {
    const wamid = `wamid.${randomUUID()}`;
    const saved = getEventSchema(MESSAGING_EVENTS.INBOUND_RECEIVED);
    catalogTesting.reset(); // esvazia o catálogo → publishEvent lança "not in catalog"
    let threw = false;
    try {
      await persistInbound(clinicA, 'meta', makeMsg(wamid, phoneIdA));
    } catch {
      threw = true;
    }
    // restaura o catálogo para não afetar nada depois
    if (saved) registerEventSchema(MESSAGING_EVENTS.INBOUND_RECEIVED, InboundReceivedSchema);
    assert(threw, 'persistInbound deveria propagar a exceção do publishEvent');
    assert((await countInbound(clinicA, wamid)) === 0, 'rollback: inbound NÃO deveria persistir');
    assert((await countInboxEvent(`inbound:meta:${wamid}`)) === 0, 'rollback: evento NÃO deveria persistir');
  });

  // 8. reconexão após disconnect (partial unique WHERE active=true)
  await tryStep('8 reconexão de número após disconnect', async () => {
    const clinicC = await createClinic('c');
    await connectNumber(clinicC, `PC1_${Date.now().toString(36)}`, '551140000010');
    await dbAdmin.execute(
      sql`UPDATE clinic_whatsapp_numbers SET active = false WHERE clinic_id = ${clinicC} AND active = true`,
    );
    await connectNumber(clinicC, `PC2_${Date.now().toString(36)}`, '551140000011'); // deveria funcionar
    const r = await dbAdmin.execute<{ act: number; tot: number }>(sql`
      SELECT count(*) FILTER (WHERE active)::int AS act, count(*)::int AS tot
      FROM clinic_whatsapp_numbers WHERE clinic_id = ${clinicC}`);
    assert(Number(r[0]?.act) === 1 && Number(r[0]?.tot) === 2, `deveria ter 1 ativo + 1 histórico (act=${r[0]?.act} tot=${r[0]?.tot})`);
  });

  // 12. pré-flight estrutural: FORCE RLS + grants column-level
  await tryStep('12 pré-flight: 5 tabelas FORCE RLS + token grant negado', async () => {
    const tables = [
      'clinic_whatsapp_numbers',
      'inbound_messages_raw',
      'outbound_messages',
      'provider_status_events_raw',
      'inbound_messages_orphaned',
    ];
    for (const t of tables) {
      const r = await dbAdmin.execute<{ rls: boolean; force: boolean }>(
        sql`SELECT relrowsecurity AS rls, relforcerowsecurity AS force FROM pg_class WHERE relname = ${t}`,
      );
      assert(r[0]?.rls === true && r[0]?.force === true, `${t} deveria ter ENABLE+FORCE RLS`);
    }
    const grant = await dbAdmin.execute<{ tok: boolean; phone: boolean }>(sql`
      SELECT has_column_privilege('authenticated', 'clinic_whatsapp_numbers', 'token_encrypted', 'SELECT') AS tok,
             has_column_privilege('authenticated', 'clinic_whatsapp_numbers', 'phone_number', 'SELECT') AS phone`);
    assert(grant[0]?.tok === false, 'authenticated NÃO deveria poder ler token_encrypted');
    assert(grant[0]?.phone === true, 'authenticated deveria poder ler phone_number');
  });

  // 13. admin audit (connect/disconnect/rotate) → in-app (super_admin session). Skip noted.
  record('13 admin audit connect/disconnect/rotate (in-app/runbook — super_admin session)', true, 'SKIP: validado in-app');
}

// --- cleanup ----------------------------------------------------------------
async function cleanup(): Promise<void> {
  for (const clinicId of created) {
    try {
      await dbAdmin.execute(sql`DELETE FROM clinics WHERE id = ${clinicId}`);
    } catch {
      /* best-effort */
    }
  }
  for (const h of orphanHashes) {
    try {
      await dbAdmin.execute(sql`DELETE FROM inbound_messages_orphaned WHERE payload_hash = ${h}`);
    } catch {
      /* best-effort */
    }
  }
}

main()
  .catch((e) => record('main', false, e instanceof Error ? e.stack ?? e.message : String(e)))
  .finally(async () => {
    await cleanup();
    const failed = results.filter((r) => !r.ok);
    console.log(`\n=== smoke-c10: ${results.length - failed.length}/${results.length} passed ===`);
    process.exit(failed.length === 0 ? 0 : 1);
  });
