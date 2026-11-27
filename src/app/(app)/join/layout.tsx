import type { ReactNode } from 'react';

import '../(shell)/_painel/ds.css';
import './[token]/onboarding-flow.css';

/**
 * `main` aqui (UX-017, `docs/otimização_ui_final.md`): `/join` e `/join/[token]` não
 * tinham landmark principal. Fica no layout porque o assistente
 * (`[token]/join-wizard.tsx`) também muda na PR #55.
 */
export default function JoinLayout({ children }: { children: ReactNode }) {
  return <main>{children}</main>;
}
