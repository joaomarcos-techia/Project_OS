'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { Icon, LogoIcon } from '@/components/painel/icons';

import { AdminNav } from './admin-nav';

/**
 * Chrome do Platform Admin (C15) — porte do `ClinicaOS - Admin (standalone).html`.
 * Reusa o shell do DS (.app/.sidebar/.topbar/.page do app-shell.css) com a
 * identidade do console: pill "ADMIN" + scope-mini "Plataforma" + selo ink, para
 * o fundador nunca confundir "estou no painel da plataforma" com "estou numa
 * clínica". Toda leitura pesada fica nas páginas; aqui só o chrome + tema.
 */
function SunIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}
function MoonIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}
function LogoutIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5M21 12H9" />
    </svg>
  );
}

export function AdminShell({ children }: { children: ReactNode }) {
  const [dark, setDark] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  const applyTheme = (d: boolean) => {
    const el = document.documentElement;
    el.setAttribute('data-theme', d ? 'dark' : 'light');
    el.classList.toggle('dark', d);
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

  useEffect(() => {
    document.body.classList.toggle('nav-open', navOpen);
  }, [navOpen]);

  return (
    <>
      <button className="menu-btn" aria-label="Abrir navegação" onClick={() => setNavOpen((v) => !v)}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
          <path d="M3 6h18M3 12h18M3 18h18" />
        </svg>
      </button>
      <div className="scrim" onClick={() => setNavOpen(false)} />

      <div className="app">
        {/* ============================ SIDEBAR ============================ */}
        <aside className="sidebar">
          <div className="brand-row">
            <LogoIcon size={24} />
            <span className="wordmark">
              Clinica<b>OS</b>
            </span>
            <span className="adm-pill">Admin</span>
          </div>

          <div className="scope-mini">
            <span className="sm-mark">
              <Icon name="shield" size={16} />
            </span>
            <span className="sm-id">
              <span className="sm-name">Plataforma</span>
              <span className="sm-sub">Console multi-tenant</span>
            </span>
          </div>

          <AdminNav />

          <div className="sidebar-foot">
            <button className="theme-toggle" aria-label="Alternar tema" onClick={toggleTheme}>
              <span className="sw">
                {dark ? <MoonIcon /> : <SunIcon />}
                <span>{dark ? 'Tema escuro' : 'Tema claro'}</span>
              </span>
              <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-3)' }}>
                ⌘\
              </span>
            </button>
            <form action="/logout" method="post">
              <button type="submit" className="theme-toggle" aria-label="Sair">
                <span className="sw">
                  <LogoutIcon />
                  <span>Sair</span>
                </span>
              </button>
            </form>
            <span className="mono" style={{ fontSize: 10, color: 'var(--text-3)', padding: '0 2px', lineHeight: 1.5 }}>
              super_admin — toda ação auditada.
            </span>
          </div>
        </aside>

        {/* ============================ CONTENT ============================ */}
        <main className="content">
          <div className="content-inner">
            <div className="page">{children}</div>
          </div>
        </main>
      </div>
    </>
  );
}
