import type { ReactNode } from 'react';

import { requireUser } from '@/lib/auth/tenant-context';

import { SettingsNav } from './settings-nav';
import { visibleSettingsNavigation } from './settings-navigation';

/** Navegação interna por categoria; os gates reais permanecem em cada rota. */
export default async function ConfiguracoesLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const groups = visibleSettingsNavigation(
    user.permissions,
    user.isSuperAdmin && user.aal === 'aal2',
  );

  return (
    <div className="grid min-w-0 gap-(--sp-6) lg:grid-cols-[13.5rem_minmax(0,1fr)]">
      <SettingsNav groups={groups} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
