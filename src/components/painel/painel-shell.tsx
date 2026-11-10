'use client';

import Link, { useLinkStatus } from 'next/link';
import { usePathname } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useId,
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

/** Elementos que recebem foco por Tab dentro da gaveta do celular. */
const FOCUSABLE =
  'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"]), input, select, textarea';

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
 * Mostra que a troca de tela começou. Algumas rotas levam mais de 1 s para
 * responder e, sem isto, o clique parecia não ter sido aceito.
 */
function RailPending() {
  const { pending } = useLinkStatus();
  return pending ? <span className="qoro-rail-pending" aria-hidden="true" /> : null;
}

function conversationsWaiting(count: number): string {
  return `${count} ${count === 1 ? 'conversa aguardando atendimento' : 'conversas aguardando atendimento'}`;
}

/**
 * Chrome do app da clínica — Qoro App v5 (novembro/2026).
 *
 * O menu fica sobre o fundo do app, fora do painel branco de conteúdo:
 * trilho de 72 px só com ícones, que abre por cima ao passar o mouse (com um
 * instante de intenção, para não abrir ao cruzar a borda) ou focar pelo
 * teclado, e que o usuário pode fixar aberto (216 px, empurra o painel). Os
 * grupos têm título: aberto, o nome; recolhido, um traço no mesmo espaço, então
 * nada pula de lugar ao abrir.
 *
 * No celular o topo é só a marca, a clínica e o botão "Menu"; a navegação
 * inteira, com títulos, tema, conta e Sair, abre numa gaveta que prende o foco,
 * fecha com Esc, na máscara ou ao trocar de tela, e devolve o foco ao botão.
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
  allowedModuleIds,
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
  /**
   * Módulos que a pessoa consegue abrir (`visibleModuleIds`). Ausente, mostra
   * todos — o gate de cada página continua valendo de qualquer forma.
   */
  allowedModuleIds?: readonly string[];
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
  const idBase = useId();
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

  // Depois de escolher um destino no menu aberto por cima, ele recolhe mesmo com
  // o mouse ainda em cima: senão o painel ficava cobrindo a esquerda da tela nova
  // até a pessoa tirar o ponteiro dali. Volta a abrir quando o ponteiro sai e
  // entra de novo, ou com qualquer tecla dentro do menu.
  const railRef = useRef<HTMLElement>(null);
  const [peekOff, setPeekOff] = useState(false);
  const lastPathname = useRef(pathname);
  useEffect(() => {
    if (lastPathname.current === pathname) return;
    lastPathname.current = pathname;
    const rail = railRef.current;
    if (!rail) return;
    let engaged = rail.matches(':hover');
    try {
      engaged ||= rail.matches(':has(:focus-visible)');
    } catch {
      // Navegador sem `:has()` em `matches`: fica só o caso do mouse.
    }
    if (engaged) setPeekOff(true);
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
      if (event.key === 'Escape' && !event.defaultPrevented) {
        closeNav();
        return;
      }
      // Prende o Tab na gaveta: o painel por trás está `inert`, mas o link de
      // pular conteúdo e o fim do documento ainda receberiam o foco.
      const drawer = railInnerRef.current;
      if (event.key !== 'Tab' || !drawer || !drawer.contains(document.activeElement)) return;
      const focusables = Array.from(drawer.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.getClientRects().length > 0,
      );
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
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
  const visibleModules = MODULES.filter(
    (m) => !m.soon && m.href && (!allowedModuleIds || allowedModuleIds.includes(m.id)),
  );
  const visibleGroups = GROUPS.filter((group) => visibleModules.some((m) => m.group === group));
  const handoffText = handoffCount > 9 ? '9+' : String(handoffCount);
  const showHandoff =
    handoffCount > 0 && visibleModules.some((module) => module.id === 'conversas');

  return (
    <TooltipProvider delayDuration={300}>
      <div data-qoro-shell="tenant" className="qoro-app" data-nav-open={navOpen ? 'true' : 'false'}>
        <a className="qoro-skip-link" href="#qoro-main">
          Pular para o conteúdo
        </a>

        <aside
          ref={railRef}
          data-slot="tenant-rail"
          className="qoro-rail"
          data-peek={peekOff ? 'off' : undefined}
          onPointerLeave={peekOff ? () => setPeekOff(false) : undefined}
          onKeyDown={peekOff ? () => setPeekOff(false) : undefined}
        >
          <div
            ref={railInnerRef}
            className="qoro-rail-inner"
            {...(navOpen ? { role: 'dialog', 'aria-modal': true, 'aria-label': 'Navegação' } : {})}
          >
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
              {visibleGroups.map((group, index) => {
                const headingId = `${idBase}-grupo-${index}`;
                return (
                  <div
                    key={group}
                    role="group"
                    aria-labelledby={headingId}
                    data-nav-group={group}
                    className="qoro-rail-group"
                  >
                    <span className="qoro-rail-heading">
                      <span id={headingId} className="qoro-rail-heading-text qoro-rail-label">
                        {group}
                      </span>
                    </span>
                    {visibleModules
                      .filter((m) => m.group === group)
                      .map((m) => {
                        const href = m.id === 'config' ? settingsHref : m.href!;
                        const withCount = m.id === 'conversas' && showHandoff;
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
                                {withCount ? (
                                  <>
                                    {/* Um número só para leitura; o ponto sobre o
                                    ícone é a cópia visual do trilho recolhido. */}
                                    <span
                                      className="qoro-rail-count qoro-rail-label"
                                      aria-label={conversationsWaiting(handoffCount)}
                                    >
                                      {handoffText}
                                    </span>
                                    <span className="qoro-rail-dot" aria-hidden="true">
                                      {handoffText}
                                    </span>
                                  </>
                                ) : null}
                                <RailPending />
                              </Link>
                            )}
                          </RailAnimated>
                        );
                      })}
                  </div>
                );
              })}
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
            {...(showHandoff ? { 'aria-describedby': `${idBase}-pendentes` } : {})}
            // Aberta, a gaveta cobre o botão: ele sai da ordem de foco.
            inert={navOpen}
            onClick={() => setNavOpen((open) => !open)}
          >
            <Menu aria-hidden="true" className="size-5" />
            <span className="qoro-rail-toggle-text" aria-hidden="true">
              Menu
            </span>
            {showHandoff ? (
              <span className="qoro-rail-toggle-count" aria-hidden="true">
                {handoffText}
              </span>
            ) : null}
          </button>
          {showHandoff ? (
            <span id={`${idBase}-pendentes`} hidden>
              {conversationsWaiting(handoffCount)}
            </span>
          ) : null}
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
