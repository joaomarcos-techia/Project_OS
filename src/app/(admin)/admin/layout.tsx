import { eq } from 'drizzle-orm';
import type { ReactNode } from 'react';

// Design System: tokens globais vêm de globals.css (root); as classes de
// componente (.badge/.page-head/...) vivem no ds.css do shell. Importamos aqui
// para o painel reusar o MESMO design (review: DS é a verdade visual).
import '../../(app)/(shell)/_painel/ds.css';
import { profiles } from '@/contexts/identity/schema';
import { AdminShell } from '@/components/admin/admin-shell';
import { requireUser } from '@/lib/auth/tenant-context';
import { dbAdmin } from '@/lib/db';

import { guardAdminAccess } from './_lib/guard';

// Toda leitura é live + depende de sessão; nunca estática.
export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await guardAdminAccess(); // 404 p/ qualquer não-super_admin AAL2
  const user = await requireUser();
  const [operator] = await dbAdmin
    .select({ nome: profiles.nome })
    .from(profiles)
    .where(eq(profiles.id, user.userId))
    .limit(1);

  return <AdminShell operatorName={operator?.nome ?? 'Super Admin'}>{children}</AdminShell>;
}
