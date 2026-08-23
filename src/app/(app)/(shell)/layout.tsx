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
import { PERMISSIONS } from '@/lib/auth/permissions';
import { getActiveAnnouncement } from '@/lib/platform-announcements';

import { HandoffWatcher } from './_painel/handoff-watcher';

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

  // V9 (auditoria de segurança): backstop de defesa-em-profundidade. O middleware
  // + `require*` por página são a defesa primária; este guard garante que o shell
  // NUNCA renderize para um usuário não-autenticado, mesmo que uma request fure o
  // middleware (ex.: cookie `_healed` forjado / V4) — fail-closed no layout.
  if (!user) {
    redirect('/login');
  }

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
      {/* Só monta para quem atende: sem a permissão o watcher nem existe no
          cliente, então não há polling nem payload de fila para quem não pode
          ver conversa. A action reautoriza por conta própria. */}
      {user.permissions.includes(PERMISSIONS.VIEW_CONVERSATIONS) ? <HandoffWatcher /> : null}
      <PainelShell userName={id.userName} userRole={id.userRole}>
        {children}
      </PainelShell>
    </>
  );
}
