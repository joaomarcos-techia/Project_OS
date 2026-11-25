import type { Metadata } from 'next';
import type { ReactNode } from 'react';

/**
 * Só o título da aba (UX-008, `docs/otimização_ui_final.md`). Fica num layout
 * porque o page.tsx desta pasta é componente de cliente ou muda numa PR
 * paralela (#53 billing / #55 Convênios); assim a integração não conflita.
 */
export const metadata: Metadata = { title: 'Entrar' };

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
