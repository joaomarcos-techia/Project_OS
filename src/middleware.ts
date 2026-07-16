/**
 * Middleware — refresh de sessão + presença de auth. NADA de autorização.
 *
 * ===================================================================
 * ADR-037 — o que este arquivo DEIXOU de fazer (2026-07-16)
 * ===================================================================
 * Até aqui o middleware era o "heal layer": comparava `claims_version` do JWT com
 * o banco (fetch ao PostgREST), com throttle de ~60-75s (cookie `_claim_check_at`)
 * e anti-loop por cookie `_healed`. Três problemas, todos estruturais:
 *
 *   1. Era declaradamente NÃO-enforcement (ADR-009 D22) — então a revogação real
 *      não acontecia em lugar nenhum, e o access token sobrevivia até 15min (I-4).
 *   2. O `_healed` era forjável: `httpOnly` impede o JS de LER o cookie, não impede
 *      um cliente de ENVIAR `Cookie: _healed=1` num curl. Quem forjasse pulava o
 *      drift-check indefinidamente (I-7).
 *   3. Throttle + jitter + fetch + remontagem de cookie fragmentado + decode
 *      manual de JWT: ~150 linhas de máquina para uma garantia que não existia.
 *
 * Agora o enforcement mora na porta única (`authenticate()` em
 * @/lib/auth/tenant-context), que confere o epoch contra o banco a CADA request.
 * Tudo acima foi DELETADO — não assinamos um cookie que não precisa existir.
 * Um `_healed` forjado hoje não tem para onde ir: não há código que o leia.
 *
 * O que sobrou, e por quê:
 *   - `getUser()`: NÃO é decoração. É ele que RENOVA os cookies de sessão via
 *     @supabase/ssr. Server Component não pode escrever cookie, então sem esta
 *     chamada aqui a sessão morre a cada 15min. Ele também dá o redirect rápido
 *     de quem não tem sessão (UX — o gate negaria de qualquer jeito).
 *   - `x-request-id`: correlação de logger/Sentry/audit (C16 1.1).
 *
 * Continua valendo (ADR-009 D22, agora por escolha e não por limitação): middleware
 * é UX. Toda decisão de autorização acontece nos `require*` da porta única.
 */
import { createServerClient, type CookieMethodsServer } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export const config = {
  // Rotas excluídas: assets estáticos, healthchecks, CRON (auto-autenticadas via
  // Bearer CRON_SECRET) e WEBHOOKS (auto-autenticados pelo token/assinatura do
  // provider — Asaas/Meta). Essas rotas NÃO têm sessão Supabase; passar pelo
  // middleware de sessão as redirecionava para /login (307) e quebrava o webhook
  // em prod. Também: fluxos auth não-autenticados + /account/security (pré-MFA) +
  // /join (onboarding público via convite mágico — sem sessão até o owner ser criado;
  // a "auth" é o token validado server-side + rate-limit).
  // `monitoring` é o tunnelRoute do Sentry (next.config withSentryConfig). Sem a
  // exclusão, o middleware de sessão intercepta o túnel e redireciona p/ /login,
  // quebrando o report de erros do client (aviso explícito da doc do Sentry).
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|monitoring|api/health|api/cron|api/webhooks|login|forgot-password|reset-password|convite|auth/callback|account/security|join).*)',
  ],
};

export async function middleware(req: NextRequest): Promise<NextResponse> {
  // C16 (1.1): carimba x-request-id na request encaminhada E na resposta, para que
  // logger/Sentry/audit (buildRequestContext) correlacionem pelo mesmo handle.
  // `crypto` global existe no Edge runtime — não importar node:crypto aqui.
  const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID();
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-request-id', requestId);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set('x-request-id', requestId);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    // Sem env, não conseguimos validar — passar adiante (build/dev sem secrets).
    // Seguro: sem enforcement aqui, quem decide é a porta única (ADR-037).
    return res;
  }

  const adapter: CookieMethodsServer = {
    getAll: () => req.cookies.getAll().map((c) => ({ name: c.name, value: c.value })),
    setAll: (items) => {
      for (const { name, value, options } of items) {
        res.cookies.set({ name, value, ...options });
      }
    },
  };
  const supabase = createServerClient(url, key, { cookies: adapter });

  // Renova a sessão (escreve os cookies novos via `setAll`) e diz se há alguém.
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    const target = new URL('/login', req.url);
    return NextResponse.redirect(target, { headers: res.headers });
  }

  return res;
}
