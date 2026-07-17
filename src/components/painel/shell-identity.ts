import 'server-only';

import { sql } from 'drizzle-orm';

import { getCurrentUser } from '@/lib/auth/tenant-context';
import { withTenant } from '@/lib/db/tenant';

/**
 * Identidade real exibida no shell do Painel (clinic switcher + usuário no topbar).
 * Lê nome do profile + nome da clínica (fundação identity/tenancy) via withTenant.
 * Best-effort: qualquer falha cai em rótulos neutros (o shell nunca quebra a página).
 */
export interface ShellIdentity {
  userName: string;
  userRole: string;
  clinicName: string;
}

const ROLE_LABEL: Record<string, string> = {
  owner: 'Dono(a)',
  gestor: 'Gestor',
  doctor: 'Médico(a)',
  attendant: 'Atendente',
  financial: 'Financeiro',
  super_admin: 'Administrador',
};

const NEUTRAL: ShellIdentity = { userName: 'Você', userRole: '', clinicName: 'Qoro' };

export async function getShellIdentity(): Promise<ShellIdentity> {
  try {
    const user = await getCurrentUser();
    if (!user) return NEUTRAL;
    const role = ROLE_LABEL[user.role] ?? user.role;
    if (!user.clinicId) return { userName: 'Você', userRole: role, clinicName: 'Qoro' };

    return await withTenant(user.clinicId, async (tx) => {
      const rows = (await tx.execute(sql`
        SELECT p.nome AS user_name, c.nome AS clinic_name
          FROM profiles p, clinics c
         WHERE p.id = ${user.userId} AND c.id = ${user.clinicId}
         LIMIT 1
      `)) as unknown as Array<{ user_name: string | null; clinic_name: string | null }>;
      const r = rows[0];
      return {
        userName: r?.user_name?.trim() || 'Você',
        userRole: role,
        clinicName: r?.clinic_name?.trim() || 'Qoro',
      };
    });
  } catch {
    return NEUTRAL;
  }
}
