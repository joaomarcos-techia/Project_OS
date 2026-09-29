/**
 * Reabrir a clínica depois de uma reativação de assinatura — pelo único papel
 * que consegue.
 *
 * ===================================================================
 * O defeito (medido em 28/09/2026, banco DEV, transação desfeita)
 * ===================================================================
 * `reactivateSubscription` roda dentro de `withTenant`, como `authenticated`, e
 * chama `setClinicAccess('enabled')`, que faz `UPDATE clinics SET status`. A
 * tabela `clinics` só tem policy de UPDATE para super_admin. Sob RLS, o UPDATE
 * de um tenant não dá erro: ele casa ZERO linhas. Medido: 0 linhas afetadas.
 *
 * Resultado em produção: a reativação religava a cobrança no Asaas (com
 * vencimento no mesmo dia) e deixava `clinics.status = 'cancelled'` — e é esse
 * campo que `requireActiveClinic` lê para bloquear escrita. A clínica pagava e
 * continuava bloqueada. É o mesmo modo de falha que o `session-epoch.ts`
 * documenta para `profiles`: RLS que falha ABERTO por casar zero linhas.
 *
 * ===================================================================
 * Por que o comando é tão estreito
 * ===================================================================
 * `dbAdmin` ignora RLS. Então a condição de segurança mora no SQL:
 *   - só muda uma clínica que está `cancelled`;
 *   - só se a assinatura dela está `active` no billing;
 *   - só se o último evento do histórico da assinatura é a reativação feita
 *     pelo fluxo auditado. Uma clínica cancelada por outro motivo (suspensão
 *     administrativa, por exemplo) não é reaberta por acidente.
 */
import { sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db';

const REABRIR_CONDICAO = sql`
       c.status = 'cancelled'::clinic_status
   AND EXISTS (
         SELECT 1 FROM public.subscriptions s
          WHERE s.clinic_id = c.id
            AND s.billing_status = 'active'
       )
   AND (
         SELECT h.reason
           FROM public.subscription_history h
          WHERE h.clinic_id = c.id
          ORDER BY h.created_at DESC
          LIMIT 1
       ) = 'subscription_reactivated'
`;

/** Reabre UMA clínica logo depois da reativação. `true` = estava fechada e abriu. */
export async function reopenClinicAfterReactivation(clinicId: string): Promise<boolean> {
  const rows = (await dbAdmin.execute(sql`
    UPDATE public.clinics c
       SET status = 'active'::clinic_status, updated_at = now()
     WHERE c.id = ${clinicId}::uuid
       AND ${REABRIR_CONDICAO}
    RETURNING c.id
  `)) as unknown as Array<{ id: string }>;
  return rows.length > 0;
}

/**
 * Backstop diário: toda clínica que ficou fechada depois de uma reativação.
 *
 * Existe porque a reabertura imediata roda DEPOIS do commit da reativação — se
 * ela falhar, a cobrança já está religada e a clínica fechada. O cron corrige
 * em até um dia sem depender de a pessoa tentar de novo.
 */
export async function reopenReactivatedClinics(limit = 50): Promise<number> {
  const rows = (await dbAdmin.execute(sql`
    UPDATE public.clinics c
       SET status = 'active'::clinic_status, updated_at = now()
     WHERE c.id IN (
             SELECT c.id FROM public.clinics c
              WHERE ${REABRIR_CONDICAO}
              LIMIT ${limit}
           )
    RETURNING c.id
  `)) as unknown as Array<{ id: string }>;
  return rows.length;
}
