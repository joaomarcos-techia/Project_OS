/** Prova PostgreSQL do metering comercial de IA, somente em fixture isolada no DEV. */
import './_env';

import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';

import { AI_AGENT_EVENTS } from '@/contexts/ai-agent';
import { BILLING_EVENTS, AiUsageNoticeRequestedSchema } from '@/contexts/billing/events';
import '@/contexts/billing/internal/handlers/conversation-completed';
import '@/app/api/cron/outbox/ai-usage-notice-handler';
import { createAdminClient } from '@/lib/auth/supabase-admin';
import { dbAdmin } from '@/lib/db';
import { withTenant } from '@/lib/db/tenant';
import { createResendInboxAlias, waitForResendEmail } from '@/lib/email/resend-inspector';
import { env } from '@/lib/env';
import { getHandler } from '@/lib/outbox/registry';

import { assertDevContext } from './_env';

const DEV_PROJECT_REF = 'pqhkirrszzpwezdaqrai';
const clinicId = randomUUID();
const slug = `ai-usage-${clinicId.slice(0, 12)}`;

async function main(): Promise<void> {
  const { databaseUrl } = assertDevContext();
  const url = new URL(databaseUrl);
  if (
    !url.username.endsWith(`.${DEV_PROJECT_REF}`) ||
    databaseUrl === process.env.DATABASE_URL_PROD ||
    !env.NEXT_PUBLIC_SUPABASE_URL ||
    new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname !== `${DEV_PROJECT_REF}.supabase.co`
  ) {
    throw new Error('A prova de IA exige exclusivamente o banco DEV esperado.');
  }
  const [catalog] = await dbAdmin.execute<{ plan_id: string; price_id: string }>(sql`
    SELECT p.id::text AS plan_id, pr.id::text AS price_id
    FROM public.plans p JOIN public.prices pr ON pr.plan_id = p.id
    WHERE p.code = 'consultorio_2026' AND p.ativo = true
      AND pr.billing_cycle = 'monthly' AND pr.active_until IS NULL
      AND pr.campaign_code IS NULL
    LIMIT 1
  `);
  if (!catalog) throw new Error('Catálogo Consultório 2026 indisponível no DEV.');

  const registered = getHandler(AI_AGENT_EVENTS.CONVERSATION_COMPLETED);
  if (!registered || registered.execution !== 'transactional') {
    throw new Error('Handler transacional de metering não registrado.');
  }
  let created = false;
  let authUserId: string | null = null;
  let assertions = 0;
  const assert = (condition: boolean, label: string): void => {
    if (!condition) throw new Error(`FAIL: ${label}`);
    assertions++;
  };
  const readCount = async (): Promise<number> => {
    const [row] = await dbAdmin.execute<{ count: number }>(sql`
      SELECT conversas_ia_count::int AS count FROM public.usage_metrics
      WHERE clinic_id = ${clinicId}::uuid
        AND period_yyyymm = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM')
    `);
    return Number(row?.count ?? 0);
  };
  const conversation = async (phoneHash: string): Promise<string> => {
    const [row] = await dbAdmin.execute<{ id: string }>(sql`
      INSERT INTO public.ai_conversations
        (clinic_id, patient_phone_hash, patient_phone_encrypted)
      VALUES (${clinicId}::uuid, ${phoneHash}, 'fixture-only-no-delivery')
      RETURNING id::text AS id
    `);
    if (!row) throw new Error('Conversa sintética não criada.');
    return row.id;
  };
  const processTurn = async (conversationId: string, eventId = randomUUID()): Promise<void> =>
    withTenant(clinicId, (tx) =>
      registered.handler({
        tx,
        clinicId,
        eventId,
        attempt: 1,
        payload: {
          clinicId,
          conversationId,
          inboundMessageId: randomUUID(),
          outcome: 'replied',
          toolCallCount: 0,
          costUsd: 0.001,
        },
      }),
    );

  try {
    await dbAdmin.execute(sql`
      INSERT INTO public.clinics (id, nome, slug)
      VALUES (${clinicId}::uuid, 'Fixture IA 24h', ${slug})
    `);
    created = true;
    await dbAdmin.execute(sql`
      INSERT INTO public.subscriptions (clinic_id, plan_id, price_id, billing_status)
      VALUES (${clinicId}::uuid, ${catalog.plan_id}::uuid, ${catalog.price_id}::uuid, 'active')
    `);
    const firstConversation = await conversation(`fixture-${clinicId}-a`);
    const firstEvent = randomUUID();
    await processTurn(firstConversation, firstEvent);
    assert((await readCount()) === 1, 'primeira resposta conta');
    await processTurn(firstConversation);
    assert((await readCount()) === 1, 'outro turno dentro de 24h não conta');
    await dbAdmin.execute(sql`
      UPDATE public.usage_counter_ledger
      SET period_yyyymm = to_char((now() AT TIME ZONE 'UTC') - interval '1 month', 'YYYY-MM')
      WHERE clinic_id = ${clinicId}::uuid AND metric = 'ai_messages'
    `);
    await processTurn(firstConversation);
    assert((await readCount()) === 1, 'janela de 24h atravessa o limite do mês');
    await dbAdmin.execute(sql`
      UPDATE public.usage_counter_ledger
      SET created_at = now() - interval '25 hours'
      WHERE clinic_id = ${clinicId}::uuid AND metric = 'ai_messages'
    `);
    await processTurn(firstConversation);
    assert((await readCount()) === 2, 'após 24h o mesmo paciente conta novamente');
    await processTurn(firstConversation, firstEvent);
    assert((await readCount()) === 2, 'replay tardio do mesmo evento não duplica');

    const concurrentConversation = await conversation(`fixture-${clinicId}-b`);
    await Promise.all([processTurn(concurrentConversation), processTurn(concurrentConversation)]);
    assert((await readCount()) === 3, 'duas respostas concorrentes do mesmo contato contam uma');

    await dbAdmin.execute(sql`
      UPDATE public.usage_metrics SET conversas_ia_count = 399
      WHERE clinic_id = ${clinicId}::uuid
    `);
    await processTurn(await conversation(`fixture-${clinicId}-c`));
    assert((await readCount()) === 400, 'limiar 80% usa o contador persistido');
    await dbAdmin.execute(sql`
      UPDATE public.usage_metrics SET conversas_ia_count = 499
      WHERE clinic_id = ${clinicId}::uuid
    `);
    await processTurn(await conversation(`fixture-${clinicId}-d`));
    assert((await readCount()) === 500, 'limiar 100% usa o contador persistido');
    const notices = await dbAdmin.execute<{ threshold: number }>(sql`
      SELECT (payload->>'threshold')::int AS threshold FROM public.outbox
      WHERE clinic_id = ${clinicId}::uuid
        AND event_type = 'billing.ai_usage.notice_requested'
      ORDER BY threshold
    `);
    assert(
      notices.length === 2 && notices[0]?.threshold === 80 && notices[1]?.threshold === 100,
      'avisos 80% e 100% enfileirados exatamente uma vez',
    );
    // O cron DEV não pode enviar uma fixture antes de ela ganhar titular.
    await dbAdmin.execute(sql`
      UPDATE public.outbox SET next_attempt_at = '2099-01-01'::timestamptz
      WHERE clinic_id = ${clinicId}::uuid
        AND event_type = 'billing.ai_usage.notice_requested'
    `);
    const inbox = process.env.E2E_RESEND_INBOX_ADDRESS;
    const resendKey = env.RESEND_API_KEY;
    if (inbox && resendKey) {
      const recipient = createResendInboxAlias(inbox, clinicId.slice(0, 12));
      const admin = createAdminClient();
      const { data, error } = await admin.auth.admin.createUser({
        email: recipient,
        email_confirm: true,
      });
      if (error || !data.user)
        throw new Error('Não foi possível criar titular sintético no Auth DEV.');
      authUserId = data.user.id;
      await dbAdmin.execute(sql`
        INSERT INTO public.profiles (id, clinic_id, nome, role)
        VALUES (${authUserId}::uuid, ${clinicId}::uuid, 'Titular Fixture IA', 'owner')
      `);
      const [notice] = await dbAdmin.execute<{ payload: unknown; id: string }>(sql`
        SELECT id::text AS id, payload FROM public.outbox
        WHERE clinic_id = ${clinicId}::uuid
          AND event_type = 'billing.ai_usage.notice_requested'
          AND payload->>'threshold' = '80'
        LIMIT 1
      `);
      if (!notice) throw new Error('Evento de 80% ausente antes do envio ao inbox.');
      const noticePayload = AiUsageNoticeRequestedSchema.parse(notice.payload);
      const delivery = getHandler(BILLING_EVENTS.AI_USAGE_NOTICE_REQUESTED);
      if (!delivery || delivery.execution !== 'detached') {
        throw new Error('Handler de e-mail de IA não registrado.');
      }
      const startedAt = new Date(Date.now() - 1_000);
      await delivery.handler({
        clinicId,
        payload: noticePayload,
        eventId: notice.id,
        attempt: 1,
      });
      const received = await waitForResendEmail({
        apiKey: resendKey,
        to: recipient,
        subject: 'Qoro: 80% da referência mensal de IA',
        sentAfter: startedAt,
        kind: 'received',
        timeoutMs: 60_000,
      });
      assert(
        Boolean(received.text?.includes('A IA continua atendendo')) &&
          Boolean(received.text?.includes('400 de 500')),
        'Resend entregou ao inbox o aviso correto de 80%',
      );
      console.log('PASS: aviso de IA chegou ao inbox Resend de teste.');
    } else {
      console.log(
        'BLOCKED: inbox Resend de teste ou chave DEV ausente; aviso somente enfileirado.',
      );
    }
    console.log(`PASS: metering IA no PostgreSQL DEV, ${assertions} asserções.`);
  } finally {
    let authCleanupFailed = false;
    if (authUserId) {
      try {
        const admin = createAdminClient();
        const deleted = await admin.auth.admin.deleteUser(authUserId);
        const readback = await admin.auth.admin.getUserById(authUserId);
        authCleanupFailed = Boolean(deleted.error || readback.data.user);
      } catch {
        authCleanupFailed = true;
      }
    }
    if (created) {
      await dbAdmin.execute(sql`DELETE FROM public.outbox WHERE clinic_id = ${clinicId}::uuid`);
      await dbAdmin.execute(sql`DELETE FROM public.clinics WHERE id = ${clinicId}::uuid`);
      const [residue] = await dbAdmin.execute<{
        clinics: number;
        usage: number;
        notices: number;
      }>(sql`
        SELECT
          (SELECT count(*)::int FROM public.clinics WHERE id = ${clinicId}::uuid) AS clinics,
          (SELECT count(*)::int FROM public.usage_counter_ledger WHERE clinic_id = ${clinicId}::uuid) AS usage,
          (SELECT count(*)::int FROM public.outbox WHERE clinic_id = ${clinicId}::uuid) AS notices
      `);
      if (!residue || residue.clinics !== 0 || residue.usage !== 0 || residue.notices !== 0) {
        throw new Error('Cleanup da fixture de IA deixou resíduos.');
      }
      console.log('PASS: cleanup da fixture de IA, resíduos 0.');
    }
    if (authCleanupFailed) throw new Error('Cleanup do usuário Auth da fixture de IA falhou.');
  }
}

void main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Falha desconhecida no metering de IA.');
    process.exit(1);
  });
