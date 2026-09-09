import type { ReactNode } from 'react';

import { requireUser } from '@/lib/auth/tenant-context';

import { SettingsNav } from './settings-nav';
import { visibleSettingsNavigation } from './settings-navigation';
import styles from './settings.module.css';

/**
 * As abas vivem aqui, e não em cada página, para serem as mesmas em todas.
 *
 * Só os hrefs atravessam a fronteira para o cliente — os ícones das categorias
 * são componentes React e não são serializáveis. Os gates reais continuam em
 * cada rota; o filtro daqui é de ANÚNCIO (não oferecer o que não se pode
 * abrir), nunca de autorização.
 */
export default async function ConfiguracoesLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const groups = visibleSettingsNavigation(
    user.permissions,
    user.isSuperAdmin && user.aal === 'aal2',
  );
  const visibleHrefs = groups.flatMap((group) => group.items.map((item) => item.href));

  return (
    <div className={styles.layout}>
      <SettingsNav visibleHrefs={visibleHrefs} />
      {children}
    </div>
  );
}
