import type { ReactNode } from 'react';

import { cn } from '@/lib/ui/cn';

/** Cabeçalho de página — estrutura do Design System (`page-head` / `ph-title` / `ph-desc` / `ph-actions`). */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('page-head', className)}>
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
