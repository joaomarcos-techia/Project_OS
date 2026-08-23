import Link from 'next/link';
import { redirect } from 'next/navigation';

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
import { EmptyState } from '@/components/ui/empty-state';
import { MetricStrip } from '@/components/ui/metric-strip';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { StatCard } from '@/components/ui/stat-card';
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
import { TableToolbar, TableToolbarSpacer } from '@/components/ui/table-toolbar';
import { TablePager } from '@/components/ui/table-pager';
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
        description="Visão geral do caixa e dos lançamentos da clínica."
        actions={
          <>
            <Link
              href="/financeiro/fornecedores"
              className={buttonVariants({ variant: 'secondary', size: 'sm' })}
            >
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

      {/* O saldo vem primeiro e maior: é a resposta, e o resto são as parcelas
          que a compõem. A ordem anterior obrigava a somar de cabeça para chegar
          no número que a pessoa abriu a tela para ver. */}
      <MetricStrip className="mb-(--sp-4)">
        <StatCard
          emphasis
          label="Saldo do mês"
          value={formatBRL(flow.saldoHoje)}
          valueTone={flow.saldoHoje >= 0 ? 'positive' : 'negative'}
        />
        <StatCard label="Recebido no mês" value={formatBRL(flow.recebidoHoje)} />
        <StatCard
          label="A receber"
          value={formatBRL(flow.receber)}
          valueTone={flow.receber > 0 ? 'warning' : 'default'}
          hint="pendências em aberto"
        />
        <StatCard label="Pago no mês" value={formatBRL(flow.pagoHoje)} />
        <StatCard
          label="A pagar"
          value={formatBRL(flow.pagar)}
          valueTone={flow.pagar > 0 ? 'warning' : 'default'}
          hint="contas em aberto"
        />
      </MetricStrip>

      <TableWrap>
        <TableToolbar>
          <form className="flex flex-wrap items-center gap-2">
            <Select
              name="tipo"
              defaultValue={tipoFilter ?? ''}
              aria-label="Filtrar por tipo"
              className="min-w-36"
            >
              <option value="">Todos os tipos</option>
              <option value="receber">A receber</option>
              <option value="pagar">A pagar</option>
            </Select>
            <Select
              name="status"
              defaultValue={statusFilter ?? ''}
              aria-label="Filtrar por status"
              className="min-w-36"
            >
              <option value="">Todos os status</option>
              <option value="pendente">Pendente</option>
              <option value="parcial">Parcial</option>
              <option value="pago">Pago</option>
              <option value="cancelado">Cancelado</option>
              <option value="estornado">Estornado</option>
            </Select>
            <button type="submit" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
              Filtrar
            </button>
          </form>
          <TableToolbarSpacer />
        </TableToolbar>
        {lancamentos.length === 0 ? (
          <EmptyState
            title="Nenhum lançamento"
            description="Ajuste os filtros ou crie um lançamento."
          />
        ) : (
          <>
            <TableScroll>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Descrição</TableHead>
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
                          sub={`${l.tipo === 'receber' ? 'A receber' : 'A pagar'} · criado ${formatDatePt(l.createdAt)}`}
                        />
                      </TableCell>
                      <TableCell className="text-fg-muted">{formatDatePt(l.dueDate)}</TableCell>
                      <TableCell>
                        <Badge tone={STATUS_TONE[l.status]} dot>
                          {STATUS_LABEL[l.status]}
                        </Badge>
                      </TableCell>
                      <TableCell
                        numeric
                        className={cn(
                          'font-medium',
                          l.tipo === 'receber' ? 'text-success-700' : 'text-danger-700',
                        )}
                      >
                        {l.tipo === 'receber' ? '+' : '−'}
                        {formatBRL(l.valor)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableScroll>
            <TableFoot>
              <TableFootInfo>
                Página {page} de {totalPages} · {lancamentosResult.total} lançamento
                {lancamentosResult.total === 1 ? '' : 's'}
              </TableFootInfo>
              <TablePager
                page={page}
                pageCount={totalPages}
                hrefFor={(targetPage) => financeiroPageHref(paginationFilters, targetPage)}
              />
            </TableFoot>
          </>
        )}
      </TableWrap>
    </>
  );
}
