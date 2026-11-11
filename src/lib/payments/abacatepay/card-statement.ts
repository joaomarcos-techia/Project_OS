import 'server-only';

import { z } from 'zod';

import { GatewayReadError, opaqueBillingId, parseBillingValue } from '../saas/contracts';
import type { createAbacatePayTransport } from './transport';

const resource = (prefix: string) => opaqueBillingId.refine((id) => id.startsWith(prefix));
const amount = z.number().int().positive().max(999_999_999_999);
const inputSchema = z.object({
  checkoutId: resource('bill_'),
  customerId: resource('cust_'),
  expectedAmountMinor: amount,
  periodStart: z.iso.datetime({ offset: true }),
  periodEnd: z.iso.datetime({ offset: true }),
  paymentId: opaqueBillingId.optional(),
  requireCustomer: z.boolean().optional(),
});
const statementSchema = z.object({
  id: resource('tran_'),
  currency: z.literal('BRL'),
  createdAt: z.iso.datetime({ offset: true }),
  checkoutId: resource('bill_').nullable(),
  paymentIntentId: opaqueBillingId.nullable(),
  customer: z
    .object({ publicId: resource('cust_') })
    .nullable()
    .optional(),
  movements: z
    .array(
      z.object({
        amount: z.number().int().refine(Number.isSafeInteger),
        kind: z.string().min(1).max(128),
        method: z.string().min(1).max(128),
        category: z.string().min(1).max(128),
        balanceEffect: z.enum(['credit', 'debit', 'none']),
      }),
    )
    .min(1)
    .max(20),
});
const envelopeSchema = z.object({
  success: z.literal(true),
  data: z.array(statementSchema).max(100),
  pagination: z.object({ hasMore: z.boolean(), next: opaqueBillingId.nullable() }),
});
const RECEIPT_CLOCK_SKEW_MS = 60_000;
export const MAX_CARD_RECEIPT_WINDOW_MS = 32 * 86_400_000;
const MAX_PAGES = 5;

function brazilDate(timestamp: number): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestamp));
  const part = (type: 'year' | 'month' | 'day') => parts.find((item) => item.type === type)?.value;
  const date = `${part('year')}-${part('month')}-${part('day')}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new GatewayReadError('invalid_input');
  return date;
}

export type ApprovedCardStatement = {
  statementId: string;
  paymentId: string;
  checkoutId: string;
  amountMinor: number;
  createdAt: string;
};

/** Shared bounded financial read. The caller proves the contract/checkout relationship. */
export async function readApprovedCardStatement(
  request: ReturnType<typeof createAbacatePayTransport>,
  raw: z.input<typeof inputSchema>,
): Promise<ApprovedCardStatement | null> {
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) throw new GatewayReadError('invalid_input');
  const expected = parsed.data;
  const start = Date.parse(expected.periodStart),
    end = Date.parse(expected.periodEnd);
  if (end <= start || end - start > MAX_CARD_RECEIPT_WINDOW_MS)
    throw new GatewayReadError('invalid_input');
  const seenCursors = new Set<string>(),
    seenStatements = new Set<string>();
  const candidates: ApprovedCardStatement[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({
      limit: '100',
      method: 'CARD',
      kind: 'CARD_APPROVED',
      status: 'APPROVED',
      startDate: brazilDate(start - RECEIPT_CLOCK_SKEW_MS),
      endDate: brazilDate(end),
    });
    if (cursor) params.set('after', cursor);
    const envelope = parseBillingValue(
      envelopeSchema,
      await request({ method: 'GET', path: '/bank-statement/list', params }),
    );
    for (const item of envelope.data) {
      if (seenStatements.has(item.id)) throw new GatewayReadError('pagination_invalid');
      seenStatements.add(item.id);
      const createdAt = Date.parse(item.createdAt);
      if (
        item.checkoutId !== expected.checkoutId ||
        createdAt < start - RECEIPT_CLOCK_SKEW_MS ||
        createdAt >= end ||
        (expected.paymentId !== undefined && item.paymentIntentId !== expected.paymentId)
      )
        continue;
      if (
        !item.paymentIntentId ||
        (expected.requireCustomer === true && item.customer?.publicId !== expected.customerId) ||
        (item.customer && item.customer.publicId !== expected.customerId)
      )
        throw new GatewayReadError('binding_mismatch');
      const gross = item.movements.filter((movement) => movement.kind === 'CARD_APPROVED');
      if (
        gross.length !== 1 ||
        gross[0]?.amount !== expected.expectedAmountMinor ||
        gross[0]?.method !== 'CARD' ||
        gross[0]?.category !== 'transaction' ||
        gross[0]?.balanceEffect === 'debit'
      )
        throw new GatewayReadError('binding_mismatch');
      candidates.push({
        statementId: item.id,
        paymentId: item.paymentIntentId,
        checkoutId: expected.checkoutId,
        amountMinor: expected.expectedAmountMinor,
        createdAt: item.createdAt,
      });
    }
    if (!envelope.pagination.hasMore) {
      if (envelope.pagination.next !== null) throw new GatewayReadError('pagination_invalid');
      if (candidates.length > 1) throw new GatewayReadError('binding_mismatch');
      return candidates[0] ?? null;
    }
    const next = envelope.pagination.next;
    if (next === null || seenCursors.has(next)) throw new GatewayReadError('pagination_invalid');
    seenCursors.add(next);
    cursor = next;
  }
  throw new GatewayReadError('pagination_invalid');
}
