/**
 * Middleware — presença de auth + x-request-id. NADA de rede, NADA de autorização.
 *
 * ===================================================================
 * ADR-037 — o que este arquivo DEIXOU de fazer (2026-07-16)
 * ===================================================================
 * Até aqui o middleware era o "heal layer": comparava `claims_version` do JWT com
 * o banco. Isso foi deletado — o enforcement mora na porta única (`authenticate()`
 * em @/lib/auth/tenant-context), que confere o epoch contra o banco a CADA request.
 *
 * ===================================================================
 * 2026-07-25 — por que o `getUser()` saiu daqui
 * ===================================================================
 * O middleware roda no EDGE runtime. `supabase.auth.getUser()` faz um round-trip de
 * REDE ao Auth server (diferente de `getClaims()`, que valida o JWT localmente).
 * Observado em Preview: esse fetch PENDURA no Edge (não no Node — /api/health e
 * /login, serverless, funcionam), segurando a resposta até o limite de 300s da
 * função e derrubando TODA rota autenticada ("loading infinito" em /admin; log
 * source=edge-middleware). Timeout no nível do middleware (Promise.race) fazia o
 * middleware DECIDIR em 3s, mas a promise de rede abandonada continuava pendente e
 * a invocação Edge não finalizava a resposta (status 0).
 *
 * O middleware mantém apenas operações síncronas: presença da geração selecionada,
 * expiração de cookies legados/órfãos e detecção de vencimento. Navegações
 * próximas do vencimento passam por `/auth/session-refresh`, Route Handler Node
 * gravável; não há chamada de rede no Edge. A porta única segue autorizando.
 *
 * `x-request-id`: correlação de logger/Sentry/audit (C16 1.1) — mantido.
 */
import { NextResponse, type NextRequest } from 'next/server';

import {
  sessionNeedsRefresh,
  supabaseAuthCookiePrefix,
  supabaseAuthCookieName,
  supabaseAuthCookies,
  supabaseLegacyAuthCookieName,
  supabaseVersionedAuthCookies,
  SUPABASE_SESSION_SELECTOR_COOKIE,
  SUPABASE_SESSION_COOKIE_OPTIONS,
} from '@/lib/auth/supabase-session-cookie';

const PUBLIC_PATHS = [
  '/login',
  '/reset-password',
  '/convite',
  '/auth/callback',
  '/auth/confirm',
  '/auth/auth-error',
  '/auth/session-refresh',
  '/account/security',
  '/join',
  '/cadastro',
  '/api/signup',
] as const;

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export const config = {
  // Assets, healthchecks, CRON, webhooks e tunnel Sentry não passam aqui.
  // Páginas públicas passam também para expirar cookies legados e órfãos;
  // `isPublicPath` impede exigir sessão onde ela ainda não existe.
  //
  // `api/signup` (ADR-060, O-2a): cadastro autônomo é PÚBLICO por definição —
  // quem chega ali ainda não tem conta, então exigir cookie de sessão redirecionaria
  // todo visitante para /login. O que protege essas rotas não é sessão: é rate limit
  // por IP, teto de sessões vivas e, na fatia O-2b, desafio adaptativo. Elas não leem
  // nem escrevem dado de tenant.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|monitoring|api/health|api/cron|api/webhooks).*)',
  ],
};

export function middleware(req: NextRequest): NextResponse {
  // C16 (1.1): carimba x-request-id na request encaminhada E na resposta.
  // `crypto` global existe no Edge runtime.
  const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID();
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-request-id', requestId);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const cookiePrefix = supabaseAuthCookiePrefix(supabaseUrl);
  const cookieName = supabaseAuthCookieName(
    supabaseUrl,
    req.cookies.get(SUPABASE_SESSION_SELECTOR_COOKIE)?.value,
  );
  const legacyCookieName = supabaseLegacyAuthCookieName(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const allCookies = req.cookies.getAll();
  const authCookies = cookieName ? supabaseAuthCookies(allCookies, cookieName) : [];
  const legacyAuthCookies = legacyCookieName
    ? supabaseAuthCookies(allCookies, legacyCookieName)
    : [];
  const inactiveVersionedCookies = cookiePrefix
    ? supabaseVersionedAuthCookies(allCookies, cookiePrefix).filter(
        ({ name }) => !cookieName || (name !== cookieName && !name.startsWith(`${cookieName}.`)),
      )
    : [];
  const path = req.nextUrl.pathname;
  const paymentReturn =
    path === '/' &&
    ['success', 'cancelled', 'expired'].includes(req.nextUrl.searchParams.get('payment') ?? '');
  const publicPath = isPublicPath(path) || paymentReturn;
  const emailTokenType = req.nextUrl.searchParams.get('type');
  const hasLegacyEmailToken =
    Boolean(req.nextUrl.searchParams.get('token_hash')) &&
    ((path === '/convite' && (emailTokenType === 'invite' || emailTokenType === 'recovery')) ||
      (path === '/reset-password' && emailTokenType === 'recovery'));
  const sessionPage =
    !publicPath ||
    path === '/convite' ||
    path === '/reset-password' ||
    path === '/login/mfa' ||
    path === '/account/security';
  let res: NextResponse;

  if (!publicPath && authCookies.length === 0) {
    // S-02 (docs/otimização_ui_final.md, 33): sem sessão, uma Server Action recebia o mesmo 307
    // das páginas. O navegador reenviava o POST para /login, recebia HTML, e o cliente do Next
    // lançava ("Algo deu errado"). A action continua recusada aqui, sem chegar ao servidor de
    // aplicação; a resposta só passa a ser a que o cliente entende: corpo vazio e
    // `x-action-redirect`, que ele trata como redirecionamento para o login. Destino fixo.
    res =
      req.method === 'POST' && req.headers.has('next-action')
        ? new NextResponse(null, {
            status: 401,
            headers: { 'x-action-redirect': '/login;replace', 'content-type': 'text/plain' },
          })
        : NextResponse.redirect(new URL('/login', req.url));
  } else if (
    cookieName &&
    authCookies.length > 0 &&
    req.method === 'GET' &&
    sessionPage &&
    !hasLegacyEmailToken &&
    !path.startsWith('/api/') &&
    path !== '/auth/session-refresh' &&
    sessionNeedsRefresh(allCookies, cookieName)
  ) {
    const refreshUrl = new URL('/auth/session-refresh', req.url);
    refreshUrl.searchParams.set('next', `${path}${req.nextUrl.search}`);
    res = NextResponse.redirect(refreshUrl);
  } else {
    // Keep the visible Portuguese URL while routing through an ASCII segment.
    // Authentication and refresh are decided above, before either mapping.
    const documentationRoot = '/documentação';
    const internalRoot = '/documentacao';
    const normalizedPath = path.replace(/%[0-9a-f]{2}/giu, (escape) => escape.toUpperCase());
    const canonicalPrefix = [documentationRoot, encodeURI(documentationRoot)].find(
      (prefix) => normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`),
    );
    if (canonicalPrefix) {
      const target = req.nextUrl.clone();
      target.pathname = internalRoot + path.slice(canonicalPrefix.length);
      res = NextResponse.rewrite(target, { request: { headers: requestHeaders } });
    } else if (path === internalRoot || path.startsWith(`${internalRoot}/`)) {
      const target = req.nextUrl.clone();
      target.pathname = documentationRoot + path.slice(internalRoot.length);
      res = NextResponse.redirect(target, 308);
    } else {
      res = NextResponse.next({ request: { headers: requestHeaders } });
    }
  }

  res.headers.set('x-request-id', requestId);
  // O request não informa se um cookie é HttpOnly. Por isso a sessão antiga
  // usa outro nome e nunca é copiada: uma GET lenta poderia terminar depois de
  // logout/login/confirm e ressuscitar o snapshot recebido. O cutover é
  // fail-closed: expira o legado e exige uma autenticação única novamente.
  for (const { name } of [...legacyAuthCookies, ...inactiveVersionedCookies]) {
    res.cookies.set(name, '', {
      ...SUPABASE_SESSION_COOKIE_OPTIONS,
      path: '/',
      maxAge: 0,
      expires: new Date(0),
    });
  }
  return res;
}
