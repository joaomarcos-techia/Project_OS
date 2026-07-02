'use client';

import { LogOut, ShieldCheck } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

import { LogoIcon } from '@/components/painel/icons';
import {
  MobileNavButton,
  ShellScrim,
  ShellSidebar,
  SidebarFootButton,
  ThemeFootToggle,
  Wordmark,
} from '@/components/shared/shell-chrome';
import { useTheme } from '@/components/shared/use-theme';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';

import { AdminNav } from './admin-nav';

/**
 * Chrome do Platform Admin (C15) — DS v2 em Tailwind (ADR-031). Identidade do
 * console (pill ADMIN + escopo Plataforma + selo ink) para o fundador nunca
 * confundir "estou na plataforma" com "estou numa clínica".
 */
export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { dark, toggle } = useTheme();
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  return (
    <TooltipProvider delayDuration={300}>
      <MobileNavButton onClick={() => setNavOpen((v) => !v)} />
      <ShellScrim show={navOpen} onClick={() => setNavOpen(false)} />

      <div className="min-h-dvh lg:grid lg:grid-cols-[var(--sidebar-w)_1fr]">
        <ShellSidebar open={navOpen}>
          <div className="flex items-center justify-between pr-(--sp-5)">
            <Wordmark logo={<LogoIcon size={24} />} />
            <span className="rounded-(--r-xs) bg-secondary px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-(--tracking-label) text-secondary-fg uppercase">
              Admin
            </span>
          </div>

          {/* Escopo do console — nunca confundir com uma clínica */}
          <div className="mx-(--sp-3) flex items-center gap-2.5 rounded-(--r-md) border border-border bg-surface-2 px-3 py-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-(--r-sm) bg-secondary text-secondary-fg">
              <ShieldCheck className="size-4" />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="text-(length:--fs-sm) leading-tight font-semibold">Plataforma</span>
              <span className="font-mono text-[10px] text-fg-subtle">Console multi-tenant</span>
            </span>
          </div>

          <AdminNav />

          <div className="flex flex-col gap-1 border-t border-border p-(--sp-3)">
            <ThemeFootToggle dark={dark} onToggle={toggle} />
            <form action="/logout" method="post">
              <SidebarFootButton type="submit" icon={<LogOut />} label="Sair" aria-label="Sair" />
            </form>
            <span className="px-0.5 font-mono text-[10px] leading-normal text-fg-subtle">
              super_admin — toda ação auditada.
            </span>
          </div>
        </ShellSidebar>

        <div className="flex min-w-0 flex-col bg-canvas">
          <main className="mx-auto w-full max-w-330 flex-1 px-(--sp-8) pt-(--sp-6) pb-(--sp-16) max-md:px-(--sp-4)">
            {children}
          </main>
        </div>
      </div>
      <Toaster />
    </TooltipProvider>
  );
}
