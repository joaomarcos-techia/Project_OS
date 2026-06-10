import type { ReactNode } from 'react';

import { cn } from '@/lib/ui/cn';

/** Empty state — classe do Design System (`ds.css` `.empty` + `.em-ico`). */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('empty', className)}>
      {icon ? <span className="em-ico">{icon}</span> : null}
      <b>{title}</b>
      {description ? <p>{description}</p> : null}
      {action ? <div style={{ marginTop: 'var(--sp-3)' }}>{action}</div> : null}
    </div>
  );
}
