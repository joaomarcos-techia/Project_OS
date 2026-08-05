/**
 * Smoke C13 — integração de billing contra o dev DB. Exercita os caminhos de
 * aceitação (§13.5/§13.6) SEM tocar o Asaas real (o gate real é billing:live-check):
 *   - provisionamento (clínica pending_payment + subscription trial);
 *   - PAYMENT_RECEIVED (markInvoicePaid) → invoice paid + clínica reativada;
 *   - dunning D+30 (setClinicAccess blocked) → clínica suspended;
 *   - quota: recordUsage idempotente (mesmo dedup → conta 1×);
 *   - RLS: clínica B não vê subscription da A.
 *
 * Uso: `pnpm smoke:c13`. Cleanup ao fim (CASCADE por clinic_id).
 */
import './_env';

import { eq, sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db';
import { withTenant } from '@/lib/db/tenant';

import { currentPeriod, recordUsage } from '@/contexts/billing/internal/quota';
import { ledgerKeyFor } from '@/contexts/billing/internal/quota-policy';
import { provisionTenant } from '@/contexts/billing/internal/provisioning';
import { markInvoicePaid, setClinicAccess } from '@/contexts/billing/internal/subscriptions';
import { checkoutSessions, invoices, subscriptions } from '@/contexts/billing/schema';

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.error(`  ✗ ${label}`);
  }
}

async function clinicStatus(clinicId: string): Promise<string | null> {
  const r = (await dbAdmin.execute(
    sql`SELECT status::text AS s FROM clinics WHERE id = ${clinicId}::uuid`,
  )) as unknown as Array<{ s: string }>;
  return r[0]?.s ?? null;
}

async function provision(slug: string): Promise<string> {
  const [plan] = (await dbAdmin.execute(
    sql`SELECT id::text AS id FROM plans WHERE code='solo'`,
  )) as unknown as Array<{ id: string }>;
  const [price] = (await dbAdmin.execute(
    sql`SELECT id::text AS id FROM prices WHERE plan_id=${plan!.id}::uuid AND billing_cycle='monthly' AND active_until IS NULL`,
  )) as unknown as Array<{ id: string }>;
  return dbAdmin.transaction(async (tx) => {
    const [sess] = await tx
      .insert(checkoutSessions)
      .values({
        email: `${slug}@qoro.dev`,
        clinicName: `Smoke ${slug}`,
        planId: plan!.id,
        idempotencyKey: `smoke:${slug}`,
        expiresAt: new Date(Date.now() + 3600_000),
      })
      .returning({ id: checkoutSessions.id });
    const { clinicId } = await provisionTenant(tx as never, {
      checkoutSessionId: sess!.id,
      slug,
      clinicName: `Smoke ${slug}`,
      planId: plan!.id,
      planCode: 'solo',
      priceId: price!.id,
      billingCycle: 'monthly',
      customerName: `Smoke ${slug}`,
      email: `${slug}@qoro.dev`,
      trialDays: 14,
    });
    return clinicId;
  });
}

async function main(): Promise<void> {
  const stamp = Date.now();
  const slugA = `smoke-c13-a-${stamp}`;
  const slugB = `smoke-c13-b-${stamp}`;
  const clinicA = await provision(slugA);
  const clinicB = await provision(slugB);
  console.log(`[smoke:c13] provisionadas A=${clinicA} B=${clinicB}`);

  try {
    check(
      'clínica provisionada em pending_payment',
      (await clinicStatus(clinicA)) === 'pending_payment',
    );

    // Invoice open + PAYMENT_RECEIVED.
    const invId = await withTenant(clinicA, async (tx) => {
      const [sub] = await tx
        .select({ id: subscriptions.id })
        .from(subscriptions)
        .where(eq(subscriptions.clinicId, clinicA))
        .limit(1);
      const [inv] = await tx
        .insert(invoices)
        .values({
          clinicId: clinicA,
          subscriptionId: sub!.id,
          totalAmount: '149.00',
          status: 'open',
          dueDate: new Date().toISOString().slice(0, 10),
          asaasPaymentId: `pay_smoke_${stamp}`,
        })
        .returning({ id: invoices.id });
      return inv!.id;
    });

    // Webhook/cron rodam como service_role (clinics.status é write privilegiado).
    await dbAdmin.transaction(async (tx) => {
      const [inv] = await tx.select().from(invoices).where(eq(invoices.id, invId)).limit(1);
      await markInvoicePaid(tx, clinicA, inv!, {
        paymentMethod: 'PIX',
        providerPaymentId: `pay_smoke_${stamp}`,
        idemSuffix: `smoke-paid-${stamp}`,
      });
    });
    const invAfter = (await dbAdmin.execute(
      sql`SELECT status::text AS s FROM invoices WHERE id=${invId}::uuid`,
    )) as unknown as Array<{ s: string }>;
    check('PAYMENT_RECEIVED → invoice paid', invAfter[0]?.s === 'paid');
    check(
      'PAYMENT_RECEIVED → clínica reativada (active)',
      (await clinicStatus(clinicA)) === 'active',
    );

    // Dunning D+30 → blocked.
    await dbAdmin.transaction(async (tx) => {
      await setClinicAccess(tx, clinicA, 'blocked', 'dunning D+30', `smoke-dunning-${stamp}`);
    });
    check(
      'dunning D+30 → clínica suspended (blocked)',
      (await clinicStatus(clinicA)) === 'suspended',
    );

    // Quota idempotente: mesmo dedup conta 1×.
    const key = ledgerKeyFor('agendamento', { appointmentId: `appt-smoke-${stamp}` });
    const period = currentPeriod();
    const first = await withTenant(clinicA, (tx) => recordUsage(tx, clinicA, key, period));
    const second = await withTenant(clinicA, (tx) => recordUsage(tx, clinicA, key, period));
    check('quota: 1ª contagem registra', first === true);
    check('quota: 2ª contagem (mesmo dedup) é no-op', second === false);
    const usage = (await dbAdmin.execute(
      sql`SELECT agendamentos_count AS c FROM usage_metrics WHERE clinic_id=${clinicA}::uuid AND period_yyyymm=${period}`,
    )) as unknown as Array<{ c: number }>;
    check('quota: contador = 1 (idempotente)', Number(usage[0]?.c) === 1);

    // RLS: clínica B não vê subscription da A.
    const crossCount = await withTenant(clinicB, async (tx) => {
      const rows = await tx
        .select({ id: subscriptions.id })
        .from(subscriptions)
        .where(eq(subscriptions.clinicId, clinicA));
      return rows.length;
    });
    check('RLS: clínica B não vê subscription da A', crossCount === 0);
  } finally {
    // tenantId() não declara FK nas tabelas de infraestrutura; limpar antes das
    // clínicas impede que o worker de dev herde eventos órfãos desta fixture.
    for (const clinicId of [clinicA, clinicB]) {
      for (const table of ['outbox', 'idempotency_keys', 'audit_events'] as const) {
        await dbAdmin.execute(sql`DELETE FROM ${sql.raw(table)} WHERE clinic_id = ${clinicId}`);
      }
    }
    await dbAdmin.execute(
      sql`DELETE FROM clinics WHERE id IN (${clinicA}::uuid, ${clinicB}::uuid)`,
    );
    console.log('[smoke:c13] cleanup ok');
  }

  console.log(`\n[smoke:c13] ${pass} passou, ${fail} falhou`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
