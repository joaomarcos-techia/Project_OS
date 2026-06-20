import Link from 'next/link';

import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';

import { guardAdminAccess } from '../_lib/guard';
import { formatDateTime } from '../_lib/format';
import { auditRepository } from '../_lib/repositories/audit.repo';
import { clinicRepository } from '../_lib/repositories/clinics.repo';

export const dynamic = 'force-dynamic';

type SP = {
  user?: string;
  clinic?: string;
  action?: string;
  entity?: string;
  from?: string;
  to?: string;
  page?: string;
};

function qstring(sp: SP, extra: Partial<SP>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...sp, ...extra })) if (v) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
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
      <PageHeader title="Auditoria" description={`Busca cross-tenant — ${result.total} evento(s).`} />

      <form className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs text-fg-muted">Clínica</label>
          <select name="clinic" defaultValue={sp.clinic ?? ''} className="select">
            <option value="">Todas</option>
            {clinicOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.nome}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-fg-muted">Ação</label>
          <Input name="action" defaultValue={sp.action ?? ''} placeholder="ex.: update_clinic" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-fg-muted">Entidade</label>
          <Input name="entity" defaultValue={sp.entity ?? ''} placeholder="ex.: patient" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-fg-muted">Usuário (id)</label>
          <Input name="user" defaultValue={sp.user ?? ''} placeholder="uuid" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-fg-muted">De</label>
          <input type="date" name="from" defaultValue={sp.from ?? ''} className="input" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-fg-muted">Até</label>
          <input type="date" name="to" defaultValue={sp.to ?? ''} className="input" />
        </div>
        <button type="submit" className={buttonVariants({ variant: 'secondary' })}>
          Filtrar
        </button>
      </form>

      {result.items.length === 0 ? (
        <EmptyState title="Nenhum evento" description="Ajuste os filtros." />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-fg-muted">
                <th className="px-3 py-2 font-medium">Data/Hora</th>
                <th className="px-3 py-2 font-medium">Ação</th>
                <th className="px-3 py-2 font-medium">Entidade</th>
                <th className="px-3 py-2 font-medium">Tenant</th>
                <th className="px-3 py-2 font-medium">Usuário</th>
                <th className="px-3 py-2 font-medium">IP</th>
                <th className="px-3 py-2 font-medium">Resultado</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((a) => (
                <tr key={a.id} className="border-b border-border/60">
                  <td className="whitespace-nowrap px-3 py-2 text-xs">{formatDateTime(a.timestamp)}</td>
                  <td className="px-3 py-2 font-mono text-xs">{a.action}</td>
                  <td className="px-3 py-2 text-xs">
                    {a.resourceType}
                    {a.resourceId ? `:${a.resourceId.slice(0, 8)}` : ''}
                  </td>
                  <td className="px-3 py-2 text-xs">{a.clinicId.slice(0, 8)}</td>
                  <td className="px-3 py-2 text-xs">{a.userId ? a.userId.slice(0, 8) : '—'}</td>
                  <td className="px-3 py-2 text-xs">{a.ip ?? '—'}</td>
                  <td className="px-3 py-2 text-xs">{a.result}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {totalPages > 1 ? (
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-fg-subtle">
            Página {page} de {totalPages}
          </span>
          <div className="flex gap-2">
            {page > 1 ? (
              <Link className={buttonVariants({ variant: 'secondary' })} href={`/admin/audit${qstring(sp, { page: String(page - 1) })}`}>
                Anterior
              </Link>
            ) : null}
            {page < totalPages ? (
              <Link className={buttonVariants({ variant: 'secondary' })} href={`/admin/audit${qstring(sp, { page: String(page + 1) })}`}>
                Próxima
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
