import type { ReactNode } from 'react';

import { AppShell } from '@/components/shared/app-shell';

/**
 * Layout das rotas autenticadas com chrome (sidebar). Route-group `(shell)` não
 * altera URL. Auth real é feita pelo middleware + `requireUser` nas páginas.
 */
export default function ShellLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
