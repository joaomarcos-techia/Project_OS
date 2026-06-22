import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

// Painel (C-UI): shell + design tokens do bundle de design (ds.css base do DS +
// app-shell.css da casca). Importados aqui (layout) p/ valerem em todas as telas
// autenticadas. globals.css (root) carrega antes; tokens compartilham linhagem.
import './_painel/ds.css';
import './_painel/app-shell.css';
import { ImpersonationBanner } from '@/components/admin/impersonation-banner';
import { PainelShell } from '@/components/painel/painel-shell';
import { getShellIdentity } from '@/components/painel/shell-identity';
import { AnnouncementPopup } from '@/components/shared/announcement-popup';
import { getCurrentUser } from '@/lib/auth/tenant-context';
import { getImpersonationView } from '@/lib/impersonation';
import { getActiveAnnouncement } from '@/lib/platform-announcements';

import { stopImpersonationAction } from '../../(admin)/admin/actions/impersonation';

/**
 * Layout das rotas autenticadas com chrome (sidebar). Route-group `(shell)` não
 * altera URL. Auth real é feita pelo middleware + `requireUser` nas páginas.
 * A identidade (usuário/clínica) do shell vem do profile + clinics reais.
 *
 * C15: durante impersonate, o banner permanente (OR-I9) aparece acima do shell.
 */
export default async function ShellLayout({ children }: { children: ReactNode }) {
  const [user, id, impersonation, announcement] = await Promise.all([
    getCurrentUser(),
    getShellIdentity(),
    getImpersonationView(),
    getActiveAnnouncement(),
  ]);

  // C15: super_admin só fica no app tenant DURANTE um impersonate. Sem sessão
  // ativa (nunca iniciou / TTL expirou / revogado), volta pro /admin — em vez de
  // bater em requireClinicId() e quebrar a tela tenant (OR-I10).
  if (user?.isSuperAdmin && !impersonation) {
    redirect('/admin');
  }

  return (
    <>
      {announcement ? <AnnouncementPopup announcement={announcement} /> : null}
      {impersonation ? (
        <ImpersonationBanner view={impersonation} stopAction={stopImpersonationAction} />
      ) : null}
      <PainelShell userName={id.userName} userRole={id.userRole} clinicName={id.clinicName}>
        {children}
      </PainelShell>
    </>
  );
}
