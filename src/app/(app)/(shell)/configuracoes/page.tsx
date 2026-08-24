import { redirect } from 'next/navigation';

import { requireUser } from '@/lib/auth/tenant-context';

import { firstSettingsHref, visibleSettingsNavigation } from './settings-navigation';

export const dynamic = 'force-dynamic';

/** `/configuracoes` não é tela: abre a primeira categoria acessível. */
export default async function ConfiguracoesPage() {
  const user = await requireUser();
  const groups = visibleSettingsNavigation(
    user.permissions,
    user.isSuperAdmin && user.aal === 'aal2',
  );

  redirect(firstSettingsHref(groups));
}
