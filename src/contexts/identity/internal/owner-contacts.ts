import 'server-only';

import { and, asc, eq, isNull } from 'drizzle-orm';

import { createAdminClient } from '@/lib/auth/supabase-admin';
import { withTenant } from '@/lib/db/tenant';

import { profiles } from '../schema';

/**
 * E-mails dos donos ativos da clínica, para avisos operacionais que não podem
 * depender de alguém abrir a tela (ex.: encerramento da conta de pagamento).
 *
 * Quem é dono vem do banco pelo caminho tenant (RLS); o e-mail vive no Auth, não
 * em `profiles` (D7), e só a Admin API o lê. Este módulo só LÊ o e-mail por id:
 * não cria, não altera e não toca o banco com o client privilegiado. Dono sem
 * e-mail é pulado.
 */
export async function listActiveOwnerEmails(clinicId: string): Promise<string[]> {
  const owners = await withTenant(clinicId, (tx) =>
    tx
      .select({ id: profiles.id })
      .from(profiles)
      .where(
        and(
          eq(profiles.clinicId, clinicId),
          eq(profiles.role, 'owner'),
          eq(profiles.ativo, true),
          isNull(profiles.deletedAt),
        ),
      )
      .orderBy(asc(profiles.createdAt)),
  );
  if (owners.length === 0) return [];
  const admin = createAdminClient();
  const emails: string[] = [];
  for (const owner of owners) {
    const { data } = await admin.auth.admin.getUserById(owner.id);
    const email = data?.user?.email;
    if (email) emails.push(email);
  }
  return emails;
}
