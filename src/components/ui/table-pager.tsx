import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';

import { cn } from '@/lib/ui/cn';

const btn = cn(
  'inline-flex h-7.5 min-w-7.5 items-center justify-center rounded-(--r-sm) px-2 text-(length:--fs-sm) tabular-nums',
  'text-fg-muted transition-all duration-(--dur-fast) hover:bg-surface-hover hover:text-fg',
);

/**
 * Paginação dirigida por URL — DS v2 §pager. `hrefFor(page)` é montado pela
 * page (RSC) preservando os searchParams; sem estado cliente.
 */
export function TablePager({
  page,
  pageCount,
  hrefFor,
  className,
}: {
  page: number;
  pageCount: number;
  hrefFor: (page: number) => string;
  className?: string;
}) {
  if (pageCount <= 1) return null;

  // Janela: 1 … (p-1) p (p+1) … N
  const pages: (number | '…')[] = [];
  for (let i = 1; i <= pageCount; i++) {
    if (i === 1 || i === pageCount || Math.abs(i - page) <= 1) {
      pages.push(i);
    } else if (pages[pages.length - 1] !== '…') {
      pages.push('…');
    }
  }

  return (
    <nav aria-label="Paginação" className={cn('inline-flex gap-0.75', className)}>
      {page > 1 ? (
        <Link href={hrefFor(page - 1)} aria-label="Página anterior" className={btn}>
          <ChevronLeft className="size-4" />
        </Link>
      ) : (
        <span aria-hidden="true" className={cn(btn, 'pointer-events-none opacity-40')}>
          <ChevronLeft className="size-4" />
        </span>
      )}
      {pages.map((p, i) =>
        p === '…' ? (
          <span key={`e${i}`} aria-hidden="true" className={cn(btn, 'pointer-events-none')}>
            …
          </span>
        ) : (
          <Link
            key={p}
            href={hrefFor(p)}
            aria-current={p === page ? 'page' : undefined}
            className={cn(
              btn,
              p === page && 'bg-primary text-on-primary hover:bg-primary hover:text-on-primary',
            )}
          >
            {p}
          </Link>
        ),
      )}
      {page < pageCount ? (
        <Link href={hrefFor(page + 1)} aria-label="Próxima página" className={btn}>
          <ChevronRight className="size-4" />
        </Link>
      ) : (
        <span aria-hidden="true" className={cn(btn, 'pointer-events-none opacity-40')}>
          <ChevronRight className="size-4" />
        </span>
      )}
    </nav>
  );
}
