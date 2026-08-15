/**
 * `/auth/confirm` — troca de link de e-mail (convite/recovery) por sessão,
 * SERVER-SIDE (itens 10/11/21 do lote).
 *
 * Por que existe: os fluxos que chegam por e-mail (convite `inviteUserByEmail`,
 * recovery `resetPasswordForEmail`/`generateLink`) NÃO podem ser trocados por
 * `exchangeCodeForSession(?code)` no cliente — o `?code` exige um code-verifier
 * PKCE que só existe no navegador que INICIOU o fluxo; um link de e-mail nunca
 * tem. `verifyOtp({token_hash, type})` no servidor não depende de verifier e
 * funciona em qualquer navegador. É o padrão SSR canônico do Supabase.
 *
 * Depende do template do e-mail apontar para
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=<invite|recovery>&next=<path>
 * (config do dashboard — ver plano). O `type` vem do template; aceitamos os
 * types dos nossos fluxos e validamos.
 *
 * Segurança: `next` é sanitizado (só path interno — anti open-redirect). Antes do
 * verifyOtp fazemos signOut local para não misturar com uma sessão pré-existente
 * (ex.: alguém logado abre o convite de outra pessoa → estabelece a identidade
 * do TOKEN, não a antiga).
 *
 * NÃO libera acesso ao app: para convite, a sessão resultante é a PENDENTE (sem
 * claims — o hook nega até `invite_accepted_at`, ADR-040). Quem libera é o
 * aceite em `/convite`.
 */
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { NextRequest } from 'next/server';

import {
  RECOVERY_GRANT_COOKIE,
  RECOVERY_GRANT_TTL_SECONDS,
  signRecoveryGrant,
} from '@/lib/auth/recovery-grant';
import { createServerClient } from '@/lib/auth/supabase-server';
import { readAuthoritativeProfile } from '@/lib/auth/tenant-context';
import { env } from '@/lib/env';
import { logger } from '@/lib/observability/logger';

import { isValidOtpType, safeNext, verifyErrorReason } from './confirm-logic';

export async function GET(request: NextRequest): Promise<never> {
  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type');
  const next = safeNext(searchParams.get('next'));

  const fail = (reason: string): never => redirect(`/auth/auth-error?reason=${reason}`);

  if (!tokenHash) return fail('missing_token');
  if (!isValidOtpType(type)) return fail('invalid_type');

  const supabase = await createServerClient();

  // Limpa qualquer sessão local antes de estabelecer a do token (evita
  // "usuário errado abre o convite"). `local` não faz round-trip ao servidor.
  await supabase.auth.signOut({ scope: 'local' }).catch(() => {
    /* sem sessão prévia — no-op */
  });

  const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
  if (error) {
    logger.warn('auth.confirm.verify_failed', { type, message: error.message });
    return fail(verifyErrorReason(error.message));
  }

  // AUTH-006 — ESTE é o único ponto do sistema que prova "apresentou um token
  // de recovery". Só aqui o grant de troca de senha pode nascer. Se algum dia
  // outro caminho passar a emiti-lo sem essa prova, o achado volta.
  if (type === 'recovery') {
    const userId = data.user?.id;
    if (!userId) return fail('invalid_token');
    // O epoch atual entra no grant e é o que o torna one-time (ver o módulo).
    const profile = await readAuthoritativeProfile(userId);
    if (!profile) return fail('invalid_token');

    const jar = await cookies();
    jar.set(
      RECOVERY_GRANT_COOKIE,
      signRecoveryGrant({
        userId,
        epoch: profile.claimsVersion,
        expiresAt: Date.now() + RECOVERY_GRANT_TTL_SECONDS * 1000,
      }),
      {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: RECOVERY_GRANT_TTL_SECONDS,
      },
    );
  }

  // Sucesso: cookies de sessão já gravados pelo adapter. Segue para o destino
  // (convite: define senha; recovery: nova senha).
  redirect(next);
}
