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
import { assertCronRuntimeReady } from '@/lib/env';
import { assertCronAuth } from '@/lib/http/cron-auth';
import { metrics } from '@/lib/observability/metrics';
import { publishEvent } from '@/lib/outbox/publish';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;
const GRACE = "interval '15 minutes'";
const MOTIVO = 'Atendimento concluído sem lançamento — verificar faturamento.';

export async function GET(req: Request): Promise<Response> {
  assertCronRuntimeReady();
  const denied = assertCronAuth(req, { route: 'financial-reconcile' });
  if (denied) return denied;

  const url = new URL(req.url);
  const limit = Math.min(
    Math.max(Number(url.searchParams.get('limit')) || DEFAULT_LIMIT, 1),
    MAX_LIMIT,
  );

  try {
    // Atendimentos atendidos, fora da janela de carência, sem lançamento e ainda
    // não sinalizados como pendentes.
    const rows = (await dbAdmin.execute(
      sql`SELECT a.id::text AS id, a.clinic_id::text AS clinic_id, a.valor::text AS valor
            FROM appointments a
           WHERE a.status = 'atendido'
             AND a.faturamento_pendente = false
             AND a.updated_at < now() - ${sql.raw(GRACE)}
             AND NOT EXISTS (SELECT 1 FROM lancamentos l WHERE l.appointment_id = a.id)
           ORDER BY a.updated_at ASC
           LIMIT ${limit}`,
    )) as unknown as Array<{ id: string; clinic_id: string; valor: string }>;

    if (rows.length === 0) {
      metrics.emit('financial.reconcile.run', { opened: 0, clinics: 0 });
      await recordHeartbeat('financial-reconcile', 'success', { opened: 0, clinics: 0 });
      return Response.json({ ok: true, opened: 0, clinics: 0 }, { status: 200 });
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
            payload: { appointmentId: appt.id, clinicId, motivo: MOTIVO, valor: Number(appt.valor) },
            idempotencyKey: `reconcile:${appt.id}:${period}`,
          });
          opened++;
        }
      });
    }

    metrics.emit('financial.reconcile.pendencia_opened', { opened, clinics: byClinic.size });
    metrics.emit('financial.reconcile.run', { opened, clinics: byClinic.size });
    await recordHeartbeat('financial-reconcile', 'success', { opened, clinics: byClinic.size });
    return Response.json({ ok: true, opened, clinics: byClinic.size }, { status: 200 });
  } catch (err) {
    metrics.emit('financial.reconcile.error', { error: err });
    return Response.json({ ok: false, error: 'internal' }, { status: 500 });
  }
}
