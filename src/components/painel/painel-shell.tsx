'use client';

import { usePathname } from 'next/navigation';
import { Laptop, LogOut, Moon, Sun, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import {
  MobileNavButton,
  ShellScrim,
  ShellSidebar,
  SidebarUserMenu,
  SideNavDisabled,
  SideNavGroupLabel,
  SideNavLink,
  Wordmark,
} from '@/components/shared/shell-chrome';
import { resolvePageLayout } from '@/components/shared/page-layout';
import { useTheme } from '@/components/shared/use-theme';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { initialsFrom } from '@/components/ui/avatar';

import { useOpenHandoffCount } from './handoff-store';
import { Icon } from './icons';
import { GROUPS, MODULES } from './modules';

/**
 * Chrome do painel tenant — DS v2 §side/topbar em Tailwind (ADR-031).
 * O topbar perdeu a busca ⌘K fake e o sino sem feature (UX honesta); o bloco
 * de usuário virou menu REAL (Segurança da conta + Sair, rotas existentes).
 */
export function PainelShell({
  children,
  userName = 'Você',
  userRole = '',
  settingsHref,
  clinicSettingsHref,
}: {
  children: ReactNode;
  userName?: string;
  userRole?: string;
  /** Categoria inicial acessível; evita Link cliente para uma rota de redirect. */
  settingsHref: string;
  /** Só vem preenchido para quem tem `manage:settings` (ver o layout do shell). */
  clinicSettingsHref?: string;
}) {
  const pathname = usePathname();
  const { theme, toggle } = useTheme();
  // 0 quando o usuário não tem `view:conversations`: o watcher não é montado e
  // ninguém alimenta o store, então o badge simplesmente não aparece.
  const handoffCount = useOpenHandoffCount();
  const [navOpen, setNavOpen] = useState(false);
  const pageLayout = resolvePageLayout(pathname);

  // fecha o drawer mobile ao trocar de rota
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!navOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setNavOpen(false);
      requestAnimationFrame(() => {
        document
          .querySelector<HTMLButtonElement>(
            '[data-qoro-shell="tenant"] button[aria-label="Abrir navegação"]',
          )
          ?.focus();
      });
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [navOpen]);

  const isActive = (href?: string) =>
    !!href &&
    ([href, encodeURI(href)].some((path) => pathname === path || pathname.startsWith(path + '/')) ||
      (href === settingsHref && pathname.startsWith('/configuracoes/')));

  const userInitials = initialsFrom(userName);
  const themeLabel =
    theme === 'dark' ? 'Tema escuro' : theme === 'system' ? 'Tema do sistema' : 'Tema claro';
  const ThemeIcon = theme === 'dark' ? Moon : theme === 'system' ? Laptop : Sun;

  return (
    <TooltipProvider delayDuration={300}>
      <div data-qoro-shell="tenant">
        <a className="qoro-skip-link" href="#qoro-main">
          Pular para o conteúdo
        </a>
        <MobileNavButton open={navOpen} onClick={() => setNavOpen((v) => !v)} />
        <ShellScrim show={navOpen} onClick={() => setNavOpen(false)} />

        <div className="qoro-shell-grid min-h-dvh nav:grid nav:grid-cols-[var(--sidebar-w)_1fr]">
          <ShellSidebar open={navOpen}>
            <div className="flex items-center justify-between pr-3">
              <Wordmark />
              <Button
                variant="subtle"
                size="sm"
                icon
                className="nav:hidden"
                aria-label="Fechar navegação"
                onClick={() => setNavOpen(false)}
              >
                <X aria-hidden="true" className="size-4" />
              </Button>
            </div>

            <nav
              className="min-h-0 flex-1 overflow-y-auto px-(--sp-3)"
              aria-label="Navegação principal"
            >
              {GROUPS.map((g) => {
                const mods = MODULES.filter((m) => m.group === g);
                if (!mods.length) return null;
                return (
                  <div key={g} data-nav-group={g} className="mt-(--sp-4) first:mt-(--sp-2)">
                    <SideNavGroupLabel>{g}</SideNavGroupLabel>
                    {mods.map((m) => {
                      const href = m.id === 'config' ? settingsHref : m.href;
                      return m.soon || !href ? (
                        <SideNavDisabled key={m.id} icon={<Icon name={m.icon} />} label={m.label} />
                      ) : (
                        <SideNavLink
                          key={m.id}
                          href={href}
                          active={isActive(href)}
                          icon={<Icon name={m.icon} />}
                          label={m.label}
                          trailing={
                            m.id === 'conversas' && handoffCount > 0 ? (
                              // Vermelho porque pede ação de alguém, e com o
                              // NÚMERO: "3" diz o tamanho da fila, um ponto não.
                              <span
                                aria-label={`${handoffCount} ${
                                  handoffCount === 1
                                    ? 'conversa aguardando atendimento'
                                    : 'conversas aguardando atendimento'
                                }`}
                                className="qoro-handoff-badge grid min-w-4.5 place-items-center rounded-full bg-danger-600 px-1 text-(length:--fs-3xs) font-semibold text-(--text-inverse)"
                              >
                                {handoffCount > 9 ? '9+' : handoffCount}
                              </span>
                            ) : m.badge ? (
                              <span className="grid min-w-4.5 place-items-center rounded-full bg-(--primary-soft) px-1 text-(length:--fs-3xs) font-semibold text-(--primary-active) dark:text-fg">
                                {m.badge}
                              </span>
                            ) : undefined
                          }
                        />
                      );
                    })}
                  </div>
                );
              })}
            </nav>

            {/* Conta, tema e saída no rodapé da referência. O mesmo form atende
              tanto ao botão direto quanto ao item do menu renderizado em Portal. */}
            <div className="qoro-sidebar-footer border-t border-border p-(--sp-2)">
              <form id="painel-logout" action="/logout" method="post" className="hidden" />
              <SidebarUserMenu
                userName={userName}
                userRole={userRole}
                initials={userInitials}
                theme={theme}
                onToggleTheme={toggle}
                accountHref="/account/security"
                {...(clinicSettingsHref ? { clinicSettingsHref } : {})}
                logoutFormId="painel-logout"
                showThemeControl={false}
              />
              <div className="qoro-sidebar-actions">
                <Button
                  variant="subtle"
                  onClick={toggle}
                  aria-label={`${themeLabel}. Alternar tema`}
                >
                  <ThemeIcon aria-hidden="true" className="size-3.5" />
                  {themeLabel}
                </Button>
                <Button variant="subtle" icon type="submit" form="painel-logout" aria-label="Sair">
                  <LogOut aria-hidden="true" className="size-3.5" />
                </Button>
              </div>
            </div>
          </ShellSidebar>

          <div className="flex min-w-0 flex-col bg-canvas">
            <main
              id="qoro-main"
              tabIndex={-1}
              data-page-layout={pageLayout}
              className="mx-auto w-full max-w-(--page-maxw) flex-1 px-(--page-px) pt-(--page-pt) pb-(--page-pb) max-nav:pt-(--page-pt-mobile)"
            >
              {children}
            </main>
          </div>
        </div>
        <Toaster />
      </div>
    </TooltipProvider>
  );
}
