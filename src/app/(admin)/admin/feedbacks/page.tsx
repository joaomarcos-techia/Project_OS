import { Search } from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { fieldControlClassName } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableCellStack,
  TableFoot,
  TableFootInfo,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
  TableWrap,
} from '@/components/ui/table';
import { TablePager } from '@/components/ui/table-pager';
import { TableToolbar } from '@/components/ui/table-toolbar';
import { cn } from '@/lib/ui/cn';

import { Bars } from '../_components/charts';
import { StatCard } from '../_components/stat-card';
import { guardAdminAccess } from '../_lib/guard';
import { formatDateTime, formatNumber } from '../_lib/format';
import { PanelCard } from '@/components/ui/panel-card';
import { Card } from '@/components/ui/card';
import {
  getFeedbackMetrics,
  isFeedbackCategory,
  isFeedbackOrder,
  isFeedbackStatus,
  listFeedback,
  type FeedbackCategoryFilter,
  type FeedbackStatusFilter,
} from '../_lib/repositories/feedback.repo';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  received: 'Recebido',
  under_review: 'Em análise',
  planned: 'Planejado',
  in_development: 'Em desenvolvimento',
  completed: 'Concluído',
  rejected: 'Recusado',
  archived: 'Arquivado',
};
const CATEGORY_LABEL: Record<string, string> = {
  feature: 'Funcionalidade',
  improvement: 'Melhoria',
  bug: 'Problema',
  other: 'Outro',
};
const STATUS_TONE: Record<string, 'gray' | 'blue' | 'amber' | 'green' | 'red' | 'violet'> = {
  received: 'gray',
  under_review: 'blue',
  planned: 'violet',
  in_development: 'amber',
  completed: 'green',
  rejected: 'red',
  archived: 'gray',
};

type SearchParams = {
  q?: string | undefined;
  status?: string | undefined;
  category?: string | undefined;
  clinic?: string | undefined;
  user?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  order?: string | undefined;
  page?: string | undefined;
};

function parseDay(value: string | undefined, endExclusive = false): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return undefined;
  if (endExclusive) parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed;
}

function queryFor(params: SearchParams, overrides: Partial<SearchParams>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...params, ...overrides }))
    if (value) query.set(key, value);
  const text = query.toString();
  return text ? `?${text}` : '';
}

export default async function FeedbacksPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await guardAdminAccess();
  const params = await searchParams;
  const status: FeedbackStatusFilter | undefined = isFeedbackStatus(params.status)
    ? params.status
    : undefined;
  const category: FeedbackCategoryFilter | undefined = isFeedbackCategory(params.category)
    ? params.category
    : undefined;
  const order = isFeedbackOrder(params.order) ? params.order : 'newest';
  const [result, metrics] = await Promise.all([
    listFeedback({
      status,
      category,
      query: params.q,
      clinicQuery: params.clinic,
      userQuery: params.user,
      createdFrom: parseDay(params.from),
      createdBefore: parseDay(params.to, true),
      order,
      page: Math.max(1, Number(params.page ?? '1') || 1),
    }),
    getFeedbackMetrics(),
  ]);
  const maxStatus = Math.max(1, ...metrics.byStatus.map((item) => item.count));
  const maxMonth = Math.max(1, ...metrics.byMonth.map((item) => item.count));

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Operação' }, { label: 'Feedbacks' }]}
        title="Feedbacks"
        description={`${result.total} sugestão(ões) visíveis para operação. Conteúdo privado por autor no produto; acesso total apenas no console.`}
        actions={
          <Link
            href={`/admin/feedbacks/export${queryFor(params, { page: undefined })}`}
            className={buttonVariants({ variant: 'secondary', size: 'sm' })}
          >
            Exportar CSV
          </Link>
        }
      />
      <div className="mb-(--sp-4) grid grid-cols-2 gap-(--sp-4) lg:grid-cols-4">
        <StatCard
          label="Total"
          value={formatNumber(metrics.total)}
          hint="feedbacks não excluídos"
        />
        <StatCard
          label="Concluídos"
          value={formatNumber(metrics.completed)}
          hint="status concluído"
        />
        <StatCard
          label="Conclusão"
          value={metrics.total ? `${Math.round((metrics.completed / metrics.total) * 100)}%` : '—'}
          hint="do total recebido"
        />
        <StatCard
          label="Tempo médio"
          value={
            metrics.avgHoursToClose === null ? '—' : `${Math.round(metrics.avgHoursToClose)} h`
          }
          hint="até fechamento"
        />
      </div>
      <div className="mb-(--sp-4) grid gap-(--sp-4) lg:grid-cols-2">
        <PanelCard title="Por status">
          {metrics.byStatus.length ? (
            <Bars
              data={metrics.byStatus.map((item) => ({
                label: STATUS_LABEL[item.label] ?? item.label,
                value: Math.round((item.count / maxStatus) * 100),
              }))}
            />
          ) : (
            <p className="py-(--sp-6) text-center text-(length:--fs-sm) text-fg-subtle">
              Sem dados.
            </p>
          )}
        </PanelCard>
        <PanelCard title="Recebidos por mês">
          {metrics.byMonth.length ? (
            <Bars
              data={metrics.byMonth.map((item, index) => ({
                label: item.label,
                value: Math.round((item.count / maxMonth) * 100),
                on: index === metrics.byMonth.length - 1,
              }))}
            />
          ) : (
            <p className="py-(--sp-6) text-center text-(length:--fs-sm) text-fg-subtle">
              Sem dados no período.
            </p>
          )}
        </PanelCard>
      </div>
      <div className="mb-(--sp-4) grid gap-(--sp-4) lg:grid-cols-2">
        <Card className="p-(--card-pad)">
          <h2 className="mb-3 text-(length:--fs-sm) font-semibold">Por categoria</h2>
          <ul className="flex flex-col gap-2">
            {metrics.byCategory.map((item) => (
              <li key={item.label} className="flex justify-between text-(length:--fs-sm)">
                <span>{CATEGORY_LABEL[item.label] ?? item.label}</span>
                <span className="font-mono text-fg-muted">{formatNumber(item.count)}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="p-(--card-pad)">
          <h2 className="mb-3 text-(length:--fs-sm) font-semibold">Empresas que mais enviam</h2>
          <ul className="flex flex-col gap-2">
            {metrics.topClinics.map((item) => (
              <li key={item.label} className="flex justify-between text-(length:--fs-sm)">
                <span className="truncate">{item.label}</span>
                <span className="font-mono text-fg-muted">{formatNumber(item.count)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <TableWrap>
        <TableToolbar>
          <form className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <span className="relative block min-w-52 flex-1 sm:max-w-80">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle"
              />
              <input
                name="q"
                defaultValue={params.q ?? ''}
                placeholder="Buscar por título ou descrição"
                aria-label="Buscar feedbacks"
                className={cn(fieldControlClassName, 'pl-9')}
              />
            </span>
            <Select
              name="status"
              defaultValue={status ?? ''}
              className="max-w-48"
              aria-label="Status"
            >
              <option value="">Status: todos</option>
              {Object.entries(STATUS_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
            <Select
              name="category"
              defaultValue={category ?? ''}
              className="max-w-48"
              aria-label="Categoria"
            >
              <option value="">Categoria: todas</option>
              {Object.entries(CATEGORY_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
            <input
              name="clinic"
              defaultValue={params.clinic ?? ''}
              placeholder="Clínica"
              aria-label="Filtrar por clínica"
              className={cn(fieldControlClassName, 'max-w-40')}
            />
            <input
              name="user"
              defaultValue={params.user ?? ''}
              placeholder="Usuário"
              aria-label="Filtrar por usuário"
              className={cn(fieldControlClassName, 'max-w-40')}
            />
            <input
              name="from"
              type="date"
              defaultValue={params.from ?? ''}
              aria-label="Enviado a partir de"
              className={cn(fieldControlClassName, 'max-w-42')}
            />
            <input
              name="to"
              type="date"
              defaultValue={params.to ?? ''}
              aria-label="Enviado até"
              className={cn(fieldControlClassName, 'max-w-42')}
            />
            <Select name="order" defaultValue={order} className="max-w-44" aria-label="Ordenação">
              <option value="newest">Mais recentes</option>
              <option value="oldest">Mais antigos</option>
              <option value="priority">Maior prioridade</option>
            </Select>
            <button type="submit" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
              Filtrar
            </button>
          </form>
        </TableToolbar>
        {result.rows.length === 0 ? (
          <EmptyState title="Nenhum feedback" description="Ajuste os filtros e tente novamente." />
        ) : (
          <>
            <TableScroll>
              <Table className="min-w-200">
                <TableHeader>
                  <TableRow>
                    <TableHead>Feedback</TableHead>
                    <TableHead>Clínica</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Enviado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <Link href={`/admin/feedbacks/${row.id}`} className="hover:underline">
                          <TableCellStack
                            main={row.title}
                            sub={row.userName ?? 'Usuário removido'}
                          />
                        </Link>
                      </TableCell>
                      <TableCell className="text-fg-muted">{row.clinicName}</TableCell>
                      <TableCell>{CATEGORY_LABEL[row.category] ?? row.category}</TableCell>
                      <TableCell>
                        <Badge tone={STATUS_TONE[row.status] ?? 'gray'}>
                          {STATUS_LABEL[row.status] ?? row.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-fg-muted">
                        {formatDateTime(row.createdAt.toISOString())}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableScroll>
            <TableFoot>
              <TableFootInfo>
                Página {result.page} de {result.pageCount} · {result.total} registro(s)
              </TableFootInfo>
              <TablePager
                page={result.page}
                pageCount={result.pageCount}
                hrefFor={(page) => `/admin/feedbacks${queryFor(params, { page: String(page) })}`}
              />
            </TableFoot>
          </>
        )}
      </TableWrap>
    </>
  );
}
