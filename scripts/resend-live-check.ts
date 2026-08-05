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
import { env } from '@/lib/env';

async function main(): Promise<void> {
  if (process.env.SUPABASE_PROJECT_ENV === 'prod') {
    throw new Error('[resend-live] recusado: este check só pode rodar fora de produção.');
  }
  if (!env.SUPER_ADMIN_EMAIL) {
    throw new Error(
      '[resend-live] SUPER_ADMIN_EMAIL não configurado no ambiente de desenvolvimento.',
    );
  }

  const message = await sendTransactionalEmail({
    to: env.SUPER_ADMIN_EMAIL,
    subject: 'ClinicaOS — validação de e-mail transacional',
    text: 'Este é um e-mail de validação do ambiente de desenvolvimento ClinicaOS.',
    html: '<p>Este é um e-mail de validação do ambiente de desenvolvimento ClinicaOS.</p>',
    idempotencyKey: `resend-live-check/${Date.now()}`,
  });

  console.log('[resend-live] accepted by provider:', message.providerMessageId);
}

void main().catch((error: unknown) => {
  console.error('[resend-live] failed:', error instanceof Error ? error.message : 'unknown error');
  process.exitCode = 1;
});
