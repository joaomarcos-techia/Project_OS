/** Schema real, dados sintéticos, Postgres local descartável; nenhum provider externo. */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { sql as drizzleSql } from 'drizzle-orm';
import { startScratchSchema } from './scratch-schema';

const clinicId = randomUUID();
const ownerId = randomUUID();
let cleanupTargetVerified = false;
const cluster = await startScratchSchema({
  port: 55496,
  beforeMigration: {
    file: '0135_ai_clinic_operational_info.sql',
    async run(sql) {
      const [directory] = await sql<{ data_directory: string }[]>`show data_directory`;
      assert.ok(directory);
      const root = path.dirname(path.resolve(directory.data_directory));
      assert.equal(path.dirname(root).toLowerCase(), path.resolve(os.tmpdir()).toLowerCase());
      assert.match(path.basename(root), /^qoro-scratch-schema-[a-z0-9]+$/iu);
      cleanupTargetVerified = true;
      await sql`insert into clinics(id,slug,nome,status)
        values(${clinicId}::uuid,${'handoff-' + clinicId.slice(0, 8)},'Synthetic reliability clinic','active')`;
      await sql`insert into ai_clinic_config(clinic_id,max_days_ahead) values(${clinicId}::uuid,37)`;
    },
  },
});

// Só o processo de teste recebe URLs locais e chaves sintéticas. Não lê .env.local.
for (const key of Object.keys(process.env)) {
  if (key.startsWith('DATABASE_URL')) delete process.env[key];
}
Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: cluster.url,
  DATABASE_URL_DEV: cluster.url,
  DATABASE_URL_RUNTIME: cluster.url,
  SUPABASE_PROJECT_ENV: 'dev',
  NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  CRYPTO_SECRET_BACKEND: 'env',
  CRYPTO_MASTER_KEY_V1: Buffer.alloc(32, 7).toString('base64'),
  CRYPTO_LOOKUP_SALT: Buffer.alloc(32, 9).toString('base64'),
  MASTER_KEY_VERSION: '1',
  GEMINI_API_KEY: 'synthetic-provider-no-network',
  LOG_LEVEL: 'error',
});
assert.equal(new URL(cluster.url).hostname, '127.0.0.1');
let closeApplicationPools: (() => Promise<unknown>) | undefined;
try {
  const { dbAdmin, db, dbWorker } = await import('../../src/lib/db');
  closeApplicationPools = () =>
    Promise.all([
      dbAdmin.$client.end({ timeout: 5 }),
      db.$client.end({ timeout: 5 }),
      dbWorker.$client.end({ timeout: 5 }),
    ]);
  const { escalateToHuman, returnToAgent } =
    await import('../../src/contexts/ai-agent/internal/conversation');
  const { encryptForTenant } = await import('../../src/lib/crypto');
  const { decryptForTenant } = await import('../../src/lib/crypto');
  const { withTenant } = await import('../../src/lib/db/tenant');
  const { validateAndExecute } = await import('../../src/contexts/ai-agent/tools/registry');
  await import('../../src/contexts/ai-agent/tools/provide-clinic-info');
  let passed = 0;
  async function check(name: string, run: () => Promise<void>) {
    await run();
    passed += 1;
    console.log(`PASS ${name}`);
  }
  const sql = cluster.sql;
// Mesma ACL gerenciada reproduzida no gate signup-provision-db. Não altera
// policies nem grants de ambientes remotos.
await sql`GRANT SELECT ON public.clinics, public.subscriptions, public.profiles TO authenticated`;
  async function conversation() {
    const id = randomUUID();
    await sql`insert into ai_conversations(id,clinic_id,patient_phone_hash,patient_phone_encrypted)
    values(${id}::uuid,${clinicId}::uuid,${randomBytes(32).toString('hex')},${await encryptForTenant(clinicId, 'synthetic-contact')})`;
    return id;
  }
  async function queue(id: string) {
    return sql`select priority,assigned_to,due_at,resolved_at from ai_handoff_queue
    where clinic_id=${clinicId}::uuid and conversation_id=${id}::uuid and resolved_at is null`;
  }
  assert.ok(cleanupTargetVerified);
  await check(
    '0135 preserves existing config and defaults to unknown operational facts',
    async () => {
      const [row] =
        await sql`select max_days_ahead,operational_info from ai_clinic_config where clinic_id=${clinicId}::uuid`;
      assert.equal(row?.max_days_ahead, 37);
      assert.deepEqual(row?.operational_info, {});
    },
  );
  await sql`insert into auth.users(id,email) values(${ownerId}::uuid,'owner@example.invalid')`;
  await sql`insert into profiles(id,clinic_id,nome,role,ativo,invite_accepted_at)
    values(${ownerId}::uuid,${clinicId}::uuid,'Synthetic owner','owner',true,now())`;
  const normal = await conversation();
  await check('normal escalation retains normal priority', async () => {
    await dbAdmin.transaction((tx) => escalateToHuman(tx, clinicId, normal, 'human_requested'));
    assert.equal((await queue(normal))[0]?.priority, 'normal');
  });
  const urgent = await conversation();
  await check('emergency creates an urgent queue entry', async () => {
    await dbAdmin.transaction((tx) => escalateToHuman(tx, clinicId, urgent, 'clinical_emergency'));
    assert.equal((await queue(urgent))[0]?.priority, 'urgent');
  });
  await check(
    'emergency raises existing queue without replacing owner or extending deadline',
    async () => {
      await sql`update ai_handoff_queue set assigned_to=${ownerId}::uuid,assigned_at=now(),due_at=now()-interval '1 minute'
      where conversation_id=${normal}::uuid and resolved_at is null`;
      const [before] = await queue(normal);
      await dbAdmin.transaction((tx) =>
        escalateToHuman(tx, clinicId, normal, 'clinical_emergency'),
      );
      const after = await queue(normal);
      assert.equal(after.length, 1);
      assert.equal(after[0]?.priority, 'urgent');
      assert.equal(after[0]?.assigned_to, ownerId);
      assert.equal(after[0]?.due_at.getTime(), before?.due_at.getTime());
    },
  );
  await check('normal escalation never downgrades urgency', async () => {
    await dbAdmin.transaction((tx) => escalateToHuman(tx, clinicId, urgent, 'human_requested'));
    assert.equal((await queue(urgent))[0]?.priority, 'urgent');
  });
  await check('concurrent repeated escalation produces one open urgent entry', async () => {
    const id = await conversation();
    await Promise.all([
      dbAdmin.transaction((tx) => escalateToHuman(tx, clinicId, id, 'human_requested')),
      dbAdmin.transaction((tx) => escalateToHuman(tx, clinicId, id, 'clinical_emergency')),
    ]);
    const rows = await queue(id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.priority, 'urgent');
  });
  await check('explicit return closes queue; new episode does not rewrite history', async () => {
    assert.equal(await dbAdmin.transaction((tx) => returnToAgent(tx, clinicId, urgent)), true);
    assert.equal((await queue(urgent)).length, 0);
    await dbAdmin.transaction((tx) => escalateToHuman(tx, clinicId, urgent, 'clinical_emergency'));
    assert.equal((await queue(urgent)).length, 1);
    const [row] =
      await sql`select count(*)::int as n from ai_handoff_queue where conversation_id=${urgent}::uuid`;
    assert.equal(row?.n, 2);
  });
  await check('configured facts reach actual tool through tenant-scoped SQL', async () => {
    await sql`update ai_clinic_config set operational_info=${sql.json({ onlineCareInfo: 'Atendimento online disponível.' })} where clinic_id=${clinicId}::uuid`;
    const result = await withTenant(clinicId, (tx) =>
      validateAndExecute(
        { name: 'provide_clinic_info', args: {} },
        {
          tx,
          clinicId,
          conversationId: normal,
          eventId: randomUUID(),
          aiRequestId: randomUUID(),
          patientId: null,
          patientNome: null,
          identityAmbiguous: false,
          verifiedPhone: 'synthetic-contact',
          currentMessage: 'Atende online?',
          canScheduleAnonymous: false,
          maxDaysAhead: 37,
          clinicTimeZone: 'America/Sao_Paulo',
          pendingAppointmentProcedureName: null,
          canDisclosePayments: false,
        },
      ),
    );
    assert.equal(result.ok, true);
    if (result.ok)
      assert.ok(
        'patient_message' in result.response &&
          String(result.response.patient_message).includes('Atendimento online disponível.'),
      );
  });
  await check('database rejects non-object operational configuration', async () => {
    await assert.rejects(
      sql`update ai_clinic_config set operational_info='[]'::jsonb where clinic_id=${clinicId}::uuid`,
      (error: unknown) =>
        typeof error === 'object' && error !== null && 'code' in error && error.code === '23514',
    );
  });

  await check('new configuration remains hidden from a different tenant', async () => {
    const other = randomUUID();
    await sql`insert into clinics(id,slug,nome,status) values(${other}::uuid,${'other-' + other.slice(0, 8)},'Other synthetic clinic','active')`;
    const rows = await withTenant(other, (tx) =>
      tx.execute(
        drizzleSql`select operational_info from ai_clinic_config where clinic_id=${clinicId}::uuid`,
      ),
    );
    assert.equal(rows.length, 0);
  });

  // A saga e o SQL são reais; somente as respostas de Gemini e Meta são
  // controladas. Todo fetch inesperado é recusado, sem acesso à rede externa.
  const { GeminiProvider } = await import('../../src/lib/ai/gemini');
  const { persistInbound } = await import('../../src/contexts/messaging/internal/inbound');
  const { InboundReceivedSchema } = await import('../../src/contexts/messaging/events');
  const { __testing__: inbound } =
    await import('../../src/contexts/ai-agent/internal/handlers/inbound-received');
  const { OPERATIONAL_FALLBACK } = await import('../../src/contexts/ai-agent/prompts/system');
  const originalGenerate = GeminiProvider.prototype.generateWithTools;
  const originalFetch = globalThis.fetch;
  const generated: import('../../src/lib/ai/provider').GenerateResult[] = [];
  let providerCalls = 0;
  let externalCalls = 0;
  globalThis.fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname !== 'graph.facebook.com') {
      externalCalls += 1;
      throw new Error('Unexpected external network access');
    }
    return new Response(JSON.stringify({ messages: [{ id: 'wamid.synthetic.' + randomUUID() }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  GeminiProvider.prototype.generateWithTools = async () => {
    providerCalls += 1;
    const next = generated.shift();
    assert.ok(next, 'Synthetic model script exhausted');
    return next;
  };
  const call = (
    name: string,
    args: object = {},
  ): import('../../src/lib/ai/provider').GenerateResult => ({
    toolCalls: [{ name, args }],
    usage: { tokensInput: 1, tokensOutput: 1, model: 'gemini-3.6-flash' },
  });
  const metaId = 'synthetic-meta-' + randomUUID();
  await sql`insert into clinic_whatsapp_numbers(clinic_id,provider,phone_number,meta_phone_id,token_encrypted,verified_at,active,connection_status)
    values(${clinicId}::uuid,'meta','5511000000000',${metaId},${await encryptForTenant(clinicId, 'SYNTHETIC_TOKEN')},now(),true,'connected')`;
  const turn = async (phone: string, text: string) => {
    const message = {
      providerMessageId: 'wamid.local.' + randomUUID(),
      fromNumber: phone,
      toPhoneId: metaId,
      toNumber: '5511000000000',
      text,
      timestamp: String(Math.floor(Date.now() / 1000)),
    };
    await persistInbound(clinicId, 'meta', message);
    const [event] =
      await sql`select id,payload from outbox where clinic_id=${clinicId}::uuid and idempotency_key=${'inbound:meta:' + message.providerMessageId}`;
    assert.ok(event);
    const payload = InboundReceivedSchema.parse(event.payload);
    await inbound.processInbound({ clinicId, payload, eventId: event.id, attempt: 1 });
    const rows =
      await sql`select conversation_id,direction,content_encrypted,tool_calls from ai_messages where clinic_id=${clinicId}::uuid and event_id=${event.id} order by direction`;
    const response = rows.find((row) => row.direction === 'out');
    return {
      eventId: event.id,
      conversationId: rows[0]?.conversation_id,
      response: response ? await decryptForTenant(clinicId, response.content_encrypted) : null,
      tools: response?.tool_calls,
    };
  };
  try {
    await check(
      'real inbound saga returns configured online information after one model call',
      async () => {
        const before = providerCalls;
        generated.push(call('provide_clinic_info'));
        const result = await turn('5511999000001', 'Atende online?');
        assert.equal(providerCalls - before, 1);
        assert.ok(result.response?.includes('Atendimento online disponível.'));
        assert.equal((await queue(result.conversationId)).length, 0);
      },
    );
    await check(
      'repeated reads stop safely and preserve both rounds without false handoff promise',
      async () => {
        generated.push(call('provide_clinic_info'), call('provide_clinic_info'));
        const result = await turn('5511999000002', 'Qual o endereço?');
        assert.equal(result.response, OPERATIONAL_FALLBACK);
        assert.equal((await queue(result.conversationId)).length, 0);
        assert.deepEqual(
          result.tools.map((tool: { round: number }) => tool.round),
          [1, 2],
        );
        const [failure] =
          await sql`select error_code from ai_agent_failures where event_id=${result.eventId}::uuid`;
        assert.equal(failure?.error_code, 'tool_read_repeated');
      },
    );
    await check('three-round budget remains enforced with persistent terminal reason', async () => {
      generated.push(
        call('provide_procedure_price'),
        call('provide_procedure_price', { procedure_name: 'Consulta' }),
        call('provide_clinic_info'),
        call('provide_procedure_price', { procedure_name: 'Outro' }),
      );
      const result = await turn('5511999000003', 'Quais são as informações?');
      assert.equal(result.response, OPERATIONAL_FALLBACK);
      assert.equal(result.tools.length, 3);
      const [failure] =
        await sql`select error_code from ai_agent_failures where event_id=${result.eventId}::uuid`;
      assert.equal(failure?.error_code, 'tool_rounds_exceeded');
    });
    await check(
      'emergency during human takeover raises priority without model or concurrent reply',
      async () => {
        generated.push(call('request_human_handoff', { reason: 'Pedido humano sintético' }), {
          text: 'Conversa encaminhada.',
          usage: { tokensInput: 1, tokensOutput: 1, model: 'gemini-3.6-flash' },
        });
        const first = await turn('5511999000004', 'Quero falar com atendente');
        assert.equal((await queue(first.conversationId))[0]?.priority, 'normal');
        const before = providerCalls;
        const second = await turn('5511999000004', 'Estou com dor forte no peito');
        assert.equal(providerCalls, before);
        assert.equal(second.response, null);
        assert.equal((await queue(first.conversationId))[0]?.priority, 'urgent');
      },
    );
    assert.equal(externalCalls, 0);
  } finally {
    GeminiProvider.prototype.generateWithTools = originalGenerate;
    globalThis.fetch = originalFetch;
  }
  console.log(
    JSON.stringify({
      state: 'PASS',
      checks: passed,
      environment: 'isolated-local-postgres',
      externalCalls: false,
    }),
  );
} finally {
  await closeApplicationPools?.();
  if (cleanupTargetVerified) await cluster.stop();
}
