import type { ReactNode } from 'react';

// Painel (C-UI): shell + design tokens do bundle de design (ds.css base do DS +
// app-shell.css da casca). Importados aqui (layout) p/ valerem em todas as telas
// autenticadas. globals.css (root) carrega antes; tokens compartilham linhagem.
import './_painel/ds.css';
import './_painel/app-shell.css';
import { ImpersonationBanner } from '@/components/admin/impersonation-banner';
import { PainelShell } from '@/components/painel/painel-shell';
import { getShellIdentity } from '@/components/painel/shell-identity';
import { getImpersonationView } from '@/lib/impersonation';

import { stopImpersonationAction } from '../../(admin)/admin/actions/impersonation';

/**
 * Layout das rotas autenticadas com chrome (sidebar). Route-group `(shell)` não
 * altera URL. Auth real é feita pelo middleware + `requireUser` nas páginas.
 * A identidade (usuário/clínica) do shell vem do profile + clinics reais.
 *
 * C15: durante impersonate, o banner permanente (OR-I9) aparece acima do shell.
 */
export default async function ShellLayout({ children }: { children: ReactNode }) {
  const [id, impersonation] = await Promise.all([getShellIdentity(), getImpersonationView()]);
  return (
    <>
      {impersonation ? (
        <ImpersonationBanner view={impersonation} stopAction={stopImpersonationAction} />
      ) : null}
      <PainelShell userName={id.userName} userRole={id.userRole} clinicName={id.clinicName}>
        {children}
      </PainelShell>
    </>
  );
}
