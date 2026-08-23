import { redirect } from 'next/navigation';

import { requireUser } from '@/lib/auth/tenant-context';

import { firstSettingsHref, visibleSettingsNavigation } from './settings-navigation';

export const dynamic = 'force-dynamic';

/**
 * `/configuracoes` não é tela: abre direto o Perfil da clínica, que é o que se
 * procura no dia a dia. O resto é alcançado pela barra do layout — ela é o hub.
 */
export default async function ConfiguracoesPage() {
  const user = await requireUser();
  const groups = visibleSettingsNavigation(
    user.permissions,
    user.isSuperAdmin && user.aal === 'aal2',
  );

  redirect(firstSettingsHref(groups));
}
