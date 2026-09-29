import 'server-only';

import { createHmac } from 'node:crypto';

import { createAdminClient } from '@/lib/auth/supabase-admin';
import { sendTransactionalEmail } from '@/lib/email/resend';
import { renderPasswordResetEmail } from '@/lib/email/templates/password-reset';
import { env } from '@/lib/env';
import { createPasswordResetConfirmationUrl } from '@/lib/http/application-url';
import { logger } from '@/lib/observability/logger';
import { metrics } from '@/lib/observability/metrics';

/**
 * E-mail de "Esqueci a senha" — o token vem do GoTrue, o link e o envio são nossos.
 *
 * ===================================================================
 * O defeito (reproduzido em 29/09/2026)
 * ===================================================================
 * `forgotPasswordAction` chamava `resetPasswordForEmail`, e o GoTrue mandava o
 * template "Reset Password" do painel. O do repositório usa
 * `{{ .ConfirmationURL }}`: o link passa pelo `/auth/v1/verify` do GoTrue, que
 * consome o token e devolve a sessão na URL (ou `?code=`, no fluxo PKCE). Desde a
 * AUTH-006, `/reset-password` só aceita a prova de recovery emitida por
 * `/auth/confirm` depois de `verifyOtp` — e responde "Link inválido ou expirado"
 * a qualquer outra coisa. Resultado: TODO pedido de redefinição falhava. Não era
 * configuração: nenhum template baseado em `ConfirmationURL` funcionaria.
 *
 * ===================================================================
 * Agora
 * ===================================================================
 * `generateLink({ type: 'recovery' })` devolve só o token (não envia nada), o
 * link sai no formato que `/auth/confirm` verifica e o Resend entrega o template
 * do repositório. É o mesmo desenho que o e-mail de confirmação de cadastro já
 * usa, e pelo mesmo motivo: o painel deixa de poder quebrar este fluxo.
 *
 * Nada aqui é registrado com endereço, token ou link. O desfecho é devolvido só
 * para métrica: a action responde igual em todos os casos, para não revelar se o
 * endereço tem conta.
 */

export type PasswordResetDelivery = 'sent' | 'no_account' | 'failed';

/** Chave de idempotência sem o token: o Resend guarda a chave, e ela não é segredo lá. */
function resetIdempotencyKey(tokenHash: string): string {
  const secret = env.MAGIC_TOKEN_SECRET;
  if (!secret) throw new Error('password reset idempotency secret is unavailable');
  const digest = createHmac('sha256', secret)
    .update(`qoro/password-reset/v1:${tokenHash}`, 'utf8')
    .digest('hex');
  return `password-reset:${digest}`;
}

export async function sendPasswordResetEmail(email: string): Promise<PasswordResetDelivery> {
  let tokenHash: string;
  try {
    const { data, error } = await createAdminClient().auth.admin.generateLink({
      type: 'recovery',
      email,
    });
    if (error) {
      // Conta inexistente não é falha: é o caso que a resposta uniforme esconde.
      if (error.code === 'user_not_found' || error.status === 404) {
        metrics.emit('auth.password_reset.no_account', {});
        return 'no_account';
      }
      logger.warn('auth.password_reset.link_failed', { code: error.code ?? 'unknown' });
      return 'failed';
    }
    const hash = data?.properties?.hashed_token;
    if (typeof hash !== 'string' || hash.length === 0) {
      logger.warn('auth.password_reset.link_failed', { code: 'no_token' });
      return 'failed';
    }
    tokenHash = hash;
  } catch (error) {
    logger.warn('auth.password_reset.link_failed', {
      code: error instanceof Error ? error.name : 'unknown',
    });
    return 'failed';
  }

  try {
    const conteudo = renderPasswordResetEmail({
      resetUrl: createPasswordResetConfirmationUrl(tokenHash),
      expectedOrigin: env.APP_BASE_URL ?? '',
    });
    await sendTransactionalEmail({
      to: email,
      subject: conteudo.subject,
      html: conteudo.html,
      text: conteudo.text,
      idempotencyKey: resetIdempotencyKey(tokenHash),
    });
    metrics.emit('auth.password_reset.sent', {});
    return 'sent';
  } catch (error) {
    logger.warn('auth.password_reset.delivery_failed', {
      reason: error instanceof Error ? error.name : 'unknown',
    });
    return 'failed';
  }
}
