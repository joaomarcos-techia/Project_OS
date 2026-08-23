import type { ReactNode } from 'react';

import { requireUser } from '@/lib/auth/tenant-context';

import { SettingsNav } from './settings-nav';
import { visibleSettingsNavigation } from './settings-navigation';

/**
 * A navegação das configurações vive aqui, e não em cada página, para que a
 * barra seja a mesma em todas — é ela que faz o papel de hub. Os gates reais
 * continuam em cada rota; o filtro daqui é de ANÚNCIO (não oferecer o que não
 * se pode abrir), nunca de autorização.
 */
export default async function ConfiguracoesLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const groups = visibleSettingsNavigation(
    user.permissions,
    user.isSuperAdmin && user.aal === 'aal2',
  );

  return (
    <div className="min-w-0">
      <SettingsNav groups={groups} />
      {children}
    </div>
  );
}
