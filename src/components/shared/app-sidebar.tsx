'use client';

import {
  Banknote,
  Calendar,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  ShieldCheck,
  Stethoscope,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/ui/cn';
import { ThemeToggle } from './theme-toggle';

type NavItem = { href: string; label: string; icon: LucideIcon; soon?: boolean };
type NavGroup = { label: string; items: NavItem[] };

// Itens `soon` mostram a forma do produto sem linkar para rotas inexistentes —
// viram links reais conforme cada camada (C8 Consultório, C9 Financeiro, …) chega.
const GROUPS: NavGroup[] = [
  {
    label: 'Operação',
    items: [
      { href: '/dashboard', label: 'Visão geral', icon: LayoutDashboard },
      { href: '/pacientes', label: 'Pacientes', icon: Users },
      { href: '/agenda', label: 'Agenda', icon: Calendar, soon: true },
      { href: '/consultorio', label: 'Consultório', icon: Stethoscope },
      { href: '/caixa', label: 'Caixa', icon: Banknote },
      { href: '/financeiro', label: 'Financeiro', icon: Wallet },
      { href: '/conversas', label: 'Conversas', icon: MessageSquare, soon: true },
    ],
  },
  {
    label: 'Conta',
    items: [{ href: '/account/security', label: 'Segurança', icon: ShieldCheck }],
  },
];

export function AppSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col gap-5 px-4 pb-8 pt-6">
      <div className="flex items-center gap-2.5 px-2">
        <span className="text-[17px] font-semibold tracking-[-0.02em]">
          Clinica<b className="font-bold text-primary-600">OS</b>
        </span>
        <span className="rounded-full border border-border px-[7px] py-0.5 font-mono text-[10px] text-fg-subtle">
          v2.0
        </span>
      </div>

      <nav className="flex flex-col gap-0.5">
        {GROUPS.map((group) => (
          <div key={group.label} className="flex flex-col gap-px">
            <span className="px-3 pb-1 pt-3 font-mono text-[10.5px] font-medium uppercase tracking-[0.09em] text-fg-subtle">
              {group.label}
            </span>
            {group.items.map((item) => {
              const Icon = item.icon;
              if (item.soon) {
                return (
                  <span
                    key={item.href}
                    aria-disabled="true"
                    className="flex cursor-not-allowed items-center gap-2.5 rounded-md px-3 py-[7px] text-[13.5px] text-fg-subtle/70"
                  >
                    <Icon className="size-4 shrink-0" />
                    <span className="flex-1">{item.label}</span>
                    <span className="font-mono text-[9.5px] uppercase tracking-wide">em breve</span>
                  </span>
                );
              }
              const active = pathname === item.href || pathname.startsWith(item.href + '/');
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => onNavigate?.()}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-2.5 rounded-md px-3 py-[7px] text-[13.5px] transition-colors',
                    active
                      ? 'bg-primary-50 font-medium text-primary-700 dark:bg-primary-600/15 dark:text-primary-300'
                      : 'text-fg-muted hover:bg-surface-inset hover:text-fg',
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="mt-auto flex flex-col gap-2 px-1">
        <ThemeToggle />
        <form action="/logout" method="post">
          <button
            type="submit"
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-[13px] text-fg-muted transition-colors hover:bg-surface-inset hover:text-fg"
          >
            <LogOut className="size-4" /> Sair
          </button>
        </form>
      </div>
    </div>
  );
}
