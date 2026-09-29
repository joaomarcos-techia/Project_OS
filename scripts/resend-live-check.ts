/**
 * Verificação externa de envio transacional Resend no ambiente de desenvolvimento.
 *
 * O destinatário é exclusivamente o SUPER_ADMIN_EMAIL configurado no .env.local.
 * Não inclui dados de pacientes, links autenticados ou informação clínica.
 *
 * Uso: pnpm email:live-check
 */
import './_env';

import { sendTransactionalEmail } from '@/lib/email/resend';
import { getSentEmail } from '@/lib/email/resend-inspector';
import { env } from '@/lib/env';
import { redactOpaqueId } from '@/lib/sanitize/redact';

async function main(): Promise<void> {
  if (process.env.SUPABASE_PROJECT_ENV !== 'dev') {
    throw new Error(
      '[resend-live] recusado: SUPABASE_PROJECT_ENV deve declarar explicitamente dev.',
    );
  }
  if (!env.SUPER_ADMIN_EMAIL) {
    throw new Error(
      '[resend-live] SUPER_ADMIN_EMAIL não configurado no ambiente de desenvolvimento.',
    );
  }

  const subject = 'ClinicaOS — validação de e-mail transacional';
  const text = 'Este é um e-mail de validação do ambiente de desenvolvimento ClinicaOS.';
  const html = '<p>Este é um e-mail de validação do ambiente de desenvolvimento ClinicaOS.</p>';
  const message = await sendTransactionalEmail({
    to: env.SUPER_ADMIN_EMAIL,
    subject,
    text,
    html,
    idempotencyKey: `resend-live-check/${Date.now()}`,
  });

  const providerCopy = await getSentEmail(env.RESEND_API_KEY!, message.providerMessageId);
  if (
    providerCopy.subject !== subject ||
    providerCopy.text !== text ||
    providerCopy.html !== html ||
    !providerCopy.to.some(
      (address) => address.toLowerCase() === env.SUPER_ADMIN_EMAIL!.toLowerCase(),
    )
  ) {
    throw new Error('[resend-live] provider copy does not match the requested email');
  }

  console.log(
    '[resend-live] accepted and retrieved from provider:',
    redactOpaqueId(message.providerMessageId),
    `event=${providerCopy.lastEvent ?? 'pending'}`,
  );
}

void main().catch((error: unknown) => {
  console.error('[resend-live] failed:', error instanceof Error ? error.message : 'unknown error');
  process.exitCode = 1;
});
