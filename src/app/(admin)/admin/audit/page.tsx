import Link from 'next/link';

import { Badge, type badgeVariants } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { DateField } from '@/components/ui/date-field';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/painel/icons';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
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

function qstring(sp: SP, extra: Partial<SP>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...sp, ...extra })) if (v) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Ações privilegiadas/sensíveis → violeta (destaque de linha); demais por categoria. */
function actionTone(a: string): Tone {
  if (a.includes('impersonate') || a.includes('audit.export') || a.startsWith('super_admin')) return 'violet';
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
    <div className="screen">
      <PageHeader
        breadcrumb={
          <>
            Plataforma <span className="sep">›</span> <b>Auditoria</b>
          </>
        }
        title="Auditoria"
        description={`Trilha cross-tenant — ${result.total} evento(s). Toda ação de super_admin é auto-registrada.`}
      />

      <form className="toolbar">
        <div className="tb-grow">
          <div className="input-wrap">
            <Icon name="search" size={16} />
            <Input name="action" defaultValue={sp.action ?? ''} placeholder="Buscar por ação (ex.: impersonate, patient.create)…" />
          </div>
        </div>
        <select name="clinic" defaultValue={sp.clinic ?? ''} className="select" style={{ maxWidth: 200 }}>
          <option value="">Todas as clínicas</option>
          {clinicOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.nome}
            </option>
          ))}
        </select>
        <Input name="entity" defaultValue={sp.entity ?? ''} placeholder="entidade" style={{ maxWidth: 130 }} />
        <Input name="user" defaultValue={sp.user ?? ''} placeholder="usuário (uuid)" style={{ maxWidth: 150 }} />
        <DateField name="from" defaultValue={sp.from ?? ''} style={{ maxWidth: 150 }} />
        <DateField name="to" defaultValue={sp.to ?? ''} style={{ maxWidth: 150 }} />
        <button type="submit" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
          Filtrar
        </button>
      </form>

      {result.items.length === 0 ? (
        <EmptyState title="Nenhum evento" description="Ajuste os filtros." />
      ) : (
        <div className="cardblock">
          <div className="table-wrap">
            <table className="ui-table" style={{ minWidth: 840 }}>
              <thead>
                <tr>
                  <th>Horário</th>
                  <th>Ator</th>
                  <th>Clínica</th>
                  <th>Evento</th>
                  <th>Recurso</th>
                  <th>IP</th>
                  <th>Resultado</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((a) => {
                  const tone = actionTone(a.action);
                  const hl = tone === 'violet';
                  return (
                    <tr
                      key={a.id}
                      style={hl ? { background: 'color-mix(in oklch, var(--primary-500) 5%, transparent)' } : undefined}
                    >
                      <td className="td-sub whitespace-nowrap">{formatDateTime(a.timestamp)}</td>
                      <td style={{ fontWeight: 500 }}>{a.userId ? a.userId.slice(0, 8) : 'sistema'}</td>
                      <td style={{ color: 'var(--text-2)' }}>{a.clinicId.slice(0, 8)}</td>
                      <td>
                        <Badge tone={tone}>{a.action}</Badge>
                      </td>
                      <td className="mono" style={{ fontSize: 11.5, color: 'var(--text-2)' }}>
                        {a.resourceType}
                        {a.resourceId ? `:${a.resourceId.slice(0, 8)}` : ''}
                      </td>
                      <td className="td-sub">{a.ip ?? '—'}</td>
                      <td style={{ color: 'var(--text-2)' }}>{a.result}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {totalPages > 1 ? (
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-fg-subtle">
            Página {page} de {totalPages}
          </span>
          <div className="flex gap-2">
            {page > 1 ? (
              <Link className={buttonVariants({ variant: 'secondary', size: 'sm' })} href={`/admin/audit${qstring(sp, { page: String(page - 1) })}`}>
                Anterior
              </Link>
            ) : null}
            {page < totalPages ? (
              <Link className={buttonVariants({ variant: 'secondary', size: 'sm' })} href={`/admin/audit${qstring(sp, { page: String(page + 1) })}`}>
                Próxima
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
