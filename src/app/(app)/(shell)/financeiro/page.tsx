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
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
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

function StatTile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="stat-tile">
      <div className="st-top">
        <span className="st-l">{label}</span>
      </div>
      <div className={cn('st-v tabular-nums', tone)}>{value}</div>
    </div>
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
      <div className="screen">
        <PageHeader title="Financeiro" />
        <Alert variant="warning" title="Sem acesso">
          Seu perfil não tem permissão para o financeiro.
        </Alert>
      </div>
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
    <div className="screen">
      <PageHeader
        breadcrumb={
          <>
            Gestão <span className="sep">›</span> <b>Financeiro</b>
          </>
        }
        title="Financeiro"
        description="Visão geral do caixa e dos lançamentos da clínica."
        actions={
          <>
            <Link
              href="/financeiro/fornecedores"
              className={buttonVariants({ variant: 'ghost', size: 'sm' })}
            >
              Fornecedores
            </Link>
            {canManage ? (
              <Link
                href="/financeiro/lancamentos/novo"
                className={buttonVariants({ variant: 'primary', size: 'sm' })}
              >
                Novo lançamento
              </Link>
            ) : null}
          </>
        }
      />

      <div className="stat-row five" style={{ marginBottom: 'var(--sp-4)' }}>
        <StatTile label="A receber" value={formatBRL(flow.receber)} tone="text-warning-600" />
        <StatTile label="A pagar" value={formatBRL(flow.pagar)} tone="text-warning-600" />
        <StatTile label="Recebido hoje" value={formatBRL(flow.recebidoHoje)} tone="text-success-600" />
        <StatTile label="Pago hoje" value={formatBRL(flow.pagoHoje)} />
        <StatTile
          label="Saldo hoje"
          value={formatBRL(flow.saldoHoje)}
          tone={flow.saldoHoje >= 0 ? 'text-success-600' : 'text-danger-600'}
        />
      </div>

      <form className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="Tipo">
          <Select name="tipo" defaultValue={tipo ?? ''} className="min-w-40">
            <option value="">Todos</option>
            <option value="receber">A receber</option>
            <option value="pagar">A pagar</option>
          </Select>
        </Field>
        <Field label="Status">
          <Select name="status" defaultValue={status ?? ''} className="min-w-40">
            <option value="">Todos</option>
            <option value="pendente">Pendente</option>
            <option value="parcial">Parcial</option>
            <option value="pago">Pago</option>
            <option value="cancelado">Cancelado</option>
            <option value="estornado">Estornado</option>
          </Select>
        </Field>
        <button type="submit" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
          Filtrar
        </button>
      </form>

      {lancamentos.length === 0 ? (
        <EmptyState title="Nenhum lançamento" description="Ajuste os filtros ou crie um lançamento." />
      ) : (
        <div className="cardblock">
          <div className="listrows">
            {lancamentos.map((l: LancamentoSummary) => (
              <div key={l.id} className="listrow">
                <div className="lr-main">
                  <b>{l.descricao}</b>
                  <span className="lr-sub">
                    {l.tipo === 'receber' ? 'A receber' : 'A pagar'} · venc.{' '}
                    {formatDatePt(l.dueDate)} · {formatDatePt(l.createdAt)}
                  </span>
                </div>
                <div className="lr-end">
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
        </div>
      )}
    </div>
  );
}
