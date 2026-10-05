/**
 * GET /api/cron/financial-reconcile — COMPONENTE CRÍTICO (C9 / R4).
 *
 * Garante "vazamento financeiro zero": nenhum atendimento concluído fica sem
 * lançamento. Protege contra evento perdido, worker morto, timeout permanente do
 * handler e bug de deploy. NÃO é uma rede de segurança opcional — é a malha que
 * fecha o invariante "todo atendimento realizado é rastreável financeiramente".
 *
 * Scan cross-tenant (dbAdmin) por appointments `atendido` com janela de carência
 * (>15 min), `faturamento_pendente=false` e SEM lançamento. Por clínica
 * (withTenant): abre/atualiza `faturamento_pendencias` (banner do Caixa) e publica
 * `financial.faturamento.pendente` → o handler do Scheduling marca a flag (R3:
 * ownership de appointments fica no Scheduling).
 *
 * Auth idêntica a /api/cron/outbox (Bearer CRON_SECRET + header Vercel não-fatal).
 * Agendado VERSIONADO em vercel.json a cada 15 minutos (F-03 da auditoria
 * 2026-06-10 — antes rodava 1×/dia, violando a janela ≈15min do contrato R4).
 */
import { sql } from 'drizzle-orm';

import { FINANCIAL_EVENTS, faturamentoPendencias } from '@/contexts/financial';
import { recordHeartbeat } from '@/lib/cron-heartbeat';
import { dbAdmin } from '@/lib/db';
import { withTenant } from '@/lib/db/tenant';
import { withCron } from '@/lib/http/cron';
import { metrics } from '@/lib/observability/metrics';
import { publishEvent } from '@/lib/outbox/publish';

import { ORPHAN_CREDIT_AGE_DAYS, scanOrphanCredits } from './orphan-credit-scan';
import {
  reconcileQuarantinedPatientPayments,
  reconcilePendingPaymentEconomics,
  scanQuarantinedPatientPayments,
  scanPendingPaymentEconomics,
} from './payment-economics-reconcile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;
// Cada leitura externa tem teto de 4 s. Três leituras cabem no orçamento do cron.
const PAYMENT_ECONOMICS_LIMIT = 2;
const PAYMENT_ANOMALY_LIMIT = 1;
const PAYMENT_BACKSTOP_START_DEADLINE_MS = 30_000;
const GRACE = "interval '15 minutes'";
const MOTIVO = 'Atendimento concluído sem lançamento — verificar faturamento.';
const TERMINAL_APPOINTMENT_STATUSES = new Set(['atendido', 'cancelado', 'faltou']);

export const GET = withCron(
  {
    job: 'financial-reconcile',
    route: 'financial-reconcile',
    errorEvent: 'financial.reconcile.error',
  },
  async (req) => {
    const startedAt = Date.now();
    const url = new URL(req.url);
    const limit = Math.min(
      Math.max(Number(url.searchParams.get('limit')) || DEFAULT_LIMIT, 1),
      MAX_LIMIT,
    );

    // Atendimentos atendidos, fora da janela de carência, sem lançamento e ainda
    // não sinalizados como pendentes.
    const scan = await dbAdmin.transaction(async (tx) => {
      // O Transaction Pooler pode entregar a conexão administrativa ainda no
      // papel `authenticator`. Este scan é o bypass cross-tenant explicitamente
      // autorizado nesta rota; restaura o principal da conexão apenas dentro
      // desta transação curta, antes das duas leituras administrativas.
      await tx.execute(sql`RESET ROLE`);
      const receivables =
        await tx.execute(sql`SELECT a.id::text AS id, a.clinic_id::text AS clinic_id, a.valor::text AS valor
                                                FROM appointments a
                                               WHERE a.status = 'atendido'
                                                 AND a.faturamento_pendente = false
                                                 AND a.updated_at < now() - ${sql.raw(GRACE)}
                                                 AND NOT EXISTS (SELECT 1 FROM lancamentos l WHERE l.appointment_id = a.id)
                                               ORDER BY a.updated_at ASC
                                               LIMIT ${limit}`);
      const orphanCredits = await scanOrphanCredits(tx);
      return { receivables, orphanCredits };
    });
    const rows = scan.receivables as unknown as Array<{
      id: string;
      clinic_id: string;
      valor: string;
    }>;

    const orphanClinicIds = new Set(scan.orphanCredits.map((group) => group.clinicId));
    let orphanCredits = 0;
    let terminalCredits = 0;
    let staleActiveCredits = 0;
    let missingAppointmentCredits = 0;
    for (const group of scan.orphanCredits) {
      orphanCredits += group.count;
      if (group.appointmentStatus === 'missing') {
        missingAppointmentCredits += group.count;
      } else if (TERMINAL_APPOINTMENT_STATUSES.has(group.appointmentStatus)) {
        terminalCredits += group.count;
      } else {
        staleActiveCredits += group.count;
      }
    }

    if (orphanCredits > 0) {
      metrics.emit('financial.reconcile.orphan_credit_detected', {
        credits: orphanCredits,
        clinics: orphanClinicIds.size,
        terminal: terminalCredits,
        staleActive: staleActiveCredits,
        missingAppointment: missingAppointmentCredits,
        ageDays: ORPHAN_CREDIT_AGE_DAYS,
      });
    }

    const byClinic = new Map<string, Array<{ id: string; valor: string }>>();
    for (const r of rows) {
      const arr = byClinic.get(r.clinic_id) ?? [];
      arr.push({ id: r.id, valor: r.valor });
      byClinic.set(r.clinic_id, arr);
    }

    let opened = 0;
    for (const [clinicId, appts] of byClinic) {
      await withTenant(clinicId, async (tx) => {
        for (const appt of appts) {
          await tx
            .insert(faturamentoPendencias)
            .values({
              clinicId,
              appointmentId: appt.id,
              motivo: MOTIVO,
              valor: appt.valor,
              status: 'aberta',
            })
            .onConflictDoUpdate({
              target: faturamentoPendencias.appointmentId,
              set: { motivo: MOTIVO, status: 'aberta', resolvedAt: null, resolvedBy: null },
            });
          // F-13: a chave inclui o dia (UTC) do run. Com a chave fixa
          // `reconcile:<id>`, um evento que falhasse 5× e virasse `failed`
          // terminal nunca era republicável — o dedup UNIQUE(event_type, key)
          // engolia para sempre e a flag faturamento_pendente nunca era setada.
          // Por período: enquanto o appointment continuar elegível no scan
          // (flag=false e sem lançamento), cada dia re-arma um evento novo;
          // o handler é idempotente (UPDATE da flag) e a pendência é UPSERT.
          const period = new Date().toISOString().slice(0, 10);
          await publishEvent(tx, {
            clinicId,
            eventType: FINANCIAL_EVENTS.FATURAMENTO_PENDENTE,
            payload: {
              appointmentId: appt.id,
              clinicId,
              motivo: MOTIVO,
              valor: Number(appt.valor),
            },
            idempotencyKey: `reconcile:${appt.id}:${period}`,
          });
          opened++;
        }
      });
    }

    if (opened > 0) {
      metrics.emit('financial.reconcile.pendencia_opened', { opened, clinics: byClinic.size });
    }
    // A recuperação de recebíveis é a obrigação primária deste cron. O Asaas
    // pode ficar lento; só depois dela fazemos um lote pequeno do backstop.
    const paymentBackstopSkippedForBudget =
      Date.now() - startedAt >= PAYMENT_BACKSTOP_START_DEADLINE_MS;
    if (paymentBackstopSkippedForBudget) {
      metrics.emit('financial.reconcile.payment_backstop_skipped_budget', {});
    }
    const paymentScan = !paymentBackstopSkippedForBudget
      ? await dbAdmin.transaction(async (tx) => {
          await tx.execute(sql`RESET ROLE`);
          const pendingPaymentEconomics = await scanPendingPaymentEconomics(
            tx,
            Math.min(limit, PAYMENT_ECONOMICS_LIMIT),
          );
          const quarantinedPayments = await scanQuarantinedPatientPayments(
            tx,
            Math.min(limit, PAYMENT_ANOMALY_LIMIT),
          );
          return { pendingPaymentEconomics, quarantinedPayments };
        })
      : { pendingPaymentEconomics: [], quarantinedPayments: [] };
    const paymentEconomics = await reconcilePendingPaymentEconomics(
      paymentScan.pendingPaymentEconomics,
      new Date(),
    );
    const paymentAnomalies = await reconcileQuarantinedPatientPayments(
      paymentScan.quarantinedPayments,
      new Date(),
    );
    if (paymentAnomalies.mismatched > 0) {
      metrics.emit('financial.reconcile.payment_anomaly_persisted', {
        count: paymentAnomalies.mismatched,
      });
    }
    if (paymentEconomics.mismatched > 0) {
      metrics.emit('financial.reconcile.payment_amount_mismatch', {
        count: paymentEconomics.mismatched,
      });
    }
    const runFields = {
      opened,
      clinics: byClinic.size,
      orphanCredits,
      orphanClinics: orphanClinicIds.size,
      paymentEconomicsCandidates: paymentEconomics.candidates,
      paymentEconomicsReconciled: paymentEconomics.reconciled,
      paymentEconomicsPending: paymentEconomics.pending,
      paymentEconomicsSkipped: paymentEconomics.skipped,
      paymentEconomicsMismatched: paymentEconomics.mismatched,
      paymentEconomicsFailed: paymentEconomics.failed,
      paymentAnomalyCandidates: paymentScan.quarantinedPayments.length,
      paymentAnomalyRecovered: paymentAnomalies.recovered,
      paymentAnomalyMismatched: paymentAnomalies.mismatched,
      paymentAnomalySkipped: paymentAnomalies.skipped,
      paymentAnomalyFailed: paymentAnomalies.failed,
      paymentBackstopSkippedForBudget,
    };
    metrics.emit('financial.reconcile.run', runFields);
    await recordHeartbeat('financial-reconcile', 'success', runFields);
    return Response.json(
      {
        ok: true,
        opened,
        clinics: byClinic.size,
        paymentEconomicsReconciled: paymentEconomics.reconciled,
      },
      { status: 200 },
    );
  },
);
