import 'server-only';

import { getCurrentUser } from '@/lib/auth/tenant-context';

/**
 * Identidade real exibida no shell do Painel (clinic switcher + usuário no topbar).
 * Reaproveita os nomes carregados na identidade já validada pela auth.
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

    return {
      userName: user.name?.trim() || 'Você',
      userRole: role,
      clinicName: user.clinicName?.trim() || 'Qoro',
    };
  } catch {
    return NEUTRAL;
  }
}
