// ESLint flat config (ESLint 9).
// Composes:
//   - next/core-web-vitals (via FlatCompat — eslint-config-next is still legacy)
//   - eslint-plugin-boundaries (cross-context isolation — see docs/CONVENTIONS.md)
//   - eslint-config-prettier (turn off formatting rules — Prettier owns those)
//
// Anti-acoplamento contract enforced here:
//   context  -> only lib
//   lib      -> only lib
//   app      -> anything
//   component-> lib + component
//
// Override pontual permitido com:
//   // eslint-disable-next-line boundaries/element-types -- razão obrigatória
import { FlatCompat } from '@eslint/eslintrc';
import boundaries from 'eslint-plugin-boundaries';
import prettierConfig from 'eslint-config-prettier';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
  // pnpm mantém os plugins como dependências do eslint-config-next.
  // Resolve também no lint iniciado pelo next build em uma cópia do checkout.
  resolvePluginsRelativeTo: path.dirname(
    createRequire(import.meta.url).resolve('eslint-config-next/package.json'),
  ),
});

const config = [
  {
    ignores: [
      '.claude/worktrees/**',
      '.next/**',
      'node_modules/**',
      'dist/**',
      'build/**',
      'coverage/**',
      // Artefatos gerados pelo Playwright são necessários como evidência de E2E,
      // mas contêm bundles de terceiros minificados — não são código da aplicação.
      '.playwright/**',
      'playwright-report/**',
      'test-results/**',
      'next-env.d.ts',
    ],
  },

  ...compat.extends('next/core-web-vitals', 'next/typescript'),

  {
    plugins: { boundaries },
    settings: {
      'boundaries/elements': [
        { type: 'context', pattern: 'src/contexts/*', mode: 'folder' },
        { type: 'lib', pattern: 'src/lib/*', mode: 'folder' },
        { type: 'app', pattern: 'src/app/**', mode: 'file' },
        { type: 'component', pattern: 'src/components/*', mode: 'folder' },
      ],
      'boundaries/include': ['src/**/*.{ts,tsx}'],
    },
    rules: {
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          rules: [
            { from: 'context', allow: ['lib'] },
            { from: 'lib', allow: ['lib'] },
            { from: 'app', allow: ['context', 'lib', 'component', 'app'] },
            { from: 'component', allow: ['lib', 'component'] },
          ],
        },
      ],
      'boundaries/no-unknown': 'off',
      'boundaries/no-unknown-files': 'off',
    },
  },

  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-console': ['error', { allow: ['warn', 'error'] }],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // Tests and config scripts can use console freely.
  {
    files: [
      '**/*.test.ts',
      '**/*.test.tsx',
      'scripts/**',
      'vitest.config.ts',
      'next.config.ts',
      'eslint.config.mjs',
    ],
    rules: {
      'no-console': 'off',
    },
  },

  // crypto.randomUUID só existe em CONTEXTO SEGURO (https/localhost) — em
  // client components quebra ao acessar via http://IP (dev na rede, mobile).
  // Use uuidv4() de @/lib/ui/uuid (fallback getRandomValues). Server code
  // (actions/route handlers, Node) pode continuar usando crypto.randomUUID.
  {
    files: ['src/components/**/*.{ts,tsx}', 'src/app/**/*.tsx'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'crypto',
          property: 'randomUUID',
          message:
            'crypto.randomUUID quebra em contexto não-seguro (http://IP). Use uuidv4() de "@/lib/ui/uuid".',
        },
      ],
    },
  },

  // C1 db guard #1: `postgres` driver may ONLY be imported by:
  //   - src/lib/db/index.ts (canonical pool factory for the app)
  //   - scripts/db-migrate-prod.ts, scripts/delete-test-clinics-prod.ts,
  //     scripts/reset-prod-data.ts and the P8 disposable load runners
  //     (each needs a dedicated one-shot connection against DATABASE_URL_PROD;
  //     src/lib/db is bound to env.DATABASE_URL at boot and can't target a
  //     different URL).
  // Anywhere else duplicates the pool -> connection leak + config drift.
  // Mirror this allowlist in scripts/arch-db-check.ts.
  {
    files: ['src/**/*.{ts,tsx}', 'scripts/**/*.ts'],
    ignores: [
      'src/lib/db/index.ts',
      'scripts/db-migrate-prod.ts',
      'scripts/delete-test-clinics-prod.ts',
      // P8: conexões one-shot exclusivamente contra PostgreSQL loopback criado
      // pelo próprio harness. Guardas recusam Preview/prod/DEV compartilhado.
      'scripts/load-test.ts',
      'scripts/load-test-seed-runner.ts',
      // Bootstrap do cluster temporário: loopback fixo e data_directory verificado.
      'scripts/security/tenant-isolation.ts',
      'scripts/security/signup-regression.ts',
      // Mesmo bootstrap, para o harness de provisionamento O-6: cluster efêmero
      // sob o TEMP do SO, loopback fixo, migrations reais aplicadas em ordem.
      'scripts/security/scratch-schema.ts',
      // Reset operacional de pré-go-live: conexão one-shot explícita em
      // DATABASE_URL_PROD, backup obrigatório e confirmação fail-closed.
      'scripts/reset-prod-data.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'postgres',
              message:
                'Direct postgres driver imports are forbidden outside src/lib/db/index.ts. Use { db, dbAdmin } from "@/lib/db" instead.',
            },
            {
              // C3 D33: o helper foi renomeado para distinguir cache (JWT) de fresh (DB).
              // Importar `requirePermission` é falsa garantia — escolha explícita entre
              // `requireCachedPermission` ou `requireFreshPermission`. Ver ADR-008.
              name: '@/lib/auth/tenant-context',
              importNames: ['requirePermission'],
              message:
                'requirePermission was renamed (D33). Use requireCachedPermission (JWT cache) or requireFreshPermission (DB-revalidated, mandatory for CRITICAL_ACTIONS). See ADR-008.',
            },
            {
              // C4 ADR-011: o placeholder de C3 foi REMOVIDO. Use:
              //   - idempotentMutation  (default para Server Actions mutativas)
              //   - auditedMutation     (raro: mutação sem idempotency)
              //   - superAdminAction    (ações cross-tenant do super_admin)
              name: '@/lib/auth/tenant-context',
              importNames: ['auditableAction'],
              message:
                'auditableAction was removed in C4. Use idempotentMutation (@/lib/idempotency/mutation), auditedMutation (@/lib/audit/mutation) or superAdminAction (@/lib/audit/super-admin). See ADR-011.',
            },
          ],
        },
      ],
    },
  },

  // C1 db guard #2: `dbAdmin` is admin-only (will bypass RLS in C2+).
  // Allowed: src/app/(admin)/, src/app/api/admin/, scripts/, src/lib/db/.
  // Forbidden: user-facing contexts, app routes, components, AND user-facing
  // API routes (everything under src/app/api/ that is NOT api/admin/).
  //
  // Coverage discovery (C1 audit): the original glob `src/app/(app)/**` did
  // NOT match route handlers under `src/app/api/...`. That meant a future
  // `src/app/api/patients/route.ts` could import dbAdmin and bypass RLS
  // silently. Added `src/app/api/**` to the block list, with
  // `src/app/api/admin/**` in ignores for the legitimate admin path.
  //
  // IMPORTANT: in ESLint flat config, later rule configs REPLACE earlier
  // ones for the same rule name. Since this block targets a subset of
  // guard #1's glob, we MUST repeat the `postgres` restriction here.
  {
    files: [
      'src/contexts/**/*.{ts,tsx}',
      'src/app/(app)/**/*.{ts,tsx}',
      'src/app/api/**/*.{ts,tsx}',
      'src/components/**/*.{ts,tsx}',
    ],
    ignores: [
      'src/app/api/admin/**/*.{ts,tsx}',
      // C4: cron worker route precisa de dbAdmin para passar pelas 3 TXs
      // do worker (TX1 reserve, TX3 finalize) sem RLS. TX2 (handler) usa
      // withTenant (RLS aplica). Inline allowlist documentada em ADR-011.
      'src/app/api/cron/**/*.{ts,tsx}',
      // C4: healthcheck precisa de dbAdmin para queries agregadas cross-tenant
      // (counts por tenant inteiro). Endpoint exige Bearer CRON_SECRET — não há
      // RLS bypass exposed externamente.
      'src/app/api/health/**/*.{ts,tsx}',
      // C13/ADR-025: webhook Asaas resolve a clínica cross-tenant por
      // asaas_payment_id (server-to-server, validado por token) e processa a
      // transição. Mesma justificativa dos crons. Só esta rota de webhook.
      'src/app/api/webhooks/asaas/**/*.{ts,tsx}',
      // C14: read-models de "candidatos" (Scheduling/Financial são donos da regra
      // de "quem recebe") + repository da fila proativa fazem scan cross-tenant
      // read-only (sem PII, bound por LIMIT); writes per-clínica seguem em
      // withTenant. Mesma justificativa dos crons C9/C13 — também na allowlist do
      // arch:db-check. Só estes 3 arquivos.
      'src/contexts/scheduling/reminder-candidates.ts',
      'src/contexts/financial/dunning-candidates.ts',
      'src/contexts/ai-agent/proactive-jobs/infra/repository.ts',
      // ADR-049 1.3b: mesma forma, para o sinal. `deposit-candidates` é o
      // read-model do Scheduling ("quem ainda pode ser cobrado"); `deposit-scan`
      // lê as clínicas que ligaram a política — tabela do próprio Payments, sem
      // clinic_id de request. Ambos read-only, bound por LIMIT; a cobrança em si
      // volta para withTenant. Também na allowlist do arch:db-check.
      'src/contexts/scheduling/deposit-candidates.ts',
      'src/contexts/payments/internal/deposit-scan.ts',
      // ADR-049 1.3: varredura de holds vencidos. Read-only cross-tenant, bound
      // por LIMIT; o CANCELAMENTO de cada agendamento volta para withTenant e passa
      // pela máquina de estados congelada (applyTransition).
      'src/contexts/scheduling/internal/deposit-hold.ts',
      // WAIT-001: mesma forma — o SCAN de ofertas de lista de espera vencidas é
      // cross-tenant e devolve só ids; a liberação/repasse de cada uma roda em
      // withTenant, sob RLS. O privilégio descobre o trabalho, não o executa.
      'src/contexts/scheduling/waitlist-expiry.ts',
      // F1 onboarding: clinic_invites é global-protected (entidade PRÉ-clínica, sem
      // clinic_id de tenant). Resolução de token (/join público), transições guardadas
      // por version e a saga de provisionamento rodam via dbAdmin/BYPASSRLS. Mesma
      // justificativa dos read-models acima — também na allowlist do arch:db-check.
      'src/contexts/onboarding/internal/invites.ts',
      'src/contexts/onboarding/internal/saga.ts',
      // ADR-060 (O-2a): signup_sessions é global pré-tenant, como clinic_invites —
      // nasce ANTES de existir clínica, então não há GUC de tenant para withTenant
      // setar. A tabela tem RLS ENABLE+FORCE SEM NENHUMA POLICY, grant só a
      // service_role e REVOKE explícito de anon/authenticated (migration 0096).
      'src/contexts/onboarding/internal/signup-session.ts',
      // ADR-060 §1.c.1: as quatro perguntas escrevem na MESMA tabela global
      // pré-tenant. Mesma justificativa do irmão acima — `withTenant` não tem
      // GUC de tenant para setar numa linha que nasce antes de existir clínica.
      'src/contexts/onboarding/internal/signup-answers.ts',
      // ADR-062 O-3b.3: ownership do mesmo signup_sessions global prÃ©-tenant.
      // O draft verificado ainda nÃ£o tem clinic_id; RLS FORCE sem policy e grant
      // exclusivo a service_role mantÃªm a fronteira atÃ© o provisionamento.
      'src/contexts/onboarding/internal/signup-draft.ts',
      // O-5 (0103): intenção de assinatura no MESMO signup_sessions pré-tenant.
      // O draft verificado ainda não tem clinic_id; a reserva precisa acontecer
      // antes de existir tenant, então não há GUC para withTenant setar. RLS FORCE
      // sem policy e grant exclusivo a service_role seguem sendo a fronteira.
      'src/contexts/onboarding/internal/signup-billing.ts',
      // O-6: provisionamento a partir do cadastro pré-tenant. Lê/apaga
      // signup_sessions e cria o tenant na MESMA tx — irmão da saga de convite.
      'src/contexts/onboarding/internal/signup-provision.ts',
      // O-3b (22/09/2026): o e-mail de confirmação passou a ser NOSSO. Emitir o
      // token de confirmação é `auth.admin.generateLink`, que só existe na Admin
      // API — a chave anônima não a alcança, e não há caminho de menor
      // privilégio para isso. Exceção MAIS ESTREITA que as vizinhas: este módulo
      // não abre banco nenhum (nada de dbAdmin), só fala com o GoTrue e com o
      // Resend. Por isso ele não entra na allowlist do arch:db-check.
      'src/contexts/onboarding/internal/signup-confirmation-email.ts',
      // Cadastro self-service: estes tres pontos executam transicoes Auth que
      // nao existem no client comum. Todos derivam user/ref do banco ou de um
      // grant assinado e usam CAS antes de instalar a senha.
      'src/contexts/onboarding/internal/signup-auth-admin.ts',
      'src/app/api/signup/sessions/continue/route.ts',
      'src/app/(app)/reset-password/actions.ts',
      // Fase 2 (ADR-032): convite de funcionário cria auth user (inviteUserByEmail via
      // createAdminClient) + insere profile via dbAdmin — profiles não tem INSERT p/
      // authenticated (D31). Mesma justificativa da saga de onboarding.
      'src/contexts/identity/internal/members.ts',
      // I-2 (ADR-039): ciclo de vida de membro aceito (desativar/reativar/trocar role/
      // override). Escrita ADMINISTRATIVA em profiles/overrides — a autorização já
      // aconteceu no gate; profiles/overrides não têm UPDATE p/ authenticated (D31 /
      // I-13). Escopo defensivo por clinic_id (V1.2). Irmão de members.ts.
      'src/contexts/identity/internal/lifecycle.ts',
      // Credencial profissional: profiles não tem UPDATE para authenticated (D31).
      // A action já provou o ator; o comando fixa id+clinic_id, as colunas permitidas
      // e a auditoria na mesma tx. Irmão do lifecycle e do perfil da clínica.
      'src/contexts/identity/internal/professional-credential.ts',
      // I-11a (0042): auditoria de login roda por service_role (dbAdmin), não mais por
      // anon via PostgREST. record_login_attempt é SECURITY DEFINER (D9); dbAdmin tem
      // EXECUTE. Ponto ÚNICO e privilegiado — best-effort, nunca bloqueia o login.
      'src/lib/auth/login-audit.ts',
      // Perfil da clínica (tenant-facing): clinics UPDATE é super_admin via RLS
      // (0001/S5) → a escrita do tenant roteia por dbAdmin+audit aqui, com
      // colunas fixas e WHERE id=clinicId (do request). Irmão do connection-store.
      'src/contexts/tenancy/internal/profile-core.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'postgres',
              message:
                'Direct postgres driver imports are forbidden outside src/lib/db/index.ts. Use { db, dbAdmin } from "@/lib/db" instead.',
            },
            {
              // F-01: `db` (runtime pool) bypassa RLS quando usado SEM withTenant
              // (o role de conexão tem BYPASSRLS; FORCE não cobre BYPASSRLS).
              // Contexts/app NUNCA importam o valor `db` — usam withTenant
              // (@/lib/db/tenant). `dbAdmin`/`dbWorker` são admin/worker only.
              // (`type Tx`/`type Db` são nomes diferentes e seguem permitidos.)
              name: '@/lib/db',
              importNames: ['db', 'dbAdmin', 'dbWorker'],
              message:
                'db/dbAdmin/dbWorker bypassam RLS fora de withTenant. Em contexts/app use withTenant (@/lib/db/tenant). dbAdmin/dbWorker só em scripts/, api/admin/, api/cron/, api/health/, (admin)/. Ver ADR-007 (F-01).',
            },
            {
              // C3: createAdminClient usa SUPABASE_SECRET_KEY e bypassa RLS via service_role.
              // Mesma allowlist que dbAdmin (scripts/, api/admin/, (admin)/) — sem server-only
              // no módulo porque scripts CLI precisam importar fora do Next bundler.
              name: '@/lib/auth/supabase-admin',
              importNames: ['createAdminClient'],
              message:
                'createAdminClient bypasses RLS (service_role). Only use inside scripts/, src/app/api/admin/, or src/app/(admin)/. See ADR-008.',
            },
            {
              // C3 D33 (repetida aqui por causa do "later configs REPLACE" do flat config).
              name: '@/lib/auth/tenant-context',
              importNames: ['requirePermission'],
              message:
                'requirePermission was renamed (D33). Use requireCachedPermission (JWT cache) or requireFreshPermission (DB-revalidated, mandatory for CRITICAL_ACTIONS). See ADR-008.',
            },
            {
              // C4 ADR-011 (repetida aqui por causa do "later configs REPLACE").
              name: '@/lib/auth/tenant-context',
              importNames: ['auditableAction'],
              message:
                'auditableAction was removed in C4. Use idempotentMutation (@/lib/idempotency/mutation), auditedMutation (@/lib/audit/mutation) or superAdminAction (@/lib/audit/super-admin). See ADR-011.',
            },
          ],
        },
      ],
    },
  },

  // C4 guard: events.ts pertence ao CATÁLOGO (registerEventSchema). Importar
  // do handler REGISTRY confunde producer/consumer split (ADR-011 §6). Handlers
  // vivem em <context>/internal/handlers/* e SÓ o boot file do cron os importa.
  // HIGH-10: events.ts NÃO pode usar z.date()/z.bigint()/z.nan() — payloads
  // precisam ser JSON-safe (Date/BigInt/NaN não sobrevivem JSON.stringify).
  // Use `z.string().datetime()` para timestamps, `z.string()` para BigInt.
  {
    files: ['src/contexts/*/events.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@/lib/outbox/registry',
              message:
                'events.ts pertence ao catalog (registerEventSchema), não ao handler registry. Handlers vivem em <context>/internal/handlers/*. ADR-011 §6.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.object.name='z'][callee.property.name='date']",
          message:
            'z.date() em events.ts gera Date no payload — quebra JSON-safety (assertJsonSafe rejeita) e hash-stability. Use z.string().datetime() (ISO string). ADR-011 §27.',
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.object.name='z'][callee.property.name='bigint']",
          message:
            'z.bigint() em events.ts gera BigInt no payload — quebra JSON-safety. Use z.string() representando o número. ADR-011 §27.',
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.object.name='z'][callee.property.name='nan']",
          message: 'z.nan() em events.ts é nonsense — NaN não sobrevive JSON. ADR-011 §27.',
        },
        {
          selector: "NewExpression[callee.name='Date']",
          message:
            'new Date() em events.ts? Schema deve descrever wire format (string), não runtime type. Use z.string().datetime(). ADR-011 §27.',
        },
      ],
    },
  },

  // CRITICAL-03 / C4 guard: handlers (src/contexts/*/internal/handlers/**) NÃO
  // podem importar `db` ou `dbAdmin` diretamente — o `tx` recebido em
  // HandlerCtx já é o caminho RLS-correto (withTenant authenticated). Importar
  // db direto bypassa RLS e quebra atomicidade com worker TXs.
  {
    files: ['src/contexts/*/internal/handlers/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@/lib/db',
              importNames: ['db', 'dbAdmin', 'dbWorker'],
              message:
                'Handlers DEVEM usar ctx.tx recebido em HandlerCtx — esse já é o tx do worker (withTenant authenticated, RLS aplica). Importar db/dbAdmin/dbWorker bypassa boundary tenant + quebra at-least-once dedup. ADR-011 §26.',
            },
          ],
        },
      ],
    },
  },

  // C3 auth guard: forbid `supabase.auth.getSession()` everywhere in src/.
  // `getSession()` trusts the cookie WITHOUT verifying signature server-side
  // (unsafe against tampering). Force `getUser()` (or our wrapper
  // `getCurrentUser()` / `requireUser()`), which round-trips to Supabase Auth
  // and validates the JWT signature. See ADR-008 + plano C3 v6.
  //
  // Uses no-restricted-syntax (different rule than no-restricted-imports),
  // so this block does NOT clobber the earlier no-restricted-imports configs.
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.property.name='getSession'][callee.object.type='MemberExpression'][callee.object.property.name='auth']",
          message:
            'supabase.auth.getSession() trusts the cookie without validating signature. Use getUser() (or our wrapper getCurrentUser/requireUser) instead. See ADR-008.',
        },
        // C4 ADR-011: there is no event bus. The ONLY emitter is publishEvent
        // from @/lib/outbox/publish. Catching the *names* prevents drift via
        // copy-paste from external examples.
        {
          selector: "Identifier[name='emitEvent']",
          message:
            'There is no emitEvent. Use publishEvent(tx, ...) from @/lib/outbox/publish — the only cross-context emitter. See ADR-011.',
        },
        {
          selector: "MemberExpression[object.name='eventBus']",
          message:
            'There is no eventBus. Use publishEvent(tx, ...) from @/lib/outbox/publish — the only cross-context emitter. See ADR-011.',
        },
        {
          selector: "Identifier[name='auditableAction']",
          message:
            'auditableAction was removed in C4. Use idempotentMutation (@/lib/idempotency/mutation), auditedMutation (@/lib/audit/mutation) or superAdminAction (@/lib/audit/super-admin). See ADR-011.',
        },
      ],
    },
  },

  prettierConfig,
];

export default config;
