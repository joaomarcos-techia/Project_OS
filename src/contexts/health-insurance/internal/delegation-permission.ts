/**
 * R45 — a pessoa que pediu a exportação em segundo plano ainda tem a permissão?
 *
 * Mesma decisão do `requireFreshPermission` (papel + exceções individuais, com o filtro
 * de plano da view `effective_permissions_v`), mas para quem NÃO está na sessão: o worker
 * age em nome dela. A view lê `role_permissions`, que o papel `authenticated` não
 * enxerga; por isso esta leitura usa a conexão administrativa, com escopo FIXO: um
 * usuário, uma clínica, uma permissão do catálogo, resposta booleana. Nada é escrito e
 * nenhum dado sai além do sim/não.
 *
 * Um dos dois pontos do contexto de convênios com `dbAdmin` (o outro é a varredura do
 * cron em `billing-gap-candidates.ts`), ambos na allowlist do ESLint e do arch-db-check.
 * Auditoria completa: docs/convenios/auditoria-leituras-privilegiadas.md (P6).
 */
import 'server-only';

import { sql } from 'drizzle-orm';

import type { Permission } from '@/lib/auth/permissions';
import { dbAdmin } from '@/lib/db';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export async function requesterStillHasPermission(clinicId: string, userId: string, permission: Permission): Promise<boolean> {
  if (!UUID.test(clinicId) || !UUID.test(userId)) return false;
  const [row] = (await dbAdmin.execute(
    sql`SELECT EXISTS (
          SELECT 1 FROM public.effective_permissions_v e
           WHERE e.user_id = ${userId}::uuid AND e.clinic_id = ${clinicId}::uuid
             AND e.ativo AND e.deleted_at IS NULL
             AND ${permission} = ANY (e.permissions)
        ) AS allowed`,
  )) as unknown as Array<{ allowed: boolean }>;
  return Boolean(row?.allowed);
}
