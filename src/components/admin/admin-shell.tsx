'use client';

import { LogOut, ShieldCheck } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

import {
  MobileNavButton,
  ShellScrim,
  ShellSidebar,
  SidebarFootButton,
  ThemeFootToggle,
  Wordmark,
} from '@/components/shared/shell-chrome';
import { Logo } from '@/components/shared/logo';
import { useTheme } from '@/components/shared/use-theme';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';

import { AdminNav } from './admin-nav';

/**
 * Chrome do Platform Admin (C15) — DS v2 em Tailwind (ADR-031). Identidade do
 * console (pill ADMIN + escopo Plataforma + selo ink) para o fundador nunca
 * confundir "estou na plataforma" com "estou numa clínica".
 */
/** Selo do console: escuro, para não parecer um rótulo de clínica. */
function AdminBadge() {
  return (
    <span className="rounded-(--tag-radius) bg-secondary px-1.5 py-0.5 font-mono text-(length:--fs-3xs) font-semibold tracking-(--tracking-label) text-secondary-fg uppercase">
      Admin
    </span>
  );
}

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { theme, toggle } = useTheme();
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  return (
    <TooltipProvider delayDuration={300}>
      <ShellScrim show={navOpen} onClick={() => setNavOpen(false)} />

      {/* Tokens do app Qoro v5 (fontes, cores, raios), como no app da clínica e
          nas telas públicas. A identidade de console — selo ADMIN e "Plataforma"
          — continua, para nunca confundir o console com uma clínica. */}
      <div
        data-qoro-tokens="app-v5"
        data-slot="admin-shell"
        className="min-h-dvh bg-(--shell-bg) px-(--shell-gap) pb-(--shell-gap) nav:grid nav:grid-cols-[var(--sidebar-w)_1fr] nav:gap-(--shell-gap) nav:p-(--shell-gap)"
      >
        {/* Celular: barra do topo com a marca, o selo do console e o botão
            Menu, como no app da clínica. O botão flutuante cobria o título. */}
        <div className="flex h-15 items-center justify-between gap-2 nav:hidden">
          <span className="flex items-center gap-2">
            <Logo className="h-7 w-auto" />
            <AdminBadge />
          </span>
          <MobileNavButton open={navOpen} onClick={() => setNavOpen((v) => !v)} />
        </div>
        <ShellSidebar open={navOpen}>
          <div className="flex items-center justify-between pr-(--sp-5)">
            <Wordmark />
            <AdminBadge />
          </div>

          {/* Escopo do console — nunca confundir com uma clínica */}
          <div className="mx-(--sp-3) flex items-center gap-2.5 rounded-(--card-radius) border border-border bg-(--card) px-3 py-2.5 shadow-(--elev-1)">
            <span className="grid size-8 shrink-0 place-items-center rounded-(--r-sm) bg-secondary text-secondary-fg">
              <ShieldCheck className="size-4" />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="text-(length:--fs-sm) leading-tight font-semibold">Plataforma</span>
              <span className="font-mono text-(length:--fs-3xs) text-fg-subtle">
                Console multi-tenant
              </span>
            </span>
          </div>

          <AdminNav />

          <div className="flex flex-col gap-1 border-t border-(--rail-sep) p-(--sp-3)">
            <ThemeFootToggle theme={theme} onToggle={toggle} />
            <form action="/logout" method="post">
              <SidebarFootButton type="submit" icon={<LogOut />} label="Sair" aria-label="Sair" />
            </form>
            <span className="px-0.5 font-mono text-(length:--fs-3xs) leading-normal text-fg-subtle">
              super_admin — toda ação auditada.
            </span>
          </div>
        </ShellSidebar>

        {/* Painel de conteúdo: branco, borda fina e raio 16, como o da clínica. */}
        <div className="flex min-w-0 flex-col rounded-(--panel-radius) border border-border bg-(--background)">
          <main
            data-page-layout="data"
            className="mx-auto w-full max-w-(--page-maxw) flex-1 px-(--page-px) pt-(--sp-6) pb-(--page-pb)"
          >
            {children}
          </main>
        </div>
      </div>
      <Toaster />
    </TooltipProvider>
  );
}
