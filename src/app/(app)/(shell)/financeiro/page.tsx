import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  CircleDot,
  Filter,
  Info,
  Scale,
  Truck,
} from 'lucide-react';
import type { ReactNode } from 'react';

import { clinicMonthBounds } from '@/contexts/financial/logic';
import {
  getAvailablePatientCreditSummary,
  getCashFlowToday,
  listLancamentosPage,
  listPaymentMethods,
  listSuppliers,
} from '@/contexts/financial/queries';
import { listPatientCards } from '@/contexts/patient/queries';
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
import { PaymentStatusBadge } from '@/components/ui/status-badge';
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
import { formatBRL } from '@/lib/format';
import { cn } from '@/lib/ui/cn';

import { NewLancamentoDrawer } from './new-lancamento-drawer';
import { financeiroPageHref, parseFinanceiroPage } from './pagination';

export const dynamic = 'force-dynamic';

type SP = { tipo?: string; status?: string; novo?: string; page?: string };

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
  // DUAS RODADAS, não três. Só `getCashFlowToday` precisa da janela do mês, e
  // portanto do fuso; lançamentos, fornecedores e formas de pagamento não
  // dependem de nada. Esperar o fuso para só então disparar os três era uma ida
  // ao banco a mais em série — e esta rota era a mais lenta do shell, com
  // 3.725 ms streamando o documento contra 70 ms de TTFB.
  //
  // `withQueryDeadline` (FALHA ALTO): nunca mostra vazio-por-timeout como
  // verdade — estolou, cai no error boundary do shell, não pendura.
  const [tz, lancamentosResult, suppliers, methods] = await withQueryDeadline(
    'financeiro.load',
    Promise.all([
      getClinicTimezone(clinicId),
      listLancamentosPage(clinicId, {
        ...paginationFilters,
        page,
      }),
      canManage ? listSuppliers(clinicId, { onlyActive: true }) : Promise.resolve([]),
      canManage ? listPaymentMethods(clinicId) : Promise.resolve([]),
    ]),
  );

  // Cards de fluxo = MÊS corrente (não o dia): recebido/pago/saldo do mês. Os
  // totais "a receber/a pagar" já são o aberto geral (independem da janela).
  const { from, to } = clinicMonthBounds(tz);

  // Nome do paciente resolvido na CAMADA PAGE, como no Caixa: o Financial não
  // conhece Patient, então nada de JOIN cross-context. A referência põe o nome
  // na linha porque "Atendimento - Consulta" repetido seis vezes não identifica
  // lançamento nenhum — o operador precisa saber de QUEM é a cobrança.
  const patientIds = [
    ...new Set(lancamentosResult.items.filter((l) => l.patientId).map((l) => l.patientId!)),
  ];

  const [flow, patientCards, advanceCredits] = await withQueryDeadline(
    'financeiro.flow',
    Promise.all([
      getCashFlowToday(clinicId, from, to),
      listPatientCards(clinicId, patientIds),
      getAvailablePatientCreditSummary(clinicId),
    ]),
  );
  const nomeDoPaciente = new Map(patientCards.map((card) => [card.id, card.nome]));
  const nomeDoFornecedor = new Map(suppliers.map((s) => [s.id, s.razaoSocial]));

  const totalPages = Math.max(1, Math.ceil(lancamentosResult.total / lancamentosResult.pageSize));
  if (page > totalPages) {
    redirect(financeiroPageHref(paginationFilters, totalPages));
  }
  const lancamentos = lancamentosResult.items;

  // A faixa vem do MÊS de `from`, não de aritmética sobre `to`. `to` é um
  // instante exclusivo e subtrair milissegundos dele depende do offset exato do
  // fuso — `Date.UTC(ano, mes, 0)` devolve o último dia do mês sem essa dança.
  const [anoMes, mesMes] = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
  })
    .format(from)
    .split('-')
    .map(Number);
  const mm = String(mesMes).padStart(2, '0');
  /**
   * dd/MM no fuso da clínica — a referência não repete o ano em toda linha.
   *
   * Recebe as DUAS formas que a tabela tem: `dueDate` é uma data civil sem hora
   * (`YYYY-MM-DD`), e ancorá-la ao meio-dia UTC evita que o fuso a jogue para o
   * dia anterior; `createdAt` já é um instante ISO completo e não pode receber
   * sufixo nenhum — concatenar hora nele produzia `Invalid Date`.
   */
  const diaCurto = (iso: string | Date | null) => {
    if (!iso) return '—';
    const instante =
      typeof iso === 'string'
        ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00Z` : iso)
        : iso;
    if (Number.isNaN(instante.getTime())) return '—';
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: tz,
      day: '2-digit',
      month: '2-digit',
    }).format(instante);
  };
  const hojeYmd = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
  /** Dias de atraso de um vencimento ainda em aberto; 0 quando não venceu. */
  const diasVencido = (l: LancamentoSummary) => {
    if (l.dueDate == null || (l.status !== 'pendente' && l.status !== 'parcial')) return 0;
    if (l.dueDate >= hojeYmd) return 0;
    return Math.max(
      1,
      Math.round(
        (Date.parse(`${hojeYmd}T00:00:00Z`) - Date.parse(`${l.dueDate}T00:00:00Z`)) / 86_400_000,
      ),
    );
  };
  const ultimoDia = new Date(Date.UTC(anoMes!, mesMes!, 0)).getUTCDate();
  const periodoLabel = `01/${mm}/${anoMes} – ${ultimoDia}/${mm}/${anoMes}`;

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Gestão' }, { label: 'Financeiro' }]}
        title="Financeiro"
        description={`Visão gerencial de ${new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: tz }).format(from)}`}
        meta={
          <span className="font-mono tabular-nums">
            atualizado{' '}
            {new Intl.DateTimeFormat('pt-BR', {
              timeZone: tz,
              hourCycle: 'h23',
              hour: '2-digit',
              minute: '2-digit',
            }).format(new Date())}
          </span>
        }
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
              hint={`${flow.contagens.receber} lançamento${flow.contagens.receber === 1 ? '' : 's'}${flow.contagens.receberVencidos > 0 ? ` · ${flow.contagens.receberVencidos} vencido${flow.contagens.receberVencidos === 1 ? '' : 's'}` : ''}`}
            />
            <FinancialMetric
              label="Recebido no mês"
              value={flow.recebidoHoje}
              icon={<Check />}
              tone="positive"
              hint={`${flow.contagens.recebimentos} recebimento${flow.contagens.recebimentos === 1 ? '' : 's'}`}
            />
          </FinancialMetricGroup>
          <FinancialMetricGroup title="Saídas">
            <FinancialMetric
              label="A pagar"
              value={flow.pagar}
              icon={<ArrowUpRight />}
              hint={`${flow.contagens.pagar} lançamento${flow.contagens.pagar === 1 ? '' : 's'}`}
            />
            <FinancialMetric
              label="Pago no mês"
              value={flow.pagoHoje}
              icon={<Check />}
              hint={`${flow.contagens.pagamentos} pagamento${flow.contagens.pagamentos === 1 ? '' : 's'}`}
            />
          </FinancialMetricGroup>
          <FinancialMetricGroup title="Saldo do mês">
            <FinancialMetric
              label="Recebido menos pago"
              value={flow.saldoHoje}
              icon={<Scale />}
              tone={flow.saldoHoje >= 0 ? 'balance' : 'negative'}
              hint={`até ${diaCurto(new Date())}, fuso da clínica`}
              emphasis
            />
          </FinancialMetricGroup>
        </section>

        <section
          aria-label="Créditos antecipados e excedentes"
          className="qoro-section flex flex-wrap items-center justify-between gap-4 px-4 py-3"
        >
          <div>
            <h2 className="text-sm font-semibold text-fg">Créditos antecipados e excedentes</h2>
            <p className="mt-1 font-mono text-xl font-semibold tabular-nums text-fg">
              {formatBRL(advanceCredits.amount)}
            </p>
            <p className="text-xs text-fg-muted">
              {advanceCredits.count} crédito{advanceCredits.count === 1 ? '' : 's'} com saldo não
              aplicado
            </p>
          </div>
          <p className="max-w-xl text-sm leading-relaxed text-fg-muted">
            Pagamentos confirmados ainda não aplicados a um recebível. Podem anteceder a consulta ou
            ser um excedente. Este saldo não entra em “A receber”. Após a consulta, o crédito é
            aplicado ao recebível; se cobrir o valor integral, o atendimento fica pago.
          </p>
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
          {/* Faixa do mês ao lado do aviso: é o recorte que os números acima
              usam, e sem ele "do mês" fica sem começo nem fim. */}
          <span className="shrink-0 font-mono tabular-nums">{periodoLabel}</span>
        </div>

        <DataTable
          total={lancamentos.length === 0 ? 0 : lancamentosResult.total}
          page={page}
          pageCount={totalPages}
          pageSize={lancamentosResult.pageSize}
          unit={{ one: 'lançamento', many: 'lançamentos' }}
          hrefFor={(targetPage) => financeiroPageHref(paginationFilters, targetPage)}
          hint="Ordenado pelos mais recentes"
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
                  {/* A natureza vira sinal VISUAL: seta para dentro em verde,
                      para fora em cinza. Antes era só texto e obrigava a ler
                      a linha inteira para saber se o dinheiro entra ou sai. */}
                  <TableCellStack
                    main={[
                      l.snapshotProcedureName ?? l.descricao,
                      l.patientId
                        ? nomeDoPaciente.get(l.patientId)
                        : l.supplierId
                          ? nomeDoFornecedor.get(l.supplierId)
                          : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    sub={
                      <span
                        className={cn(
                          'inline-flex items-center gap-1.5 font-semibold',
                          l.tipo === 'receber' ? 'text-success-700' : 'text-fg-muted',
                        )}
                      >
                        {l.tipo === 'receber' ? (
                          <ArrowDownLeft aria-hidden="true" className="size-3" />
                        ) : (
                          <ArrowUpRight aria-hidden="true" className="size-3" />
                        )}
                        {l.tipo === 'receber' ? 'A receber' : 'A pagar'}
                      </span>
                    }
                  />
                </TableCell>
                <TableCell className="font-mono text-xs whitespace-nowrap text-fg-subtle tabular-nums">
                  {diaCurto(l.createdAt)}
                </TableCell>
                <TableCell
                  className={cn(
                    'font-mono text-xs whitespace-nowrap tabular-nums',
                    // Vencimento em atraso é o dado que decide a próxima ação
                    // da linha; em cinza ele se perdia entre as outras datas.
                    diasVencido(l) > 0 ? 'font-semibold text-danger-700' : 'text-fg-muted',
                  )}
                >
                  {diaCurto(l.dueDate)}
                </TableCell>
                <TableCell>
                  {/* O parcial no prazo é o único caso com badge próprio: numa
                      tabela, "quanto ainda falta" é a resposta que o operador
                      viria buscar, e ela não cabe no badge compartilhado. */}
                  {diasVencido(l) === 0 && l.status === 'parcial' ? (
                    <Badge tone="blue">
                      <CircleDot aria-hidden="true" className="size-3 shrink-0" />
                      Parcial · {formatBRL(l.valor - l.valorPago - l.valorGlosado)} em aberto
                    </Badge>
                  ) : (
                    <PaymentStatusBadge
                      status={l.status}
                      overdue={diasVencido(l) > 0}
                      overdueDays={diasVencido(l)}
                    />
                  )}
                </TableCell>
                <TableCell
                  numeric
                  className={cn(
                    'font-mono text-xs font-medium whitespace-nowrap',
                    l.status === 'pago' && l.tipo === 'receber' ? 'text-success-700' : 'text-fg',
                  )}
                >
                  {l.tipo === 'receber' ? '+' : '−'} {formatBRL(l.valor)}
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
