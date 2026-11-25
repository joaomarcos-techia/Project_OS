import 'server-only';

import { and, asc, eq, isNull, sql } from 'drizzle-orm';

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

/** Papéis de clínica (sem super_admin). */
type ClinicRole = 'owner' | 'gestor' | 'attendant' | 'financial' | 'doctor';

/**
 * E-mails das pessoas ATIVAS da clínica que têm uma permissão: quem está num dos papéis que a
 * recebem pelo pacote (lista do chamador) e não tem a negativa individual dela, mais quem a recebeu
 * por concessão individual. Para avisos operacionais a quem executa a tarefa (ex.: avisos de
 * autorização de convênio à recepção e à gestão), no máximo `limit` pessoas.
 *
 * Mesmo desenho de `listActiveOwnerEmails`: os perfis e as exceções vêm pelo caminho tenant (RLS);
 * o e-mail é lido no Auth por id. Pessoa desativada, excluída ou sem e-mail não entra.
 */
export async function listActiveMemberEmails(
  clinicId: string,
  opts: { roles: readonly ClinicRole[]; permission: string; limit?: number },
): Promise<string[]> {
  for (const r of opts.roles) if (!/^[a-z_]+$/u.test(r)) throw new Error('papel fora do formato');
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 25);
  // Os papéis vão como literal de array (lista fechada do chamador), não como lista de parâmetros.
  const roles = `{${opts.roles.join(',')}}`;
  const members = await withTenant(clinicId, async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT p.id::text AS id
        FROM public.profiles p
       WHERE p.clinic_id = ${clinicId}::uuid AND p.ativo IS TRUE AND p.deleted_at IS NULL
         AND (
           (p.role::text = ANY(${roles}::text[])
            AND NOT EXISTS (SELECT 1 FROM public.user_permission_overrides o
                             WHERE o.clinic_id = p.clinic_id AND o.user_id = p.id
                               AND o.permission_code = ${opts.permission} AND o.granted = false))
           OR EXISTS (SELECT 1 FROM public.user_permission_overrides o
                       WHERE o.clinic_id = p.clinic_id AND o.user_id = p.id
                         AND o.permission_code = ${opts.permission} AND o.granted = true)
         )
       ORDER BY p.created_at, p.id
       LIMIT ${limit}`)) as unknown as Array<{ id: string }>;
    return rows;
  });
  if (members.length === 0) return [];
  const admin = createAdminClient();
  const emails: string[] = [];
  for (const member of members) {
    const { data } = await admin.auth.admin.getUserById(member.id);
    const email = data?.user?.email;
    if (email && !emails.includes(email)) emails.push(email);
  }
  return emails;
}
