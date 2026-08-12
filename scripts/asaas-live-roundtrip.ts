/**
 * Asaas LIVE round-trip (C13 — 13.6.1/13.6.2 completo). Diferente do live-check
 * (só adapter), este PERSISTE localmente: cria customer+subscription no Asaas E
 * provisiona clínica + subscription no banco. Assim, quando você confirmar o
 * pagamento no painel sandbox, o webhook acha a subscription, materializa a
 * invoice e a marca paga (clínica → active).
 *
 * Requer ASAAS_API_KEY (sandbox). Escreve no DATABASE_URL do .env — para o
 * round-trip fechar, o webhook deployado deve apontar para O MESMO banco.
 * Uso: `pnpm billing:live-roundtrip`
 */
import './_env';

import { sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db';
import { redactOpaqueId } from '@/lib/sanitize/redact';

import { asaasProvider } from '@/contexts/billing/internal/providers/asaas';
import { provisionTenant } from '@/contexts/billing/internal/provisioning';
import { checkoutSessions } from '@/contexts/billing/schema';

function tomorrowISO(): string {
  return new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  if (!process.env.ASAAS_API_KEY) {
    console.error('[roundtrip] ASAAS_API_KEY ausente — abortando.');
    process.exit(1);
  }
  const stamp = Date.now();
  const slug = `live-${stamp}`;

  const [plan] = (await dbAdmin.execute(
    sql`SELECT id::text AS id FROM plans WHERE code='solo'`,
  )) as unknown as Array<{ id: string }>;
  const [price] = (await dbAdmin.execute(
    sql`SELECT id::text AS id FROM prices WHERE plan_id=${plan!.id}::uuid AND billing_cycle='monthly' AND active_until IS NULL`,
  )) as unknown as Array<{ id: string }>;

  // Asaas REAL: customer + subscription.
  const customer = await asaasProvider.createCustomer({
    name: `Round-trip ${stamp}`,
    email: `roundtrip+${stamp}@qoro.dev`,
    cpfCnpj: '24971563792',
    phone: '11999990000',
  });
  const sub = await asaasProvider.createSubscription({
    customerId: customer.customerId,
    value: 149,
    cycle: 'MONTHLY',
    nextDueDate: tomorrowISO(),
    description: 'ClinicaOS — Solo (round-trip)',
    billingType: 'BOLETO',
  });

  // Persistência local (clínica pending_payment + subscription trial).
  const clinicId = await dbAdmin.transaction(async (tx) => {
    const [sess] = await tx
      .insert(checkoutSessions)
      .values({
        email: `roundtrip+${stamp}@qoro.dev`,
        clinicName: `Round-trip ${stamp}`,
        planId: plan!.id,
        idempotencyKey: `roundtrip:${stamp}`,
        expiresAt: new Date(Date.now() + 3600_000),
      })
      .returning({ id: checkoutSessions.id });
    const { clinicId } = await provisionTenant(tx as never, {
      checkoutSessionId: sess!.id,
      slug,
      clinicName: `Round-trip ${stamp}`,
      planId: plan!.id,
      planCode: 'solo',
      priceId: price!.id,
      billingCycle: 'monthly',
      customerName: `Round-trip ${stamp}`,
      email: `roundtrip+${stamp}@qoro.dev`,
      asaasCustomerId: customer.customerId,
      asaasSubscriptionId: sub.subscriptionId,
      trialDays: 14,
    });
    return clinicId;
  });

  console.log('\n[roundtrip] criado:');
  console.log('  clinic_id            =', redactOpaqueId(clinicId), '(status: pending_payment)');
  console.log('  asaas_customer_id    =', redactOpaqueId(customer.customerId));
  console.log('  asaas_subscription_id=', redactOpaqueId(sub.subscriptionId));
  console.log('\nAgora, no painel Asaas sandbox:');
  console.log('  1. Abra a cobrança da subscription e "Confirmar recebimento".');
  console.log('  2. O Asaas dispara PAYMENT_CREATED/RECEIVED → /api/webhooks/asaas.');
  console.log('  3. Confirme: invoice vira "paid" e a clínica vira "active".');
  console.log(
    '     (SELECT status FROM clinics WHERE id=...; SELECT status FROM invoices WHERE clinic_id=...)',
  );
  process.exit(0);
}

void main();
