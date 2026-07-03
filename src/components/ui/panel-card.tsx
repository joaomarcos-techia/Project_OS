import Link from 'next/link';
import type { ReactNode } from 'react';

import { Card } from '@/components/ui/card';
import { cn } from '@/lib/ui/cn';

/** Painel do dashboard — Card DS v2 com cabeçalho compacto + ação opcional. */
export function PanelCard({
  title,
  titleIcon,
  action,
  meta,
  children,
  className,
}: {
  title: ReactNode;
  titleIcon?: ReactNode;
  /** Link de ação no canto (ex.: "Financeiro"). */
  action?: { label: string; href: string };
  /** Nota discreta no canto (ex.: "em breve"). */
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn('flex flex-col p-(--sp-4)', className)}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h4 className="flex items-center gap-1.5 text-(length:--fs-sm) font-semibold [&>svg]:size-4 [&>svg]:text-fg-subtle">
          {titleIcon}
          {title}
        </h4>
        {action ? (
          <Link
            href={action.href}
            className="text-(length:--fs-xs) font-medium text-link hover:underline"
          >
            {action.label}
          </Link>
        ) : meta ? (
          <span className="font-mono text-(length:--fs-2xs) text-fg-subtle uppercase">{meta}</span>
        ) : null}
      </div>
      {children}
    </Card>
  );
}
