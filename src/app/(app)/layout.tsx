import type { ReactNode } from 'react';

// DS base (tokens + componentes: `.input`/`.btn`/`.field`/`.card`/`.alert`…) para
// TODAS as rotas do grupo (app): tanto as telas autenticadas (shell) quanto as de
// auth (login/forgot/reset/mfa) — que antes ficavam sem as classes do DS porque o
// ds.css só era importado no layout do (shell). app-shell.css continua exclusivo do
// (shell) (chrome de sidebar/topbar). Passthrough puro: nenhuma lógica de auth aqui
// (essa vive no middleware + no layout do (shell)).
import './(shell)/_painel/ds.css';

export default function AppGroupLayout({ children }: { children: ReactNode }) {
  return children;
}
