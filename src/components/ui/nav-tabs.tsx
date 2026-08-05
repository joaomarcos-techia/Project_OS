'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

import { cn } from '@/lib/ui/cn';

export type NavTab = {
  label: string;
  href: string;
  /** true = ativa só com pathname idêntico (default: prefixo de rota). */
  exact?: boolean;
};

function isActive(pathname: string, search: URLSearchParams, tab: NavTab): boolean {
  const [path, query] = tab.href.split('?');
  if (!path) return false;
  const pathOk = tab.exact
    ? pathname === path
    : pathname === path || pathname.startsWith(`${path}/`);
  if (!pathOk) return false;
  if (!query) return true;
  const params = new URLSearchParams(query);
  for (const [k, v] of params) if (search.get(k) !== v) return false;
  return true;
}

/**
 * Tabs de navegação entre subrotas/query params — DS v2 §tabs em cima de
 * <Link> + usePathname (RSC continua dono do fetch de cada subrota).
 */
export function NavTabs({ tabs, className }: { tabs: NavTab[]; className?: string }) {
  const pathname = usePathname();
  const search = useSearchParams();
  return (
    <nav className={cn('flex gap-0.5 border-b border-border', className)}>
      {tabs.map((tab) => {
        const active = isActive(pathname, search, tab);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative px-3.5 py-2.5 text-(length:--fs-sm) font-medium transition-colors duration-(--dur-fast)',
              'after:absolute after:right-2 after:-bottom-px after:left-2 after:h-0.5 after:bg-primary after:transition-opacity',
              active
                ? 'text-primary after:opacity-100'
                : 'text-fg-muted after:opacity-0 hover:text-fg',
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
