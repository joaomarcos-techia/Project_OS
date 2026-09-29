/**
 * GET /api/cron/billing-dunning (C13). Diário. Avança o dunning das clínicas
 * inadimplentes de forma IDEMPOTENTE (só age quando o estágio calculado >
 * subscription.dunning_stage). D+15 → access readonly; D+30 → blocked; D+3/D+7 →
 * emite billing.clinic.dunning_advanced (transporte WhatsApp/email é da C14).
 *
 * Asaas atualiza billing; ClinicaOS decide acesso (ADR-016/025). Auth idêntica
 * aos outros crons (Bearer CRON_SECRET + header Vercel não-fatal).
 */
import { eq, sql } from 'drizzle-orm';

import { recordHeartbeat } from '@/lib/cron-heartbeat';
import { dbAdmin } from '@/lib/db';
import { withCron } from '@/lib/http/cron';
import { metrics } from '@/lib/observability/metrics';
import { publishEvent } from '@/lib/outbox/publish';

import { BILLING_EVENTS } from '@/contexts/billing/events';
import { evaluateDunning } from '@/contexts/billing/internal/dunning';
import { setClinicAccess } from '@/contexts/billing/internal/subscriptions';
import { subscriptions } from '@/contexts/billing/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const GET = withCron(
  {
    job: 'billing-dunning',
    route: 'billing-dunning',
    errorEvent: 'billing.dunning.error',
    destructive: true,
  },
  async () => {
    const now = new Date();

    // Invoice overdue mais antiga por clínica + estágio atual da subscription.
    const rows = (await dbAdmin.execute(
      sql`SELECT i.clinic_id::text AS clinic_id,
                 min(i.due_date)::text AS due_date,
                 s.id::text AS sub_id,
                 s.dunning_stage AS dunning_stage,
                 s.grace_period_until AS grace
            FROM invoices i
            JOIN subscriptions s ON s.clinic_id = i.clinic_id
           WHERE i.status = 'overdue'
             -- Assinatura cancelada não é inadimplente: não se persegue quem
             -- saiu. Antes deste filtro, uma parcela que sobrava no Asaas após o
             -- cancelamento vencia e levava a clínica cancelada pela régua.
             AND s.billing_status <> 'cancelled'
           GROUP BY i.clinic_id, s.id, s.dunning_stage, s.grace_period_until`,
    )) as unknown as Array<{
      clinic_id: string;
      due_date: string;
      sub_id: string;
      dunning_stage: number;
      grace: string | null;
    }>;

    let advanced = 0;
    for (const r of rows) {
      const due = new Date(`${r.due_date}T00:00:00Z`);
      const grace = r.grace ? new Date(r.grace) : null;
      const res = evaluateDunning(due, now, grace);
      if (res.stage <= r.dunning_stage) continue; // idempotente

      // dbAdmin (service_role): a transição de acesso escreve clinics.status, que
      // é write privilegiado (D31). withTenant (authenticated) seria bloqueado.
      await dbAdmin.transaction(async (tx) => {
        await tx
          .update(subscriptions)
          .set({ dunningStage: res.stage })
          .where(eq(subscriptions.id, r.sub_id));

        if (res.access !== 'enabled') {
          await setClinicAccess(
            tx,
            r.clinic_id,
            res.access,
            `dunning D+${res.stage}`,
            `dunning:${r.clinic_id}:${res.stage}`,
          );
        }
        if (res.channel) {
          await publishEvent(tx, {
            clinicId: r.clinic_id,
            eventType: BILLING_EVENTS.CLINIC_DUNNING_ADVANCED,
            payload: {
              clinicId: r.clinic_id,
              subscriptionId: r.sub_id,
              stage: res.stage,
              channel: res.channel === 'asaas' ? 'whatsapp' : res.channel, // D+1 nativo Asaas; demais p/ C14
            },
            idempotencyKey: `dunning-advanced:${r.clinic_id}:${res.stage}`,
          });
        }
      });
      advanced++;
    }

    metrics.emit('billing.dunning.run', { scanned: rows.length, advanced });
    await recordHeartbeat('billing-dunning', 'success', { scanned: rows.length, advanced });
    return Response.json({ ok: true, scanned: rows.length, advanced }, { status: 200 });
  },
);
