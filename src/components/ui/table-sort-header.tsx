import { ChevronDown, ChevronUp } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { cn } from '@/lib/ui/cn';
import { TableHead } from './table';

/**
 * Cabeçalho ordenável dirigido por URL — DS v2 §tbl (th.sortable).
 * A page (RSC) monta o `href` com o próximo estado de ordenação; o clique é um
 * <Link> (sem estado cliente) e o Drizzle reordena no servidor.
 */
export function TableSortHeader({
  children,
  href,
  direction,
  numeric = false,
  className,
}: {
  children: ReactNode;
  /** URL com o próximo estado de sort (toggle asc/desc feito pela page). */
  href: string;
  /** Direção ATUAL desta coluna (null = não ordenada por ela). */
  direction: 'asc' | 'desc' | null;
  numeric?: boolean;
  className?: string;
}) {
  return (
    <TableHead
      numeric={numeric}
      aria-sort={direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : undefined}
      className={cn('p-0', className)}
    >
      <Link
        href={href}
        className="flex items-center gap-1.25 px-3.5 py-2.5 transition-colors select-none hover:text-fg"
      >
        {children}
        <span className="inline-flex flex-col" aria-hidden="true">
          <ChevronUp
            className={cn('-mb-1 size-3', direction === 'asc' ? 'opacity-100' : 'opacity-30')}
          />
          <ChevronDown
            className={cn('size-3', direction === 'desc' ? 'opacity-100' : 'opacity-30')}
          />
        </span>
      </Link>
    </TableHead>
  );
}
