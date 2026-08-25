/**
 * Financial read-side (C9). Tudo tenant-scoped via withTenant (RLS resolve por
 * `app.current_clinic`). REGRA: sem JOIN cross-context — nomes de paciente são
 * resolvidos na camada page (que pode importar o contexto patient), não aqui.
 *
 * Server-only.
 */
import 'server-only';

import { and, desc, eq, gte, inArray, lt, or, sql } from 'drizzle-orm';

import { withTenant } from '@/lib/db/tenant';

import {
  cashFlowDaily,
  collectionCases,
  faturamentoPendencias,
  lancamentos,
  paymentMethods,
  paymentTransactions,
  suppliers,
  type LancamentoRow,
  type PaymentTransactionRow,
  type SupplierRow,
} from './schema';
import type {
  CashFlowDTO,
  CollectionCaseDTO,
  FaturamentoPendenciaDTO,
  LancamentoCreatedVia,
  LancamentoStatus,
  LancamentoSummary,
  LancamentoTipo,
  PaymentMethodDTO,
  PaymentTransactionSummary,
  SupplierSummary,
} from './types';

const toIso = (v: Date | string | null | undefined): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : v;

const num = (v: string | number | null | undefined): number => (v == null ? 0 : Number(v));
const roundMoney = (v: number): number => Math.round((v + Number.EPSILON) * 100) / 100;
const DEFAULT_TZ = 'America/Sao_Paulo';

/**
 * Compatibilidade para actions do contexto financeiro: a página usa o read
 * model de tenancy cacheado; este fluxo interno continua sob a fronteira do
 * próprio contexto, sem atravessar as regras de dependência entre contexts.
 */
export async function getClinicTimezone(clinicId: string): Promise<string> {
  return withTenant(clinicId, async (tx) => {
    const rows = await tx.execute<{ timezone: string | null }>(
      sql`SELECT timezone FROM clinics WHERE id = ${clinicId} LIMIT 1`,
    );
    return rows[0]?.timezone ?? DEFAULT_TZ;
  });
}

export function toLancamentoSummary(row: LancamentoRow): LancamentoSummary {
  return {
    id: row.id,
    clinicId: row.clinicId,
    unitId: row.unitId ?? null,
    tipo: row.tipo as LancamentoTipo,
    descricao: row.descricao,
    valor: num(row.valor),
    valorPago: num(row.valorPago),
    status: row.status as LancamentoStatus,
    dueDate: (row.dueDate as string | null) ?? null,
    paidAt: toIso(row.paidAt),
    patientId: row.patientId ?? null,
    supplierId: row.supplierId ?? null,
    appointmentId: row.appointmentId ?? null,
    paymentMethod: row.paymentMethod ?? null,
    createdVia: row.createdVia as LancamentoCreatedVia,
    reversesLancamentoId: row.reversesLancamentoId ?? null,
    snapshotProcedureName: row.snapshotProcedureName ?? null,
    snapshotDoctorNome: row.snapshotDoctorNome ?? null,
    createdAt: toIso(row.createdAt)!,
  };
}

export function toPaymentTransactionSummary(
  row: PaymentTransactionRow,
  refundable: number,
): PaymentTransactionSummary {
  return {
    id: row.id,
    clinicId: row.clinicId,
    lancamentoId: row.lancamentoId,
    kind: row.kind,
    amount: num(row.amount),
    paymentMethod: row.paymentMethod ?? null,
    occurredAt: toIso(row.occurredAt)!,
    originalPaymentId: row.originalPaymentId ?? null,
    reason: row.reason ?? null,
    createdBy: row.createdBy ?? null,
    refundableAmount: refundable,
  };
}

export async function listPaymentTransactionsForLancamentos(
  clinicId: string,
  lancamentoIds: readonly string[],
): Promise<PaymentTransactionSummary[]> {
  if (lancamentoIds.length === 0) return [];
  return withTenant(clinicId, async (tx) => {
    const rows = await tx
      .select()
      .from(paymentTransactions)
      .where(
        and(
          eq(paymentTransactions.clinicId, clinicId),
          inArray(paymentTransactions.lancamentoId, [...lancamentoIds]),
        ),
      )
      .orderBy(desc(paymentTransactions.occurredAt));

    const refundedByPayment = new Map<string, number>();
    for (const row of rows) {
      if (row.kind === 'refund' && row.originalPaymentId) {
        refundedByPayment.set(
          row.originalPaymentId,
          num(refundedByPayment.get(row.originalPaymentId)) + num(row.amount),
        );
      }
    }
    return rows.map((row) =>
      toPaymentTransactionSummary(
        row,
        row.kind === 'payment'
          ? Math.max(0, roundMoney(num(row.amount) - num(refundedByPayment.get(row.id))))
          : 0,
      ),
    );
  });
}

/**
 * C12 — cobranças PENDENTES de um paciente (a receber; pendente ou parcial).
 * Read-only; consumida pela tool list_pending_payments do AI Agent (com gating
 * de identidade por telefone verificado feito na saga). Sem JOIN cross-context
 * (patientId é coluna). A IA NUNCA cria/edita cobrança (par.12 — proibido).
 */
export async function listPendingByPatient(
  clinicId: string,
  patientId: string,
): Promise<LancamentoSummary[]> {
  return withTenant(clinicId, async (tx) => {
    const rows = await tx
      .select()
      .from(lancamentos)
      .where(
        and(
          eq(lancamentos.clinicId, clinicId),
          eq(lancamentos.patientId, patientId),
          eq(lancamentos.tipo, 'receber'),
          inArray(lancamentos.status, ['pendente', 'parcial']),
        ),
      )
      .orderBy(desc(lancamentos.createdAt))
      .limit(50);
    return rows.map(toLancamentoSummary);
  });
}

/**
 * Saldo em aberto do recebível de um atendimento (ADR-051 1.5b.3a).
 *
 * **Por que este seam existe:** o Payments precisa saber quanto ainda falta para
 * decidir se cobra o restante — e essa resposta é do FINANCIAL, que é a fonte da
 * verdade. Se o Payments calculasse por conta própria (valor do procedimento
 * menos o que ELE recebeu), um pagamento feito em dinheiro na recepção e lançado
 * no Caixa não apareceria: o paciente receberia um link cobrando algo que já
 * pagou. É o pior desfecho possível desta fase.
 *
 * `null` quando não há recebível do atendimento — e `null` significa **não
 * cobrar**, o mesmo modo de falha seguro do `resolveDepositAmount`.
 *
 * Estados terminais (`cancelado`, `estornado`) são excluídos: não há saldo a
 * perseguir num lançamento que deixou de existir como obrigação.
 */
export async function getAppointmentBalance(
  clinicId: string,
  appointmentId: string,
): Promise<{ lancamentoId: string; valor: number; valorPago: number; saldo: number } | null> {
  return withTenant(clinicId, async (tx) => {
    const [row] = await tx
      .select({
        id: lancamentos.id,
        valor: lancamentos.valor,
        valorPago: lancamentos.valorPago,
      })
      .from(lancamentos)
      .where(
        and(
          eq(lancamentos.clinicId, clinicId),
          eq(lancamentos.appointmentId, appointmentId),
          eq(lancamentos.tipo, 'receber'),
          inArray(lancamentos.status, ['pendente', 'parcial']),
        ),
      )
      .limit(1);
    if (!row) return null;
    const valor = Number(row.valor);
    const valorPago = Number(row.valorPago);
    return {
      lancamentoId: row.id,
      valor,
      valorPago,
      saldo: Math.round((valor - valorPago + Number.EPSILON) * 100) / 100,
    };
  });
}

// --- Caixa -----------------------------------------------------------------

export interface CaixaLancamentos {
  pendentes: LancamentoSummary[];
  parciais: LancamentoSummary[];
  pagosHoje: LancamentoSummary[];
}

/**
 * Recebimentos do Caixa: pendentes, parciais e pagos hoje (janela tz da clínica
 * computada na page). Uma query, split em JS — o operador vê tudo numa carga.
 */
export async function getCaixaLancamentos(
  clinicId: string,
  todayFrom: Date,
  todayTo: Date,
): Promise<CaixaLancamentos> {
  return withTenant(clinicId, async (tx) => {
    const rows = await tx
      .select()
      .from(lancamentos)
      .where(
        and(
          eq(lancamentos.tipo, 'receber'),
          or(
            inArray(lancamentos.status, ['pendente', 'parcial']),
            and(
              eq(lancamentos.status, 'pago'),
              gte(lancamentos.paidAt, todayFrom),
              lt(lancamentos.paidAt, todayTo),
            ),
          ),
        ),
      )
      .orderBy(lancamentos.dueDate, lancamentos.createdAt);

    const out: CaixaLancamentos = { pendentes: [], parciais: [], pagosHoje: [] };
    for (const r of rows) {
      const s = toLancamentoSummary(r);
      if (s.status === 'pendente') out.pendentes.push(s);
      else if (s.status === 'parcial') out.parciais.push(s);
      else out.pagosHoje.push(s);
    }
    return out;
  });
}

/**
 * Contas A PAGAR em aberto (visibilidade no Caixa — antes só mostrava a receber).
 * Read-only: a baixa de pagáveis mora em /financeiro; aqui é só panorama. Não
 * altera nenhuma soma de "a receber" (aditivo).
 */
export async function getCaixaPagaveis(clinicId: string): Promise<LancamentoSummary[]> {
  return withTenant(clinicId, async (tx) => {
    const rows = await tx
      .select()
      .from(lancamentos)
      .where(
        and(eq(lancamentos.tipo, 'pagar'), inArray(lancamentos.status, ['pendente', 'parcial'])),
      )
      .orderBy(lancamentos.dueDate, lancamentos.createdAt);
    return rows.map(toLancamentoSummary);
  });
}

export async function getLancamento(
  clinicId: string,
  id: string,
): Promise<LancamentoSummary | null> {
  return withTenant(clinicId, async (tx) => {
    const [row] = await tx.select().from(lancamentos).where(eq(lancamentos.id, id)).limit(1);
    return row ? toLancamentoSummary(row) : null;
  });
}

// --- pendências de faturamento (banner) ------------------------------------

export async function listPendenciasAbertas(clinicId: string): Promise<FaturamentoPendenciaDTO[]> {
  return withTenant(clinicId, async (tx) => {
    const rows = await tx
      .select()
      .from(faturamentoPendencias)
      .where(eq(faturamentoPendencias.status, 'aberta'))
      .orderBy(desc(faturamentoPendencias.createdAt))
      .limit(100);
    return rows.map((r) => ({
      id: r.id,
      appointmentId: r.appointmentId,
      motivo: r.motivo,
      valor: r.valor == null ? null : Number(r.valor),
      createdAt: toIso(r.createdAt)!,
    }));
  });
}

export async function countPendenciasAbertas(clinicId: string): Promise<number> {
  return withTenant(clinicId, async (tx) => {
    const [r] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(faturamentoPendencias)
      .where(eq(faturamentoPendencias.status, 'aberta'));
    return r?.n ?? 0;
  });
}

export async function listOpenCollectionCases(clinicId: string): Promise<CollectionCaseDTO[]> {
  return withTenant(clinicId, async (tx) => {
    const rows = await tx
      .select()
      .from(collectionCases)
      .where(and(eq(collectionCases.clinicId, clinicId), eq(collectionCases.status, 'open')))
      .orderBy(desc(collectionCases.daysOverdue))
      .limit(100);
    return rows.map((row) => ({
      id: row.id,
      lancamentoId: row.lancamentoId,
      stage: row.stage,
      daysOverdue: row.daysOverdue,
      residualAmount: num(row.residualAmount),
      createdAt: toIso(row.createdAt)!,
    }));
  });
}

// --- fluxo de caixa (ao vivo) ----------------------------------------------

/**
 * Snapshot ao vivo do dia. `recebidoHoje`/`pagoHoje` contam lançamentos que
 * ficaram `pago` hoje (paid_at na janela) — pagamentos parciais entram só ao
 * fechar (modelo simples, sem ledger de pagamentos). Estornos (status='estornado')
 * saem de todas as somas, então pagar+estornar no mesmo dia neta a zero.
 */
export async function getCashFlowToday(
  clinicId: string,
  todayFrom: Date,
  todayTo: Date,
): Promise<CashFlowDTO> {
  return withTenant(clinicId, async (tx) => {
    const [aberto] = await tx
      .select({
        receber: sql<string>`coalesce(sum(case when ${lancamentos.tipo} = 'receber' then ${lancamentos.valor} - ${lancamentos.valorPago} else 0 end), 0)`,
        pagar: sql<string>`coalesce(sum(case when ${lancamentos.tipo} = 'pagar' then ${lancamentos.valor} - ${lancamentos.valorPago} else 0 end), 0)`,
      })
      .from(lancamentos)
      .where(inArray(lancamentos.status, ['pendente', 'parcial']));

    const [liquidado] = await tx
      .select({
        recebidoHoje: sql<string>`coalesce(sum(case
          when (${lancamentos.tipo} = 'receber' and ${paymentTransactions.kind} = 'payment')
            or (${lancamentos.tipo} = 'pagar' and ${paymentTransactions.kind} = 'refund')
          then ${paymentTransactions.amount} else 0 end), 0)`,
        pagoHoje: sql<string>`coalesce(sum(case
          when (${lancamentos.tipo} = 'pagar' and ${paymentTransactions.kind} = 'payment')
            or (${lancamentos.tipo} = 'receber' and ${paymentTransactions.kind} = 'refund')
          then ${paymentTransactions.amount} else 0 end), 0)`,
      })
      .from(paymentTransactions)
      .innerJoin(lancamentos, eq(lancamentos.id, paymentTransactions.lancamentoId))
      .where(
        and(
          eq(paymentTransactions.clinicId, clinicId),
          gte(paymentTransactions.occurredAt, todayFrom),
          lt(paymentTransactions.occurredAt, todayTo),
        ),
      );

    const recebidoHoje = num(liquidado?.recebidoHoje);
    const pagoHoje = num(liquidado?.pagoHoje);
    return {
      receber: num(aberto?.receber),
      pagar: num(aberto?.pagar),
      recebidoHoje,
      pagoHoje,
      saldoHoje: Math.round((recebidoHoje - pagoHoje) * 100) / 100,
    };
  });
}

/**
 * Faturamento de um PERÍODO (Relatórios): soma o que ficou `pago` com paid_at na
 * janela [from, to). Mesma semântica do getCashFlowToday (não depende do rollup
 * cash_flow_daily estar populado). Estornos (status='estornado') ficam de fora.
 */
export async function getFaturamentoPeriodo(
  clinicId: string,
  from: Date,
  to: Date,
): Promise<{ recebido: number; pago: number; saldo: number }> {
  return withTenant(clinicId, async (tx) => {
    const [r] = await tx
      .select({
        recebido: sql<string>`coalesce(sum(case
          when (${lancamentos.tipo} = 'receber' and ${paymentTransactions.kind} = 'payment')
            or (${lancamentos.tipo} = 'pagar' and ${paymentTransactions.kind} = 'refund')
          then ${paymentTransactions.amount} else 0 end), 0)`,
        pago: sql<string>`coalesce(sum(case
          when (${lancamentos.tipo} = 'pagar' and ${paymentTransactions.kind} = 'payment')
            or (${lancamentos.tipo} = 'receber' and ${paymentTransactions.kind} = 'refund')
          then ${paymentTransactions.amount} else 0 end), 0)`,
      })
      .from(paymentTransactions)
      .innerJoin(lancamentos, eq(lancamentos.id, paymentTransactions.lancamentoId))
      .where(
        and(
          eq(paymentTransactions.clinicId, clinicId),
          gte(paymentTransactions.occurredAt, from),
          lt(paymentTransactions.occurredAt, to),
        ),
      );
    const recebido = num(r?.recebido);
    const pago = num(r?.pago);
    return { recebido, pago, saldo: Math.round((recebido - pago) * 100) / 100 };
  });
}

export interface AppointmentReceiptTotal {
  appointmentId: string;
  recebido: number;
}

/**
 * Total líquido recebido por atendimento. O chamador fornece IDs tenant-scoped
 * vindos de Scheduling; a consulta agrega pagamentos e reembolsos no banco sem
 * acessar tabelas de outro contexto.
 */
export async function getRecebimentosByAppointment(
  clinicId: string,
  appointmentIds: string[],
): Promise<AppointmentReceiptTotal[]> {
  if (appointmentIds.length === 0) return [];

  return withTenant(clinicId, async (tx) => {
    const rows = await tx
      .select({
        appointmentId: lancamentos.appointmentId,
        recebido: sql<string>`coalesce(sum(case
          when ${paymentTransactions.kind} = 'payment' then ${paymentTransactions.amount}
          when ${paymentTransactions.kind} = 'refund' then -${paymentTransactions.amount}
          else 0 end), 0)`,
      })
      .from(paymentTransactions)
      .innerJoin(lancamentos, eq(lancamentos.id, paymentTransactions.lancamentoId))
      .where(
        and(
          eq(paymentTransactions.clinicId, clinicId),
          eq(lancamentos.clinicId, clinicId),
          eq(lancamentos.tipo, 'receber'),
          inArray(lancamentos.appointmentId, appointmentIds),
        ),
      )
      .groupBy(lancamentos.appointmentId);

    return rows.flatMap((row) =>
      row.appointmentId == null
        ? []
        : [{ appointmentId: row.appointmentId, recebido: roundMoney(num(row.recebido)) }],
    );
  });
}

/** Histórico consolidado (cash_flow_daily) — Fase 2 dashboard. */
export async function listCashFlowDaily(
  clinicId: string,
  fromDate: string,
  toDate: string,
): Promise<Array<{ date: string; totalRecebido: number; totalPago: number; saldo: number }>> {
  return withTenant(clinicId, async (tx) => {
    const rows = await tx
      .select()
      .from(cashFlowDaily)
      .where(and(gte(cashFlowDaily.date, fromDate), lt(cashFlowDaily.date, toDate)))
      .orderBy(cashFlowDaily.date);
    return rows.map((r) => ({
      date: r.date as string,
      totalRecebido: num(r.totalRecebido),
      totalPago: num(r.totalPago),
      saldo: num(r.saldo),
    }));
  });
}

// --- lançamentos (Fase 2 dashboard) + fornecedores -------------------------

export interface ListLancamentosFilter {
  tipo?: LancamentoTipo;
  status?: LancamentoStatus;
  limit?: number;
}

export interface ListLancamentosPageFilter {
  tipo?: LancamentoTipo;
  status?: LancamentoStatus;
  page?: number;
  pageSize?: number;
}

export interface PaginatedLancamentos {
  items: LancamentoSummary[];
  total: number;
  page: number;
  pageSize: number;
}

const DEFAULT_LANCAMENTOS_PAGE_SIZE = 50;
const MAX_LANCAMENTOS_PAGE_SIZE = 200;

export async function listLancamentos(
  clinicId: string,
  filter: ListLancamentosFilter = {},
): Promise<LancamentoSummary[]> {
  return withTenant(clinicId, async (tx) => {
    const conds = [] as ReturnType<typeof eq>[];
    if (filter.tipo) conds.push(eq(lancamentos.tipo, filter.tipo));
    if (filter.status) conds.push(eq(lancamentos.status, filter.status));
    const rows = await tx
      .select()
      .from(lancamentos)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(lancamentos.createdAt))
      .limit(filter.limit ?? 50);
    return rows.map(toLancamentoSummary);
  });
}

export async function listLancamentosPage(
  clinicId: string,
  filter: ListLancamentosPageFilter = {},
): Promise<PaginatedLancamentos> {
  const requestedPage = filter.page;
  const requestedPageSize = filter.pageSize;
  const page =
    typeof requestedPage === 'number' && Number.isSafeInteger(requestedPage) && requestedPage > 0
      ? requestedPage
      : 1;
  const pageSize =
    typeof requestedPageSize === 'number' &&
    Number.isSafeInteger(requestedPageSize) &&
    requestedPageSize > 0
      ? Math.min(requestedPageSize, MAX_LANCAMENTOS_PAGE_SIZE)
      : DEFAULT_LANCAMENTOS_PAGE_SIZE;
  const offset = (page - 1) * pageSize;

  return withTenant(clinicId, async (tx) => {
    // RLS continua sendo a barreira autoritativa. O predicado explícito reduz a
    // superfície de erro e garante que lista e total usem exatamente o mesmo tenant.
    const conds = [eq(lancamentos.clinicId, clinicId)];
    if (filter.tipo) conds.push(eq(lancamentos.tipo, filter.tipo));
    if (filter.status) conds.push(eq(lancamentos.status, filter.status));
    const where = and(...conds);

    const [rows, [countRow]] = await Promise.all([
      tx
        .select()
        .from(lancamentos)
        .where(where)
        // created_at não é único; id fecha o empate para evitar itens pulando
        // entre páginas quando dois lançamentos são criados no mesmo instante.
        .orderBy(desc(lancamentos.createdAt), desc(lancamentos.id))
        .limit(pageSize)
        .offset(offset),
      tx
        .select({ total: sql<number>`count(*)::int` })
        .from(lancamentos)
        .where(where),
    ]);

    return {
      items: rows.map(toLancamentoSummary),
      total: Number(countRow?.total ?? 0),
      page,
      pageSize,
    };
  });
}

export function toSupplierSummary(r: SupplierRow): SupplierSummary {
  return {
    id: r.id,
    razaoSocial: r.razaoSocial,
    cnpj: r.cnpj ?? null,
    contato: r.contato ?? null,
    condicaoPagamento: r.condicaoPagamento ?? null,
    ativo: r.ativo,
    updatedAt: toIso(r.updatedAt),
  };
}

export async function listSuppliers(
  clinicId: string,
  opts: { onlyActive?: boolean } = {},
): Promise<SupplierSummary[]> {
  return withTenant(clinicId, async (tx) => {
    const rows = await tx
      .select()
      .from(suppliers)
      .where(opts.onlyActive ? eq(suppliers.ativo, true) : undefined)
      .orderBy(suppliers.razaoSocial);
    return rows.map(toSupplierSummary);
  });
}

/**
 * Catálogo global de formas de pagamento (ativas), p/ o dialog do Caixa.
 * payment_methods é GLOBAL (sem clinic_id) com policy read-all a authenticated;
 * lemos dentro de withTenant (role authenticated) — a GUC de tenant é inócua aqui.
 */
export async function listPaymentMethods(clinicId: string): Promise<PaymentMethodDTO[]> {
  return withTenant(clinicId, async (tx) => {
    const rows = await tx
      .select({ code: paymentMethods.code, label: paymentMethods.label })
      .from(paymentMethods)
      .where(eq(paymentMethods.ativo, true))
      .orderBy(paymentMethods.ordem);
    return rows.map((r) => ({ code: r.code, label: r.label }));
  });
}
