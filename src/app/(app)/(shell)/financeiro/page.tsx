import Link from 'next/link';

import { clinicDayBounds } from '@/contexts/financial/logic';
import {
  getCashFlowToday,
  getClinicTimezone,
  listLancamentos,
  listPaymentMethods,
  listSuppliers,
} from '@/contexts/financial/queries';
import type {
  LancamentoStatus,
  LancamentoSummary,
  LancamentoTipo,
} from '@/contexts/financial/types';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
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
import { buttonVariants } from '@/components/ui/button';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { requireClinicId, requireUser } from '@/lib/auth/tenant-context';
import { formatBRL, formatDatePt } from '@/lib/format';
import { cn } from '@/lib/ui/cn';

import { NewLancamentoDrawer } from './new-lancamento-drawer';

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

export default async function FinanceiroPage({
  searchParams,
}: {
  searchParams: Promise<{ tipo?: string; status?: string; novo?: string }>;
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
  const { tipo, status, novo } = await searchParams;
  const tz = await getClinicTimezone(clinicId);
  const { from, to } = clinicDayBounds(tz);

  const [flow, lancamentos, suppliers, methods] = await Promise.all([
    getCashFlowToday(clinicId, from, to),
    listLancamentos(clinicId, {
      ...(isTipo(tipo) ? { tipo } : {}),
      ...(isStatus(status) ? { status } : {}),
      limit: 50,
    }),
    canManage ? listSuppliers(clinicId, { onlyActive: true }) : Promise.resolve([]),
    canManage ? listPaymentMethods(clinicId) : Promise.resolve([]),
  ]);

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

      <div className="mb-(--sp-4) grid grid-cols-2 gap-(--sp-4) lg:grid-cols-3 2xl:grid-cols-5">
        <StatCard label="A receber" value={formatBRL(flow.receber)} />
        <StatCard label="A pagar" value={formatBRL(flow.pagar)} />
        <StatCard label="Recebido hoje" value={formatBRL(flow.recebidoHoje)} />
        <StatCard label="Pago hoje" value={formatBRL(flow.pagoHoje)} />
        <StatCard
          label="Saldo hoje"
          value={
            <span className={flow.saldoHoje >= 0 ? 'text-success-600' : 'text-danger-600'}>
              {formatBRL(flow.saldoHoje)}
            </span>
          }
        />
      </div>

      <TableWrap>
        <TableToolbar>
          <form className="flex flex-wrap items-center gap-2">
            <Select
              name="tipo"
              defaultValue={tipo ?? ''}
              aria-label="Filtrar por tipo"
              className="min-w-36"
            >
              <option value="">Todos os tipos</option>
              <option value="receber">A receber</option>
              <option value="pagar">A pagar</option>
            </Select>
            <Select
              name="status"
              defaultValue={status ?? ''}
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
                {lancamentos.length} lançamento{lancamentos.length === 1 ? '' : 's'}
                {lancamentos.length === 50 ? ' (mostrando os 50 mais recentes)' : ''}
              </TableFootInfo>
            </TableFoot>
          </>
        )}
      </TableWrap>
    </>
  );
}
