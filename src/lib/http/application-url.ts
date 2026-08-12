import 'server-only';

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
  if (!/^[A-Za-z0-9_-]{32,512}$/.test(rawToken)) {
    throw new Error('[app-url] onboarding invite token is invalid');
  }
  return configuredApplicationUrl(`/join/${rawToken}`);
}

export function createAuthRedirectUrl(): string {
  return configuredApplicationUrl('/convite');
}
