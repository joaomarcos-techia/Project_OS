/**
 * `pnpm arch:db-check`
 *
 * Structural guard mirroring the ESLint rules AND a FAIL-CLOSED allowlist for DB
 * connection origins (F-01): the multi-tenant boundary is enforced by tooling,
 * not convention.
 *
 * F-01 — connection-origin allowlist (default-deny). The runtime `db` pool
 * connects with a BYPASSRLS role; `withTenant` (SET LOCAL ROLE authenticated) is
 * the principal isolation defense, NOT FORCE RLS (which does not stop BYPASSRLS —
 * ADR-007). Any path reaching a connection origin OUTSIDE the explicit allowlist
 * is a latent cross-tenant bypass.
 *
 * Detection is AST-based (src/lib/db/connection-origin-guard.ts) and covers
 * import / dynamic import() / require() / re-export (`export { db } from`,
 * `export *`), with re-export chains tracked transitively to a fixed point.
 *
 * Origins + per-file allowlists:
 *   - bare `postgres`                        → src/lib/db/index.ts, scripts/db-migrate-prod.ts,
 *                                               scripts/delete-test-clinics-prod.ts,
 *                                               scripts/reset-prod-data.ts,
 *                                               scripts/load-test.ts + seed runner
 *   - `drizzle` from drizzle-orm/postgres-js  → src/lib/db/index.ts
 *   - `db`      (named export of @/lib/db)    → src/lib/db/tenant.ts (withTenant)
 *   - `dbAdmin` (named export of @/lib/db)    → ALLOWED_DB_VALUE_IMPORTS.dbAdmin
 *   - `dbWorker`(named export of @/lib/db)    → ALLOWED_DB_VALUE_IMPORTS.dbWorker
 *   - namespace import / dynamic / require of an origin → only src/lib/db/index.ts
 *   - any re-export of a pool name/origin     → forbidden everywhere except origin
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve, sep, posix } from 'node:path';

import {
  findOriginUsages,
  type Classify,
  type SpecifierClass,
} from '@/lib/db/connection-origin-guard';

const REPO_ROOT = process.cwd();
const DB_ORIGIN = 'src/lib/db/index.ts';

const ALLOWED_POSTGRES_IMPORTS = new Set([
  // Exact DEV ref, frozen hashes, read-only default; one reviewed migrator session.
  'scripts/security/abacatepay-dev-release.ts',
  // One-shot Pix migrator: exact DEV ref, pinned journal/hash and session lock.
  'scripts/abacatepay-pix-dev-apply.ts',
  'src/lib/db/index.ts',
  // Cluster temporário próprio, loopback fixo e data_directory conferido antes do DDL.
  'scripts/security/tenant-isolation.ts',
  'scripts/security/signup-regression.ts',
  'scripts/security/scratch-schema.ts',
  // Fixed loopback CLI project 55442; synthetic fixtures, no remote targets.
  'scripts/security/signup-local-backend.ts',
  'scripts/security/signup-local.integration.ts',
  'scripts/security/signup-browser.integration.ts',
  // Guarded Preview/DEV operator; synthetic resend.dev recipients only.
  'scripts/run-signup-recovery-dev.ts',
  'scripts/db-migrate-prod.ts',
  'scripts/delete-test-clinics-prod.ts',
  // P8: conexões descartáveis, guardadas por loopback + prefixo do banco.
  'scripts/load-test.ts',
  'scripts/load-test-seed-runner.ts',
  // Reset operacional one-shot: não pode usar o pool do runtime porque recebe
  // DATABASE_URL_PROD após opt-in explícito e gera backup antes da transação.
  'scripts/reset-prod-data.ts',
]);
const ALLOWED_DRIZZLE_PG_IMPORTS = new Set([
  'src/lib/db/index.ts',
  'scripts/security/abacatepay-dev-release.ts',
  'scripts/abacatepay-pix-dev-apply.ts',
  // Disposable PostgreSQL fixture; the shared scratch-schema owns its loopback pool.
  'scripts/security/abacatepay-pix-release-db.ts',
]);
const ALLOWED_DB_VALUE_IMPORTS: Record<string, Set<string>> = {
  db: new Set(['src/lib/db/tenant.ts']),
  dbAdmin: new Set([
    'src/lib/audit/super-admin.ts',
    // C15: auditoria extra do impersonate grava em super_admin_actions via
    // service_role (a tx do tenant roda como authenticated e não passa na RLS
    // is_super_admin()). Escrita pós-commit, best-effort.
    'src/lib/audit/impersonation-extra.ts',
    'src/lib/auth/tenant-context.ts',
    // AUTH-005/006/007: o bump autoritativo do epoch de sessão (logout global e
    // troca de senha). `profiles` não tem UPDATE para `authenticated` (D31) —
    // via RLS o UPDATE casaria zero linhas e falharia ABERTO, que é o modo de
    // falha que a 0040 corrigiu. Comando estreito, WHERE por PK, uma coluna.
    'src/lib/auth/session-epoch.ts',
    'src/lib/idempotency/cleanup.ts',
    // C15 — impersonate: a tabela impersonation_sessions é a fonte autoritativa
    // (cross-tenant, global-protected). Leitura/escrita via dbAdmin; o cookie só
    // carrega o id assinado. Único seam do módulo que toca dbAdmin.
    'src/lib/impersonation/session.ts',
    // Platform globals (global-protected, sem dado tenant): reader de flags com
    // cache (hot path de crons/IA), writer de heartbeat e reader de anúncio do
    // shell tenant. Leitura/escrita via dbAdmin/BYPASSRLS (tabelas sem clinic_id).
    'src/lib/platform-settings/index.ts',
    'src/lib/cron-heartbeat/index.ts',
    // A4/E4 (ADR-045): gauge de saturação de conexões. Lê `pg_stat_activity`
    // (pg_catalog, sem dado de tenant) e PRECISA do role `postgres`: como
    // qoro_runtime (NOBYPASSRLS, sem pg_monitor) o catálogo devolve
    // `state`/`query` NULOS para sessões de outros roles — justamente as que
    // interessam observar. Read-only, cacheado, nunca lança.
    'src/lib/db/pool-stats.ts',
    'src/lib/platform-announcements/index.ts',
    // Onboarding (convite mágico): clinic_invites é global-protected (pré-clínica,
    // sem clinic_id). Resolução de token (rota pública /join) e transições guardadas
    // por version rodam via dbAdmin/BYPASSRLS. A saga de provisionamento também.
    'src/contexts/onboarding/internal/invites.ts',
    'src/contexts/onboarding/internal/saga.ts',
    // ADR-060 (O-2a): signup_sessions é global pré-tenant (sem clinic_id), com RLS
    // ENABLE+FORCE sem policy, grant só a service_role e REVOKE de
    // anon/authenticated na 0096. withTenant não se aplica.
    'src/contexts/onboarding/internal/signup-session.ts',
    // 0134: GLOBAL PROTECTED code CAS and signed delivery ledger; no tenant exists yet.
    'src/contexts/onboarding/internal/signup-email-code-repository.ts',
    'src/contexts/onboarding/internal/signup-email-delivery.ts',
    'src/contexts/onboarding/internal/signup-recovery.ts',
    // Operator-only restoration; exact Auth identity, consent and absence of newer progress.
    'src/contexts/onboarding/internal/signup-draft-snapshot.ts',
    // Reabrir clínica após reativação: `clinics` não tem UPDATE para o tenant —
    // via RLS casaria zero linhas (medido em 28/09). Comando estreito, guardado
    // por billing ativo + reativação como último evento do histórico.
    'src/contexts/billing/internal/clinic-status.ts',
    // ADR-060 §1.c.1: as quatro perguntas escrevem na MESMA tabela global
    // pré-tenant. Irmão do arquivo acima, mesma justificativa.
    'src/contexts/onboarding/internal/signup-answers.ts',
    // ADR-062 O-3b.3: ownership do mesmo signup_sessions global prÃ©-tenant;
    // permanece sem clinic_id e protegido por RLS FORCE sem policy/service_role.
    'src/contexts/onboarding/internal/signup-draft.ts',
    // O-5 (0103): intenção de assinatura no mesmo signup_sessions pré-tenant.
    // Irmão dos três acima; a reserva precede o tenant, logo precede o GUC.
    'src/contexts/onboarding/internal/signup-billing.ts',
    // O-6: consome signup_sessions e cria o tenant na mesma tx (ADR-027).
    'src/contexts/onboarding/internal/signup-provision.ts',
    // ADR-069: exact GLOBAL PROTECTED seams; scope checked before any grant/POST.
    'src/contexts/onboarding/internal/signup-free-trial.ts',
    // ADR-069 C3: private pre-tenant invitation/identity; no tenant exists yet.
    'src/contexts/onboarding/internal/signup-pilot-repository.ts',
    'src/contexts/onboarding/internal/signup-pilot.ts',
    'src/contexts/billing/internal/deferred-checkout.ts',
    'src/contexts/billing/internal/abacatepay-processing.ts',
    'src/app/api/webhooks/abacatepay/route.ts',
    // Fase 2 (ADR-032): convite de funcionário insere profile via dbAdmin — profiles
    // não tem INSERT p/ authenticated (D31). Mesma justificativa da saga de onboarding.
    'src/contexts/identity/internal/members.ts',
    // I-2 (ADR-039): ciclo de vida (desativar/reativar/trocar role/override) — escrita
    // administrativa em profiles/overrides via dbAdmin, escopo defensivo por clinic_id.
    'src/contexts/identity/internal/lifecycle.ts',
    // Credencial profissional: `profiles` bloqueia UPDATE para authenticated (D31).
    // O comando estreito roda após o gate server-side, restringe id+clinic_id e audita.
    'src/contexts/identity/internal/professional-credential.ts',
    // I-11a (0042): auditoria de login via service_role (record_login_attempt SECURITY
    // DEFINER, D9) em vez de anon via PostgREST. Best-effort, nunca bloqueia o login.
    'src/lib/auth/login-audit.ts',
    // Perfil da clínica (tenant-facing): clinics UPDATE é super_admin via RLS
    // (S5) → escrita do tenant via dbAdmin+audit, colunas fixas + WHERE id=clinicId
    // (do request). Irmão do connection-store de mensageria.
    'src/contexts/tenancy/internal/profile-core.ts',
    // C10 — seam privilegiado ÚNICO de mensageria (superfície congelada 3ª#6,
    // ADR-020): roteamento de tenant pré-JWT no webhook exige leitura
    // cross-tenant. Faltava aqui porque o guard não rodava no CI (F-07) —
    // a entrada foi adicionada na remediação ao ativar o gate.
    'src/lib/messaging/number-store.ts',
    // F2 — seam privilegiado de ESCRITA da conexão self-service (irmão do
    // number-store): upsert/desativa o número + audita em audit_events via
    // service_role. F-01 proíbe dbAdmin no contexto; a escrita do owner mora aqui.
    'src/lib/messaging/connection-store.ts',
    // ADR-049 1.1 — seam privilegiado de ESCRITA da conta de pagamento da clinica
    // (irmao direto do connection-store). `clinic_payment_accounts.api_key_encrypted`
    // esta FORA do grant de `authenticated` (0080), entao `withTenant` (SET LOCAL ROLE
    // authenticated) nao consegue escrever por construcao. Comando estreito, sempre
    // com WHERE clinic_id, e audita na MESMA tx.
    'src/lib/payments/account-store.ts',
    // ADR-049 1.3b — varredura do sinal: lê as clínicas que ligaram a política
    // (tabela do próprio Payments, cross-tenant como os crons financeiros). A
    // cobrança em si volta para withTenant.
    'src/contexts/payments/internal/deposit-scan.ts',
    // ADR-049 1.3 — varredura de holds vencidos (scan cross-tenant read-only);
    // o cancelamento de cada um volta para withTenant + applyTransition.
    'src/contexts/scheduling/internal/deposit-hold.ts',
    'src/app/api/cron/patient-hard-delete/route.ts',
    'src/app/api/cron/audit-partitions/route.ts',
    // C9 — crons financeiros: scan cross-tenant (reconcile) + rollup do caixa.
    'src/app/api/cron/financial-reconcile/route.ts',
    'src/app/api/cron/cash-flow-rollup/route.ts',
    // C16 — metrics-rollup: agrega system_metrics_daily cross-tenant (UPSERT por
    // clínica/dia). Mesma justificativa do cash-flow-rollup.
    'src/app/api/cron/metrics-rollup/route.ts',
    // F-09 — retenção: purge de outbox terminal (processed/skipped) e
    // login_attempts exige BYPASSRLS (outbox é UPDATE/DELETE-blocked p/ tenant).
    'src/app/api/cron/data-retention/route.ts',
    // ADR-027 — invites-cleanup (LGPD): anonimiza convites incompletos > 30d
    // (clinic_invites é global-protected, sem clinic_id → BYPASSRLS).
    'src/app/api/cron/invites-cleanup/route.ts',
    'src/app/api/health/outbox/route.ts',
    'src/app/api/health/auth-hook/route.ts',
    // C16 — healthcheck unificado: db `SELECT 1` + outbox_pending cross-tenant.
    'src/app/api/health/route.ts',
    // C13/ADR-025 — webhook Asaas: resolve clínica cross-tenant por
    // asaas_payment_id (server-to-server, validado por token) e processa.
    'src/app/api/webhooks/asaas/route.ts',
    // C13 — crons de billing: dunning (scan overdue cross-tenant) e reconcile
    // (estado Asaas vs local cross-tenant). Mesma justificativa dos crons C9.
    'src/app/api/cron/billing-dunning/route.ts',
    'src/app/api/cron/billing-reconcile/route.ts',
    // C14 — read-models de "candidatos" (regra mora no contexto-fonte) +
    // repository da fila proativa: scans cross-tenant read-only, sem PII, bound
    // por LIMIT; writes per-clínica continuam via withTenant. Mesma justificativa
    // dos crons C9/C13. (Os crons proactive-* NUNCA tocam dbAdmin: só estes 3.)
    'src/contexts/scheduling/reminder-candidates.ts',
    // ADR-049 1.3b — irmão do reminder-candidates: read-model privilegiado que
    // lista agendamentos elegíveis a sinal em várias clínicas num scan só.
    'src/contexts/scheduling/deposit-candidates.ts',
    'src/contexts/financial/dunning-candidates.ts',
    // WAIT-001 — mesma forma: o SCAN de ofertas vencidas é cross-tenant e só
    // devolve ids; a liberação/repasse de cada uma roda em withTenant, sob RLS.
    'src/contexts/scheduling/waitlist-expiry.ts',
    // collection_cases concede escrita apenas a service_role (migration 0058).
    // Este seam valida lancamento_id + clinic_id, limita o conflito ao mesmo
    // tenant e grava audit_events na mesma transação (no audit, no op).
    'src/lib/financial/collection-case-store.ts',
    'src/contexts/ai-agent/proactive-jobs/infra/repository.ts',
  ]),
  dbWorker: new Set([
    'src/lib/outbox/worker.ts',
    'src/lib/outbox/janitor.ts',
    'src/lib/outbox/circuit.ts',
  ]),
};

const ALLOWED_RESTRICTED_DISABLES = new Set(['src/app/api/health/auth-hook/route.ts']);
const SELF_RELATIVE = 'scripts/arch-db-check.ts';
const MIGRATIONS_DIR = resolve(REPO_ROOT, 'drizzle', 'migrations');
const MIGRATION_NAME_RE = /^\d{4}_[a-z][a-z0-9_]*\.sql$/;

interface Finding {
  file: string;
  line: number;
  pattern: string;
  excerpt: string;
}
const findings: Finding[] = [];

function walk(dir: string, extensions: string[]): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === 'dist')
        continue;
      out.push(...walk(full, extensions));
    } else if (extensions.includes(extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

const sourceFiles = [
  ...walk(resolve(REPO_ROOT, 'src'), ['.ts', '.tsx']),
  ...walk(resolve(REPO_ROOT, 'scripts'), ['.ts']),
];
const relOf = (file: string) => relative(REPO_ROOT, file).split(sep).join('/');
const relSet = new Set(sourceFiles.map(relOf));
const textCache = new Map<string, string>();
const textOf = (rel: string): string => {
  let t = textCache.get(rel);
  if (t === undefined) {
    t = readFileSync(resolve(REPO_ROOT, rel), 'utf8');
    textCache.set(rel, t);
  }
  return t;
};

/** Resolve a specifier to a repo-relative .ts path, or `{ bare }`. */
function resolveSpecifier(fromRel: string, spec: string): { rel?: string; bare?: string } {
  let base: string;
  if (spec.startsWith('@/')) base = posix.join('src', spec.slice(2));
  else if (spec.startsWith('.')) base = posix.join(posix.dirname(fromRel), spec);
  else return { bare: spec };
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`];
  for (const c of candidates) if (relSet.has(c)) return { rel: c };
  return { rel: base.endsWith('.ts') || base.endsWith('.tsx') ? base : `${base}/index.ts` };
}

// classify factory: poolOrigin = the origin module OR a tainted re-exporter.
const makeClassify =
  (fromRel: string, tainted: ReadonlySet<string>): Classify =>
  (spec: string): SpecifierClass => {
    const t = resolveSpecifier(fromRel, spec);
    return {
      postgresDriver: t.bare === 'postgres',
      drizzlePgFactory: t.bare === 'drizzle-orm/postgres-js',
      poolOrigin: t.rel === DB_ORIGIN || (t.rel ? tainted.has(t.rel) : false),
    };
  };

// ---- Pass 1: transitive taint set (modules that re-export a pool/origin) ----
const tainted = new Set<string>();
for (let changed = true, guard = 0; changed && guard < 10; guard++) {
  changed = false;
  for (const rel of relSet) {
    if (rel === SELF_RELATIVE || rel === DB_ORIGIN || tainted.has(rel)) continue;
    const usages = findOriginUsages(textOf(rel), rel, makeClassify(rel, tainted));
    if (usages.some((u) => u.kind === 'pool-reexport')) {
      tainted.add(rel);
      changed = true;
    }
  }
}

// Operator tooling + admin surface may hold the admin/worker pools (mirrors the
// original ESLint allowlist: scripts/, src/app/(admin)/, src/app/api/admin/).
// The bare `postgres` driver + `drizzle` factory stay strict (only index.ts +
// the two production one-shot scripts) — there is exactly ONE runtime pool factory.
const isOperatorOrAdmin = (rel: string): boolean =>
  rel.startsWith('scripts/') ||
  rel.startsWith('src/app/(admin)/') ||
  rel.startsWith('src/app/api/admin/');
const poolHolderAllowed = (rel: string, name?: string): boolean => {
  if (isOperatorOrAdmin(rel)) return true;
  const allow = name ? ALLOWED_DB_VALUE_IMPORTS[name] : undefined;
  return !!allow && allow.has(rel);
};
const originAccessAllowed = (rel: string): boolean => rel === DB_ORIGIN || isOperatorOrAdmin(rel);

// ---- Pass 2: apply the allowlist policy to every usage ----
for (const rel of relSet) {
  if (rel === SELF_RELATIVE) continue;
  const text = textOf(rel);
  const usages = findOriginUsages(text, rel, makeClassify(rel, tainted));
  for (const u of usages) {
    const deny = (pattern: string) =>
      findings.push({ file: rel, line: u.line, pattern, excerpt: u.excerpt });
    switch (u.kind) {
      case 'postgres':
        if (!ALLOWED_POSTGRES_IMPORTS.has(rel)) deny('import postgres (driver)');
        break;
      case 'drizzle-pg':
        if (!ALLOWED_DRIZZLE_PG_IMPORTS.has(rel))
          deny("import { drizzle } from 'drizzle-orm/postgres-js'");
        break;
      case 'pool-import':
        if (!poolHolderAllowed(rel, u.name)) deny(`import { ${u.name} } (connection origin)`);
        break;
      case 'pool-namespace':
        if (!originAccessAllowed(rel)) deny('namespace import of connection origin');
        break;
      case 'pool-reexport':
        if (!originAccessAllowed(rel)) deny('re-export of connection origin');
        break;
      case 'dynamic':
        if (!originAccessAllowed(rel)) deny('dynamic import() of connection origin');
        break;
      case 'require':
        if (!originAccessAllowed(rel) && !ALLOWED_POSTGRES_IMPORTS.has(rel))
          deny('require() of connection origin');
        break;
    }
  }

  // line-based: new Pool( + suspicious eslint-disable of no-restricted-imports
  text.split(/\r?\n/).forEach((line, i) => {
    if (/\bnew\s+Pool\s*\(/.test(line)) {
      findings.push({ file: rel, line: i + 1, pattern: 'new Pool(', excerpt: line.trim() });
    }
    if (
      !ALLOWED_RESTRICTED_DISABLES.has(rel) &&
      /eslint-disable.*no-restricted-imports/.test(line)
    ) {
      findings.push({
        file: rel,
        line: i + 1,
        pattern: 'eslint-disable no-restricted-imports',
        excerpt: line.trim(),
      });
    }
  });
}

// ---- Migration filename convention ----
try {
  for (const entry of readdirSync(MIGRATIONS_DIR, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.sql') && !MIGRATION_NAME_RE.test(entry.name)) {
      findings.push({
        file: `drizzle/migrations/${entry.name}`,
        line: 0,
        pattern: 'migration filename',
        excerpt: `expected ${MIGRATION_NAME_RE.source}, got "${entry.name}"`,
      });
    }
  }
} catch {
  // First run: directory may not exist yet.
}

if (findings.length > 0) {
  console.error('[arch:db-check] FAILED with', findings.length, 'finding(s):');
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line} — ${f.pattern}`);
    console.error(`    ${f.excerpt}`);
  }
  process.exit(1);
}

// Sanity: the canonical origin still imports postgres.
const CANONICAL = join('src', 'lib', 'db', 'index.ts');
try {
  const content = readFileSync(resolve(REPO_ROOT, CANONICAL), 'utf8');
  if (!/\bfrom\s+['"]postgres['"]/.test(content)) {
    console.error(
      `[arch:db-check] ${CANONICAL} does not import postgres. Did src/lib/db/index.ts move?`,
    );
    process.exit(1);
  }
  statSync(resolve(REPO_ROOT, CANONICAL));
} catch {
  console.error(`[arch:db-check] missing required file: ${CANONICAL}`);
  process.exit(1);
}

console.log(
  `[arch:db-check] OK — scanned ${sourceFiles.length} files (${tainted.size} tainted re-export module(s)), 0 findings.`,
);
