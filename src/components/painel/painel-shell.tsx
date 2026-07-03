'use client';

import { ChevronDown, LogOut, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/ui/cn';

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

      <div className="min-h-dvh lg:grid lg:grid-cols-[var(--sidebar-w)_1fr]">
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
          <header
            className={cn(
              'sticky top-0 z-(--z-sticky) flex items-center gap-(--sp-3) border-b border-border px-(--sp-8) py-2 max-lg:pl-16 max-md:px-(--sp-4) max-md:pl-16',
              'bg-[color-mix(in_oklch,var(--bg)_86%,transparent)] backdrop-blur-[12px] backdrop-saturate-[1.3]',
            )}
          >
            <div className="flex-1" />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-2.5 rounded-(--r-md) px-2 py-1.5 transition-colors hover:bg-surface-hover focus-visible:shadow-(--focus-ring) focus-visible:outline-none"
                >
                  <span className="grid size-8 place-items-center rounded-full bg-primary text-(length:--fs-xs) font-semibold text-on-primary">
                    {userInitials}
                  </span>
                  <span className="flex flex-col items-start max-md:hidden">
                    <span className="text-(length:--fs-sm) leading-tight font-medium">
                      {userName}
                    </span>
                    {userRole ? (
                      <span className="text-(length:--fs-2xs) leading-tight text-fg-subtle">
                        {userRole}
                      </span>
                    ) : null}
                  </span>
                  <ChevronDown aria-hidden="true" className="size-3.5 text-fg-subtle max-md:hidden" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Conta</DropdownMenuLabel>
                <DropdownMenuItem asChild>
                  <Link href="/account/security">
                    <ShieldCheck />
                    Segurança da conta
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <form action="/logout" method="post">
                  <DropdownMenuItem asChild danger>
                    <button type="submit" className="w-full">
                      <LogOut />
                      Sair
                    </button>
                  </DropdownMenuItem>
                </form>
              </DropdownMenuContent>
            </DropdownMenu>
          </header>

          <main className="mx-auto w-full max-w-330 flex-1 px-(--sp-8) pt-(--sp-6) pb-(--sp-16) max-md:px-(--sp-4)">
            {children}
          </main>
        </div>
      </div>
      <Toaster />
    </TooltipProvider>
  );
}
