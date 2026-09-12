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
  meta,
  breadcrumb,
  crumbs,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /**
   * Contexto de leitura — "12 consultas", "atualizado 14:02", o fuso da clínica.
   *
   * Vive na LINHA DO TÍTULO, atrás de um filete, e não no cluster de ações: é
   * informação, não affordance, e encostado nos botões o texto mudo lia como
   * botão desabilitado. Atrás do filete ele fica colado no assunto que mede.
   */
  meta?: ReactNode;
  breadcrumb?: ReactNode;
  crumbs?: Crumb[];
  className?: string;
}) {
  return (
    <div data-slot="page-header" className={cn('mb-(--sp-5)', className)}>
      {crumbs ? (
        <Breadcrumbs items={crumbs} className="mb-(--sp-3)" />
      ) : breadcrumb ? (
        <div className="mb-(--sp-3) flex items-center gap-2 text-(length:--fs-2xs) text-fg-subtle [&_.sep]:opacity-50 [&_b]:font-medium [&_b]:text-fg-muted">
          {breadcrumb}
        </div>
      ) : null}
      {/* items-start: com descrição de duas linhas, alinhar pelo fim jogava o
          cluster de ações para baixo e desalinhava do título, que é a âncora
          visual da linha na referência. */}
      <div
        data-slot="page-header-row"
        className="flex flex-wrap items-start justify-between gap-(--sp-4)"
      >
        <div data-slot="page-header-copy" className="min-w-0">
          <h1 className="text-balance font-display text-(length:--fs-page) font-semibold tracking-tight">
            {title}
          </h1>
          {description ? (
            <p className="mt-1.5 max-w-160 text-pretty text-(length:--fs-base) text-fg-muted">
              {description}
            </p>
          ) : null}
          {meta ? (
            <span
              data-slot="page-header-meta"
              className="mt-1.5 block text-(length:--fs-body-sm) text-fg-subtle"
            >
              {meta}
            </span>
          ) : null}
        </div>
        {actions ? (
          <div data-slot="page-header-actions" className="flex flex-wrap items-center gap-(--sp-4)">
            <div className="flex flex-wrap items-center gap-(--sp-2)">{actions}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
