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
  regionLabel,
  children,
  className,
}: {
  title: ReactNode;
  titleIcon?: ReactNode;
  /** Link de ação no canto (ex.: "Financeiro"). */
  action?: { label: string; href: string };
  /** Nota discreta no canto (ex.: "em breve"). */
  meta?: ReactNode;
  /**
   * Transforma o painel em landmark nomeado. O `<h4>` do título dá estrutura de
   * leitura, mas não cria região navegável: sem isto, quem usa leitor de tela
   * não consegue pular direto para o painel.
   *
   * É `string` e não derivado do `title` porque `title` é ReactNode e nem sempre
   * dá para transformar em texto.
   */
  regionLabel?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card
      {...(regionLabel ? { role: 'region', 'aria-label': regionLabel } : {})}
      className={cn('flex flex-col p-(--sp-4)', className)}
    >
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
          <span className="text-(length:--fs-2xs) tracking-(--tracking-label) text-fg-subtle uppercase">
            {meta}
          </span>
        ) : null}
      </div>
      {children}
    </Card>
  );
}
