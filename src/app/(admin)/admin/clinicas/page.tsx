import { Eye, Search } from 'lucide-react';
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

import { ClinicMark } from '../_components/charts';
import { BillingBadge, ClinicStatusBadge } from '../_components/badges';
import { guardAdminAccess } from '../_lib/guard';
import { formatDateTime } from '../_lib/format';
import { clinicRepository } from '../_lib/repositories/clinics.repo';
import { invitesRepository } from '../_lib/repositories/invites.repo';
import { NewClinicModal } from './new-clinic-modal';
import { CancelInviteButton } from './cancel-invite-button';

export const dynamic = 'force-dynamic';

const INVITES_PER_PAGE = 6;

function inviteTone(s: string): 'blue' | 'amber' | 'green' | 'gray' | 'red' {
  if (s === 'completed') return 'green';
  if (s === 'started') return 'amber';
  if (s === 'cancelled') return 'red';
  if (s === 'expired') return 'gray';
  return 'blue'; // pending
}

const CLINIC_STATUSES = [
  'trial',
  'active',
  'suspended_readonly',
  'suspended',
  'cancelled',
  'pending_payment',
];
const BILLING_STATUSES = ['trial', 'active', 'past_due', 'cancelled'];

type SP = { q?: string; status?: string; plan?: string; billing?: string; page?: string; ipage?: string };

function buildQuery(sp: SP, overrides: { [K in keyof SP]?: string | undefined }): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...sp, ...overrides })) if (v) params.set(k, String(v));
  const s = params.toString();
  return s ? `?${s}` : '';
}

export default async function ClinicasPage({ searchParams }: { searchParams: Promise<SP> }) {
  await guardAdminAccess();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? '1') || 1);
  const ipage = Math.max(1, Number(sp.ipage ?? '1') || 1);

  const [result, plans, invites] = await Promise.all([
    clinicRepository.list({
      search: sp.q,
      status: sp.status,
      plan: sp.plan,
      billing: sp.billing,
      page,
      pageSize: 20,
    }),
    invitesRepository.listPlans(),
    invitesRepository.list(),
  ]);
  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));

  // Convites: 6 por página ("virar página" — pedido do founder; sem scroll).
  const invitePages = Math.max(1, Math.ceil(invites.length / INVITES_PER_PAGE));
  const invitesPage = invites.slice((ipage - 1) * INVITES_PER_PAGE, ipage * INVITES_PER_PAGE);

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Operação' }, { label: 'Clínicas' }]}
        title="Clínicas"
        description={`${result.total} tenant(s) na plataforma. Abra para inspecionar ou impersonar — toda ação é auditada.`}
        actions={<NewClinicModal plans={plans} />}
      />

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
                defaultValue={sp.q ?? ''}
                placeholder="Buscar por nome ou slug…"
                aria-label="Buscar clínicas"
                className={cn(fieldControlClassName, 'pl-9')}
              />
            </span>
            <Select name="status" defaultValue={sp.status ?? ''} className="max-w-44" aria-label="Status">
              <option value="">Status: todos</option>
              {CLINIC_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
            <Select name="billing" defaultValue={sp.billing ?? ''} className="max-w-40" aria-label="Billing">
              <option value="">Billing: todos</option>
              {BILLING_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
            <input
              name="plan"
              defaultValue={sp.plan ?? ''}
              placeholder="plano (code)"
              aria-label="Plano"
              className={cn(fieldControlClassName, 'max-w-36')}
            />
            <button type="submit" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
              Filtrar
            </button>
          </form>
        </TableToolbar>
        {result.items.length === 0 ? (
          <EmptyState title="Nenhuma clínica" description="Ajuste os filtros e tente de novo." />
        ) : (
          <>
            <TableScroll>
              <Table className="min-w-180">
                <TableHeader>
                  <TableRow>
                    <TableHead>Clínica</TableHead>
                    <TableHead>Plano</TableHead>
                    <TableHead>Billing</TableHead>
                    <TableHead>Última atividade</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-12" aria-label="Abrir" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.items.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>
                        <span className="flex items-center gap-2.5">
                          <ClinicMark nome={c.nome} />
                          <TableCellStack main={c.nome} sub={`/${c.slug}`} />
                        </span>
                      </TableCell>
                      <TableCell>
                        {c.planCode ? (
                          <Badge tone="blue">{c.planCode}</Badge>
                        ) : (
                          <span className="text-fg-subtle">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <BillingBadge status={c.billingStatus} />
                      </TableCell>
                      <TableCell className="text-fg-muted">
                        {c.lastActivityAt ? formatDateTime(c.lastActivityAt) : '—'}
                      </TableCell>
                      <TableCell>
                        <ClinicStatusBadge status={c.status} />
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/admin/clinicas/${c.id}`}
                          title="Inspecionar / impersonar"
                          aria-label={`Abrir ${c.nome}`}
                          className="grid size-7 place-items-center rounded-(--r-sm) text-fg-subtle transition-colors hover:bg-surface-hover hover:text-fg"
                        >
                          <Eye className="size-4" />
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableScroll>
            <TableFoot>
              <TableFootInfo>
                Página {page} de {totalPages} · {result.total} clínica{result.total === 1 ? '' : 's'}
              </TableFootInfo>
              <TablePager
                page={page}
                pageCount={totalPages}
                hrefFor={(p) => `/admin/clinicas${buildQuery(sp, { page: String(p), ipage: undefined })}`}
              />
            </TableFoot>
          </>
        )}
      </TableWrap>

      {/* ======================== CONVITES ======================== */}
      <TableWrap className="mt-(--sp-5)">
        <TableToolbar>
          <h4 className="text-(length:--fs-sm) font-semibold">Convites</h4>
          <span className="text-(length:--fs-xs) text-fg-subtle">
            {invites.length} · onboarding via convite mágico
          </span>
        </TableToolbar>
        {invites.length === 0 ? (
          <p className="px-5 py-4 text-sm text-fg-subtle">
            Nenhum convite. Use <b>Nova Clínica</b> para gerar um link de onboarding.
          </p>
        ) : (
          <>
            <TableScroll>
              <Table className="min-w-180">
                <TableHeader>
                  <TableRow>
                    <TableHead>Gestor / Clínica</TableHead>
                    <TableHead>Plano</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Criado</TableHead>
                    <TableHead>Expira</TableHead>
                    <TableHead className="w-24" aria-label="Ações" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invitesPage.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell className="font-medium">
                        {i.clinicNome ?? i.email ?? <span className="text-fg-subtle">—</span>}
                      </TableCell>
                      <TableCell>
                        {i.planCode ? (
                          <Badge tone="blue">{i.planCode}</Badge>
                        ) : (
                          <span className="text-fg-subtle">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge tone={inviteTone(i.status)}>{i.status}</Badge>
                      </TableCell>
                      <TableCell className="text-fg-muted">{formatDateTime(i.createdAt)}</TableCell>
                      <TableCell className="text-fg-muted">{formatDateTime(i.expiresAt)}</TableCell>
                      <TableCell>
                        {i.status === 'pending' || i.status === 'started' ? (
                          <CancelInviteButton id={i.id} />
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableScroll>
            <TableFoot>
              <TableFootInfo>
                Página {ipage} de {invitePages}
              </TableFootInfo>
              <TablePager
                page={ipage}
                pageCount={invitePages}
                hrefFor={(p) => `/admin/clinicas${buildQuery(sp, { ipage: String(p) })}`}
              />
            </TableFoot>
          </>
        )}
      </TableWrap>
    </>
  );
}
