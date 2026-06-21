import type { ReactNode } from 'react';

import { cn } from '@/lib/ui/cn';

/**
 * Cabeçalho de página — estrutura do Design System (`page-head` / `ph-crumb` /
 * `ph-title` / `ph-desc` / `ph-actions`). `breadcrumb` (opcional) renderiza a
 * trilha `.ph-crumb` acima do título, como no dashboard de referência.
 */
export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumb?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('page-head', className)}>
      {breadcrumb ? <div className="ph-crumb">{breadcrumb}</div> : null}
      <div className="ph-title-row">
        <div>
          <h1 className="ph-title">{title}</h1>
          {description ? <p className="ph-desc">{description}</p> : null}
        </div>
        {actions ? <div className="ph-actions">{actions}</div> : null}
      </div>
    </div>
  );
}
