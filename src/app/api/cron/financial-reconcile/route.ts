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
 * Rodar FREQUENTE via agendador externo (≈15 min), junto do outbox.
 */
import { sql } from 'drizzle-orm';

import { FINANCIAL_EVENTS, faturamentoPendencias } from '@/contexts/financial';
import { dbAdmin } from '@/lib/db';
import { withTenant } from '@/lib/db/tenant';
import { assertCronRuntimeReady, env } from '@/lib/env';
import { metrics } from '@/lib/observability/metrics';
import { publishEvent } from '@/lib/outbox/publish';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;
const GRACE = "interval '15 minutes'";
const MOTIVO = 'Atendimento concluído sem lançamento — verificar faturamento.';

function isAuthorized(req: Request): boolean {
  if (req.headers.get('authorization') !== `Bearer ${env.CRON_SECRET}`) return false;
  const hasOriginHeader =
    req.headers.get('x-vercel-cron') !== null ||
    req.headers.get('x-vercel-cron-schedule') !== null;
  const allowNonVercel =
    process.env.OUTBOX_CRON_ALLOW_NON_VERCEL === 'true' || env.NODE_ENV !== 'production';
  if (!hasOriginHeader && !allowNonVercel) {
    metrics.emit('cron.origin_header_missing', { route: 'financial-reconcile' });
  }
  return true;
}

export async function GET(req: Request): Promise<Response> {
  assertCronRuntimeReady();
  if (!isAuthorized(req)) {
    metrics.emit('cron.unauthorized', { route: 'financial-reconcile' });
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

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
          await publishEvent(tx, {
            clinicId,
            eventType: FINANCIAL_EVENTS.FATURAMENTO_PENDENTE,
            payload: { appointmentId: appt.id, clinicId, motivo: MOTIVO, valor: Number(appt.valor) },
            idempotencyKey: `reconcile:${appt.id}`,
          });
          opened++;
        }
      });
    }

    metrics.emit('financial.reconcile.pendencia_opened', { opened, clinics: byClinic.size });
    metrics.emit('financial.reconcile.run', { opened, clinics: byClinic.size });
    return Response.json({ ok: true, opened, clinics: byClinic.size }, { status: 200 });
  } catch (err) {
    metrics.emit('financial.reconcile.error', { error: err });
    return Response.json({ ok: false, error: 'internal' }, { status: 500 });
  }
}
