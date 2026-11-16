/**
 * Candidatos do reconcile "convênio sem guia" (P7.4) — read-model PRIVILEGIADO do
 * convênio, irmão do `financial/dunning-candidates.ts`.
 *
 * O convênio é dono da regra de "atendimento que ainda não entrou no faturamento".
 * Scan cross-tenant via dbAdmin, só leitura, só ids e o estado do evento de
 * conclusão (sem dado pessoal), limitado por LIMIT. O processamento de cada um
 * roda depois em `withTenant`, sob RLS.
 *
 * Entra:
 *  A. convênio concluído há mais de 15 min (janela do worker), em clínica com o
 *     módulo ligado, sem guia viva fora da edição com pendências, e cuja pendência
 *     não existe, está aberta e vencida para nova tentativa, ou foi resolvida por
 *     uma guia que depois deixou de valer (cancelada);
 *  B. pendência aberta que já pode fechar (atendimento deixou de estar concluído
 *     ou alguém aprontou a guia por outro caminho).
 * Fica de fora: particular, decisão humana (`dismissed`), retorno não faturável e
 * pendência humana sem próxima tentativa (aguarda a pessoa).
 */
import 'server-only';

import { sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db';

import type { HiBillingGapEventState } from './schema-clinic';

export interface BillingGapCandidate {
  clinicId: string;
  appointmentId: string;
  eventState: HiBillingGapEventState;
}

const EVENT_TYPE = 'scheduling.appointment.insurance_completed';
const GRACE = "interval '15 minutes'";

export async function listBillingGapCandidates(limit = 50): Promise<BillingGapCandidate[]> {
  const rows = await dbAdmin.transaction(async (tx) => {
    // Mesmo cuidado do financial-reconcile: o pooler pode entregar a conexão no
    // papel `authenticator`; o scan cross-tenant restaura o principal só aqui.
    await tx.execute(sql`RESET ROLE`);
    return tx.execute<{ clinic_id: string; appointment_id: string; event_status: string | null }>(
      sql`WITH ready AS (
            SELECT DISTINCT i.clinic_id, i.appointment_id
              FROM hi_guide_items i
              JOIN hi_guides g ON g.clinic_id = i.clinic_id AND g.id = i.guide_id
             WHERE i.appointment_id IS NOT NULL
               AND g.live AND g.status NOT IN ('pending_data', 'cancelled', 'replaced')
          )
          SELECT a.clinic_id::text AS clinic_id, a.id::text AS appointment_id,
                 ev.status::text AS event_status
            FROM hi_clinic_settings s
            JOIN appointments a ON a.clinic_id = s.clinic_id
            LEFT JOIN hi_billing_gaps gap ON gap.clinic_id = a.clinic_id AND gap.appointment_id = a.id
            LEFT JOIN ready r ON r.clinic_id = a.clinic_id AND r.appointment_id = a.id
            LEFT JOIN LATERAL (
              SELECT o.status FROM outbox o
               WHERE o.clinic_id = a.clinic_id AND o.event_type = ${EVENT_TYPE}
                 AND o.payload->>'appointmentId' = a.id::text
               ORDER BY o.created_at DESC LIMIT 1
            ) ev ON true
           WHERE s.enabled
             AND a.billing_mode = 'convenio'
             AND (
               (a.status = 'atendido'
                AND a.updated_at < now() - ${sql.raw(GRACE)}
                AND r.appointment_id IS NULL
                AND (gap.id IS NULL
                     OR (gap.status = 'open' AND gap.next_attempt_at IS NOT NULL AND gap.next_attempt_at <= now())
                     OR (gap.status = 'resolved' AND gap.resolution = 'guide_ready')))
               OR (gap.status = 'open' AND (a.status <> 'atendido' OR r.appointment_id IS NOT NULL))
             )
           ORDER BY a.updated_at ASC
           LIMIT ${limit}`,
    );
  });
  return rows.map((r) => ({
    clinicId: r.clinic_id,
    appointmentId: r.appointment_id,
    eventState: toEventState(r.event_status),
  }));
}

function toEventState(status: string | null): HiBillingGapEventState {
  switch (status) {
    case null:
      return 'missing';
    case 'pending':
    case 'processing':
    case 'failed':
    case 'processed':
      return status;
    default:
      return 'not_checked';
  }
}

export interface CopaySyncCandidate {
  clinicId: string;
  copaymentId: string;
}

/**
 * Coparticipações cuja situação ficou atrás do dinheiro (P10.5): cobrança criada e a
 * coparticipação ainda "confirmada"; recebível pago e ela ainda "cobrada"; estorno
 * integral registrado e ela ainda "paga". O webhook do paciente sincroniza logo depois
 * da baixa; esta varredura é a garantia quando aquele passo falha ou demora (mesmo
 * cuidado do scan acima: cross-tenant, só leitura, só ids, sem dado pessoal, com LIMIT).
 * Cada candidato é sincronizado depois em `withTenant`, sob RLS, pela função do banco.
 */
export async function listCopaySyncCandidates(limit = 50): Promise<CopaySyncCandidate[]> {
  const rows = await dbAdmin.transaction(async (tx) => {
    await tx.execute(sql`RESET ROLE`);
    return tx.execute<{ clinic_id: string; copayment_id: string }>(
      sql`SELECT c.clinic_id::text AS clinic_id, c.id::text AS copayment_id
            FROM hi_copayments c
            LEFT JOIN lancamentos l
              ON l.clinic_id = c.clinic_id AND l.appointment_id = c.appointment_id AND l.tipo = 'receber'
            LEFT JOIN LATERAL (
              SELECT coalesce(sum(t.amount) FILTER (WHERE t.kind = 'payment'), 0) AS paid,
                     coalesce(sum(t.amount) FILTER (WHERE t.kind = 'refund'), 0) AS refunded
                FROM payment_transactions t
               WHERE t.clinic_id = c.clinic_id AND t.lancamento_id = l.id
            ) m ON true
           WHERE (c.status = 'confirmed' AND EXISTS (
                    SELECT 1 FROM patient_charges pc
                     WHERE pc.clinic_id = c.clinic_id AND pc.appointment_id = c.appointment_id
                       AND pc.kind = 'remainder' AND pc.status::text IN ('pending', 'paid', 'refunded')))
              OR (c.status = 'charged' AND l.status = 'pago')
              OR (c.status = 'paid' AND m.refunded > 0 AND m.refunded >= m.paid)
           ORDER BY c.updated_at ASC
           LIMIT ${limit}`,
    );
  });
  return rows.map((r) => ({ clinicId: r.clinic_id, copaymentId: r.copayment_id }));
}

/** P6.6/P12.6: até quantas clínicas a manutenção de Convênios percorre por execução. */
export const INSURANCE_MAINTENANCE_LIMIT = 200;

/**
 * Clínicas com Convênios instalado (linha em hi_clinic_settings), para a manutenção do fim do
 * financial-reconcile. Mesma forma das leituras acima: cross-tenant, só identificadores, LIMIT; o
 * trabalho de cada clínica volta para withTenant (maintenance.ts).
 */
export async function listInsuranceMaintenanceClinics(limit = INSURANCE_MAINTENANCE_LIMIT): Promise<string[]> {
  const rows = await dbAdmin.transaction(async (tx) => {
    await tx.execute(sql`RESET ROLE`);
    return tx.execute<{ clinic_id: string }>(
      sql`SELECT clinic_id::text AS clinic_id FROM hi_clinic_settings ORDER BY clinic_id LIMIT ${limit}`,
    );
  });
  return (rows as unknown as Array<{ clinic_id: string }>).map((r) => r.clinic_id);
}
