/**
 * P6.6 — superfície dos avisos de autorização para fora do contexto: a ENTREGA (handler do outbox,
 * na camada do app, que conhece e-mail e Identity) e a leitura para as telas.
 *
 * Nada aqui decide permissão: as telas passam pelo `conveniosAccess` e a action pelo portão.
 */
import 'server-only';

import { sql } from 'drizzle-orm';

import { withTenant } from '@/lib/db/tenant';

import {
  AUTHORIZATION_ALERT_KINDS,
  isConveniosOperableTx,
  listOpenAuthorizationAlertsTx,
  type AuthorizationAlertKind,
  type AuthorizationAlertView,
} from './internal/authorization-alert-service';

export { AUTHORIZATION_ALERT_KINDS, type AuthorizationAlertKind, type AuthorizationAlertView };
export { HEALTH_INSURANCE_EVENTS, type AuthorizationAlertsDeliveryPayload } from './events';
export { OPERATE_CONVENIOS_ROLES } from './rights';

export type AlertCounts = Record<AuthorizationAlertKind, number>;

export interface AlertDeliveryBatch {
  /** Módulo ligado e assinatura paga e ativa: senão, nada é enviado. */
  operable: boolean;
  /** Avisos do lote ainda por entregar (abertos; o que já foi visto na tela não vai por e-mail), por tipo. */
  counts: AlertCounts;
  total: number;
}

const emptyCounts = (): AlertCounts => ({ password_expiring: 0, password_expired: 0, sessions_ending: 0, operator_overdue: 0 });

/** O que ainda há para entregar do lote (aviso encerrado ou já entregue não entra). */
export async function readAlertDeliveryBatch(clinicId: string, batch: string): Promise<AlertDeliveryBatch> {
  return withTenant(clinicId, async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT kind, count(*)::int AS n FROM public.hi_authorization_alerts
       WHERE clinic_id = ${clinicId}::uuid AND delivery_batch = ${batch}
         AND delivered_at IS NULL AND status = 'open'
       GROUP BY kind`)) as unknown as Array<{ kind: AuthorizationAlertKind; n: number }>;
    const counts = emptyCounts();
    for (const r of rows) if (AUTHORIZATION_ALERT_KINDS.includes(r.kind)) counts[r.kind] = Number(r.n);
    const total = Object.values(counts).reduce((s, n) => s + n, 0);
    return { operable: total > 0 ? await isConveniosOperableTx(tx, clinicId) : false, counts, total };
  });
}

/**
 * Registra o resultado da tentativa de entrega do lote: entregue (carimbo que não muda mais) ou a
 * falha (tentativas + só o TIPO do erro). Aviso encerrado no meio do caminho fica como está.
 */
export async function recordAlertDeliveryOutcome(
  clinicId: string,
  batch: string,
  outcome: { delivered: true } | { delivered: false; error: string },
): Promise<number> {
  const error = outcome.delivered ? null : outcome.error.replace(/[^A-Za-z0-9_.-]/gu, '_').slice(0, 64) || 'unknown';
  return withTenant(clinicId, async (tx) => {
    const rows = (await tx.execute(
      outcome.delivered
        ? sql`UPDATE public.hi_authorization_alerts
                 SET delivered_at = now(), delivery_attempts = delivery_attempts + 1, delivery_error = NULL
               WHERE clinic_id = ${clinicId}::uuid AND delivery_batch = ${batch}
                 AND delivered_at IS NULL AND status = 'open'
              RETURNING id`
        : sql`UPDATE public.hi_authorization_alerts
                 SET delivery_attempts = delivery_attempts + 1, delivery_error = ${error}
               WHERE clinic_id = ${clinicId}::uuid AND delivery_batch = ${batch}
                 AND delivered_at IS NULL AND status = 'open'
              RETURNING id`,
    )) as unknown as unknown[];
    return rows.length;
  });
}

/** Avisos abertos para as telas de Convênios (quem opera). */
export async function listOpenAuthorizationAlerts(clinicId: string, limit = 50): Promise<AuthorizationAlertView[]> {
  return withTenant(clinicId, (tx) => listOpenAuthorizationAlertsTx(tx, clinicId, limit));
}
