/**
 * Messaging internal API (C10→C11) — para outros contextos / AI Agent, NÃO
 * HTTP. Versionada desde já (M14, mesmo padrão de scheduling/api.ts): quando o
 * contrato evoluir, nasce `messagingApiV2` sem refactor global dos call-sites.
 *
 * Razão de existir (ADR-022): o AI Agent consome `messaging.inbound.received`
 * mas NÃO pode tocar `inbound_messages_raw` nem `internal/sender` diretamente
 * (boundary). Este seam é o ÚNICO ponto de decrypt de inbound do contexto —
 * conteúdo e telefone saem em claro APENAS por aqui, para o consumidor do
 * evento (que roda em withTenant, RLS aplicada).
 *
 * - getInboundForAgent / markInboundProcessed são tx-aware: rodam dentro da TX
 *   que o caller já segura (handler do worker ou fase da saga C11).
 * - sendText gerencia as PRÓPRIAS TXs (3-fase do sender — reserve/send/finalize)
 *   e NUNCA deve ser chamado segurando uma TX aberta.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';

import { decryptForTenant } from '@/lib/crypto';
import type { Tx } from '@/lib/db';

import { sendOutbound } from './internal/sender';
import { inboundMessagesRaw, outboundMessages } from './schema';
import type { OutboundResult, SendOutboundInput } from './types';

export interface InboundForAgent {
  id: string;
  /** Conteúdo decifrado ('' quando a mensagem não tinha texto). */
  text: string;
  fromNumberHash: string;
  /**
   * Telefone de resposta decifrado (normalizado, dígitos). NULL para rows
   * anteriores à migration 0024 (coluna aditiva) — sem ele não há resposta.
   */
  fromNumber: string | null;
  receivedAt: Date;
  /** Marcador de consumo do C11 — dedup at-least-once do handler. */
  processedAt: Date | null;
}

/**
 * ADR-047 — estado REAL do envio, por idempotencyKey. Existe porque persistir a
 * mensagem no histórico não prova entrega: quem sabe se o WhatsApp aceitou é
 * `outbound_messages`, e o painel precisa disso para não dizer "enviada" a uma
 * mensagem ainda na fila (ou que falhou).
 *
 * Chave ausente do mapa = ainda não houve tentativa de envio (evento no outbox,
 * worker ainda não rodou) — o caller trata como 'pending'.
 */
export type OutboundDeliveryStatus =
  | 'pending'
  | 'accepted'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed'
  | 'unknown';

export interface MessagingApiV1 {
  getInboundForAgent(
    tx: Tx,
    clinicId: string,
    inboundMessageId: string,
  ): Promise<InboundForAgent | null>;
  markInboundProcessed(tx: Tx, clinicId: string, inboundMessageId: string): Promise<void>;
  getOutboundStatuses(
    tx: Tx,
    clinicId: string,
    idempotencyKeys: readonly string[],
  ): Promise<Map<string, OutboundDeliveryStatus>>;
  sendText(input: SendOutboundInput): Promise<OutboundResult>;
}

async function getInboundForAgent(
  tx: Tx,
  clinicId: string,
  inboundMessageId: string,
): Promise<InboundForAgent | null> {
  const [row] = await tx
    .select()
    .from(inboundMessagesRaw)
    .where(
      and(eq(inboundMessagesRaw.id, inboundMessageId), eq(inboundMessagesRaw.clinicId, clinicId)),
    )
    .limit(1);
  if (!row) return null;

  return {
    id: row.id,
    text: await decryptForTenant(clinicId, row.contentEncrypted),
    fromNumberHash: row.fromNumberHash,
    fromNumber: row.fromNumberEncrypted
      ? await decryptForTenant(clinicId, row.fromNumberEncrypted)
      : null,
    receivedAt: row.receivedAt,
    processedAt: row.processedAt,
  };
}

async function markInboundProcessed(
  tx: Tx,
  clinicId: string,
  inboundMessageId: string,
): Promise<void> {
  // Idempotente: re-marcar só re-escreve o timestamp se ainda for NULL.
  await tx
    .update(inboundMessagesRaw)
    .set({ processedAt: sql`COALESCE(processed_at, now())` })
    .where(
      and(eq(inboundMessagesRaw.id, inboundMessageId), eq(inboundMessagesRaw.clinicId, clinicId)),
    );
}

async function getOutboundStatuses(
  tx: Tx,
  clinicId: string,
  idempotencyKeys: readonly string[],
): Promise<Map<string, OutboundDeliveryStatus>> {
  if (idempotencyKeys.length === 0) return new Map();
  const rows = await tx
    .select({ key: outboundMessages.idempotencyKey, status: outboundMessages.status })
    .from(outboundMessages)
    .where(
      and(
        eq(outboundMessages.clinicId, clinicId),
        inArray(outboundMessages.idempotencyKey, [...idempotencyKeys]),
      ),
    );
  return new Map(rows.map((r) => [r.key, r.status]));
}

export const messagingApiV1: MessagingApiV1 = {
  getInboundForAgent,
  markInboundProcessed,
  getOutboundStatuses,
  sendText: (input) => sendOutbound(input),
};
