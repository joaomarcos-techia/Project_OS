import type { ComponentProps } from 'react';

import { cn } from '@/lib/ui/cn';

/**
 * Table kit — DS v2 (§tbl), RSC-first: componentes presentacionais puros.
 * Ordenação/paginação são dirigidas por URL (ver table-sort-header/table-pager);
 * o dado chega ordenado do Drizzle na page.
 */

/** Moldura da tabela (borda + raio + clip). */
export function TableWrap({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('overflow-hidden rounded-(--r-lg) border border-border bg-surface', className)}
      {...props}
    />
  );
}

/** Área com scroll horizontal para tabelas largas. */
export function TableScroll({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('overflow-x-auto', className)} {...props} />;
}

export function Table({ className, ...props }: ComponentProps<'table'>) {
  return (
    <table className={cn('w-full border-collapse text-(length:--fs-sm)', className)} {...props} />
  );
}

export function TableHeader({ className, ...props }: ComponentProps<'thead'>) {
  return <thead className={className} {...props} />;
}

export function TableHead({
  className,
  numeric = false,
  ...props
}: ComponentProps<'th'> & { numeric?: boolean }) {
  return (
    <th
      className={cn(
        'border-b border-border bg-(--table-header-bg) px-3.5 py-2.5 text-left text-(length:--fs-xs) font-semibold whitespace-nowrap text-fg-muted',
        numeric && 'text-right tabular-nums',
        className,
      )}
      {...props}
    />
  );
}

export function TableBody({ className, ...props }: ComponentProps<'tbody'>) {
  return <tbody className={cn('[&>tr:last-child>td]:border-b-0', className)} {...props} />;
}

export function TableRow({
  className,
  selected = false,
  ...props
}: ComponentProps<'tr'> & { selected?: boolean }) {
  return (
    <tr
      aria-selected={selected || undefined}
      className={cn(
        'transition-colors duration-(--dur-fast) hover:bg-surface-hover',
        selected &&
          'bg-(--primary-soft) hover:bg-[color-mix(in_oklch,var(--primary)_14%,var(--surface))]',
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({
  className,
  numeric = false,
  ...props
}: ComponentProps<'td'> & { numeric?: boolean }) {
  return (
    <td
      className={cn(
        'h-(--row-h) border-b border-border px-3.5 py-(--cell-py) align-middle',
        numeric && 'text-right tabular-nums',
        className,
      )}
      {...props}
    />
  );
}

/** Célula com linha principal + sublinha (`.cell-2`). */
export function TableCellStack({
  main,
  sub,
  className,
}: {
  main: React.ReactNode;
  sub?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-px', className)}>
      <span className="font-medium text-fg">{main}</span>
      {sub ? <span className="text-(length:--fs-xs) text-fg-subtle">{sub}</span> : null}
    </div>
  );
}

/** Rodapé da moldura (contagem + paginação). */
export function TableFoot({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 border-t border-border bg-surface-2 px-3.5 py-3',
        className,
      )}
      {...props}
    />
  );
}

export function TableFootInfo({ className, ...props }: ComponentProps<'span'>) {
  return <span className={cn('text-(length:--fs-xs) text-fg-subtle', className)} {...props} />;
}
