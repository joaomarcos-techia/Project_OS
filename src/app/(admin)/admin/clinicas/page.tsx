import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/painel/icons';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';

import { ClinicMark } from '../_components/charts';
import { BillingBadge, ClinicStatusBadge } from '../_components/badges';
import { guardAdminAccess } from '../_lib/guard';
import { formatDateTime } from '../_lib/format';
import { clinicRepository } from '../_lib/repositories/clinics.repo';

export const dynamic = 'force-dynamic';

const CLINIC_STATUSES = [
  'trial',
  'active',
  'suspended_readonly',
  'suspended',
  'cancelled',
  'pending_payment',
];
const BILLING_STATUSES = ['trial', 'active', 'past_due', 'cancelled'];

type SP = { q?: string; status?: string; plan?: string; billing?: string; page?: string };

function buildQuery(sp: SP, overrides: Partial<SP>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...sp, ...overrides })) if (v) params.set(k, String(v));
  const s = params.toString();
  return s ? `?${s}` : '';
}

export default async function ClinicasPage({ searchParams }: { searchParams: Promise<SP> }) {
  await guardAdminAccess();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? '1') || 1);

  const result = await clinicRepository.list({
    search: sp.q,
    status: sp.status,
    plan: sp.plan,
    billing: sp.billing,
    page,
    pageSize: 20,
  });
  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));

  return (
    <div className="screen">
      <PageHeader
        breadcrumb={
          <>
            Operação <span className="sep">›</span> <b>Clínicas</b>
          </>
        }
        title="Clínicas"
        description={`${result.total} tenant(s) na plataforma. Abra para inspecionar ou impersonar — toda ação é auditada.`}
      />

      <form className="toolbar">
        <div className="tb-grow">
          <div className="input-wrap">
            <Icon name="search" size={16} />
            <Input name="q" defaultValue={sp.q ?? ''} placeholder="Buscar por nome ou slug…" />
          </div>
        </div>
        <select name="status" defaultValue={sp.status ?? ''} className="select" style={{ maxWidth: 180 }}>
          <option value="">Status: todos</option>
          {CLINIC_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select name="billing" defaultValue={sp.billing ?? ''} className="select" style={{ maxWidth: 170 }}>
          <option value="">Billing: todos</option>
          {BILLING_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <Input name="plan" defaultValue={sp.plan ?? ''} placeholder="plano (code)" style={{ maxWidth: 150 }} />
        <button type="submit" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
          Filtrar
        </button>
      </form>

      {result.items.length === 0 ? (
        <EmptyState title="Nenhuma clínica" description="Ajuste os filtros e tente de novo." />
      ) : (
        <div className="cardblock">
          <div className="table-wrap">
            <table className="ui-table" style={{ minWidth: 720 }}>
              <thead>
                <tr>
                  <th>Clínica</th>
                  <th>Plano</th>
                  <th>Billing</th>
                  <th>Última atividade</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {result.items.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <span className="td-name">
                        <ClinicMark nome={c.nome} />
                        <span>
                          <b style={{ fontWeight: 600 }}>{c.nome}</b>
                          <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
                            /{c.slug}
                          </span>
                        </span>
                      </span>
                    </td>
                    <td>{c.planCode ? <Badge tone="blue">{c.planCode}</Badge> : <span className="td-sub">—</span>}</td>
                    <td>
                      <BillingBadge status={c.billingStatus} />
                    </td>
                    <td className="td-sub">{c.lastActivityAt ? formatDateTime(c.lastActivityAt) : '—'}</td>
                    <td>
                      <ClinicStatusBadge status={c.status} />
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <Link
                        href={`/admin/clinicas/${c.id}`}
                        className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                        title="Inspecionar / impersonar"
                      >
                        <Icon name="eye" size={16} />
                      </Link>
                    </td>
                  </tr>
                ))}
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
              <Link
                className={buttonVariants({ variant: 'secondary', size: 'sm' })}
                href={`/admin/clinicas${buildQuery(sp, { page: String(page - 1) })}`}
              >
                Anterior
              </Link>
            ) : null}
            {page < totalPages ? (
              <Link
                className={buttonVariants({ variant: 'secondary', size: 'sm' })}
                href={`/admin/clinicas${buildQuery(sp, { page: String(page + 1) })}`}
              >
                Próxima
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
