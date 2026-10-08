import { and, asc, eq, sql } from 'drizzle-orm';

import type { Tx } from '@/lib/db';
import { publishEvent } from '@/lib/outbox/publish';

import { MESSAGING_EVENTS } from '../events';
import { outboundMessages, providerStatusEventsRaw } from '../schema';
import {
  advanceDeliveryStatus,
  normalizeProviderDeliveryStatus,
  providerFailureCode,
  type ProviderDeliveryStatus,
} from './delivery-status';

export async function applyProviderDeliveryStatus(
  tx: Tx,
  input: {
    clinicId: string;
    providerMessageId: string;
    status: ProviderDeliveryStatus;
    sourceId: string;
    /** `providerFailureCode` do callback; só viaja no evento quando `failed`. */
    errorCode?: string | null;
  },
): Promise<boolean> {
  const [outbound] = await tx
    .select({ id: outboundMessages.id, status: outboundMessages.status })
    .from(outboundMessages)
    .where(
      and(
        eq(outboundMessages.clinicId, input.clinicId),
        eq(outboundMessages.providerMessageId, input.providerMessageId),
      ),
    )
    .limit(1)
    .for('update');
  if (!outbound) return false;

  const next = advanceDeliveryStatus(outbound.status, input.status);
  if (next === outbound.status) return true;
  await tx
    .update(outboundMessages)
    .set({
      status: next,
      statusUpdatedAt: sql`now()`,
      ...(next === 'sent' ? { sentAt: sql`coalesce(${outboundMessages.sentAt}, now())` } : {}),
      ...(next === 'delivered' ? { deliveredAt: sql`now()` } : {}),
      ...(next === 'read'
        ? {
            deliveredAt: sql`coalesce(${outboundMessages.deliveredAt}, now())`,
            readAt: sql`now()`,
          }
        : {}),
      ...(next === 'failed' ? { failedAt: sql`now()` } : {}),
    })
    .where(
      and(eq(outboundMessages.id, outbound.id), eq(outboundMessages.clinicId, input.clinicId)),
    );
  await publishEvent(tx, {
    clinicId: input.clinicId,
    eventType: MESSAGING_EVENTS.OUTBOUND_STATUS_UPDATED,
    payload: {
      clinicId: input.clinicId,
      outboundMessageId: outbound.id,
      providerMessageId: input.providerMessageId,
      status: input.status,
      ...(input.status === 'failed' && input.errorCode ? { errorCode: input.errorCode } : {}),
    },
    idempotencyKey: `provider-status:${input.sourceId}`,
  });
  return true;
}

export async function reconcileStoredProviderStatuses(
  tx: Tx,
  clinicId: string,
  providerMessageId: string,
): Promise<void> {
  const statuses = await tx
    .select({
      id: providerStatusEventsRaw.id,
      status: providerStatusEventsRaw.statusText,
      raw: providerStatusEventsRaw.raw,
    })
    .from(providerStatusEventsRaw)
    .where(
      and(
        eq(providerStatusEventsRaw.clinicId, clinicId),
        eq(providerStatusEventsRaw.providerMessageId, providerMessageId),
      ),
    )
    .orderBy(asc(providerStatusEventsRaw.receivedAt));
  for (const row of statuses) {
    const normalized = normalizeProviderDeliveryStatus(row.status);
    if (normalized) {
      await applyProviderDeliveryStatus(tx, {
        clinicId,
        providerMessageId,
        status: normalized,
        sourceId: row.id,
        errorCode: providerFailureCode(row.raw),
      });
    }
  }
}
