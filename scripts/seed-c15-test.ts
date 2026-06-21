/**
 * `pnpm seed:c15`
 *
 * Popula DADOS DE DEMONSTRAÇÃO para o Platform Admin (C15) terem conteúdo:
 *   - clínica 'clinica-demo' (active)
 *   - plano 'demo' + preço mensal vigente
 *   - assinatura active
 *   - faturas: 1 paga ESTE MÊS (alimenta o MRR), 1 aberta, 1 vencida
 *   - 1 conversa de IA com 2 mensagens CIFRADAS (per-tenant) → testa decrypt
 *   - alguns audit_events (última atividade / tela de auditoria / export)
 *
 * Idempotente: limpa os dados de billing/IA da clínica demo antes de reinserir.
 * SÓ dev (assertDevContext). Requer CRYPTO_MASTER_KEY_V1 + CRYPTO_LOOKUP_SALT no
 * .env.local (para cifrar as mensagens).
 */
import { assertDevContext } from './_env';

import { sql } from 'drizzle-orm';

import { encryptForTenant, hashForLookup } from '@/lib/crypto';
import { dbAdmin } from '@/lib/db';

const { databaseUrl } = assertDevContext();
console.log(`[seed-c15] target: ${redact(databaseUrl)}`);

const SLUG = 'clinica-demo';
const NOME = 'Clínica Demo (C15)';

// 1. Clínica (upsert por slug).
const clinicRows = (await dbAdmin.execute(sql`
  INSERT INTO public.clinics (slug, nome, status, cnpj, timezone)
  VALUES (${SLUG}, ${NOME}, 'active', '12.345.678/0001-90', 'America/Sao_Paulo')
  ON CONFLICT (slug) DO UPDATE SET nome = EXCLUDED.nome, status = 'active', updated_at = now()
  RETURNING id::text AS id
`)) as unknown as Array<{ id: string }>;
const clinicId = clinicRows[0]!.id;
console.log(`[seed-c15] clínica: ${NOME} (${SLUG}) → ${clinicId}`);

// 2. Plano 'demo' + preço mensal vigente.
const planRows = (await dbAdmin.execute(sql`
  INSERT INTO public.plans (code, name, ativo)
  VALUES ('demo', 'Demo', true)
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, ativo = true, updated_at = now()
  RETURNING id::text AS id
`)) as unknown as Array<{ id: string }>;
const planId = planRows[0]!.id;

const existingPrice = (await dbAdmin.execute(sql`
  SELECT id::text AS id FROM public.prices
  WHERE plan_id = ${planId}::uuid AND billing_cycle = 'monthly' AND active_until IS NULL
  LIMIT 1
`)) as unknown as Array<{ id: string }>;
let priceId: string;
if (existingPrice[0]) {
  priceId = existingPrice[0].id;
} else {
  const priceRows = (await dbAdmin.execute(sql`
    INSERT INTO public.prices (plan_id, amount, currency, billing_cycle)
    VALUES (${planId}::uuid, '299.00', 'BRL', 'monthly')
    RETURNING id::text AS id
  `)) as unknown as Array<{ id: string }>;
  priceId = priceRows[0]!.id;
}
console.log(`[seed-c15] plano demo → ${planId} · preço mensal → ${priceId}`);

// 3. Limpa billing/IA anteriores da clínica demo (idempotência).
await dbAdmin.execute(sql`DELETE FROM public.invoices WHERE clinic_id = ${clinicId}::uuid`);
await dbAdmin.execute(sql`DELETE FROM public.subscriptions WHERE clinic_id = ${clinicId}::uuid`);
await dbAdmin.execute(sql`DELETE FROM public.ai_messages WHERE clinic_id = ${clinicId}::uuid`);
await dbAdmin.execute(sql`DELETE FROM public.ai_conversations WHERE clinic_id = ${clinicId}::uuid`);

// 4. Assinatura active.
const subRows = (await dbAdmin.execute(sql`
  INSERT INTO public.subscriptions
    (clinic_id, plan_id, price_id, billing_status, started_at, current_period_start, current_period_end)
  VALUES
    (${clinicId}::uuid, ${planId}::uuid, ${priceId}::uuid, 'active', now(),
     date_trunc('month', now()), date_trunc('month', now()) + interval '1 month')
  RETURNING id::text AS id
`)) as unknown as Array<{ id: string }>;
const subId = subRows[0]!.id;

// 5. Faturas: paga (este mês → MRR), aberta, vencida.
await dbAdmin.execute(sql`
  INSERT INTO public.invoices (clinic_id, subscription_id, total_amount, status, due_date, paid_at, period_start, period_end)
  VALUES
    (${clinicId}::uuid, ${subId}::uuid, '299.00', 'paid',    current_date,       now(),  date_trunc('month', now())::date, (date_trunc('month', now()) + interval '1 month')::date),
    (${clinicId}::uuid, ${subId}::uuid, '299.00', 'open',    current_date + 5,   NULL,   date_trunc('month', now())::date, (date_trunc('month', now()) + interval '1 month')::date),
    (${clinicId}::uuid, ${subId}::uuid, '299.00', 'overdue', current_date - 5,   NULL,   (date_trunc('month', now()) - interval '1 month')::date, date_trunc('month', now())::date)
`);
console.log('[seed-c15] assinatura + 3 faturas (paid/open/overdue) criadas.');

// 6. Conversa de IA + 2 mensagens CIFRADAS (testa decrypt server-side).
const phone = '+5511999990000';
const phoneHash = await hashForLookup(phone);
const phoneEnc = await encryptForTenant(clinicId, phone);
const convRows = (await dbAdmin.execute(sql`
  INSERT INTO public.ai_conversations
    (clinic_id, patient_phone_hash, patient_phone_encrypted, status, intent_atual, last_message_at)
  VALUES (${clinicId}::uuid, ${phoneHash}, ${phoneEnc}, 'active', 'agendamento', now())
  RETURNING id::text AS id
`)) as unknown as Array<{ id: string }>;
const convId = convRows[0]!.id;

const msgIn = await encryptForTenant(clinicId, 'Olá, gostaria de agendar uma consulta para semana que vem.');
const msgOut = await encryptForTenant(
  clinicId,
  'Claro! Temos horários na terça às 14h e na quinta às 10h. Qual prefere?',
);
await dbAdmin.execute(sql`
  INSERT INTO public.ai_messages
    (clinic_id, conversation_id, direction, content_encrypted, tokens_input, tokens_output, cost_usd, model)
  VALUES
    (${clinicId}::uuid, ${convId}::uuid, 'in',  ${msgIn},  18, 0,  '0.000000', NULL),
    (${clinicId}::uuid, ${convId}::uuid, 'out', ${msgOut}, 0,  42, '0.000189', 'gemini-2.5-flash')
`);
console.log('[seed-c15] conversa de IA + 2 mensagens cifradas criadas.');

// 7. audit_events (última atividade / tela de auditoria / export).
await dbAdmin.execute(sql`
  INSERT INTO public.audit_events (clinic_id, user_id, action, resource_type, resource_id, request_id, created_at)
  VALUES
    (${clinicId}::uuid, NULL, 'clinic.viewed',  'clinic',  ${clinicId}, gen_random_uuid()::text, now() - interval '2 hours'),
    (${clinicId}::uuid, NULL, 'patient.created','patient', gen_random_uuid()::text, gen_random_uuid()::text, now() - interval '1 hour'),
    (${clinicId}::uuid, NULL, 'invoice.paid',   'invoice', ${subId}, gen_random_uuid()::text, now())
`);
console.log('[seed-c15] 3 audit_events criados.');

console.log(`
[seed-c15] ✅ done. clinic_id=${clinicId}

PRÓXIMOS PASSOS:
  1. pnpm seed:admin-bucket   (bucket de export)
  2. pnpm seed:super-admin    (com SUPER_ADMIN_EMAIL/PASSWORD no env)
  3. pnpm dev → login super_admin + MFA → /admin
     - Dashboard: MRR deve mostrar R$ 299,00 (1 assinatura ativa @ R$299/mês — MRR
       é receita recorrente normalizada, não soma de faturas pagas).
     - /admin/clinicas → '${NOME}' → Impersonar / Exportar auditoria.
     - /admin/conversas-ia → ver a conversa (texto descriptografado).
`);

function redact(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return '[unparseable-url]';
  }
}

process.exit(0);
