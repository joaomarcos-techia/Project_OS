/**
 * Loop externo de e-mail em DEV:
 * Qoro -> Resend send -> evento delivered -> inbox inbound Resend -> conteúdo.
 *
 * Pré-requisito manual único:
 *   Resend -> Receiving Emails -> Inbound address
 *   E2E_RESEND_INBOX_ADDRESS=<qualquer-alias>@<id>.resend.app
 *
 * Nunca imprime endereço, corpo, links, tokens ou IDs completos.
 */
import './_env';

import { randomUUID } from 'node:crypto';

import { sendTransactionalEmail } from '@/lib/email/resend';
import { createResendInboxAlias, waitForResendEmail } from '@/lib/email/resend-inspector';
import { env } from '@/lib/env';
import { redactOpaqueId } from '@/lib/sanitize/redact';

async function main(): Promise<void> {
  if (process.env.SUPABASE_PROJECT_ENV !== 'dev') {
    throw new Error('[resend-inbox] SUPABASE_PROJECT_ENV=dev é obrigatório');
  }
  const configuredInbox = process.env.E2E_RESEND_INBOX_ADDRESS;
  if (!configuredInbox) {
    throw new Error(
      '[resend-inbox] E2E_RESEND_INBOX_ADDRESS ausente; copie o Inbound address em Resend -> Receiving Emails',
    );
  }
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) throw new Error('[resend-inbox] RESEND_API_KEY_DEV ausente');

  const runId = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const recipient = createResendInboxAlias(configuredInbox, runId);
  const subject = `Qoro E2E inbox ${runId}`;
  const nonce = randomUUID();
  const startedAt = new Date(Date.now() - 1_000);
  const sent = await sendTransactionalEmail({
    to: recipient,
    subject,
    text: `Validação de inbox Qoro. Código: ${nonce}`,
    html: `<p>Validação de inbox Qoro.</p><p>Código: <strong>${nonce}</strong></p>`,
    idempotencyKey: `resend-inbox/${runId}`,
  });

  const providerCopy = await waitForResendEmail({
    apiKey,
    to: recipient,
    subject,
    sentAfter: startedAt,
    kind: 'sent',
    timeoutMs: 60_000,
    acceptedLastEvents: ['delivered', 'opened', 'clicked'],
    rejectedLastEvents: ['bounced', 'complained', 'canceled', 'failed'],
  });
  if (providerCopy.id !== sent.providerMessageId) {
    throw new Error('[resend-inbox] listagem não corresponde ao envio desta execução');
  }
  if (!['delivered', 'opened', 'clicked'].includes(providerCopy.lastEvent ?? '')) {
    throw new Error('[resend-inbox] Resend ainda não confirmou entrega');
  }
  if (!providerCopy.text?.includes(nonce) || !providerCopy.html?.includes(nonce)) {
    throw new Error('[resend-inbox] cópia enviada não preservou o conteúdo esperado');
  }

  const received = await waitForResendEmail({
    apiKey,
    to: recipient,
    subject,
    sentAfter: startedAt,
    kind: 'received',
    timeoutMs: 60_000,
  });
  if (!received.text?.includes(nonce) && !received.html?.includes(nonce)) {
    throw new Error('[resend-inbox] inbox recebido não contém o marcador desta execução');
  }

  console.log(
    `[resend-inbox] PASS sent=${redactOpaqueId(providerCopy.id)} received=${redactOpaqueId(received.id)} event=${providerCopy.lastEvent}`,
  );
}

void main().catch((error: unknown) => {
  console.error('[resend-inbox] FAIL:', error instanceof Error ? error.message : 'unknown error');
  process.exitCode = 1;
});
