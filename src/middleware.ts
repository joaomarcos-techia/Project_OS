/**
 * Middleware — claims drift mitigation throttled (NÃO é enforcement primário, D22).
 *
 * Decisões frozen (ADR-009 + plano C3 v6):
 *   - 3 responsabilidades APENAS: validar auth presente, checar drift (throttled),
 *     redirect para login. Nada de role routing, MFA routing, AAL enforcement.
 *   - Throttle por cookie `_claim_check_at` (epoch ms + jitter 0-15s, D28).
 *     No máximo 1 query DB por user a cada ~60-75s.
 *   - Anti-loop via cookie `_healed` (60s) durante ciclo signOut+redirect.
 *   - Drift = JWT.claims_version diferente de DB.claims_version OU profile.ativo=false
 *     OU profile.deleted_at IS NOT NULL → signOut global + redirect /login?reason=...
 *   - JWT replay window (D12): access_token TTL 15min Supabase config — middleware
 *     reduz janela de inconsistência, NÃO elimina (ADR-009 P5).
 *
 * Toda decisão de autorização REAL (role, permission) acontece em Server Actions
 * via requireUser/requireRole/requireCachedPermission/requireFreshPermission.
 * Middleware NÃO substitui — middleware é UX/heal layer.
 */
import { createServerClient, type CookieMethodsServer } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const HEALED_COOKIE = '_healed';
const CLAIM_CHECK_COOKIE = '_claim_check_at';
const CLAIM_CHECK_WINDOW_MS = 60_000;
const CLAIM_CHECK_JITTER_MS = 15_000;

export const config = {
  // Rotas excluídas: assets estáticos, healthchecks, CRON (auto-autenticadas via
  // Bearer CRON_SECRET — NÃO têm sessão Supabase; passar pelo middleware de
  // sessão as redirecionava para /login e quebrava o worker da Vercel em prod),
  // fluxos auth não-autenticados, /account/security (pré-MFA-enroll super_admin).
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/health|api/cron|login|forgot-password|reset-password|auth/callback|account/security).*)',
  ],
};

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const res = NextResponse.next({ request: req });

  // Anti-loop: durante ciclo de healing (signOut + redirect), cookie _healed
  // bloqueia o middleware por 60s para evitar redirect loop. O cookie é
  // recriado a cada drift detection.
  if (req.cookies.get(HEALED_COOKIE)) {
    return res;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    // Sem env, não conseguimos validar — passar adiante (build/dev sem secrets).
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

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    // Sem session → login.
    return redirectToLogin(req, null);
  }

  // Throttle DB check: se cookie indica check < 60s + jitter atrás, skip query.
  const lastCheck = parseEpoch(req.cookies.get(CLAIM_CHECK_COOKIE)?.value);
  const now = Date.now();
  const jitter = Math.floor(Math.random() * CLAIM_CHECK_JITTER_MS);
  if (lastCheck !== null && now - lastCheck < CLAIM_CHECK_WINDOW_MS + jitter) {
    return res;
  }

  // DB check: profile.ativo + claims_version drift detection.
  // Postgres PK lookup é sub-ms; trade-off aceitável vs query a cada request.
  // Usa fetch direto à Supabase REST API (Edge runtime não suporta postgres-js).
  // PostgREST com publishable key respeita RLS: profiles_self_select policy
  // permite o user ler o próprio profile.
  const jwt = data.user.id; // só usamos id; o filter precisa de access_token.
  const accessToken = await getAccessTokenFromCookies(req, adapter);

  let profile: { claims_version: number; ativo: boolean; deleted_at: string | null } | null = null;
  if (accessToken) {
    try {
      const r = await fetch(
        `${url}/rest/v1/profiles?id=eq.${jwt}&select=claims_version,ativo,deleted_at`,
        {
          headers: {
            apikey: key,
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );
      if (r.ok) {
        const rows = (await r.json()) as Array<{
          claims_version: number;
          ativo: boolean;
          deleted_at: string | null;
        }>;
        profile = rows[0] ?? null;
      }
    } catch {
      // Network failure não deve bloquear navegação; throttle vai re-tentar em 60s.
      return res;
    }
  }

  if (!profile) {
    // Profile não encontrado (raro — usuário criado em auth.users mas sem profile
    // ainda, ou RLS bloqueando). Tratamos como sem authorization.
    return redirectToLogin(req, 'no_profile');
  }

  if (!profile.ativo || profile.deleted_at !== null) {
    return forceHealAndLogout(req, res, 'disabled', supabase);
  }

  // Drift detection: comparar claims_version do JWT com DB.
  const jwtClaimsVersion = await getClaimsVersionFromJwt(accessToken);
  if (
    jwtClaimsVersion !== null &&
    jwtClaimsVersion !== profile.claims_version
  ) {
    return await forceHealAndLogout(req, res, 'drift', supabase);
  }

  // OK: marca timestamp do last check.
  res.cookies.set({
    name: CLAIM_CHECK_COOKIE,
    value: String(now),
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    maxAge: 60 * 5,
  });
  return res;
}

function parseEpoch(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

async function getAccessTokenFromCookies(
  _req: NextRequest,
  adapter: CookieMethodsServer,
): Promise<string | null> {
  // O @supabase/ssr armazena a session encoded em um cookie cujo nome contém
  // 'sb-' + projectRef + '-auth-token'. Quando a sessão serializada passa de
  // ~3180 bytes (users com muitas permissões — gestor/owner), o @supabase/ssr
  // QUEBRA o cookie em fragmentos `...-auth-token.0`, `.1`, ... Precisamos
  // remontar os fragmentos em ordem ANTES de parsear, senão o token nunca é
  // encontrado e o middleware devolve no_profile indevidamente.
  const cookiesMaybeAsync = adapter.getAll?.();
  const cookies = cookiesMaybeAsync instanceof Promise ? await cookiesMaybeAsync : cookiesMaybeAsync;
  if (!cookies) return null;

  // Agrupa por nome-base (sem o sufixo .N), guardando o índice de cada fragmento.
  const groups = new Map<string, { index: number; value: string }[]>();
  for (const c of cookies) {
    if (!c.name.startsWith('sb-')) continue;
    const m = c.name.match(/^(.*-auth-token)(?:\.(\d+))?$/);
    if (!m) continue;
    const base = m[1]!;
    const index = m[2] ? Number.parseInt(m[2], 10) : 0;
    const arr = groups.get(base) ?? [];
    arr.push({ index, value: c.value });
    groups.set(base, arr);
  }

  for (const parts of groups.values()) {
    // Concatena os fragmentos em ordem; o prefixo 'base64-' (quando presente)
    // vem no fragmento .0, então fica no início do valor remontado.
    parts.sort((a, b) => a.index - b.index);
    let raw = parts.map((p) => p.value).join('');
    try {
      if (raw.startsWith('base64-')) {
        raw = Buffer.from(raw.slice(7), 'base64').toString('utf8');
      }
      const parsed = JSON.parse(raw) as { access_token?: string };
      if (parsed.access_token) return parsed.access_token;
    } catch {
      // formato pode variar entre versões @supabase/ssr — tenta o próximo grupo
    }
  }
  return null;
}

async function getClaimsVersionFromJwt(token: string | null): Promise<number | null> {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const norm = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = norm + '=='.slice(0, (4 - (norm.length % 4)) % 4);
    const payload = JSON.parse(
      Buffer.from(padded, 'base64').toString('utf8'),
    ) as { claims_version?: number };
    return typeof payload.claims_version === 'number' ? payload.claims_version : null;
  } catch {
    return null;
  }
}

function redirectToLogin(req: NextRequest, reason: string | null): NextResponse {
  const target = new URL('/login', req.url);
  if (reason) target.searchParams.set('reason', reason);
  return NextResponse.redirect(target);
}

async function forceHealAndLogout(
  req: NextRequest,
  res: NextResponse,
  reason: 'disabled' | 'drift',
  supabase: ReturnType<typeof createServerClient>,
): Promise<NextResponse> {
  // F-18: usuário DESATIVADO (ativo=false / deleted) deve perder a sessão
  // server-side — não só o cookie local. signOut({scope:'global'}) no client
  // @supabase/ssr (com a sessão da request) revoga os refresh tokens via Auth
  // server (Cenário A confirmado na doc Supabase). Revoga EXATAMENTE UMA VEZ:
  // só chegamos aqui quando `_healed` ainda NÃO está setado (early-return no
  // topo do middleware) e há sessão; setamos `_healed` logo abaixo + limpamos os
  // cookies sb-, então a próxima request pula o middleware ou já não tem sessão —
  // sem tempestade de revogação. Falha da revogação é NÃO-FATAL (UX > revogação).
  if (reason === 'disabled') {
    try {
      await supabase.auth.signOut({ scope: 'global' });
    } catch {
      // não-fatal — o cookie cleanup + redirect abaixo seguem.
    }
  }
  // Anti-loop: marca _healed por 60s. Próximo request com o cookie pula middleware
  // e vai direto pro /login (matcher exclui /login).
  res.cookies.set({
    name: HEALED_COOKIE,
    value: '1',
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    maxAge: 60,
  });
  // Limpa cookies do Supabase para forçar re-login. signOut global server-side
  // acontece quando o user tenta novamente — aqui o cookie cleanup é suficiente
  // para invalidar a session do device atual.
  for (const c of req.cookies.getAll()) {
    if (c.name.startsWith('sb-') && c.name.endsWith('-auth-token')) {
      res.cookies.delete(c.name);
    }
  }
  const target = new URL('/login', req.url);
  target.searchParams.set('reason', reason);
  return NextResponse.redirect(target, { headers: res.headers });
}
