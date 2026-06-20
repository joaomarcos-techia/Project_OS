'use client';

import {
  Activity,
  Building2,
  CreditCard,
  LayoutDashboard,
  MessageSquare,
  ScrollText,
  Settings,
  TrendingUp,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ComponentType } from 'react';

import { cn } from '@/lib/ui/cn';

type NavItem = { href: string; label: string; icon: ComponentType<{ className?: string }> };

/** Navegação do painel — espelha EXATAMENTE as rotas do brief (nada além). */
const ITEMS: readonly NavItem[] = [
  { href: '/admin', label: 'Visão geral', icon: LayoutDashboard },
  { href: '/admin/clinicas', label: 'Clínicas', icon: Building2 },
  { href: '/admin/billing', label: 'Billing', icon: CreditCard },
  { href: '/admin/conversas-ia', label: 'Conversas IA', icon: MessageSquare },
  { href: '/admin/metricas', label: 'Métricas', icon: TrendingUp },
  { href: '/admin/audit', label: 'Auditoria', icon: ScrollText },
  { href: '/admin/saude', label: 'Saúde', icon: Activity },
  { href: '/admin/config', label: 'Configurações', icon: Settings },
];

function isActive(pathname: string, href: string): boolean {
  if (href === '/admin') return pathname === '/admin';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5" aria-label="Navegação do painel">
      {ITEMS.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              active
                ? 'bg-primary-50 text-primary-700 dark:bg-primary-950 dark:text-primary-200'
                : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
