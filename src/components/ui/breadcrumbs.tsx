import Link from 'next/link';
import type { ReactNode } from 'react';

import { cn } from '@/lib/ui/cn';

export type Crumb = { label: ReactNode; href?: string };

/** Trilha de navegação — DS v2 §crumb (mono, discreta; último item é a página atual). */
export function Breadcrumbs({ items, className }: { items: Crumb[]; className?: string }) {
  if (items.length === 0) return null;
  return (
    <nav aria-label="Trilha de navegação" className={className}>
      <ol className="flex items-center gap-1.5 text-(length:--fs-xs) text-fg-subtle">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={i} className="flex items-center gap-1.5">
              {item.href && !last ? (
                // Alvo de 24 px (WCAG 2.5.8): a margem negativa compensa, e a linha não cresce.
                <Link
                  href={item.href}
                  className="-my-0.5 inline-flex min-h-6 items-center transition-colors hover:text-fg"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  aria-current={last ? 'page' : undefined}
                  className={cn(last && 'font-medium text-fg-muted')}
                >
                  {item.label}
                </span>
              )}
              {!last ? <span aria-hidden="true">/</span> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
