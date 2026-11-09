'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Laptop, LogOut, Menu, Moon, PanelLeft, Sun, X } from 'lucide-react';

import { QoroMark } from '@/components/shared/qoro-mark';
import { SidebarUserMenu } from '@/components/shared/shell-chrome';
import { resolvePageLayout } from '@/components/shared/page-layout';
import { useTheme } from '@/components/shared/use-theme';
import { Toaster } from '@/components/ui/toaster';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { initialsFrom } from '@/components/ui/avatar';

import { useOpenHandoffCount } from './handoff-store';
import { Icon } from './icons';
import { GROUPS, MODULES } from './modules';
import { RailAnimated } from './rail-animations';
import { useRailPinned } from './use-rail-pinned';

/** Até esta largura o menu é a barra do topo; `globals.css` usa o mesmo corte. */
const MOBILE_BAR_QUERY = '(max-width: 720px)';

/** O botão de tema é remontado a cada troca (o `key` muda a animação). */
function refocusThemeButton() {
  requestAnimationFrame(() => {
    document.querySelector<HTMLButtonElement>('[data-rail-theme]')?.focus({ preventScroll: true });
  });
}

/** Nome dos ícones do rodapé: aparece no mouse e no foco por teclado. */
function RailFootTip({ label, children }: { label: string; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Chrome do app da clínica — Qoro App v5 (novembro/2026).
 *
 * O menu fica sobre o fundo do app, fora do painel branco de conteúdo:
 * trilho de 72 px só com ícones, que abre por cima ao passar o mouse ou focar
 * pelo teclado, e que o usuário pode fixar aberto (216 px, empurra o painel).
 * No celular o mesmo menu vira uma barra no topo com rolagem lateral; o botão
 * "Abrir navegação" o expande em gaveta, que é onde ficam tema, conta e Sair.
 *
 * As peças são só do tenant (classes `qoro-rail*` em `globals.css`): o
 * `shell-chrome` continua servindo o /admin sem mudança. O menu da conta
 * (`SidebarUserMenu`) é reaproveitado — é o único caminho para "Perfil da
 * clínica" e "Segurança da conta".
 */
export function PainelShell({
  children,
  userName = 'Você',
  userRole = '',
  clinicName = 'Qoro',
  settingsHref,
  clinicSettingsHref,
}: {
  children: ReactNode;
  userName?: string;
  userRole?: string;
  /** Nome da clínica no topo do menu. Sem ele, a marca. */
  clinicName?: string;
  /** Categoria inicial acessível; evita Link cliente para uma rota de redirect. */
  settingsHref: string;
  /** Só vem preenchido para quem tem `manage:settings` (ver o layout do shell). */
  clinicSettingsHref?: string;
}) {
  const pathname = usePathname();
  const { theme, toggle } = useTheme();
  const rail = useRailPinned();
  // 0 quando o usuário não tem `view:conversations`: o watcher não é montado e
  // ninguém alimenta o store, então o contador simplesmente não aparece.
  const handoffCount = useOpenHandoffCount();
  const [navOpen, setNavOpen] = useState(false);
  const pageLayout = resolvePageLayout(pathname);
  const railInnerRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const toggleButtonRef = useRef<HTMLButtonElement>(null);
  // Só volta ao botão de menu quem fechou a gaveta (X, máscara ou Esc). Na troca
  // de rota o foco não é puxado de volta para o menu.
  const refocusToggleOnClose = useRef(false);

  const closeNav = useCallback(() => {
    refocusToggleOnClose.current = true;
    setNavOpen(false);
  }, []);

  // fecha a gaveta do celular ao trocar de rota
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!navOpen) return;
    const root = document.documentElement;
    const toggleButton = toggleButtonRef.current;
    const previousOverflow = root.style.overflow;
    root.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      // `defaultPrevented`: o Esc já fechou uma dica ou o menu da conta.
      if (event.key === 'Escape' && !event.defaultPrevented) closeNav();
    };
    // Girar o aparelho pode passar de 720 px, onde não há gaveta nem como fechá-la.
    const mobileBar = window.matchMedia(MOBILE_BAR_QUERY);
    const onViewportChange = () => {
      if (!mobileBar.matches) setNavOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    mobileBar.addEventListener('change', onViewportChange);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      mobileBar.removeEventListener('change', onViewportChange);
      root.style.overflow = previousOverflow;
      if (refocusToggleOnClose.current) {
        refocusToggleOnClose.current = false;
        toggleButton?.focus();
      }
    };
  }, [navOpen, closeNav]);

  // Na barra do celular, traz o item ativo para a área visível. Espera a gaveta
  // fechar: aberta, o menu não é a faixa horizontal e a medida sairia errada.
  useEffect(() => {
    const inner = railInnerRef.current;
    if (navOpen || !inner || !window.matchMedia(MOBILE_BAR_QUERY).matches) return;
    const item = inner.querySelector('.qoro-rail-nav [aria-current="page"]');
    if (!item) return;
    const bar = inner.getBoundingClientRect();
    const { left, right } = item.getBoundingClientRect();
    if (left < bar.left) inner.scrollLeft += left - bar.left;
    else if (right > bar.right) inner.scrollLeft += right - bar.right;
  }, [pathname, navOpen]);

  const isActive = (href?: string) =>
    !!href &&
    ([href, encodeURI(href)].some((path) => pathname === path || pathname.startsWith(path + '/')) ||
      (href === settingsHref && pathname.startsWith('/configuracoes/')));

  const userInitials = initialsFrom(userName);
  const pinLabel = rail.pinned ? 'Recolher menu' : 'Fixar menu aberto';
  const themeLabel =
    theme === 'dark' ? 'Tema escuro' : theme === 'system' ? 'Tema do sistema' : 'Tema claro';
  const ThemeIcon = theme === 'dark' ? Moon : theme === 'system' ? Laptop : Sun;
  const themeAnimation = theme === 'dark' ? 'dark' : theme === 'system' ? 'system' : 'light';
  const visibleGroups = GROUPS.filter((group) => MODULES.some((m) => m.group === group));

  return (
    <TooltipProvider delayDuration={300}>
      <div data-qoro-shell="tenant" className="qoro-app" data-nav-open={navOpen ? 'true' : 'false'}>
        <a className="qoro-skip-link" href="#qoro-main">
          Pular para o conteúdo
        </a>

        <aside data-slot="tenant-rail" className="qoro-rail">
          <div ref={railInnerRef} className="qoro-rail-inner">
            <div className="qoro-rail-top">
              <Link
                href="/"
                prefetch={false}
                className="qoro-rail-clinic"
                aria-label={`${clinicName} — início`}
              >
                <span className="qoro-rail-mark" aria-hidden="true">
                  <QoroMark />
                </span>
                <span className="qoro-rail-clinic-name qoro-rail-label">{clinicName}</span>
              </Link>
              <button
                ref={closeButtonRef}
                type="button"
                className="qoro-rail-close"
                aria-label="Fechar navegação"
                onClick={closeNav}
              >
                <X aria-hidden="true" className="size-4" />
              </button>
            </div>

            <nav className="qoro-rail-nav" aria-label="Navegação principal">
              {visibleGroups.map((group, index) => (
                <Fragment key={group}>
                  {index > 0 ? <span className="qoro-rail-sep" aria-hidden="true" /> : null}
                  <div
                    role="group"
                    aria-label={group}
                    data-nav-group={group}
                    className="qoro-rail-group"
                  >
                    {MODULES.filter((m) => m.group === group).map((m) => {
                      const href = m.id === 'config' ? settingsHref : m.href;
                      if (m.soon || !href) return null;
                      const showHandoff = m.id === 'conversas' && handoffCount > 0;
                      const countText = handoffCount > 9 ? '9+' : String(handoffCount);
                      return (
                        <RailAnimated
                          key={m.id}
                          name={m.icon}
                          size={27}
                          fallback={<Icon name={m.icon} size={20} sw={1.75} />}
                        >
                          {(icon, events) => (
                            <Link
                              {...events}
                              href={href}
                              // Sem prefetch: com o modo automático, abrir qualquer
                              // aba renderizava todas as outras em segundo plano
                              // (medido no Preview, até 1,4 s por destino).
                              prefetch={false}
                              data-slot="rail-link"
                              className="qoro-rail-item"
                              aria-current={isActive(href) ? 'page' : undefined}
                            >
                              {icon}
                              <span className="qoro-rail-label">{m.label}</span>
                              {showHandoff ? (
                                <>
                                  {/* Um número só para leitura; o ponto sobre o
                                  ícone é a cópia visual do trilho recolhido. */}
                                  <span
                                    className="qoro-rail-count qoro-rail-label"
                                    aria-label={`${handoffCount} ${
                                      handoffCount === 1
                                        ? 'conversa aguardando atendimento'
                                        : 'conversas aguardando atendimento'
                                    }`}
                                  >
                                    {countText}
                                  </span>
                                  <span className="qoro-rail-dot" aria-hidden="true">
                                    {countText}
                                  </span>
                                </>
                              ) : null}
                            </Link>
                          )}
                        </RailAnimated>
                      );
                    })}
                  </div>
                </Fragment>
              ))}
            </nav>

            <span className="qoro-rail-spacer" aria-hidden="true" />

            <div className="qoro-rail-foot">
              <RailAnimated name="pin" size={24} fallback={<PanelLeft aria-hidden="true" />}>
                {(icon, events) => (
                  <RailFootTip label={pinLabel}>
                    <button
                      {...events}
                      type="button"
                      className="qoro-rail-item"
                      data-pressed={rail.pinned ? 'true' : 'false'}
                      onClick={(event) => {
                        events?.onClick(event);
                        rail.toggle();
                      }}
                    >
                      {icon}
                      <span className="qoro-rail-label">{pinLabel}</span>
                    </button>
                  </RailFootTip>
                )}
              </RailAnimated>
              <RailAnimated
                key={themeAnimation}
                name={themeAnimation}
                size={24}
                fallback={<ThemeIcon aria-hidden="true" />}
              >
                {(icon, events) => (
                  <RailFootTip label={themeLabel}>
                    <button
                      {...events}
                      type="button"
                      data-rail-theme
                      className="qoro-rail-item"
                      onClick={(event) => {
                        events?.onClick(event);
                        toggle();
                        // Enter e Espaço chegam com `detail` 0. No clique do mouse o
                        // foco não volta: reabriria a dica e poderia prender o trilho.
                        if (event.detail === 0) refocusThemeButton();
                      }}
                      aria-label={`${themeLabel}. Alternar tema`}
                    >
                      {icon}
                      <span className="qoro-rail-label">{themeLabel}</span>
                    </button>
                  </RailFootTip>
                )}
              </RailAnimated>
              {/* Logout é mutação: POST de formulário, nunca GET. O mesmo form
                  atende ao item do menu da conta, que vive num portal. */}
              <form id="painel-logout" action="/logout" method="post" hidden />
              <RailAnimated name="logout" size={24} fallback={<LogOut aria-hidden="true" />}>
                {(icon, events) => (
                  <RailFootTip label="Sair da conta">
                    <button
                      {...events}
                      type="submit"
                      form="painel-logout"
                      className="qoro-rail-item"
                    >
                      {icon}
                      <span className="qoro-rail-label">Sair</span>
                    </button>
                  </RailFootTip>
                )}
              </RailAnimated>
            </div>

            <div className="qoro-rail-user">
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
            </div>
          </div>

          <button
            ref={toggleButtonRef}
            type="button"
            className="qoro-rail-toggle"
            aria-label="Abrir navegação"
            aria-expanded={navOpen}
            onClick={() => setNavOpen((open) => !open)}
          >
            <Menu aria-hidden="true" className="size-5" />
          </button>
        </aside>
        <div className="qoro-rail-scrim" aria-hidden="true" onClick={closeNav} />

        <div className="qoro-panel" inert={navOpen}>
          <main
            id="qoro-main"
            tabIndex={-1}
            data-page-layout={pageLayout}
            className="w-full min-w-0 flex-1 px-(--page-px) pt-(--page-pt) pb-(--page-pb)"
          >
            {children}
          </main>
        </div>
        <Toaster />
      </div>
    </TooltipProvider>
  );
}
