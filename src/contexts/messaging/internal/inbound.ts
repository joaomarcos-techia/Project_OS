/**
 * Persistência INBOUND (C10). Sem JWT (webhook) — usa `withTenant` (role
 * authenticated, RLS via GUC), dedup por UNIQUE + ON CONFLICT, audit NENHUM
 * (mensagens são evento operacional, não forense — 1ª#9).
 *
 * Garantia transacional (ponto 10): o INSERT em inbound_messages_raw e o
 * publishEvent(messaging.inbound.received) rodam na MESMA tx do withTenant.
 * Se publishEvent lança, a tx inteira faz rollback (inbound incluído) e a
 * exceção propaga → a rota responde 500 → Meta re-tenta. Nunca existe inbound
 * salvo sem evento.
 *
 * Dedup (4ª#6): UNIQUE(provider, provider_message_id). No conflito, compara o
 * payload_hash canônico: igual → `messaging.inbound.duplicate` (reenvio benigno);
 * diferente → `messaging.inbound.conflict` (incidente — mesmo id, conteúdo outro).
 */
import 'server-only';

import { and, eq } from 'drizzle-orm';

import { encryptForTenant, hashForLookup, normalizePhone } from '@/lib/crypto';
import { withTenant } from '@/lib/db/tenant';
import { payloadHash } from '@/lib/idempotency/hash';
import type {
  MessagingProviderName,
  ParsedInboundMessage,
  ParsedStatusEvent,
} from '@/lib/messaging';
import { metrics } from '@/lib/observability/metrics';
import { publishEvent } from '@/lib/outbox/publish';

import { MESSAGING_EVENTS } from '../events';
import { inboundMessagesRaw, providerStatusEventsRaw } from '../schema';
import { normalizeProviderDeliveryStatus } from './delivery-status';
import { applyProviderDeliveryStatus } from './status-reconciler';

/** Epoch-seconds string → Date (ou null se inválido → coluna usa default now()). */
function epochToDate(ts: string): Date | null {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000);
}

function epochToIso(ts: string): string {
  return epochToDate(ts)?.toISOString() ?? new Date().toISOString();
}

export async function persistInbound(
  clinicId: string,
  provider: MessagingProviderName,
  msg: ParsedInboundMessage,
): Promise<{ deduped: boolean }> {
  // Pré-compute fora da tx (cifra/hash são CPU puro).
  const fromNumberHash = await hashForLookup(normalizePhone(msg.fromNumber));
  // C11 (ADR-022): o número normalizado também é persistido CIFRADO — é o que
  // permite ao AI Agent responder (hash não é reversível; payload do evento
  // continua sem plaintext).
  const fromNumberEncrypted = await encryptForTenant(clinicId, normalizePhone(msg.fromNumber));
  const contentEncrypted = await encryptForTenant(clinicId, msg.text ?? '');
  const pHash = payloadHash({
    providerMessageId: msg.providerMessageId,
    from: msg.fromNumber,
    text: msg.text,
    ts: msg.timestamp,
  });
  const receivedAt = epochToDate(msg.timestamp);

  return withTenant(clinicId, async (tx) => {
    const inserted = await tx
      .insert(inboundMessagesRaw)
      .values({
        clinicId,
        providerMessageId: msg.providerMessageId,
        provider,
        fromNumberHash,
        fromNumberEncrypted,
        toNumber: msg.toNumber,
        contentEncrypted,
        payloadHash: pHash,
        ...(receivedAt ? { receivedAt } : {}),
      })
      .onConflictDoNothing({
        target: [inboundMessagesRaw.provider, inboundMessagesRaw.providerMessageId],
      })
      .returning({ id: inboundMessagesRaw.id });

    if (inserted.length === 0) {
      const [existing] = await tx
        .select({ payloadHash: inboundMessagesRaw.payloadHash })
        .from(inboundMessagesRaw)
        .where(
          and(
            eq(inboundMessagesRaw.provider, provider),
            eq(inboundMessagesRaw.providerMessageId, msg.providerMessageId),
          ),
        )
        .limit(1);
      // payload_hash diferente = mesmo id, conteúdo outro = INCIDENTE (4ª#6).
      const incident = existing !== undefined && existing.payloadHash !== pHash;
      metrics.emit(incident ? 'messaging.inbound.conflict' : 'messaging.inbound.duplicate', {
        clinicId,
        provider,
        providerMessageId: msg.providerMessageId,
      });
      return { deduped: true };
    }

    await publishEvent(tx, {
      clinicId,
      eventType: MESSAGING_EVENTS.INBOUND_RECEIVED,
      payload: {
        clinicId,
        inboundMessageId: inserted[0]!.id,
        providerMessageId: msg.providerMessageId,
        provider,
        fromNumberHash,
        toPhoneId: msg.toPhoneId,
        hasText: msg.text !== null,
        receivedAt: epochToIso(msg.timestamp),
      },
      idempotencyKey: `inbound:${provider}:${msg.providerMessageId}`,
    });
    metrics.emit('messaging.inbound.received', { clinicId, provider });
    return { deduped: false };
  });
}

/**
 * Persiste callbacks de status (sent/delivered/read/failed) CRUS, append-only,
 * sem consumidor (drena em C14). Dedup por (provider, payload_hash) tolera os
 * reenvios da Meta (3ª#1+2). Independente da existência da mensagem (3ª#8) —
 * pode chegar antes do inbound/outbound; SEM FK.
 */
export async function persistStatusEvents(
  clinicId: string,
  provider: MessagingProviderName,
  statuses: ParsedStatusEvent[],
): Promise<void> {
  if (statuses.length === 0) return;

  const rows = await Promise.all(
    statuses.map(async (s) => ({
      clinicId,
      provider,
      providerMessageId: s.providerMessageId,
      statusText: s.status,
      recipientHash: s.recipientNumber
        ? await hashForLookup(normalizePhone(s.recipientNumber))
        : null,
      payloadHash: payloadHash(s.raw),
      raw: s.raw as never,
    })),
  );

  await withTenant(clinicId, async (tx) => {
    for (const row of rows) {
      const [inserted] = await tx
        .insert(providerStatusEventsRaw)
        .values(row)
        .onConflictDoNothing({
          target: [providerStatusEventsRaw.provider, providerStatusEventsRaw.payloadHash],
        })
        .returning({ id: providerStatusEventsRaw.id });
      const normalized = normalizeProviderDeliveryStatus(row.statusText);
      if (inserted && normalized && row.providerMessageId) {
        await applyProviderDeliveryStatus(tx, {
          clinicId,
          providerMessageId: row.providerMessageId,
          status: normalized,
          sourceId: inserted.id,
        });
      }
    }
  });
  metrics.emit('messaging.status.received', { clinicId, provider, count: statuses.length });
}
