/**
 * P9.10 — relatório por operadora e período, com exportação CSV.
 *
 * Fonte única: a conta da guia (`hi_guide_accounts`, 0152), a mesma que alimenta o livro da clínica
 * (0153) e a conciliação: faturado = recebido + glosa definitiva + pendente, por guia. O período é o
 * da DATA DE ENVIO do lote à operadora (`hi_batches.sent_on`): é quando a guia vira cobrança.
 *
 * Indicadores (sem fórmula nova):
 *   - faturamento: faturado, recebido, glosa em aberto, glosa definitiva e pendente (somas da conta);
 *   - glosa: glosa definitiva ÷ faturado;
 *   - prazo médio: média, entre as guias que receberam algum pagamento, dos dias entre o envio e o
 *     último pagamento alocado a ela;
 *   - inadimplência: o pendente por idade desde o envio (até 30, 31–60, 61–90, mais de 90 dias). Não
 *     há prazo contratual de pagamento cadastrado por operadora, então "em atraso" na tela é o
 *     pendente com MAIS DE 30 DIAS do envio, e o rótulo diz isso.
 *
 * Nada de paciente, carteirinha, senha ou dado clínico: guia, lote, datas e valores.
 */
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import type { Tx } from '@/lib/db';

/** Teto de linhas por relatório (e por CSV): acima disso, pedir um período menor. */
export const REPORT_MAX_ROWS = 10_000;
/** Período máximo de uma consulta, em dias. */
export const REPORT_MAX_DAYS = 366;
/** Idade do pendente a partir da qual a tela mostra "em atraso" (sem prazo contratual cadastrado). */
export const OVERDUE_AFTER_DAYS = 30;

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
export const ReportFilter = z
  .object({
    from: ymd,
    to: ymd,
    insurerId: z.string().uuid().nullable().default(null),
  })
  .refine((f) => f.from <= f.to, { message: 'A data inicial precisa ser anterior à final.' })
  .refine((f) => daysBetween(f.from, f.to) <= REPORT_MAX_DAYS, { message: `Escolha um período de até ${REPORT_MAX_DAYS} dias.` });
export type ReportFilterInput = z.input<typeof ReportFilter>;

export class InsurerReportError extends Error {
  constructor(
    message: string,
    readonly code: 'invalid' | 'too_large',
  ) {
    super(message);
    this.name = 'InsurerReportError';
  }
}

export function daysBetween(fromYmd: string, toYmd: string): number {
  return Math.round((Date.parse(`${toYmd}T00:00:00Z`) - Date.parse(`${fromYmd}T00:00:00Z`)) / 86_400_000);
}

export interface ReportLine {
  insurerId: string;
  insurerName: string;
  guideId: string;
  guideType: 'consulta' | 'sp_sadt';
  guideNumber: string;
  guideStatus: string;
  batchNumber: string;
  sentOn: string;
  lastPaidOn: string | null;
  billedCents: number;
  paidCents: number;
  glossOpenCents: number;
  glossDefinitiveCents: number;
  pendingCents: number;
}

export interface AgingBuckets {
  upTo30: number;
  d31to60: number;
  d61to90: number;
  over90: number;
}

export interface InsurerTotals {
  insurerId: string;
  insurerName: string;
  guides: number;
  billedCents: number;
  paidCents: number;
  glossOpenCents: number;
  glossDefinitiveCents: number;
  pendingCents: number;
  /** Glosa definitiva ÷ faturado, em pontos-base (1% = 100); null sem faturamento. */
  glossRateBps: number | null;
  /** Prazo médio de recebimento (dias, uma casa); null sem pagamento no período. */
  averageDaysToPay: number | null;
  /** Pendente com mais de `OVERDUE_AFTER_DAYS` dias do envio. */
  overdueCents: number;
  aging: AgingBuckets;
}

export interface InsurerReport {
  filter: { from: string; to: string; insurerId: string | null };
  today: string;
  insurers: InsurerTotals[];
  total: Omit<InsurerTotals, 'insurerId' | 'insurerName'>;
  lines: ReportLine[];
}

const emptyAging = (): AgingBuckets => ({ upTo30: 0, d31to60: 0, d61to90: 0, over90: 0 });

/** Agrega as linhas (puro; a ordem das operadoras é a das linhas, que vêm por nome). */
export function aggregateReport(lines: readonly ReportLine[], today: string): Pick<InsurerReport, 'insurers' | 'total'> {
  type Acc = InsurerTotals & { payDays: number[] };
  const zero = (insurerId: string, insurerName: string): Acc => ({
    insurerId, insurerName, guides: 0, billedCents: 0, paidCents: 0, glossOpenCents: 0, glossDefinitiveCents: 0,
    pendingCents: 0, glossRateBps: null, averageDaysToPay: null, overdueCents: 0, aging: emptyAging(), payDays: [],
  });
  const by = new Map<string, Acc>();
  const all = zero('', '');
  for (const l of lines) {
    let a = by.get(l.insurerId);
    if (!a) {
      a = zero(l.insurerId, l.insurerName);
      by.set(l.insurerId, a);
    }
    for (const t of [a, all]) {
      t.guides += 1;
      t.billedCents += l.billedCents;
      t.paidCents += l.paidCents;
      t.glossOpenCents += l.glossOpenCents;
      t.glossDefinitiveCents += l.glossDefinitiveCents;
      t.pendingCents += l.pendingCents;
      if (l.lastPaidOn && l.paidCents > 0) t.payDays.push(Math.max(0, daysBetween(l.sentOn, l.lastPaidOn)));
      if (l.pendingCents > 0) {
        const age = daysBetween(l.sentOn, today);
        if (age > OVERDUE_AFTER_DAYS) t.overdueCents += l.pendingCents;
        if (age <= 30) t.aging.upTo30 += l.pendingCents;
        else if (age <= 60) t.aging.d31to60 += l.pendingCents;
        else if (age <= 90) t.aging.d61to90 += l.pendingCents;
        else t.aging.over90 += l.pendingCents;
      }
    }
  }
  const finish = ({ payDays, ...t }: Acc): InsurerTotals => ({
    ...t,
    glossRateBps: t.billedCents > 0 ? Math.round((t.glossDefinitiveCents * 10_000) / t.billedCents) : null,
    averageDaysToPay: payDays.length > 0 ? Math.round((payDays.reduce((s, d) => s + d, 0) / payDays.length) * 10) / 10 : null,
  });
  const { insurerId: _i, insurerName: _n, ...total } = finish(all);
  return { insurers: [...by.values()].map(finish), total };
}

/** Linhas do período (RLS da clínica da sessão + filtro explícito de clínica). */
export async function loadReportLinesTx(
  tx: Tx,
  clinicId: string,
  f: { from: string; to: string; insurerId: string | null },
): Promise<ReportLine[]> {
  const rows = (await tx.execute(sql`
    SELECT a.guide_id::text AS guide_id, a.insurer_id::text AS insurer_id, i.name AS insurer_name, a.guide_type, a.number,
           a.status, b.number AS batch_number, b.sent_on::text AS sent_on,
           a.billed_cents, a.paid_cents, a.gloss_open_cents, a.gloss_definitive_cents, a.pending_cents,
           (SELECT max(p.paid_on)::text FROM public.hi_payment_allocations al
              JOIN public.hi_payments p ON p.clinic_id = al.clinic_id AND p.id = al.payment_id
             WHERE al.clinic_id = a.clinic_id AND al.guide_id = a.guide_id AND al.kind = 'allocation') AS last_paid_on
      FROM public.hi_guide_accounts a
      JOIN public.hi_batch_guides bg ON bg.clinic_id = a.clinic_id AND bg.guide_id = a.guide_id AND bg.active
      JOIN public.hi_batches b ON b.clinic_id = bg.clinic_id AND b.id = bg.batch_id
      JOIN public.hi_insurers i ON i.clinic_id = a.clinic_id AND i.id = a.insurer_id
     WHERE a.clinic_id = ${clinicId}::uuid
       AND b.sent_on BETWEEN ${f.from}::date AND ${f.to}::date
       AND (${f.insurerId}::uuid IS NULL OR a.insurer_id = ${f.insurerId}::uuid)
     ORDER BY i.name, i.id, b.sent_on, a.number
     LIMIT ${REPORT_MAX_ROWS + 1}`)) as unknown as Array<Record<string, unknown>>;
  if (rows.length > REPORT_MAX_ROWS) {
    throw new InsurerReportError(`O período tem mais de ${REPORT_MAX_ROWS.toLocaleString('pt-BR')} guias. Escolha um período menor ou uma operadora.`, 'too_large');
  }
  return rows.map((r) => ({
    insurerId: String(r.insurer_id),
    insurerName: String(r.insurer_name),
    guideId: String(r.guide_id),
    guideType: r.guide_type === 'sp_sadt' ? 'sp_sadt' : 'consulta',
    guideNumber: String(r.number),
    guideStatus: String(r.status),
    batchNumber: String(r.batch_number),
    sentOn: String(r.sent_on),
    lastPaidOn: r.last_paid_on ? String(r.last_paid_on) : null,
    billedCents: Number(r.billed_cents),
    paidCents: Number(r.paid_cents),
    glossOpenCents: Number(r.gloss_open_cents),
    glossDefinitiveCents: Number(r.gloss_definitive_cents),
    pendingCents: Number(r.pending_cents),
  }));
}

/** Data de hoje na clínica (o fuso da clínica decide a idade do pendente). */
export async function clinicTodayTx(tx: Tx, clinicId: string): Promise<string> {
  const [r] = (await tx.execute(sql`
    SELECT (now() AT TIME ZONE coalesce(c.timezone, 'America/Sao_Paulo'))::date::text AS d
      FROM public.clinics c WHERE c.id = ${clinicId}::uuid`)) as unknown as Array<{ d: string }>;
  return r?.d ?? new Date().toISOString().slice(0, 10);
}

export async function buildInsurerReportTx(tx: Tx, clinicId: string, input: ReportFilterInput): Promise<InsurerReport> {
  const parsed = ReportFilter.safeParse(input);
  if (!parsed.success) throw new InsurerReportError(parsed.error.issues[0]?.message ?? 'Filtro inválido.', 'invalid');
  const f = parsed.data;
  const [today, lines] = [await clinicTodayTx(tx, clinicId), await loadReportLinesTx(tx, clinicId, f)];
  return { filter: f, today, lines, ...aggregateReport(lines, today) };
}

// ── CSV ────────────────────────────────────────────────────────────────

/**
 * Célula segura para planilha: texto que começa com `=`, `+`, `-`, `@`, tabulação ou retorno vira
 * texto (apóstrofo na frente; CSV/formula injection), e aspas, `;` e quebras de linha vão entre aspas.
 */
export function csvCell(value: string | number | null): string {
  if (value === null) return '';
  let s = typeof value === 'number' ? String(value) : value;
  if (typeof value === 'string' && /^[=+\-@\t\r]/u.test(s)) s = `'${s}`;
  return /[";\r\n]/u.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/** Centavos em reais com vírgula (planilha em português), sem separador de milhar. */
export const csvMoney = (cents: number): string => {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  return `${neg ? '-' : ''}${Math.trunc(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
};

export const CSV_HEADER = [
  'Operadora', 'Tipo de guia', 'Guia', 'Situação', 'Lote', 'Enviada em', 'Último pagamento',
  'Faturado (R$)', 'Recebido (R$)', 'Glosa em aberto (R$)', 'Glosa definitiva (R$)', 'Pendente (R$)', 'Dias desde o envio',
] as const;

/** Marca de ordem de bytes do UTF-8 (escrita como código, não como caractere invisível). */
const BOM = String.fromCharCode(0xfeff);

/** CSV com BOM UTF-8, `;` e CRLF (abre certo no Excel em português). Uma linha por guia. */
export function reportCsv(report: Pick<InsurerReport, 'lines' | 'today'>): string {
  const rows = [CSV_HEADER.map(csvCell).join(';')];
  for (const l of report.lines) {
    rows.push(
      [
        csvCell(l.insurerName),
        csvCell(l.guideType === 'sp_sadt' ? 'SP/SADT' : 'Consulta'),
        csvCell(l.guideNumber),
        csvCell(l.guideStatus),
        csvCell(l.batchNumber),
        csvCell(l.sentOn),
        csvCell(l.lastPaidOn),
        csvMoney(l.billedCents),
        csvMoney(l.paidCents),
        csvMoney(l.glossOpenCents),
        csvMoney(l.glossDefinitiveCents),
        csvMoney(l.pendingCents),
        String(daysBetween(l.sentOn, report.today)),
      ].join(';'),
    );
  }
  return `${BOM}${rows.join('\r\n')}\r\n`;
}
