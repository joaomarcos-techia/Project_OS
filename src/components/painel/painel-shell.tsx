'use client';

import { LogOut } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

import {
  MobileNavButton,
  ShellScrim,
  ShellSidebar,
  SidebarFootButton,
  SideNavDisabled,
  SideNavGroupLabel,
  SideNavLink,
  ThemeFootToggle,
  Wordmark,
} from '@/components/shared/shell-chrome';
import { useTheme } from '@/components/shared/use-theme';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';

import { Icon, LogoIcon } from './icons';
import { GROUPS, MODULES } from './modules';

/**
 * Chrome do painel tenant — DS v2 §side/topbar em Tailwind (ADR-031).
 * O topbar perdeu a busca ⌘K fake e o sino sem feature (UX honesta); o bloco
 * de usuário virou menu REAL (Segurança da conta + Sair, rotas existentes).
 */
export function PainelShell({
  children,
  clinicName = 'ClinicaOS',
  clinicPlan,
  userName = 'Você',
  userRole = '',
}: {
  children: ReactNode;
  clinicName?: string;
  clinicPlan?: string;
  userName?: string;
  userRole?: string;
}) {
  const pathname = usePathname();
  const { dark, toggle } = useTheme();
  const [navOpen, setNavOpen] = useState(false);

  // fecha o drawer mobile ao trocar de rota
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  const isActive = (href?: string) =>
    !!href && (pathname === href || pathname.startsWith(href + '/'));

  const userInitials = userName
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <TooltipProvider delayDuration={300}>
      <MobileNavButton open={navOpen} onClick={() => setNavOpen((v) => !v)} />
      <ShellScrim show={navOpen} onClick={() => setNavOpen(false)} />

      <div className="min-h-dvh nav:grid nav:grid-cols-[var(--sidebar-w)_1fr]">
        <ShellSidebar open={navOpen}>
          <Wordmark logo={<LogoIcon size={24} />} />

          {/* Identidade do tenant — o usuário sempre sabe qual clínica está ativa */}
          <div className="mx-(--sp-4) flex items-center gap-2.5 rounded-(--r-md) border border-border bg-surface-2 px-3 py-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-(--r-sm) bg-primary">
              <LogoIcon size={16} strong="#fff" soft="rgba(255,255,255,.55)" />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-(length:--fs-sm) leading-tight font-semibold">
                {clinicName}
              </span>
              {clinicPlan ? (
                <span className="font-mono text-[10px] tracking-(--tracking-label) text-fg-subtle uppercase">
                  {clinicPlan}
                </span>
              ) : null}
            </span>
          </div>

          <nav className="flex-1 px-(--sp-3)" aria-label="Navegação principal">
            {GROUPS.map((g) => {
              const mods = MODULES.filter((m) => m.group === g);
              if (!mods.length) return null;
              return (
                <div key={g} className="mt-(--sp-5) first:mt-(--sp-2)">
                  <SideNavGroupLabel>{g}</SideNavGroupLabel>
                  {mods.map((m) =>
                    m.soon || !m.href ? (
                      <SideNavDisabled key={m.id} icon={<Icon name={m.icon} />} label={m.label} />
                    ) : (
                      <SideNavLink
                        key={m.id}
                        href={m.href}
                        active={isActive(m.href)}
                        icon={<Icon name={m.icon} />}
                        label={m.label}
                        trailing={
                          m.badge ? (
                            <span className="grid min-w-4.5 place-items-center rounded-full bg-(--primary-soft) px-1 text-[10px] font-semibold text-(--primary-active) dark:text-fg">
                              {m.badge}
                            </span>
                          ) : undefined
                        }
                      />
                    ),
                  )}
                </div>
              );
            })}
          </nav>

          <div className="flex flex-col gap-1 border-t border-border p-(--sp-3)">
            {/* Identidade do usuário — o topbar foi aposentado (decisão do founder:
                tudo na sidebar, como no /admin) */}
            <div className="flex items-center gap-2.5 px-(--sp-3) py-2">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-(length:--fs-2xs) font-semibold text-on-primary">
                {userInitials}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-(length:--fs-sm) leading-tight font-medium">
                  {userName}
                </span>
                {userRole ? (
                  <span className="text-(length:--fs-2xs) leading-tight text-fg-subtle">
                    {userRole}
                  </span>
                ) : null}
              </span>
            </div>
            <ThemeFootToggle dark={dark} onToggle={toggle} />
            <form action="/logout" method="post">
              <SidebarFootButton type="submit" icon={<LogOut />} label="Sair" aria-label="Sair" />
            </form>
            <span className="px-0.5 font-mono text-[10px] leading-normal text-fg-subtle">
              ClinicaOS — operação sem vazamento.
            </span>
          </div>
        </ShellSidebar>

        <div className="flex min-w-0 flex-col bg-canvas">
          <main className="mx-auto w-full max-w-330 flex-1 px-(--sp-8) pt-(--sp-6) pb-(--sp-16) max-nav:pt-(--sp-12) max-md:px-(--sp-4)">
            {children}
          </main>
        </div>
      </div>
      <Toaster />
    </TooltipProvider>
  );
}
