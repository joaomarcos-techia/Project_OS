import type { ReactNode } from 'react';

import { cn } from '@/lib/ui/cn';
import { Breadcrumbs, type Crumb } from './breadcrumbs';

/**
 * Cabeçalho de página — DS v2 em Tailwind. `crumbs` (array) usa o componente
 * Breadcrumbs; `breadcrumb` (ReactNode) permanece por compat com telas antigas
 * que montam a trilha manualmente.
 *
 * As opções `headline`, `icon`, `search` e `controls` existem para o app v5 da
 * clínica, cujas telas têm uma barra superior (nome da tela, busca, ações) e uma
 * faixa de título (título contextual, controles). Sem elas o markup é o mesmo de
 * sempre, que é o que o /admin usa.
 */
export function PageHeader({
  title,
  description,
  actions,
  meta,
  breadcrumb,
  crumbs,
  className,
  headline,
  icon,
  search,
  controls,
  leading,
  titleAside,
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
  /**
   * Título contextual da faixa grande ("Novembro de 2026"). Quando presente,
   * `title` — o nome da tela, que continua sendo o `<h1>` — sobe para a barra
   * superior, e este texto ganha a aparência de título sem disputar o heading.
   */
  headline?: ReactNode;
  /** Ícone ao lado do nome da tela na barra superior; só vale com `headline`. */
  icon?: ReactNode;
  /** Busca da tela, na barra superior. */
  search?: ReactNode;
  /** Controles da faixa de título, à direita (ex.: filtros segmentados). */
  controls?: ReactNode;
  /** Bloco de destaque (ficha): avatar à esquerda do título, dentro de um cartão. */
  leading?: ReactNode;
  /** Ao lado do título, na mesma linha (ex.: situação do cadastro). */
  titleAside?: ReactNode;
}) {
  const heading = (
    <h1 className="text-balance font-display text-(length:--fs-page) font-semibold tracking-tight">
      {title}
    </h1>
  );
  return (
    <div
      data-slot="page-header"
      data-hero={leading ? 'true' : undefined}
      className={cn('mb-(--sp-5)', className)}
    >
      {crumbs ? (
        <Breadcrumbs items={crumbs} className="mb-(--sp-3)" />
      ) : breadcrumb ? (
        <div className="mb-(--sp-3) flex items-center gap-2 text-(length:--fs-2xs) text-fg-subtle [&_.sep]:opacity-50 [&_b]:font-medium [&_b]:text-fg-muted">
          {breadcrumb}
        </div>
      ) : null}
      {headline ? (
        <h1 data-slot="page-header-screen" className="flex items-center gap-2 font-semibold">
          {icon}
          {title}
        </h1>
      ) : null}
      {search ? <div data-slot="page-header-search">{search}</div> : null}
      {/* items-start: com descrição de duas linhas, alinhar pelo fim jogava o
          cluster de ações para baixo e desalinhava do título, que é a âncora
          visual da linha na referência. */}
      <div
        data-slot="page-header-row"
        className="flex flex-wrap items-start justify-between gap-(--sp-4)"
      >
        <div data-slot="page-header-copy" className="min-w-0">
          {leading ? <div data-slot="page-header-leading">{leading}</div> : null}
          {headline ? (
            <p
              data-slot="page-header-headline"
              className="text-balance font-display text-(length:--fs-page) font-semibold tracking-tight"
            >
              {headline}
            </p>
          ) : titleAside ? (
            <div data-slot="page-header-title-row" className="flex flex-wrap items-center gap-3">
              {heading}
              {titleAside}
            </div>
          ) : (
            heading
          )}
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
      {controls ? (
        <div data-slot="page-header-controls" className="flex flex-wrap items-center gap-2">
          {controls}
        </div>
      ) : null}
    </div>
  );
}
