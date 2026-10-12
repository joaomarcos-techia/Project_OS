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
import { inboundMessagesRaw, outboundMessages, whatsappBusinessAppEchoes } from './schema';
import type { OutboundResult, SendOutboundInput } from './types';

/** Mensagem irmã absorvida pelo turno corrente (C12/F-08). */
export interface CoalescedInbound {
  id: string;
  /** Conteúdo decifrado. */
  text: string;
  receivedAt: Date;
}

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
  /**
   * 0114 — nome do perfil do WhatsApp, AINDA CIFRADO com a chave da mesma
   * clínica: a conversa o guarda como veio, sem decifrar. NULL quando a Meta
   * não o enviou ou a linha é anterior à 0114.
   */
  contactNameEncrypted: string | null;
  receivedAt: Date;
  /** Marcador de consumo do C11 — dedup at-least-once do handler. */
  processedAt: Date | null;
}

/**
 * Coexistência — o que a recepção enviou pelo app WhatsApp Business do celular,
 * decifrado para o consumidor de `messaging.business_app_echo.received`.
 */
export interface BusinessAppEchoForAgent {
  id: string;
  /** Conteúdo decifrado ('' quando o eco não era texto). */
  text: string;
  hasText: boolean;
  toNumberHash: string;
  /** Telefone do paciente decifrado (normalizado, dígitos). */
  toNumber: string;
  sentAt: Date;
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
  getBusinessAppEchoForAgent(
    tx: Tx,
    clinicId: string,
    echoId: string,
  ): Promise<BusinessAppEchoForAgent | null>;
  /**
   * C12/F-08 — RECLAMA as mensagens ainda não consumidas do mesmo contato para
   * que o turno corrente as trate como uma só.
   *
   * A reivindicação é ATÔMICA (`UPDATE … WHERE processed_at IS NULL RETURNING`):
   * duas execuções concorrentes nunca absorvem a mesma linha, e quem perder a
   * corrida simplesmente não a recebe. Marcar aqui — e não no fim do turno — é
   * o que fecha a janela em que o irmão seria processado por outro worker.
   */
  claimPendingSiblings(
    tx: Tx,
    clinicId: string,
    args: { fromNumberHash: string; excludeId: string; notBefore: Date; limit: number },
  ): Promise<CoalescedInbound[]>;
  getOutboundStatuses(
    tx: Tx,
    clinicId: string,
    idempotencyKeys: readonly string[],
  ): Promise<Map<string, OutboundDeliveryStatus>>;
  /**
   * EC-32 — o caminho inverso: de um envio (id do `status_updated`) à chave que
   * o remetente passou ao `sendText`. É ela que liga a recusa da Meta ao job da
   * C14 (chave = job.id). Só desta clínica; null se o envio não existe aqui.
   */
  getOutboundIdempotencyKey(
    tx: Tx,
    clinicId: string,
    outboundMessageId: string,
  ): Promise<string | null>;
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
    contactNameEncrypted: row.fromNameEncrypted ?? null,
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

/**
 * C12/F-08 — reivindica os inbounds pendentes do mesmo contato.
 *
 * SQL cru porque o `UPDATE … WHERE id IN (SELECT … ORDER BY … LIMIT … FOR UPDATE
 * SKIP LOCKED)` não tem equivalente no query builder. O `SKIP LOCKED` evita que
 * dois turnos concorrentes fiquem se esperando: quem não pegar a linha segue sem
 * ela em vez de bloquear.
 *
 * Só absorve mensagens RECENTES (`notBefore`): uma mensagem de horas atrás que
 * ficou para trás merece o próprio turno, não ser costurada num assunto novo.
 */
async function claimPendingSiblings(
  tx: Tx,
  clinicId: string,
  args: { fromNumberHash: string; excludeId: string; notBefore: Date; limit: number },
): Promise<CoalescedInbound[]> {
  if (args.limit <= 0) return [];
  const rows = await tx.execute<{
    id: string;
    content_encrypted: string;
    received_at: Date | string;
  }>(sql`
    UPDATE inbound_messages_raw
       SET processed_at = now()
     WHERE id IN (
       SELECT id FROM inbound_messages_raw
        WHERE clinic_id = ${clinicId}
          AND from_number_hash = ${args.fromNumberHash}
          AND id <> ${args.excludeId}
          AND processed_at IS NULL
          AND received_at >= ${args.notBefore.toISOString()}
          -- 08/10/2026: só TEXTO entra no turno de outra mensagem. Um áudio ou
          -- arquivo absorvido aqui sumia sem resposta; com o próprio turno, ele
          -- recebe o aviso de áudio ou vai para a equipe. NULL = linha anterior
          -- à 0117, tratada como antes.
          AND (message_type IS NULL OR message_type = 'text')
        ORDER BY received_at
        LIMIT ${args.limit}
        FOR UPDATE SKIP LOCKED
     )
    RETURNING id, content_encrypted, received_at`);

  const decoded = await Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      text: await decryptForTenant(clinicId, r.content_encrypted),
      receivedAt: r.received_at instanceof Date ? r.received_at : new Date(String(r.received_at)),
    })),
  );
  // O RETURNING não preserva a ordem do SELECT; a conversa depende dela.
  return decoded.sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
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

async function getOutboundIdempotencyKey(
  tx: Tx,
  clinicId: string,
  outboundMessageId: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ key: outboundMessages.idempotencyKey })
    .from(outboundMessages)
    .where(and(eq(outboundMessages.id, outboundMessageId), eq(outboundMessages.clinicId, clinicId)))
    .limit(1);
  return row?.key ?? null;
}

async function getBusinessAppEchoForAgent(
  tx: Tx,
  clinicId: string,
  echoId: string,
): Promise<BusinessAppEchoForAgent | null> {
  const [row] = await tx
    .select()
    .from(whatsappBusinessAppEchoes)
    .where(
      and(
        eq(whatsappBusinessAppEchoes.id, echoId),
        eq(whatsappBusinessAppEchoes.clinicId, clinicId),
      ),
    )
    .limit(1);
  if (!row) return null;

  return {
    id: row.id,
    text: await decryptForTenant(clinicId, row.contentEncrypted),
    hasText: row.hasText,
    toNumberHash: row.toNumberHash,
    toNumber: await decryptForTenant(clinicId, row.toNumberEncrypted),
    sentAt: row.sentAt,
  };
}

export const messagingApiV1: MessagingApiV1 = {
  getInboundForAgent,
  markInboundProcessed,
  getBusinessAppEchoForAgent,
  claimPendingSiblings,
  getOutboundStatuses,
  getOutboundIdempotencyKey,
  sendText: (input) => sendOutbound(input),
};
