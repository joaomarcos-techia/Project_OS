import type { ReactNode } from 'react';

// Painel (C-UI): shell + design tokens do bundle de design (ds.css base do DS +
// app-shell.css da casca). Importados aqui (layout) p/ valerem em todas as telas
// autenticadas. globals.css (root) carrega antes; tokens compartilham linhagem.
import './_painel/ds.css';
import './_painel/app-shell.css';
import { PainelShell } from '@/components/painel/painel-shell';
import { getShellIdentity } from '@/components/painel/shell-identity';

/**
 * Layout das rotas autenticadas com chrome (sidebar). Route-group `(shell)` não
 * altera URL. Auth real é feita pelo middleware + `requireUser` nas páginas.
 * A identidade (usuário/clínica) do shell vem do profile + clinics reais.
 */
export default async function ShellLayout({ children }: { children: ReactNode }) {
  const id = await getShellIdentity();
  return (
    <PainelShell userName={id.userName} userRole={id.userRole} clinicName={id.clinicName}>
      {children}
    </PainelShell>
  );
}
