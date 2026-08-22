'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';

import { Button } from '@/components/ui/button';

export const LOCAL_PAGE_SIZE = 10;

export function paginateLocally<T>(items: T[], requestedPage: number, pageSize = LOCAL_PAGE_SIZE) {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(Math.max(requestedPage, 1), pageCount);
  const firstIndex = (page - 1) * pageSize;
  const visibleItems = items.slice(firstIndex, firstIndex + pageSize);

  return {
    page,
    pageCount,
    visibleItems,
    firstItem: items.length === 0 ? 0 : firstIndex + 1,
    lastItem: Math.min(firstIndex + pageSize, items.length),
  };
}

export function LocalPager({
  label,
  page,
  pageCount,
  onPageChange,
}: {
  label: string;
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
}) {
  if (pageCount <= 1) return null;

  return (
    <nav aria-label={`Paginação de ${label}`} className="flex items-center gap-1">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        icon
        aria-label={`Página anterior de ${label}`}
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        <ChevronLeft aria-hidden="true" className="size-4" />
      </Button>
      <span
        aria-live="polite"
        className="min-w-16 text-center text-(length:--fs-xs) text-fg-subtle tabular-nums"
      >
        {page} / {pageCount}
      </span>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        icon
        aria-label={`Próxima página de ${label}`}
        disabled={page >= pageCount}
        onClick={() => onPageChange(page + 1)}
      >
        <ChevronRight aria-hidden="true" className="size-4" />
      </Button>
    </nav>
  );
}
