import type { AccountingMovementDTO, LancamentoTipo, PaymentTransactionKind } from './types';

export const ACCOUNTING_EXPORT_MAX_ROWS = 10_000;

export class AccountingExportError extends Error {
  readonly httpStatus = 422;

  constructor(
    readonly code: 'invalid_month' | 'too_many_rows',
    message: string,
  ) {
    super(message);
    this.name = 'AccountingExportError';
  }
}

export function accountingCashEffect(
  lancamentoTipo: LancamentoTipo,
  transactionKind: PaymentTransactionKind,
  amount: number,
): number {
  const increasesCash =
    (lancamentoTipo === 'receber' && transactionKind === 'payment') ||
    (lancamentoTipo === 'pagar' && transactionKind === 'refund');
  return Math.round((increasesCash ? amount : -amount) * 100) / 100;
}

export function accountingMovementType(
  lancamentoTipo: LancamentoTipo,
  transactionKind: PaymentTransactionKind,
): 'recebimento' | 'pagamento' | 'estorno_recebimento' | 'estorno_pagamento' {
  if (transactionKind === 'payment') {
    return lancamentoTipo === 'receber' ? 'recebimento' : 'pagamento';
  }
  return lancamentoTipo === 'receber' ? 'estorno_recebimento' : 'estorno_pagamento';
}

function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]),
  ) as Record<string, number>;
  return (
    Date.UTC(
      values.year!,
      values.month! - 1,
      values.day!,
      values.hour!,
      values.minute!,
      values.second!,
    ) - date.getTime()
  );
}

function localMidnightUtc(year: number, month: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, 1);
  const firstPass = new Date(guess - timeZoneOffsetMs(new Date(guess), timeZone));
  return new Date(guess - timeZoneOffsetMs(firstPass, timeZone));
}

export function currentMonthInTimeZone(timeZone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  if (!year || !month) throw new Error(`Não foi possível calcular o mês em ${timeZone}.`);
  return `${year}-${month}`;
}

export function accountingMonthRange(
  rawMonth: string | null | undefined,
  timeZone: string,
  now: Date = new Date(),
): { month: string; from: Date; to: Date } {
  const month = rawMonth?.trim() || currentMonthInTimeZone(timeZone, now);
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) {
    throw new AccountingExportError('invalid_month', 'Informe o mês no formato AAAA-MM.');
  }

  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (year < 2000 || year > 2100 || monthNumber < 1 || monthNumber > 12) {
    throw new AccountingExportError('invalid_month', 'Informe um mês entre 2000-01 e 2100-12.');
  }

  const nextYear = monthNumber === 12 ? year + 1 : year;
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1;
  return {
    month,
    from: localMidnightUtc(year, monthNumber, timeZone),
    to: localMidnightUtc(nextYear, nextMonth, timeZone),
  };
}

export function assertAccountingRowLimit(rowCount: number): void {
  if (rowCount > ACCOUNTING_EXPORT_MAX_ROWS) {
    throw new AccountingExportError(
      'too_many_rows',
      `O mês possui mais de ${ACCOUNTING_EXPORT_MAX_ROWS.toLocaleString('pt-BR')} movimentos. Exporte com apoio do suporte para não gerar um arquivo incompleto.`,
    );
  }
}

function csvField(value: string | null, protectFormula = true): string {
  if (value === null) return '';
  const guarded = protectFormula && /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${guarded.replaceAll('"', '""')}"`;
}

function money(value: number): string {
  return value.toFixed(2).replace('.', ',');
}

function localDateAndTime(iso: string, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(iso));
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return {
    date: `${value('day')}/${value('month')}/${value('year')}`,
    time: `${value('hour')}:${value('minute')}:${value('second')}`,
  };
}

const CSV_HEADER = [
  'data_movimento',
  'hora_movimento',
  'tipo_movimento',
  'natureza_lancamento',
  'descricao',
  'fornecedor',
  'fornecedor_cnpj',
  'valor_movimento',
  'efeito_caixa',
  'forma_pagamento',
  'vencimento',
  'status_atual_lancamento',
  'origem_lancamento',
  'lancamento_id',
  'transacao_id',
  'transacao_original_id',
  'motivo_estorno',
] as const;

export function renderAccountingCsv(movements: AccountingMovementDTO[], timeZone: string): string {
  const lines = [CSV_HEADER.join(';')];
  for (const movement of movements) {
    const local = localDateAndTime(movement.occurredAt, timeZone);
    const paymentMethod = movement.paymentMethodLabel ?? movement.paymentMethod;
    lines.push(
      [
        local.date,
        local.time,
        accountingMovementType(movement.lancamentoTipo, movement.transactionKind),
        movement.lancamentoTipo,
        movement.description,
        movement.supplierName,
        movement.supplierCnpj,
        money(movement.amount),
        money(movement.cashEffect),
        paymentMethod,
        movement.dueDate,
        movement.lancamentoStatus,
        movement.createdVia,
        movement.lancamentoId,
        movement.transactionId,
        movement.originalPaymentId,
        movement.reason,
      ]
        // Valores monetários são gerados pelo servidor e precisam continuar
        // numéricos (inclusive negativos) ao abrir no Excel. Texto externo usa
        // proteção contra formula injection.
        .map((value, index) => csvField(value, index !== 7 && index !== 8))
        .join(';'),
    );
  }
  return lines.join('\r\n');
}
