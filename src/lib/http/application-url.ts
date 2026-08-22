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
 * The token hash is intentionally kept in the query string only long enough for
 * `/auth/confirm` to exchange it for the HTTP-only session cookies. Returning the
 * raw Auth action link would instead redirect the recipient to `/convite` with
 * bearer credentials in the URL fragment, which is not a supported SSR flow.
 */
export function createAuthConfirmationUrl(
  tokenHash: string,
  type: 'invite' | 'recovery' | 'magiclink',
): string {
  if (!tokenHash.trim()) {
    throw new Error('[app-url] auth confirmation token hash is required');
  }

  const url = new URL(configuredApplicationUrl('/auth/confirm'));
  url.searchParams.set('token_hash', tokenHash);
  url.searchParams.set('type', type);
  url.searchParams.set('next', '/convite');
  return url.toString();
}
