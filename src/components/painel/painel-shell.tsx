'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { Icon, LogoIcon } from './icons';
import { GROUPS, MODULES } from './modules';

function SunIcon({ size = 19 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}
function MoonIcon({ size = 19 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}

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
  const [dark, setDark] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  const applyTheme = (d: boolean) => {
    const el = document.documentElement;
    el.setAttribute('data-theme', d ? 'dark' : 'light'); // ds.css/app-shell.css
    el.classList.toggle('dark', d); // globals.css (telas Tailwind existentes)
  };

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem('clinicaos-theme');
    } catch {
      /* ignore */
    }
    const isDark = saved === 'dark';
    applyTheme(isDark);
    setDark(isDark);
  }, []);

  const toggleTheme = useCallback(() => {
    setDark((prev) => {
      const next = !prev;
      applyTheme(next);
      try {
        localStorage.setItem('clinicaos-theme', next ? 'dark' : 'light');
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault();
        toggleTheme();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [toggleTheme]);

  // fecha o drawer mobile ao trocar de rota
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    document.body.classList.toggle('nav-open', navOpen);
  }, [navOpen]);

  const isActive = (href?: string) =>
    !!href && (pathname === href || pathname.startsWith(href + '/'));

  const userInitials = userName
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <>
      <button className="menu-btn" id="menuBtn" aria-label="Abrir navegação" onClick={() => setNavOpen((v) => !v)}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
          <path d="M3 6h18M3 12h18M3 18h18" />
        </svg>
      </button>
      <div className="scrim" id="scrim" onClick={() => setNavOpen(false)} />

      <div className="app">
        {/* ============================ SIDEBAR ============================ */}
        <aside className="sidebar" id="sidebar">
          <div className="brand-row">
            <LogoIcon size={24} />
            <span className="wordmark">
              Clinica<b>OS</b>
            </span>
            <span className="ver-pill">v2.0</span>
          </div>

          <div className="clinic-mini">
            <span className="cm-mark">
              <LogoIcon size={17} strong="#fff" soft="rgba(255,255,255,.55)" />
            </span>
            <span className="cm-id">
              <span className="cm-name">{clinicName}</span>
              {clinicPlan ? <span className="cm-plan">{clinicPlan}</span> : null}
            </span>
            <span className="cm-chev">
              <Icon name="chevD" size={15} />
            </span>
          </div>

          <nav className="mnav" aria-label="Navegação principal">
            {GROUPS.map((g) => {
              const mods = MODULES.filter((m) => m.group === g);
              if (!mods.length) return null;
              return (
                <div key={g}>
                  <span className="mnav-group-label">{g}</span>
                  {mods.map((m) => {
                    const active = isActive(m.href);
                    const inner = (
                      <>
                        <span className="mi-ico">
                          <Icon name={m.icon} size={18} />
                        </span>
                        <span className="mi-label">{m.label}</span>
                        {m.soon ? (
                          <span className="mono" style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-3)' }}>
                            em breve
                          </span>
                        ) : m.badge ? (
                          <span className="mi-badge">{m.badge}</span>
                        ) : null}
                      </>
                    );
                    if (m.soon || !m.href) {
                      return (
                        <span
                          key={m.id}
                          className="mnav-item"
                          aria-disabled="true"
                          style={{ cursor: 'not-allowed', opacity: 0.7 }}
                        >
                          {inner}
                        </span>
                      );
                    }
                    return (
                      <Link key={m.id} href={m.href} className={`mnav-item${active ? ' active' : ''}`} aria-current={active ? 'page' : undefined}>
                        {inner}
                      </Link>
                    );
                  })}
                </div>
              );
            })}
          </nav>

          <div className="sidebar-foot">
            <button className="theme-toggle" aria-label="Alternar tema" onClick={toggleTheme}>
              <span className="sw">
                {dark ? <MoonIcon size={15} /> : <SunIcon size={15} />}
                <span>{dark ? 'Tema escuro' : 'Tema claro'}</span>
              </span>
              <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-3)' }}>
                ⌘\
              </span>
            </button>
            <span className="mono" style={{ fontSize: 10, color: 'var(--text-3)', padding: '0 2px', lineHeight: 1.5 }}>
              ClinicaOS — operação sem vazamento.
            </span>
          </div>
        </aside>

        {/* ============================ CONTENT ============================ */}
        <main className="content">
          <div className="content-inner">
            <header className="topbar">
              <div className="tb-search">
                <div className="input-wrap">
                  <Icon name="search" size={16} />
                  <input className="input" placeholder="Buscar pacientes, agenda, faturas…" />
                  <kbd>⌘K</kbd>
                </div>
              </div>
              <div className="tb-spacer" />
              <div className="tb-right">
                <button className="tb-icon-btn" aria-label="Alternar tema" onClick={toggleTheme}>
                  {dark ? <MoonIcon /> : <SunIcon />}
                </button>
                <button className="tb-icon-btn" aria-label="Notificações">
                  <span className="nd" />
                  <Icon name="bell" size={19} />
                </button>
                <span className="tb-divider" />
                <button className="tb-user">
                  <span className="avatar" data-name={userInitials} />
                  <span className="tu-id">
                    <span className="tu-name">{userName}</span>
                    {userRole ? <span className="tu-role">{userRole}</span> : null}
                  </span>
                  <Icon name="chevD" size={15} />
                </button>
              </div>
            </header>

            <div className="page">{children}</div>
          </div>
        </main>
      </div>
    </>
  );
}
