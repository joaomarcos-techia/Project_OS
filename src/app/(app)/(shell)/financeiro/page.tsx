import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowDownLeft, ArrowUpRight, Check, Filter, Info, Scale, Truck } from 'lucide-react';
import type { ReactNode } from 'react';

import { clinicMonthBounds } from '@/contexts/financial/logic';
import {
  getCashFlowToday,
  listLancamentosPage,
  listPaymentMethods,
  listSuppliers,
} from '@/contexts/financial/queries';
import { getClinicTimezone } from '@/contexts/tenancy/queries';
import type {
  LancamentoStatus,
  LancamentoSummary,
  LancamentoTipo,
} from '@/contexts/financial/types';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { DataTable } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { Select } from '@/components/ui/select';
import {
  TableBody,
  TableCell,
  TableCellStack,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { buttonVariants } from '@/components/ui/button';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { requireClinicId, requireUser } from '@/lib/auth/tenant-context';
import { withQueryDeadline } from '@/lib/db/query-timeout';
import { formatBRL, formatDatePt } from '@/lib/format';
import { cn } from '@/lib/ui/cn';

import { NewLancamentoDrawer } from './new-lancamento-drawer';
import { financeiroPageHref, parseFinanceiroPage } from './pagination';

export const dynamic = 'force-dynamic';

type SP = { tipo?: string; status?: string; novo?: string; page?: string };

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

export default async function FinanceiroPage({ searchParams }: { searchParams: Promise<SP> }) {
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
  const { tipo, status, novo, page: rawPage } = await searchParams;
  const tipoFilter = isTipo(tipo) ? tipo : undefined;
  const statusFilter = isStatus(status) ? status : undefined;
  const paginationFilters = {
    ...(tipoFilter ? { tipo: tipoFilter } : {}),
    ...(statusFilter ? { status: statusFilter } : {}),
  };
  const page = parseFinanceiroPage(rawPage);
  const tz = await getClinicTimezone(clinicId);
  // Cards de fluxo = MÊS corrente (não o dia): recebido/pago/saldo do mês. Os
  // totais "a receber/a pagar" já são o aberto geral (independem da janela).
  const { from, to } = clinicMonthBounds(tz);

  // Fan-out do financeiro. `withQueryDeadline` (FALHA ALTO): nunca mostra vazio-por-
  // timeout como verdade — estolou, cai no error boundary do shell, não pendura.
  const [flow, lancamentosResult, suppliers, methods] = await withQueryDeadline(
    'financeiro.load',
    Promise.all([
      getCashFlowToday(clinicId, from, to),
      listLancamentosPage(clinicId, {
        ...paginationFilters,
        page,
      }),
      canManage ? listSuppliers(clinicId, { onlyActive: true }) : Promise.resolve([]),
      canManage ? listPaymentMethods(clinicId) : Promise.resolve([]),
    ]),
  );

  const totalPages = Math.max(1, Math.ceil(lancamentosResult.total / lancamentosResult.pageSize));
  if (page > totalPages) {
    redirect(financeiroPageHref(paginationFilters, totalPages));
  }
  const lancamentos = lancamentosResult.items;

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Gestão' }, { label: 'Financeiro' }]}
        title="Financeiro"
        description={`Visão gerencial de ${new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: tz }).format(from)}`}
        actions={
          <>
            <Link
              href="/financeiro/fornecedores"
              className={buttonVariants({ variant: 'secondary', size: 'sm' })}
            >
              <Truck aria-hidden="true" className="size-4" />
              Fornecedores
            </Link>
            {canManage ? (
              <NewLancamentoDrawer
                suppliers={suppliers}
                methods={methods}
                defaultOpen={novo === '1'}
              />
            ) : null}
          </>
        }
      />

      <div className="qoro-toolbar">
        <form className="flex flex-wrap items-center gap-2">
          <Select
            name="tipo"
            defaultValue={tipoFilter ?? ''}
            aria-label="Filtrar por tipo"
            className="w-44"
          >
            <option value="">Todos os tipos</option>
            <option value="receber">A receber</option>
            <option value="pagar">A pagar</option>
          </Select>
          <Select
            name="status"
            defaultValue={statusFilter ?? ''}
            aria-label="Filtrar por status"
            className="w-46"
          >
            <option value="">Todos os status</option>
            <option value="pendente">Pendente</option>
            <option value="parcial">Parcial</option>
            <option value="pago">Pago</option>
            <option value="cancelado">Cancelado</option>
            <option value="estornado">Estornado</option>
          </Select>
          <button type="submit" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
            <Filter aria-hidden="true" className="size-4" />
            Filtrar
          </button>
        </form>
        <span className="ml-auto font-mono text-xs text-fg-subtle tabular-nums">
          {lancamentosResult.total} lançamentos · mais recentes primeiro
        </span>
      </div>

      <div className="qoro-page-content space-y-3">
        <section
          aria-label="Métricas principais"
          className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(15rem,.7fr)]"
        >
          <FinancialMetricGroup title="Entradas">
            <FinancialMetric
              label="A receber"
              value={flow.receber}
              icon={<ArrowDownLeft />}
              hint="Pendências em aberto"
            />
            <FinancialMetric
              label="Recebido no mês"
              value={flow.recebidoHoje}
              icon={<Check />}
              tone="positive"
              hint="Recebimentos confirmados"
            />
          </FinancialMetricGroup>
          <FinancialMetricGroup title="Saídas">
            <FinancialMetric
              label="A pagar"
              value={flow.pagar}
              icon={<ArrowUpRight />}
              hint="Contas em aberto"
            />
            <FinancialMetric
              label="Pago no mês"
              value={flow.pagoHoje}
              icon={<Check />}
              hint="Pagamentos confirmados"
            />
          </FinancialMetricGroup>
          <FinancialMetricGroup title="Saldo do mês">
            <FinancialMetric
              label="Recebido menos pago"
              value={flow.saldoHoje}
              icon={<Scale />}
              tone={flow.saldoHoje >= 0 ? 'balance' : 'negative'}
              hint="Mês atual, no fuso da clínica"
              emphasis
            />
          </FinancialMetricGroup>
        </section>

        <div className="flex min-h-10 flex-wrap items-center gap-2.5 rounded-lg border border-border bg-surface-2 px-3.5 py-2 text-xs text-fg-muted">
          <Info aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
          <p className="min-w-0 flex-1 text-pretty">
            Esta é a visão gerencial do mês. Recebimentos e pagamentos do dia são operados no{' '}
            <Link href="/caixa" className="font-semibold text-link hover:underline">
              Caixa
            </Link>
            .
          </p>
        </div>

        <DataTable
          total={lancamentos.length === 0 ? 0 : lancamentosResult.total}
          page={page}
          pageCount={totalPages}
          pageSize={lancamentosResult.pageSize}
          unit={{ one: 'lançamento', many: 'lançamentos' }}
          hrefFor={(targetPage) => financeiroPageHref(paginationFilters, targetPage)}
          empty={
            <EmptyState
              title="Nenhum lançamento"
              description="Ajuste os filtros ou crie um lançamento."
            />
          }
        >
          <TableHeader>
            <TableRow>
              <TableHead>Lançamento e natureza</TableHead>
              <TableHead>Criado em</TableHead>
              <TableHead>Vencimento</TableHead>
              <TableHead>Status</TableHead>
              <TableHead numeric>Valor</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lancamentos.map((l: LancamentoSummary) => (
              <TableRow key={l.id}>
                <TableCell>
                  <TableCellStack
                    main={l.descricao}
                    sub={l.tipo === 'receber' ? 'A receber' : 'A pagar'}
                  />
                </TableCell>
                <TableCell className="font-mono text-xs whitespace-nowrap text-fg-subtle tabular-nums">
                  {formatDatePt(l.createdAt)}
                </TableCell>
                <TableCell className="font-mono text-xs whitespace-nowrap text-fg-muted tabular-nums">
                  {formatDatePt(l.dueDate)}
                </TableCell>
                <TableCell>
                  <Badge tone={STATUS_TONE[l.status]} dot>
                    {STATUS_LABEL[l.status]}
                  </Badge>
                </TableCell>
                <TableCell
                  numeric
                  className={cn(
                    'font-mono text-xs font-medium whitespace-nowrap',
                    l.status === 'pago' && l.tipo === 'receber' ? 'text-success-700' : 'text-fg',
                  )}
                >
                  {l.tipo === 'receber' ? '+' : '−'}
                  {formatBRL(l.valor)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </DataTable>
      </div>
    </>
  );
}

function FinancialMetricGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="qoro-section overflow-hidden">
      <h2 className="flex min-h-10 items-center border-b border-border bg-surface-2 px-4 text-(length:--fs-2xs) font-semibold tracking-wide text-fg-subtle uppercase">
        {title}
      </h2>
      <div className="grid grid-flow-col auto-cols-fr divide-x divide-border">{children}</div>
    </section>
  );
}

function FinancialMetric({
  label,
  value,
  icon,
  hint,
  tone,
  emphasis = false,
}: {
  label: string;
  value: number;
  icon: ReactNode;
  hint: string;
  tone?: 'positive' | 'negative' | 'balance';
  emphasis?: boolean;
}) {
  return (
    <StatCard
      label={label}
      value={formatBRL(value)}
      icon={icon}
      hint={hint}
      emphasis={emphasis}
      valueTone={tone === 'positive' ? 'positive' : tone === 'negative' ? 'negative' : 'default'}
      className="qoro-grouped-metric rounded-none border-0"
    />
  );
}
