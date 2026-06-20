import Link from 'next/link';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';

import { StatCard } from '../_components/stat-card';
import { guardAdminAccess } from '../_lib/guard';
import { formatBRLCents, formatDate, formatDateTime, formatNumber } from '../_lib/format';
import { billingOverviewRepository } from '../_lib/repositories/billing.repo';
import type { InvoiceRowDTO } from '../_lib/dto';

export const dynamic = 'force-dynamic';

function InvoiceList({ rows }: { rows: InvoiceRowDTO[] }) {
  if (rows.length === 0) return <p className="text-sm text-fg-subtle">Nenhuma.</p>;
  return (
    <div className="divide-y divide-border">
      {rows.map((r) => (
        <div key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
          <Link href={`/admin/clinicas/${r.clinicId}`} className="min-w-0 flex-1 truncate hover:underline">
            {r.clinicNome}
          </Link>
          <span className="w-24 text-right font-medium">{formatBRLCents(r.amountCents)}</span>
          <span className="w-24 text-right text-xs text-fg-subtle">venc. {formatDate(r.dueDate)}</span>
        </div>
      ))}
    </div>
  );
}

export default async function BillingPage() {
  await guardAdminAccess();
  const o = await billingOverviewRepository.getOverview();

  return (
    <>
      <PageHeader title="Billing" description="Visão financeira da plataforma (somente leitura)." />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="MRR (mês)" value={formatBRLCents(o.mrrCents)} />
        <StatCard label="ARR" value={formatBRLCents(o.arrCents)} />
        <StatCard label="Faturas abertas" value={formatNumber(o.open.length)} />
        <StatCard label="Em atraso" value={formatNumber(o.overdue.length)} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Faturas abertas</CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            <InvoiceList rows={o.open} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Em atraso (overdue)</CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            <InvoiceList rows={o.overdue} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Dunning</CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            {o.dunning.length === 0 ? (
              <p className="text-sm text-fg-subtle">Nenhuma clínica em dunning.</p>
            ) : (
              <div className="divide-y divide-border">
                {o.dunning.map((d) => (
                  <div key={d.clinicId} className="flex items-center justify-between py-2 text-sm">
                    <Link href={`/admin/clinicas/${d.clinicId}`} className="truncate hover:underline">
                      {d.nome}
                    </Link>
                    <span className="text-xs text-fg-subtle">stage {d.stage}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Refunds</CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            {o.refunds.length === 0 ? (
              <p className="text-sm text-fg-subtle">Nenhum refund.</p>
            ) : (
              <div className="divide-y divide-border">
                {o.refunds.map((r, i) => (
                  <div key={`${r.clinicId}-${i}`} className="flex items-center justify-between py-2 text-sm">
                    <Link href={`/admin/clinicas/${r.clinicId}`} className="truncate hover:underline">
                      {r.nome}
                    </Link>
                    <span className="flex items-center gap-2">
                      <span className="font-medium">{formatBRLCents(r.amountCents)}</span>
                      <span className="text-xs text-fg-subtle">{formatDateTime(r.at)}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
