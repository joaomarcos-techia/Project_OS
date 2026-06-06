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
  faturamentoPendencias,
  lancamentos,
  paymentMethods,
  suppliers,
  type LancamentoRow,
  type SupplierRow,
} from './schema';
import type {
  CashFlowDTO,
  FaturamentoPendenciaDTO,
  LancamentoCreatedVia,
  LancamentoStatus,
  LancamentoSummary,
  LancamentoTipo,
  PaymentMethodDTO,
  SupplierSummary,
} from './types';

const toIso = (v: Date | string | null | undefined): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : v;

const num = (v: string | number | null | undefined): number => (v == null ? 0 : Number(v));

const DEFAULT_TZ = 'America/Sao_Paulo';

/**
 * Timezone da clínica (1 clínica = 1 tz). Leitura single-table da fundação
 * (tenancy.clinics) — mesmo padrão de scheduling.getClinicTimezone; não é JOIN
 * cross-context. Usada para computar a janela "hoje" do Caixa/fluxo de caixa.
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
        recebidoHoje: sql<string>`coalesce(sum(case when ${lancamentos.tipo} = 'receber' then ${lancamentos.valorPago} else 0 end), 0)`,
        pagoHoje: sql<string>`coalesce(sum(case when ${lancamentos.tipo} = 'pagar' then ${lancamentos.valorPago} else 0 end), 0)`,
      })
      .from(lancamentos)
      .where(
        and(
          eq(lancamentos.status, 'pago'),
          gte(lancamentos.paidAt, todayFrom),
          lt(lancamentos.paidAt, todayTo),
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

export function toSupplierSummary(r: SupplierRow): SupplierSummary {
  return {
    id: r.id,
    razaoSocial: r.razaoSocial,
    cnpj: r.cnpj ?? null,
    contato: r.contato ?? null,
    condicaoPagamento: r.condicaoPagamento ?? null,
    ativo: r.ativo,
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
