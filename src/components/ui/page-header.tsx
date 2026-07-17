import type { ReactNode } from 'react';

import { cn } from '@/lib/ui/cn';
import { Breadcrumbs, type Crumb } from './breadcrumbs';

/**
 * Cabeçalho de página — DS v2 em Tailwind. `crumbs` (array) usa o componente
 * Breadcrumbs; `breadcrumb` (ReactNode) permanece por compat com telas antigas
 * que montam a trilha manualmente.
 */
export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
  crumbs,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumb?: ReactNode;
  crumbs?: Crumb[];
  className?: string;
}) {
  return (
    <div className={cn('mb-(--sp-5)', className)}>
      {crumbs ? (
        <Breadcrumbs items={crumbs} className="mb-(--sp-3)" />
      ) : breadcrumb ? (
        <div className="mb-(--sp-3) flex items-center gap-1.75 font-mono text-[11px] text-fg-subtle [&_.sep]:opacity-50 [&_b]:font-medium [&_b]:text-fg-muted">
          {breadcrumb}
        </div>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-(--sp-4)">
        <div className="min-w-0">
          <h1 className="font-display text-[27px] font-semibold tracking-tight">
            {title}
          </h1>
          {description ? (
            <p className="mt-1.25 max-w-160 text-[14.5px] text-fg-muted">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-(--sp-2)">{actions}</div> : null}
      </div>
    </div>
  );
}
