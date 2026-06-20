import Link from 'next/link';

import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';

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

type SP = {
  q?: string;
  status?: string;
  plan?: string;
  billing?: string;
  page?: string;
};

function buildQuery(sp: SP, overrides: Partial<SP>): string {
  const merged = { ...sp, ...overrides };
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) {
    if (v) params.set(k, String(v));
  }
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
    <>
      <PageHeader title="Clínicas" description={`${result.total} clínica(s) na plataforma.`} />

      <form className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-50 flex-1">
          <label className="mb-1 block text-xs text-fg-muted">Buscar</label>
          <Input name="q" defaultValue={sp.q ?? ''} placeholder="Nome ou slug…" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-fg-muted">Status</label>
          <select name="status" defaultValue={sp.status ?? ''} className="select">
            <option value="">Todos</option>
            {CLINIC_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-fg-muted">Billing</label>
          <select name="billing" defaultValue={sp.billing ?? ''} className="select">
            <option value="">Todos</option>
            {BILLING_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-fg-muted">Plano (code)</label>
          <Input name="plan" defaultValue={sp.plan ?? ''} placeholder="ex.: pro" />
        </div>
        <button type="submit" className={buttonVariants({ variant: 'secondary' })}>
          Filtrar
        </button>
      </form>

      {result.items.length === 0 ? (
        <EmptyState title="Nenhuma clínica" description="Ajuste os filtros e tente de novo." />
      ) : (
        <Card className="divide-y divide-border overflow-hidden">
          {result.items.map((c) => (
            <Link
              key={c.id}
              href={`/admin/clinicas/${c.id}`}
              className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-surface-2"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{c.nome}</div>
                <div className="truncate text-xs text-fg-subtle">/{c.slug}</div>
              </div>
              <div className="w-32 shrink-0">
                <ClinicStatusBadge status={c.status} />
              </div>
              <div className="hidden w-24 shrink-0 text-sm text-fg-muted sm:block">
                {c.planCode ?? '—'}
              </div>
              <div className="hidden w-28 shrink-0 sm:block">
                <BillingBadge status={c.billingStatus} />
              </div>
              <div className="hidden w-40 shrink-0 text-xs text-fg-subtle md:block">
                {formatDateTime(c.lastActivityAt)}
              </div>
            </Link>
          ))}
        </Card>
      )}

      {totalPages > 1 ? (
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-fg-subtle">
            Página {page} de {totalPages}
          </span>
          <div className="flex gap-2">
            {page > 1 ? (
              <Link
                className={buttonVariants({ variant: 'secondary' })}
                href={`/admin/clinicas${buildQuery(sp, { page: String(page - 1) })}`}
              >
                Anterior
              </Link>
            ) : null}
            {page < totalPages ? (
              <Link
                className="btn btn-secondary"
                href={`/admin/clinicas${buildQuery(sp, { page: String(page + 1) })}`}
              >
                Próxima
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
