import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowDownLeft, ArrowUpRight, Filter, Info, Truck, Wallet } from 'lucide-react';

import { clinicMonthBounds } from '@/contexts/financial/logic';
import {
  getAvailablePatientCreditSummary,
  getCashFlowToday,
  getOpenReceivablesByOrigin,
  listLancamentosPage,
  listPaymentMethods,
  listSuppliers,
  type LancamentoOrigem,
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
import { LinkSegmented } from '@/components/ui/link-segmented';
import { MetricStrip } from '@/components/ui/metric-strip';
import { PageActions } from '@/components/ui/page-actions';
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
import { requirePageUser } from '@/lib/auth/page-guard';
import { requireClinicId } from '@/lib/auth/tenant-context';
import { withQueryDeadline } from '@/lib/db/query-timeout';
import { formatBRL } from '@/lib/format';
import { cn } from '@/lib/ui/cn';

import { NewLancamentoDrawer } from './new-lancamento-drawer';
import { financeiroPageHref, parseFinanceiroPage } from './pagination';

import styles from './financeiro.module.css';

export const dynamic = 'force-dynamic';

type SP = { tipo?: string; status?: string; origem?: string; novo?: string; page?: string };

const isTipo = (v: string | undefined): v is LancamentoTipo => v === 'receber' || v === 'pagar';
const isStatus = (v: string | undefined): v is LancamentoStatus =>
  v === 'pendente' || v === 'parcial' || v === 'pago' || v === 'cancelado' || v === 'estornado';
// P10.6: paciente × operadora (recebível de guia de convênio, mantido pelo Convênios).
const isOrigem = (v: string | undefined): v is LancamentoOrigem =>
  v === 'paciente' || v === 'operadora';

export default async function FinanceiroPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePageUser();
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
  const { tipo, status, origem, novo, page: rawPage } = await searchParams;
  const tipoFilter = isTipo(tipo) ? tipo : undefined;
  const statusFilter = isStatus(status) ? status : undefined;
  const origemFilter = isOrigem(origem) ? origem : undefined;
  const paginationFilters = {
    ...(tipoFilter ? { tipo: tipoFilter } : {}),
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(origemFilter ? { origem: origemFilter } : {}),
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

  const [flow, patientCards, advanceCredits, byOrigin] = await withQueryDeadline(
    'financeiro.flow',
    Promise.all([
      getCashFlowToday(clinicId, from, to),
      listPatientCards(clinicId, patientIds),
      getAvailablePatientCreditSummary(clinicId),
      getOpenReceivablesByOrigin(clinicId),
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
  const mesExtenso = new Intl.DateTimeFormat('pt-BR', {
    month: 'long',
    year: 'numeric',
    timeZone: tz,
  }).format(from);
  const mesTitulo = mesExtenso.charAt(0).toUpperCase() + mesExtenso.slice(1);

  return (
    <>
      <PageHeader
        icon={<Wallet aria-hidden="true" />}
        title="Financeiro"
        headline={mesTitulo}
        description={`Atualizado às ${new Intl.DateTimeFormat('pt-BR', {
          timeZone: tz,
          hourCycle: 'h23',
          hour: '2-digit',
          minute: '2-digit',
        }).format(new Date())}`}
        actions={
          // UX-012: abaixo de 768 px "Fornecedores" entra em "Mais ações" e
          // "Novo lançamento" fica à vista — a 320 px eram 2 linhas de botões.
          <PageActions
            label="Ações do financeiro"
            secondary={[
              {
                href: '/financeiro/fornecedores',
                label: 'Fornecedores',
                icon: <Truck aria-hidden="true" className="size-4" />,
              },
            ]}
            primary={
              canManage ? (
                <NewLancamentoDrawer
                  suppliers={suppliers}
                  methods={methods}
                  defaultOpen={novo === '1'}
                />
              ) : null
            }
          />
        }
        controls={
          <>
            <LinkSegmented
              label="Tipo de lançamento"
              items={[
                { label: 'Todos os tipos', tipo: undefined },
                { label: 'A receber', tipo: 'receber' as const },
                { label: 'A pagar', tipo: 'pagar' as const },
              ].map((option) => ({
                label: option.label,
                href: financeiroPageHref(
                  {
                    ...(option.tipo ? { tipo: option.tipo } : {}),
                    ...(statusFilter ? { status: statusFilter } : {}),
                    ...(origemFilter ? { origem: origemFilter } : {}),
                  },
                  1,
                ),
                active: tipoFilter === option.tipo,
              }))}
            />
            <form className="flex flex-wrap items-center gap-2">
              {tipoFilter ? <input type="hidden" name="tipo" value={tipoFilter} /> : null}
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
              {/* P10.6: o recebível da operadora (guia de convênio) separado do que o paciente paga. */}
              <Select
                name="origem"
                defaultValue={origemFilter ?? ''}
                aria-label="Filtrar por origem"
                className="w-52"
              >
                <option value="">Todas as origens</option>
                <option value="paciente">Pacientes e outros</option>
                <option value="operadora">Operadoras de convênio</option>
              </Select>
              <button type="submit" className={buttonVariants({ variant: 'secondary' })}>
                <Filter aria-hidden="true" className="size-4" />
                Filtrar
              </button>
            </form>
          </>
        }
      />

      <div className={styles.page}>
        <MetricStrip variant="joined" className={styles.metrics ?? ''}>
          <StatCard
            label="A receber"
            value={formatBRL(flow.receber)}
            valueTone="warning"
            hint={
              <>
                {`${flow.contagens.receber} lançamento${flow.contagens.receber === 1 ? '' : 's'}${flow.contagens.receberVencidos > 0 ? ` · ${flow.contagens.receberVencidos} vencido${flow.contagens.receberVencidos === 1 ? '' : 's'}` : ''}`}
                {byOrigin.operadora.qtd > 0 ? (
                  // P10.6: quanto do aberto é do paciente e quanto é da operadora (glosa definitiva fora).
                  <span data-receivable-split className="block">
                    Pacientes {formatBRL(byOrigin.paciente.valor)} · Operadoras{' '}
                    {formatBRL(byOrigin.operadora.valor)}
                  </span>
                ) : null}
              </>
            }
          />
          <StatCard
            label="Recebido no mês"
            value={formatBRL(flow.recebidoHoje)}
            valueTone="positive"
            hint={`${flow.contagens.recebimentos} recebimento${flow.contagens.recebimentos === 1 ? '' : 's'}`}
          />
          <StatCard
            label="A pagar"
            value={formatBRL(flow.pagar)}
            hint={`${flow.contagens.pagar} lançamento${flow.contagens.pagar === 1 ? '' : 's'}`}
          />
          <StatCard
            label="Pago no mês"
            value={formatBRL(flow.pagoHoje)}
            hint={`${flow.contagens.pagamentos} pagamento${flow.contagens.pagamentos === 1 ? '' : 's'}`}
          />
          <StatCard
            label="Saldo do mês"
            value={formatBRL(flow.saldoHoje)}
            valueTone={flow.saldoHoje >= 0 ? 'default' : 'negative'}
            hint={`Recebido menos pago, até ${diaCurto(new Date())}`}
          />
        </MetricStrip>

        <div className={styles.halves}>
          <section aria-label="Créditos antecipados e excedentes" className={styles.credits}>
            <div className={styles.creditsValue}>
              <h2>Créditos antecipados e excedentes</h2>
              <p className={styles.amount}>{formatBRL(advanceCredits.amount)}</p>
              <p>
                {advanceCredits.count} crédito{advanceCredits.count === 1 ? '' : 's'} com saldo não
                aplicado
              </p>
            </div>
            <p className={styles.creditsNote}>
              Pagamentos confirmados ainda não aplicados a um recebível. Podem anteceder a consulta
              ou ser um excedente. Este saldo não entra em “A receber”. Após a consulta, o crédito é
              aplicado ao recebível; se cobrir o valor integral, o atendimento fica pago.
            </p>
          </section>

          <div className={styles.notice}>
            <Info aria-hidden="true" />
            <p>
              Esta é a visão gerencial do mês. Recebimentos e pagamentos do dia são operados no{' '}
              <Link href="/caixa" className="font-semibold text-link hover:underline">
                Caixa
              </Link>
              .
            </p>
            {/* Faixa do mês ao lado do aviso: é o recorte que os números acima
              usam, e sem ele "do mês" fica sem começo nem fim. */}
            <span className={styles.period}>{periodoLabel}</span>
          </div>
        </div>

        <DataTable
          title="Lançamentos"
          description={`${lancamentosResult.total} ${lancamentosResult.total === 1 ? 'lançamento' : 'lançamentos'} · mais recentes primeiro`}
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
                        {l.sourceHiGuideId ? (
                          // P10.6: recebível da operadora; quem cuida é o Convênios, não o Caixa.
                          <Badge tone="gray" data-origin="operadora">
                            Operadora
                          </Badge>
                        ) : null}
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
                    <Badge tone="amber" dot>
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
