import { Search } from 'lucide-react';

import { Badge, type badgeVariants } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { DateField } from '@/components/ui/date-field';
import { EmptyState } from '@/components/ui/empty-state';
import { fieldControlClassName } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
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
import type { VariantProps } from 'class-variance-authority';

import { guardAdminAccess } from '../_lib/guard';
import { formatDateTime } from '../_lib/format';
import { auditRepository } from '../_lib/repositories/audit.repo';
import { clinicRepository } from '../_lib/repositories/clinics.repo';

export const dynamic = 'force-dynamic';

type Tone = NonNullable<VariantProps<typeof badgeVariants>['tone']>;
type SP = {
  user?: string;
  clinic?: string;
  action?: string;
  entity?: string;
  from?: string;
  to?: string;
  page?: string;
};

function qstring(sp: SP, extra: { [K in keyof SP]?: string | undefined }): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...sp, ...extra })) if (v) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Ações privilegiadas/sensíveis → violeta (destaque de linha); demais por categoria. */
function actionTone(a: string): Tone {
  if (a.includes('impersonate') || a.includes('audit.export') || a.startsWith('super_admin'))
    return 'violet';
  if (a.includes('refund') || a.includes('delete') || a.includes('overdue')) return 'red';
  if (a.includes('create')) return 'green';
  if (a.includes('update') || a.includes('reschedule') || a.includes('sign')) return 'amber';
  return 'blue';
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<SP> }) {
  await guardAdminAccess();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? '1') || 1);

  const [clinicOptions, result] = await Promise.all([
    clinicRepository.listOptions(),
    auditRepository.search({
      userId: sp.user,
      clinicId: sp.clinic,
      action: sp.action,
      entity: sp.entity,
      from: sp.from ? `${sp.from}T00:00:00.000Z` : undefined,
      to: sp.to ? `${sp.to}T23:59:59.999Z` : undefined,
      page,
      pageSize: 50,
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Plataforma' }, { label: 'Auditoria' }]}
        title="Auditoria"
        description={`Trilha cross-tenant — ${result.total} evento(s). Toda ação de super_admin é auto-registrada.`}
      />

      <TableWrap>
        <TableToolbar>
          <form className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <span className="relative block min-w-60 flex-1 xl:max-w-90">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle"
              />
              <input
                name="action"
                defaultValue={sp.action ?? ''}
                placeholder="Buscar por ação (ex.: impersonate, patient.create)…"
                aria-label="Buscar por ação"
                className={cn(fieldControlClassName, 'pl-9')}
              />
            </span>
            <Select
              name="clinic"
              defaultValue={sp.clinic ?? ''}
              className="max-w-52"
              aria-label="Clínica"
            >
              <option value="">Todas as clínicas</option>
              {clinicOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.nome}
                </option>
              ))}
            </Select>
            <input
              name="entity"
              defaultValue={sp.entity ?? ''}
              placeholder="entidade"
              aria-label="Entidade"
              className={cn(fieldControlClassName, 'max-w-32')}
            />
            <input
              name="user"
              defaultValue={sp.user ?? ''}
              placeholder="usuário (uuid)"
              aria-label="Usuário"
              className={cn(fieldControlClassName, 'max-w-40')}
            />
            <DateField name="from" defaultValue={sp.from ?? ''} className="max-w-36" />
            <DateField name="to" defaultValue={sp.to ?? ''} className="max-w-36" />
            <button type="submit" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
              Filtrar
            </button>
          </form>
        </TableToolbar>
        {result.items.length === 0 ? (
          <EmptyState title="Nenhum evento" description="Ajuste os filtros." />
        ) : (
          <>
            <TableScroll>
              <Table className="min-w-210">
                <TableHeader>
                  <TableRow>
                    <TableHead>Horário</TableHead>
                    <TableHead>Ator</TableHead>
                    <TableHead>Clínica</TableHead>
                    <TableHead>Evento</TableHead>
                    <TableHead>Recurso</TableHead>
                    <TableHead>IP</TableHead>
                    <TableHead>Resultado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.items.map((a) => {
                    const tone = actionTone(a.action);
                    const hl = tone === 'violet';
                    return (
                      <TableRow
                        key={a.id}
                        className={cn(
                          hl && 'bg-[color-mix(in_oklch,var(--primary-500)_5%,transparent)]',
                        )}
                      >
                        <TableCell className="whitespace-nowrap text-fg-muted">
                          {formatDateTime(a.timestamp)}
                        </TableCell>
                        <TableCell className="font-mono text-(length:--fs-xs) font-medium">
                          {a.userId ? a.userId.slice(0, 8) : 'sistema'}
                        </TableCell>
                        <TableCell className="font-mono text-(length:--fs-xs) text-fg-muted">
                          {a.clinicId.slice(0, 8)}
                        </TableCell>
                        <TableCell>
                          <Badge tone={tone}>{a.action}</Badge>
                        </TableCell>
                        <TableCell className="font-mono text-[11.5px] text-fg-muted">
                          {a.resourceType}
                          {a.resourceId ? `:${a.resourceId.slice(0, 8)}` : ''}
                        </TableCell>
                        <TableCell className="text-fg-subtle">{a.ip ?? '—'}</TableCell>
                        <TableCell className="text-fg-muted">{a.result}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableScroll>
            <TableFoot>
              <TableFootInfo>
                Página {page} de {totalPages} · {result.total} evento{result.total === 1 ? '' : 's'}
              </TableFootInfo>
              <TablePager
                page={page}
                pageCount={totalPages}
                hrefFor={(p) => `/admin/audit${qstring(sp, { page: String(p) })}`}
              />
            </TableFoot>
          </>
        )}
      </TableWrap>
    </>
  );
}
