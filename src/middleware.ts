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
 * Como o ADR-037 já tirou do middleware qualquer papel de enforcement, a chamada de
 * rede aqui era só (a) refresh de cookie de sessão e (b) redirect rápido de UX. Sem
 * ela:
 *   - (a) refresh de sessão: NÃO acontece mais aqui. `authenticate()` valida o
 *     access token via getClaims a cada request; quando ele expira, o usuário
 *     reautentica. Reintroduzir refresh sem pendurar o Edge é trabalho à parte —
 *     candidato natural é rodar o middleware no runtime NODE (onde getUser não
 *     pendura) OU um refresh client-side. Ver follow-up.
 *   - (b) redirect de UX: preservado com um check SÍNCRONO de presença do cookie de
 *     sessão (sem rede). Quem não tem cookie nenhum vai pro /login na hora; quem tem
 *     passa e a porta única decide (inclusive nega token expirado/inválido).
 *
 * `x-request-id`: correlação de logger/Sentry/audit (C16 1.1) — mantido.
 */
import { NextResponse, type NextRequest } from 'next/server';

export const config = {
  // Rotas excluídas: assets estáticos, healthchecks, CRON (Bearer CRON_SECRET) e
  // WEBHOOKS (token/assinatura do provider), + fluxos auth não-autenticados +
  // /account/security (pré-MFA) + /join (onboarding público) + `monitoring`
  // (tunnelRoute do Sentry). Essas rotas não têm sessão Supabase.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|monitoring|api/health|api/cron|api/webhooks|login|reset-password|convite|auth/callback|auth/confirm|auth/auth-error|account/security|join).*)',
  ],
};

export function middleware(req: NextRequest): NextResponse {
  // C16 (1.1): carimba x-request-id na request encaminhada E na resposta.
  // `crypto` global existe no Edge runtime.
  const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID();
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-request-id', requestId);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set('x-request-id', requestId);

  // Presença de sessão — SÍNCRONO, sem rede (o @supabase/ssr guarda o token em
  // `sb-<ref>-auth-token`, possivelmente fragmentado em `.0/.1`). Isto é só UX; a
  // validação real (assinatura, expiração, epoch) é da porta única no servidor.
  const hasSessionCookie = req.cookies
    .getAll()
    .some((c) => c.name.startsWith('sb-') && c.name.includes('-auth-token'));

  if (!hasSessionCookie) {
    return NextResponse.redirect(new URL('/login', req.url), { headers: res.headers });
  }

  return res;
}
