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
  if (!env.APP_BASE_URL) {
    throw new Error(
      '[app-url] APP_BASE_URL is required for transactional links and Auth redirects',
    );
  }
  return buildApplicationUrl(env.APP_BASE_URL, pathname, {
    allowInsecureLocalhost: env.NODE_ENV !== 'production',
  });
}

function vercelHostname(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      !url.hostname.endsWith('.vercel.app') ||
      url.hostname === 'vercel.app'
    ) {
      return null;
    }
    return url.hostname;
  } catch {
    return null;
  }
}

/** URL estavel da branch Preview para callbacks externos que sobrevivem ao deploy. */
export function resolvePreviewCallbackOrigin(): string | null {
  if (env.VERCEL_ENV !== 'preview') return null;
  const hostname = vercelHostname(env.VERCEL_BRANCH_URL) ?? vercelHostname(env.VERCEL_URL);
  return hostname ? `https://${hostname}` : null;
}

/**
 * Resolve a origem publica desta requisicao sem confiar em Host/Origin livres.
 *
 * Em producao e local, somente APP_BASE_URL e aceito. Em Preview, a Vercel pode
 * servir o mesmo deployment pela URL imutavel ou pelo alias da branch; ambas
 * entram pela allowlist das variaveis auto-injetadas pela plataforma.
 * `undefined` indica configuracao indisponivel; `null`, requisicao bloqueada.
 */
export function resolveTrustedApplicationOrigin(request: Request): string | null | undefined {
  const suppliedOrigin = request.headers.get('origin');
  let configuredOrigin: string | undefined;
  try {
    configuredOrigin = new URL(
      buildApplicationUrl(env.APP_BASE_URL ?? '', '/', {
        allowInsecureLocalhost: env.NODE_ENV !== 'production',
      }),
    ).origin;
  } catch {
    configuredOrigin = undefined;
  }

  const allowed = new Set(
    env.VERCEL_ENV === 'preview'
      ? [vercelHostname(env.VERCEL_URL), vercelHostname(env.VERCEL_BRANCH_URL)].filter(
          (hostname): hostname is string => hostname !== null,
        )
      : [],
  );
  if (!configuredOrigin && allowed.size === 0) return undefined;
  if (!suppliedOrigin || request.headers.get('sec-fetch-site') === 'cross-site') return null;

  let requestUrl: URL;
  let originUrl: URL;
  try {
    requestUrl = new URL(request.url);
    originUrl = new URL(suppliedOrigin);
  } catch {
    return null;
  }
  if (originUrl.origin !== suppliedOrigin) return null;
  if (suppliedOrigin === configuredOrigin) return configuredOrigin;
  if (
    env.VERCEL_ENV === 'preview' &&
    requestUrl.protocol === 'https:' &&
    requestUrl.origin === suppliedOrigin &&
    allowed.has(requestUrl.hostname)
  ) {
    return requestUrl.origin;
  }
  return null;
}

/**
 * Origem dos links de Auth enviados por e-mail: redefinição de senha, convite da equipe, convite
 * de clínica e a confirmação do cadastro quando a requisição não trouxe origem validada.
 *
 * Em Preview, o alias da branch injetado pela Vercel (`resolvePreviewCallbackOrigin`), como o
 * cadastro, o Checkout e a troca de plano já fazem. A entrada geral de `APP_BASE_URL` do Preview
 * aponta para outro deploy, e o link de redefinição abria o código de outra branch (medido no
 * ciclo 8, 20/11/2026). Fora do Preview, só `APP_BASE_URL`. Nada vem de `Host`, `Origin` ou de
 * parâmetro do cliente, e o resultado passa pelas mesmas travas de `buildApplicationUrl`.
 */
export function resolveAuthLinkOrigin(): string | undefined {
  return resolvePreviewCallbackOrigin() ?? env.APP_BASE_URL;
}

function authLinkUrl(pathname: string): string {
  const origin = resolveAuthLinkOrigin();
  if (!origin) {
    throw new Error(
      '[app-url] APP_BASE_URL is required for transactional links and Auth redirects',
    );
  }
  return buildApplicationUrl(origin, pathname, {
    allowInsecureLocalhost: env.NODE_ENV !== 'production',
  });
}

export function createOnboardingInviteUrl(rawToken: string): string {
  if (!isOnboardingInviteToken(rawToken)) {
    throw new Error('[app-url] onboarding invite token is invalid');
  }
  const url = new URL(authLinkUrl('/join'));
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

/** Tela de Pagamentos da clínica — destino do aviso de encerramento da conta Asaas. */
export function createPaymentSettingsUrl(): string {
  return configuredApplicationUrl('/configuracoes/pagamentos');
}

/**
 * Callback público esperado para o app Meta deste ambiente.
 *
 * Em Preview usa o hostname imutável da branch, como os links de Auth. Quando a
 * Vercel protege o deployment, o bypass fica somente na URL server-to-server;
 * ele nunca é devolvido ao browser nem deve aparecer em logs.
 */
export function createMetaWebhookUrl(): string {
  const url = new URL(configuredApplicationUrl('/api/webhooks/meta'));
  if (env.VERCEL_ENV === 'preview' && env.VERCEL_AUTOMATION_BYPASS_SECRET) {
    url.searchParams.set('x-vercel-protection-bypass', env.VERCEL_AUTOMATION_BYPASS_SECRET);
  }
  return url.toString();
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

  const url = new URL(authLinkUrl('/auth/confirm'));
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
  publicOrigin?: string,
): string {
  if (!tokenHash.trim()) {
    throw new Error('[app-url] signup confirmation token hash is required');
  }
  if (!/^[a-f0-9]{64}$/u.test(signupRef)) {
    throw new Error('[app-url] signup confirmation ref is invalid');
  }
  const url = new URL(
    publicOrigin
      ? buildApplicationUrl(publicOrigin, '/auth/confirm', {
          allowInsecureLocalhost: env.NODE_ENV !== 'production',
        })
      : authLinkUrl('/auth/confirm'),
  );
  url.hash = new URLSearchParams({
    token_hash: tokenHash,
    type,
    next: '/cadastro/confirmado',
    signup_ref: signupRef,
  }).toString();
  return url.toString();
}

/**
 * Link de redefinição de senha pedido em "Esqueci a senha".
 *
 * Existe porque o e-mail de recovery deixou de ser o template do painel do
 * Supabase. Aquele template usava `{{ .ConfirmationURL }}`: o GoTrue consumia o
 * token no `/auth/v1/verify` dele e devolvia a sessão na URL, e `/reset-password`
 * — que desde a AUTH-006 só aceita a prova emitida por `/auth/confirm` —
 * respondia "Link inválido ou expirado" em TODO pedido. Medido em 29/09/2026.
 *
 * O formato é o mesmo dos outros links de e-mail: token no fragmento (não vai ao
 * servidor no GET, ao Referer nem ao log), `type=recovery` e destino fixo.
 */
export function createPasswordResetConfirmationUrl(tokenHash: string): string {
  if (!tokenHash.trim()) {
    throw new Error('[app-url] password reset token hash is required');
  }
  const url = new URL(authLinkUrl('/auth/confirm'));
  url.hash = new URLSearchParams({
    token_hash: tokenHash,
    type: 'recovery',
    next: '/reset-password',
  }).toString();
  return url.toString();
}
