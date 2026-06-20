import { ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';

import { AdminNav } from './admin-nav';

/**
 * Chrome do Platform Admin (C15). Server component puro — toda leitura pesada
 * fica nas páginas. Sidebar com as rotas do brief + identificação do operador.
 *
 * Visualmente distinto do shell tenant (faixa escura + selo) para o fundador
 * nunca confundir "estou no painel da plataforma" com "estou numa clínica".
 */
export function AdminShell({
  operatorName,
  children,
}: {
  operatorName: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-canvas">
      <aside className="sticky top-0 flex h-screen w-[252px] shrink-0 flex-col border-r border-border bg-surface">
        <div className="flex items-center gap-2.5 border-b border-border px-5 py-4">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary-600 text-on-primary">
            <ShieldCheck className="h-4.5 w-4.5" />
          </span>
          <div className="leading-tight">
            <div className="text-sm font-semibold">Qoro Admin</div>
            <div className="text-xs text-fg-subtle">Plataforma</div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-4">
          <AdminNav />
        </div>

        <div className="border-t border-border px-5 py-3">
          <div className="text-xs text-fg-subtle">Operador</div>
          <div className="truncate text-sm font-medium" title={operatorName}>
            {operatorName}
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <div className="mx-auto w-full max-w-[1080px] px-6 py-8">{children}</div>
      </main>
    </div>
  );
}
