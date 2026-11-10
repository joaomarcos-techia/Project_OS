import 'server-only';

import { createHmac } from 'node:crypto';
import type { User } from '@supabase/supabase-js';

import { readAuthoritativeProfile } from '@/lib/auth/tenant-context';
import { sendTransactionalEmailRetried } from '@/lib/email/retry';
import { renderSignupExistingAccountEmail } from '@/lib/email/templates/signup-existing-account';
import { env } from '@/lib/env';
import { buildApplicationUrl } from '@/lib/http/application-url';
import { logger } from '@/lib/observability/logger';
import { metrics } from '@/lib/observability/metrics';

import { readSignupAuthBinding } from './signup-auth-binding';
import { recordSignupCodeDelivery } from './signup-email-code-repository';

type Stage = 'initial' | 'resend';

/**
 * Só quem consegue entrar hoje recebe o aviso: e-mail confirmado, sem bloqueio,
 * e senha definida pelo cadastro ou perfil ativo com convite aceito. Conta
 * pendente de outro cadastro em andamento não recebe nada, como antes.
 */
async function canSignIn(user: User, email: string): Promise<boolean> {
  if (user.email?.trim().toLowerCase() !== email.trim().toLowerCase()) return false;
  if (!user.email_confirmed_at) return false;
  if (typeof user.banned_until === 'string' && user.banned_until.length > 0) return false;
  if (readSignupAuthBinding(user)?.passwordState === 'set') return true;
  const profile = await readAuthoritativeProfile(user.id);
  return Boolean(
    profile && profile.deletedAt === null && profile.ativo && profile.inviteAcceptedAt !== null,
  );
}

/** Uma chave por tentativa: retry da mesma tentativa não duplica o aviso. */
function noticeIdempotencyKey(stage: Stage, signupRef: string, attemptEpoch: number): string {
  const secret = env.MAGIC_TOKEN_SECRET;
  if (!secret) throw new Error('signup existing-account idempotency secret is unavailable');
  const digest = createHmac('sha256', secret)
    .update(`qoro/signup-existing-account/v1:${stage}:${signupRef}:${attemptEpoch}`, 'utf8')
    .digest('hex');
  return `signup-existing-account:${stage}:${digest}`;
}

/**
 * Avisa o dono do endereço que ele já tem conta, quando o cadastro foi ofuscado.
 *
 * A resposta pública não muda (ADR-062 §6): quem pediu o cadastro vê a mesma
 * tela, o mesmo status e o mesmo piso de tempo. Só a caixa do dono do e-mail
 * recebe a explicação. Nunca lança: uma falha aqui não pode virar uma resposta
 * diferente da do envio normal.
 */
export async function notifyExistingSignupAccount(input: {
  user: User;
  email: string;
  signupRef: string;
  attemptEpoch: number;
  stage: Stage;
  publicOrigin: string;
}): Promise<void> {
  try {
    if (!(await canSignIn(input.user, input.email))) return;
    const content = renderSignupExistingAccountEmail({
      loginUrl: buildApplicationUrl(input.publicOrigin, '/login', {
        allowInsecureLocalhost: env.NODE_ENV !== 'production',
      }),
      publicOrigin: input.publicOrigin,
    });
    const result = await sendTransactionalEmailRetried({
      to: input.email,
      ...content,
      idempotencyKey: noticeIdempotencyKey(input.stage, input.signupRef, input.attemptEpoch),
    });
    metrics.emit('signup.existing_account_notice.sent', { stage: input.stage });
    // O recibo entra na sessão como o de um código: o webhook do Resend
    // atualiza o status de entrega (`/me`) igual nas duas jornadas. Sem isto,
    // um cadastro real virava "entregue" e o de conta existente ficava
    // "pendente" para sempre, o que dizia qual endereço já tinha conta.
    await recordSignupCodeDelivery({
      signupRef: input.signupRef,
      attemptEpoch: input.attemptEpoch,
      messageId: result.providerMessageId,
    });
  } catch (error) {
    logger.warn('signup.existing_account_notice.failed', {
      stage: input.stage,
      reason: error instanceof Error ? error.name : 'unknown',
    });
  }
}
