import type { ReactNode } from 'react';

// Design System: tokens globais vêm de globals.css (root); as classes de
// componente (.badge/.btn/.input…) vivem no ds.css e o chrome (.app/.sidebar/
// .page-head/.stat-tile/.cardblock/.listrow/.toolbar/.empty) no app-shell.css —
// reusados do painel. admin.css traz só os extras do console
// (.adm-pill/.scope-mini/.health-*/.plan-card/.iad-*), extraídos do standalone.
import '../../(app)/(shell)/_painel/ds.css';
import '../../(app)/(shell)/_painel/app-shell.css';
import './_admin/admin.css';
import { AdminShell } from '@/components/admin/admin-shell';

import { guardAdminAccess } from './_lib/guard';

// Toda leitura é live + depende de sessão; nunca estática.
export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await guardAdminAccess(); // 404 p/ qualquer não-super_admin AAL2
  return <AdminShell>{children}</AdminShell>;
}
