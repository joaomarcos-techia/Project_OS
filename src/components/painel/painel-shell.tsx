'use client';

import { usePathname } from 'next/navigation';
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
}: {
  children: ReactNode;
  userName?: string;
  userRole?: string;
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
          <Wordmark />

          <nav
            className="min-h-0 flex-1 overflow-y-auto px-(--sp-3)"
            aria-label="Navegação principal"
          >
            {GROUPS.map((g) => {
              const mods = MODULES.filter((m) => m.group === g);
              if (!mods.length) return null;
              return (
                <div key={g} className="mt-(--sp-4) first:mt-(--sp-2)">
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
                          m.id === 'conversas' && handoffCount > 0 ? (
                            // Vermelho porque pede ação de alguém, e com o
                            // NÚMERO: "3" diz o tamanho da fila, um ponto não.
                            <span
                              aria-label={`${handoffCount} ${
                                handoffCount === 1
                                  ? 'conversa aguardando atendimento'
                                  : 'conversas aguardando atendimento'
                              }`}
                              className="grid min-w-4.5 place-items-center rounded-full bg-danger-600 px-1 text-(length:--fs-3xs) font-semibold text-(--text-inverse)"
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
                    ),
                  )}
                </div>
              );
            })}
          </nav>

          {/* Rodapé de um elemento só, como a referência. Tema e Sair não
              sumiram: viraram itens do menu do usuário, que é onde ação de conta
              é procurada. O form fica FORA do menu porque o conteúdo dele é
              renderizado num Portal; o botão o alcança por `form=id`. */}
          <div className="border-t border-border p-(--sp-2)">
            <form id="painel-logout" action="/logout" method="post" className="hidden" />
            <SidebarUserMenu
              userName={userName}
              userRole={userRole}
              initials={userInitials}
              theme={theme}
              onToggleTheme={toggle}
              accountHref="/account/security"
              logoutFormId="painel-logout"
            />
          </div>
        </ShellSidebar>

        <div className="flex min-w-0 flex-col bg-canvas">
          <main
            data-page-layout={pageLayout}
            className="mx-auto w-full max-w-(--page-maxw) flex-1 px-(--page-px) pt-(--page-pt) pb-(--page-pb) max-nav:pt-(--page-pt-mobile)"
          >
            {children}
          </main>
        </div>
      </div>
      <Toaster />
    </TooltipProvider>
  );
}
