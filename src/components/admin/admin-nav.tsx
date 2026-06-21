'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Icon } from '@/components/painel/icons';

type NavItem = { href: string; label: string; icon: string };
type NavGroup = { group: string; items: readonly NavItem[] };

/** Navegação do console — espelha EXATAMENTE as rotas do brief (nada além),
 *  agrupadas como no shell do DS (`.mnav`/`.mnav-group-label`/`.mnav-item`). */
const GROUPS: readonly NavGroup[] = [
  {
    group: 'Operação',
    items: [
      { href: '/admin', label: 'Visão geral', icon: 'dashboard' },
      { href: '/admin/clinicas', label: 'Clínicas', icon: 'building' },
      { href: '/admin/billing', label: 'Pagamentos', icon: 'wallet' },
    ],
  },
  {
    group: 'Inteligência',
    items: [
      { href: '/admin/conversas-ia', label: 'Conversas IA', icon: 'chat' },
      { href: '/admin/metricas', label: 'Métricas', icon: 'chart' },
    ],
  },
  {
    group: 'Plataforma',
    items: [
      { href: '/admin/audit', label: 'Auditoria', icon: 'record' },
      { href: '/admin/saude', label: 'Saúde', icon: 'monitor' },
      { href: '/admin/config', label: 'Configurações', icon: 'gear' },
    ],
  },
];

function isActive(pathname: string, href: string): boolean {
  if (href === '/admin') return pathname === '/admin';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="mnav" aria-label="Navegação do console">
      {GROUPS.map(({ group, items }) => (
        <div key={group}>
          <span className="mnav-group-label">{group}</span>
          {items.map(({ href, label, icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`mnav-item${active ? ' active' : ''}`}
              >
                <span className="mi-ico">
                  <Icon name={icon} size={18} />
                </span>
                <span className="mi-label">{label}</span>
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
