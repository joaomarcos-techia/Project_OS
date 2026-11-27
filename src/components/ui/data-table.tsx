import type { ReactNode } from 'react';

import { cn } from '@/lib/ui/cn';

import { Table, TableFoot, TableFootInfo, TableScroll, TableWrap } from './table';
import { TablePager } from './table-pager';

const nf = new Intl.NumberFormat('pt-BR');

/**
 * Moldura de uma tabela paginada — o que toda listagem repetia à mão.
 *
 * NÃO recebe `columns`/`rows`: o conteúdo continua sendo `<TableHeader>` e
 * `<TableBody>` escritos na página, porque cada listagem formata célula de um
 * jeito e uma API declarativa viraria um componente de trinta props. O que a
 * moldura resolve é o cerco — scroll, rodapé, contagem e paginação — que era
 * copiado em cada rota com contagem escrita de forma diferente em cada uma.
 */
export function DataTable({
  children,
  total,
  page,
  pageCount,
  pageSize,
  unit,
  hrefFor,
  empty,
  hint,
  title,
  description,
  className,
}: {
  children: ReactNode;
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  /** Singular e plural do que está sendo listado. */
  unit: { one: string; many: string };
  hrefFor: (page: number) => string;
  /** Renderizado no lugar da tabela quando não há linhas. */
  empty?: ReactNode;
  /** Texto de apoio no rodapé, à direita da contagem (ex.: como refinar a busca). */
  hint?: ReactNode;
  /** Cabeçalho de cartão acima da tabela (app v5). */
  title?: ReactNode;
  /** Apoio à direita do cabeçalho (ex.: contagem e ordenação). */
  description?: ReactNode;
  className?: string;
}) {
  const head = title ? (
    <div data-slot="table-head">
      <h2>{title}</h2>
      {description ? <p>{description}</p> : null}
    </div>
  ) : null;

  if (total === 0 && empty) {
    return (
      <TableWrap className={className}>
        {head}
        {empty}
      </TableWrap>
    );
  }

  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <TableWrap className={className}>
      {head}
      <TableScroll>
        <Table>{children}</Table>
      </TableScroll>
      <TableFoot>
        <TableFootInfo className="tabular-nums">
          {nf.format(first)}–{nf.format(last)} de {nf.format(total)}{' '}
          {total === 1 ? unit.one : unit.many}
        </TableFootInfo>
        {/* O hint cede a vez ao paginador: com mais de uma página, "como buscar"
            é ruído ao lado dos controles que o operador veio usar. */}
        {pageCount > 1 ? (
          <TablePager page={page} pageCount={pageCount} hrefFor={hrefFor} />
        ) : hint ? (
          <span className="ml-auto text-(length:--fs-caption) text-fg-subtle">{hint}</span>
        ) : null}
      </TableFoot>
    </TableWrap>
  );
}

/** Coluna de ações no fim da linha — largura fixa, sem cabeçalho visível. */
export function TableActionsCell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn('flex items-center justify-end gap-1', className)}>{children}</div>;
}
