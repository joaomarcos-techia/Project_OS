'use client';

import { usePathname } from 'next/navigation';

import { Icon } from '@/components/painel/icons';
import { SideNavGroupLabel, SideNavLink } from '@/components/shared/shell-chrome';

type NavItem = { href: string; label: string; icon: string };
type NavGroup = { group: string; items: readonly NavItem[] };

/** Navegação do console — espelha EXATAMENTE as rotas existentes (nada além). */
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
    <nav className="flex-1 px-(--sp-3)" aria-label="Navegação do console">
      {GROUPS.map(({ group, items }) => (
        <div key={group} className="mt-(--sp-4) first:mt-(--sp-2)">
          <SideNavGroupLabel>{group}</SideNavGroupLabel>
          {items.map(({ href, label, icon }) => (
            <SideNavLink
              key={href}
              href={href}
              active={isActive(pathname, href)}
              icon={<Icon name={icon} />}
              label={label}
            />
          ))}
        </div>
      ))}
    </nav>
  );
}
