import 'server-only';

import {
  createOnboardingInvitePath,
  isOnboardingInviteToken,
} from '@/lib/auth/onboarding-invite-fragment';
import { env } from '@/lib/env';

const LOCALHOST_NAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

function parseApplicationBaseUrl(baseUrl: string, allowInsecureLocalhost: boolean): URL {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error('[app-url] APP_BASE_URL must be an absolute URL');
  }

  const isLocalHttp =
    allowInsecureLocalhost && url.protocol === 'http:' && LOCALHOST_NAMES.has(url.hostname);
  if (url.protocol !== 'https:' && !isLocalHttp) {
    throw new Error('[app-url] APP_BASE_URL must use HTTPS outside local development');
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('[app-url] APP_BASE_URL must contain only an origin');
  }
  return url;
}

export function buildApplicationUrl(
  baseUrl: string,
  pathname: string,
  options: { allowInsecureLocalhost?: boolean } = {},
): string {
  if (!pathname.startsWith('/') || pathname.startsWith('//') || pathname.includes('?')) {
    throw new Error('[app-url] pathname must be an absolute path without a query string');
  }

  const url = parseApplicationBaseUrl(baseUrl, options.allowInsecureLocalhost === true);
  url.pathname = pathname;
  url.search = '';
  url.hash = '';
  return url.toString();
}

function configuredApplicationUrl(pathname: string): string {
  const vercelPreviewHost =
    env.VERCEL_ENV === 'preview' ? (env.VERCEL_BRANCH_URL ?? env.VERCEL_URL) : undefined;
  const baseUrl = vercelPreviewHost ? `https://${vercelPreviewHost}` : env.APP_BASE_URL;

  if (!baseUrl) {
    throw new Error(
      '[app-url] APP_BASE_URL is required for transactional links and Auth redirects',
    );
  }
  return buildApplicationUrl(baseUrl, pathname, {
    allowInsecureLocalhost: env.NODE_ENV !== 'production',
  });
}

export function createOnboardingInviteUrl(rawToken: string): string {
  if (!isOnboardingInviteToken(rawToken)) {
    throw new Error('[app-url] onboarding invite token is invalid');
  }
  const url = new URL(configuredApplicationUrl('/join'));
  url.hash = createOnboardingInvitePath(rawToken).slice('/join#'.length);
  return url.toString();
}

export function createAuthRedirectUrl(): string {
  return configuredApplicationUrl('/convite');
}

/** Allowlisted destination for password recovery initiated from Login. */
export function createPasswordResetRedirectUrl(): string {
  return configuredApplicationUrl('/reset-password');
}

/**
 * Creates the server-side confirmation URL for a one-time Supabase email token.
 *
 * O token fica no fragmento: o primeiro GET não o envia ao servidor, ao
 * Referer nem ao access log. A ponte de `/auth/confirm` limpa a URL e o entrega
 * por POST ao verificador SSR.
 */
export function createAuthConfirmationUrl(
  tokenHash: string,
  type: 'invite' | 'recovery' | 'magiclink',
): string {
  if (!tokenHash.trim()) {
    throw new Error('[app-url] auth confirmation token hash is required');
  }

  const url = new URL(configuredApplicationUrl('/auth/confirm'));
  url.hash = new URLSearchParams({
    token_hash: tokenHash,
    type,
    next: '/convite',
  }).toString();
  return url.toString();
}

/**
 * URL de confirmação do cadastro autônomo (§O-3b).
 *
 * Separada de `createAuthConfirmationUrl` porque o destino é outro: aquela leva
 * ao aceite do convite, esta leva à tela que só diz "e-mail confirmado". E
 * porque o `type` aqui não é decorativo — ele decide qual token o GoTrue espera
 * em `verifyOtp`:
 *
 * `recovery` é usado porque confirma a conta pendente sem receber nem substituir
 * a senha e, ao contrário de `magiclink`, falha quando o usuário não existe.
 */
export function createSignupConfirmationUrl(
  tokenHash: string,
  type: 'signup' | 'magiclink' | 'recovery',
  signupRef: string,
): string {
  if (!tokenHash.trim()) {
    throw new Error('[app-url] signup confirmation token hash is required');
  }
  if (!/^[a-f0-9]{64}$/u.test(signupRef)) {
    throw new Error('[app-url] signup confirmation ref is invalid');
  }
  const url = new URL(configuredApplicationUrl('/auth/confirm'));
  url.hash = new URLSearchParams({
    token_hash: tokenHash,
    type,
    next: '/cadastro/confirmado',
    signup_ref: signupRef,
  }).toString();
  return url.toString();
}
