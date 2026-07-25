/**
 * Outbound sender (C10) — fundação. Sem JWT (system/AI futuro); o caller é
 * responsável pela autorização (padrão worker). Sem audit (1ª#9) — só status +
 * métrica.
 *
 * NÃO segura tx durante o I/O de rede:
 *   (a) reserve  : withTenant — checa suppression + insere `pending` ON CONFLICT
 *                  (clinic_id, idempotency_key); conflito = dedup.
 *   (b) send     : provider FORA da tx.
 *   (c) finalize : withTenant — grava status + provider_message_id + response.
 *
 * Status (3ª#5): accepted (ack síncrono) | failed (HTTP definitivo) | unknown
 * (timeout/reset — NÃO sabemos se a Meta recebeu; callback async confirma em C14).
 *
 * Refresh de credencial (3ª#3 + 4ª#2): em 401/403 recarrega a credencial; só
 * reenvia se `token_version` aumentou (rotação ocorreu) — senão é token inválido
 * de verdade → `failed` na hora (sem 2ª chamada Meta inútil). Refresh único.
 *
 * Token nunca passa por `authenticated`: vem do seam `loadActiveNumberForSend`
 * (service_role) e é descriptografado aqui.
 */
import 'server-only';

import { and, eq, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import { decryptForTenant, encryptForTenant, hashForLookup, normalizePhone } from '@/lib/crypto';
import { withTenant } from '@/lib/db/tenant';
import {
  getMessagingProvider,
  loadActiveNumberForSend,
  ProviderSendError,
  ProviderUnreachableError,
  type ActiveNumber,
  type MessageRef,
  type MessagingProvider,
} from '@/lib/messaging';
import { metrics } from '@/lib/observability/metrics';

/* eslint-disable boundaries/element-types -- suppressionList é superfície PÚBLICA do Patient (re-exportada em @/contexts/patient/index); o contrato C10 permite Patient via API pública. */
import { patients, suppressionList } from '@/contexts/patient';
/* eslint-enable boundaries/element-types */

import {
  MessagingValidationError,
  NumberNotConnectedError,
  SuppressedRecipientError,
} from '../errors';
import { outboundMessages } from '../schema';
import { reconcileStoredProviderStatuses } from './status-reconciler';
import type { OutboundResult, OutboundSendStatus, SendOutboundInput } from '../types';

const uuidSchema = z.string().uuid();

type SendOutcome =
  | { kind: 'accepted'; ref: MessageRef }
  | { kind: 'failed'; raw: unknown }
  | { kind: 'unknown' }
  | { kind: 'auth_error'; raw: unknown };

async function callProvider(
  provider: MessagingProvider,
  fromPhoneId: string,
  accessToken: string,
  input: SendOutboundInput,
): Promise<SendOutcome> {
  try {
    const base = { toNumber: input.toNumber, fromPhoneId, accessToken };
    const ref =
      input.body.kind === 'text'
        ? await provider.sendText({ ...base, text: input.body.text })
        : await provider.sendTemplate({
            ...base,
            templateName: input.body.templateName,
            languageCode: input.body.languageCode,
            variables: input.body.variables,
          });
    return { kind: 'accepted', ref };
  } catch (err) {
    if (err instanceof ProviderUnreachableError) return { kind: 'unknown' };
    if (err instanceof ProviderSendError) {
      if (err.httpStatus === 401 || err.httpStatus === 403) {
        return { kind: 'auth_error', raw: err.raw };
      }
      return { kind: 'failed', raw: err.raw };
    }
    throw err;
  }
}

export async function sendOutbound(input: SendOutboundInput): Promise<OutboundResult> {
  if (!uuidSchema.safeParse(input.idempotencyKey).success) {
    throw new MessagingValidationError('idempotencyKey deve ser um UUID');
  }

  let number = await loadActiveNumberForSend(input.clinicId);
  if (!number) throw new NumberNotConnectedError(input.clinicId);

  const toNumberHash = await hashForLookup(normalizePhone(input.toNumber));
  const contentPlain =
    input.body.kind === 'text' ? input.body.text : `template:${input.body.templateName}`;
  const contentEncrypted = await encryptForTenant(input.clinicId, contentPlain);
  const templateId = input.body.kind === 'template' ? input.body.templateName : null;

  // (a) reserve — suppression + pending row, atômico.
  const reserve = await withTenant(input.clinicId, async (tx) => {
    const [deceased] = await tx
      .select({ id: patients.id })
      .from(patients)
      .where(
        and(
          eq(patients.clinicId, input.clinicId),
          eq(patients.telefoneHash, toNumberHash),
          isNotNull(patients.obitoEm),
          isNull(patients.deletedAt),
        ),
      )
      .limit(1);
    if (deceased) return { kind: 'suppressed' as const };

    const [supp] = await tx
      .select({ id: suppressionList.id })
      .from(suppressionList)
      .where(
        and(
          eq(suppressionList.clinicId, input.clinicId),
          eq(suppressionList.contactHash, toNumberHash),
          eq(suppressionList.channel, 'whatsapp'),
          input.purpose
            ? or(
                eq(suppressionList.purpose, 'all'),
                eq(suppressionList.purpose, input.purpose),
              )
            : eq(suppressionList.purpose, 'all'),
        ),
      )
      .limit(1);
    if (supp) return { kind: 'suppressed' as const };

    const ins = await tx
      .insert(outboundMessages)
      .values({
        clinicId: input.clinicId,
        idempotencyKey: input.idempotencyKey,
        toNumberHash,
        contentEncrypted,
        templateId,
        status: 'pending',
      })
      .onConflictDoNothing({
        target: [outboundMessages.clinicId, outboundMessages.idempotencyKey],
      })
      .returning({ id: outboundMessages.id });

    if (ins.length === 0) {
      const [existing] = await tx
        .select({
          id: outboundMessages.id,
          status: outboundMessages.status,
          providerMessageId: outboundMessages.providerMessageId,
        })
        .from(outboundMessages)
        .where(
          and(
            eq(outboundMessages.clinicId, input.clinicId),
            eq(outboundMessages.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);
      return { kind: 'deduped' as const, row: existing! };
    }
    return { kind: 'reserved' as const, id: ins[0]!.id };
  });

  if (reserve.kind === 'suppressed') throw new SuppressedRecipientError(input.toNumber);
  if (reserve.kind === 'deduped') {
    metrics.emit('messaging.outbound.duplicate', { clinicId: input.clinicId });
    return {
      id: reserve.row.id,
      status: reserve.row.status,
      providerMessageId: reserve.row.providerMessageId,
      deduped: true,
    };
  }
  const outboundId = reserve.id;

  // (b) send — fora da tx, com refresh único de credencial em 401/403.
  let token = await decryptForTenant(input.clinicId, number.tokenCiphertext);
  let outcome = await callProvider(getMessagingProvider(number.provider), number.metaPhoneId, token, input);
  if (outcome.kind === 'auth_error') {
    const refreshed: ActiveNumber | null = await loadActiveNumberForSend(input.clinicId);
    if (refreshed && refreshed.tokenVersion > number.tokenVersion) {
      number = refreshed;
      token = await decryptForTenant(input.clinicId, number.tokenCiphertext);
      outcome = await callProvider(getMessagingProvider(number.provider), number.metaPhoneId, token, input);
    }
  }

  // auth_error remanescente (token inválido de verdade) → failed.
  const finalStatus: OutboundSendStatus =
    outcome.kind === 'accepted' ? 'accepted' : outcome.kind === 'unknown' ? 'unknown' : 'failed';
  const providerMessageId = outcome.kind === 'accepted' ? outcome.ref.providerMessageId : null;
  const providerResponse: unknown =
    outcome.kind === 'accepted'
      ? outcome.ref.raw
      : outcome.kind === 'failed' || outcome.kind === 'auth_error'
        ? outcome.raw
        : null;

  // (c) finalize.
  await withTenant(input.clinicId, async (tx) => {
    await tx
      .update(outboundMessages)
      .set({
        status: finalStatus,
        providerMessageId,
        providerResponse: (providerResponse ?? null) as never,
        ...(finalStatus === 'accepted' ? { sentAt: sql`now()` } : {}),
      })
      .where(eq(outboundMessages.id, outboundId));
    if (providerMessageId) {
      await reconcileStoredProviderStatuses(tx, input.clinicId, providerMessageId);
    }
  });

  metrics.emit(`messaging.outbound.${finalStatus}`, { clinicId: input.clinicId });
  return { id: outboundId, status: finalStatus, providerMessageId, deduped: false };
}
