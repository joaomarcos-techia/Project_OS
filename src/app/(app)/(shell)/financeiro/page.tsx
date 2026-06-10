import Link from 'next/link';

import { clinicDayBounds } from '@/contexts/financial/logic';
import {
  getCashFlowToday,
  getClinicTimezone,
  listLancamentos,
} from '@/contexts/financial/queries';
import type {
  LancamentoStatus,
  LancamentoSummary,
  LancamentoTipo,
} from '@/contexts/financial/types';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { buttonVariants } from '@/components/ui/button';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { requireClinicId, requireUser } from '@/lib/auth/tenant-context';
import { formatBRL, formatDatePt } from '@/lib/format';
import { cn } from '@/lib/ui/cn';

export const dynamic = 'force-dynamic';

const STATUS_TONE: Record<LancamentoStatus, 'amber' | 'blue' | 'green' | 'gray' | 'red'> = {
  pendente: 'amber',
  parcial: 'blue',
  pago: 'green',
  cancelado: 'gray',
  estornado: 'red',
};
const STATUS_LABEL: Record<LancamentoStatus, string> = {
  pendente: 'Pendente',
  parcial: 'Parcial',
  pago: 'Pago',
  cancelado: 'Cancelado',
  estornado: 'Estornado',
};

const isTipo = (v: string | undefined): v is LancamentoTipo => v === 'receber' || v === 'pagar';
const isStatus = (v: string | undefined): v is LancamentoStatus =>
  v === 'pendente' || v === 'parcial' || v === 'pago' || v === 'cancelado' || v === 'estornado';

function MetricCard({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="font-mono text-[10.5px] uppercase tracking-wide text-fg-subtle">{label}</div>
        <div className={cn('mt-1 text-xl font-semibold tabular-nums', tone)}>{value}</div>
      </CardContent>
    </Card>
  );
}

export default async function FinanceiroPage({
  searchParams,
}: {
  searchParams: Promise<{ tipo?: string; status?: string }>;
}) {
  const user = await requireUser();
  await requireClinicId();

  if (!user.permissions.includes(PERMISSIONS.VIEW_FINANCIAL) || !user.clinicId) {
    return (
      <>
        <PageHeader title="Financeiro" />
        <Alert variant="warning" title="Sem acesso">
          Seu perfil não tem permissão para o financeiro.
        </Alert>
      </>
    );
  }

  const clinicId = user.clinicId;
  const canManage = user.permissions.includes(PERMISSIONS.MANAGE_FINANCIAL);
  const { tipo, status } = await searchParams;
  const tz = await getClinicTimezone(clinicId);
  const { from, to } = clinicDayBounds(tz);

  const [flow, lancamentos] = await Promise.all([
    getCashFlowToday(clinicId, from, to),
    listLancamentos(clinicId, {
      ...(isTipo(tipo) ? { tipo } : {}),
      ...(isStatus(status) ? { status } : {}),
      limit: 50,
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Financeiro"
        description="Visão geral do caixa e dos lançamentos da clínica."
        actions={
          <div className="flex items-center gap-2">
            <Link href="/financeiro/fornecedores" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
              Fornecedores
            </Link>
            {canManage ? (
              <Link href="/financeiro/lancamentos/novo" className={buttonVariants({ variant: 'primary', size: 'sm' })}>
                Novo lançamento
              </Link>
            ) : null}
          </div>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <MetricCard label="A receber" value={formatBRL(flow.receber)} tone="text-warning-600" />
        <MetricCard label="A pagar" value={formatBRL(flow.pagar)} tone="text-warning-600" />
        <MetricCard label="Recebido hoje" value={formatBRL(flow.recebidoHoje)} tone="text-success-600" />
        <MetricCard label="Pago hoje" value={formatBRL(flow.pagoHoje)} />
        <MetricCard
          label="Saldo hoje"
          value={formatBRL(flow.saldoHoje)}
          tone={flow.saldoHoje >= 0 ? 'text-success-600' : 'text-danger-600'}
        />
      </div>

      <form className="mb-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-fg-muted">Tipo</span>
          <Select name="tipo" defaultValue={tipo ?? ''} className="min-w-40">
            <option value="">Todos</option>
            <option value="receber">A receber</option>
            <option value="pagar">A pagar</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-fg-muted">Status</span>
          <Select name="status" defaultValue={status ?? ''} className="min-w-40">
            <option value="">Todos</option>
            <option value="pendente">Pendente</option>
            <option value="parcial">Parcial</option>
            <option value="pago">Pago</option>
            <option value="cancelado">Cancelado</option>
            <option value="estornado">Estornado</option>
          </Select>
        </label>
        <button type="submit" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
          Filtrar
        </button>
      </form>

      {lancamentos.length === 0 ? (
        <EmptyState title="Nenhum lançamento" description="Ajuste os filtros ou crie um lançamento." />
      ) : (
        <Card>
          <div className="divide-y divide-border">
            {lancamentos.map((l: LancamentoSummary) => (
              <div key={l.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{l.descricao}</div>
                  <div className="text-xs text-fg-subtle">
                    {l.tipo === 'receber' ? 'A receber' : 'A pagar'} · venc. {formatDatePt(l.dueDate)} ·{' '}
                    {formatDatePt(l.createdAt)}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span
                    className={cn(
                      'tabular-nums',
                      l.tipo === 'receber' ? 'text-success-700' : 'text-danger-700',
                    )}
                  >
                    {l.tipo === 'receber' ? '+' : '−'}
                    {formatBRL(l.valor)}
                  </span>
                  <Badge tone={STATUS_TONE[l.status]}>{STATUS_LABEL[l.status]}</Badge>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}
