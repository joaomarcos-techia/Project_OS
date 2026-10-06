/**
 * Environment validation — single source of truth for env vars.
 *
 * Variables are declared here even when not yet consumed, so the contract
 * is visible up-front. Each var carries a tag indicating the camada where
 * it became required.
 *
 * Anti-pattern guarded against: `process.env.X` scattered through the
 * codebase. Always import from this module.
 */
import { z } from 'zod';

import { DEVELOPMENT_ENV_ALIASES } from './env-aliases';
import { checkEnvironmentCoherence } from './env-coherence';

// Empty strings from `.env.local` (e.g. `FOO=`) become `undefined` so that
// `.optional()` actually means "not set" rather than "set to empty string".
// Without this, an empty `NEXT_PUBLIC_SUPABASE_URL=` would fail `.url()` validation.
const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v);

const EnvSchema = z
  .object({
    // --- Database (C1) ---
    DATABASE_URL: z.preprocess(emptyToUndefined, z.string().url()), // C1: required everywhere
    DATABASE_URL_PROD: z.preprocess(emptyToUndefined, z.string().url().optional()), // C1: required only when NODE_ENV=production (see superRefine below)
    // V1.3 (auditoria de segurança) — OPT-IN fail-closed: quando definido, o pool
    // RUNTIME (`db`) conecta por este URL, que DEVE autenticar como um role SEM
    // BYPASSRLS (ver runbook em docs/achados/auditoria-seguranca-codigo.md V1.3).
    // Assim, um caminho que esqueça `withTenant` retorna 0 linhas (fail-closed) em
    // vez de vazar cross-tenant. Ausente (default) → cai no DATABASE_URL atual
    // (comportamento inalterado). `dbAdmin`/`dbWorker` seguem no DATABASE_URL
    // (BYPASSRLS, necessário para admin/worker). Ativação exige criar o role +
    // verificar em deploy supervisionado.
    DATABASE_URL_RUNTIME: z.preprocess(emptyToUndefined, z.string().url().optional()),

    // --- Supabase ---
    // Naming: Supabase renamed keys in 2024. Both legacy and new keys still work.
    // Prefer the new names (publishable/secret) for new projects.
    //   anon         → publishable  (client-safe, RLS-protected)
    //   service_role → secret       (server-only, bypasses RLS)
    // C1 requires URL + at least one of publishable/anon. C3 requires the secret/service_role key.
    NEXT_PUBLIC_SUPABASE_URL: z.preprocess(emptyToUndefined, z.string().url()), // C1: required
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.preprocess(
      emptyToUndefined,
      z.string().min(1).optional(),
    ), // C1: required IF anon not set (see superRefine)
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()), // legacy alias of publishable
    SUPABASE_SECRET_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()), // C3: required (preferred)
    SUPABASE_SERVICE_ROLE_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()), // legacy alias of secret

    // --- Runtime ---
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'), // C16 wires logger
    // Auto-injetado pela Vercel (`production`/`preview`/`development`) — distingue
    // Preview de Production, o que o NODE_ENV NÃO faz (ambos são `production` na
    // Vercel). Usado como discriminador de ambiente das chaves Redis (rate-limit),
    // para que dev/preview/prod nunca colidam mesmo se compartilharem a Upstash DB
    // por erro de config. Opcional: ausente (dev local, CI) → cai no NODE_ENV.
    VERCEL_ENV: z.preprocess(
      emptyToUndefined,
      z.enum(['production', 'preview', 'development']).optional(),
    ),
    // Opt-in para uma única conta de teste: dados ilustrativos apenas no dashboard.
    DASHBOARD_DEMO_USER_ID: z.preprocess(emptyToUndefined, z.string().uuid().optional()),
    DASHBOARD_DEMO_CLINIC_ID: z.preprocess(emptyToUndefined, z.string().uuid().optional()),
    // Gerado pela Vercel quando Protection Bypass for Automation está ativo.
    // Em Preview protegido, acompanha SOMENTE URLs de webhook server-to-server;
    // nunca vai para o browser, log ou resposta. Opcional porque produção/dev
    // local não precisam dele e builds sem Deployment Protection devem continuar.
    VERCEL_AUTOMATION_BYPASS_SECRET: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    // Origem canônica, controlada no servidor, usada nos links transacionais e
    // redirects do Supabase Auth. Nunca derive links autenticados do header Origin.
    APP_BASE_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
    // ADR-062 O-3a: opt-in server-only; rollout externo separado dos testes locais.
    SIGNUP_IDENTITY_ENABLED: z.preprocess(
      emptyToUndefined,
      z
        .enum(['true', 'false'])
        .optional()
        .transform((v) => v === 'true'),
    ),

    // ADR-062 O-3b: desligado até rollout autorizado e configuração Auth comprovada.
    SIGNUP_AUTH_ENABLED: z.preprocess(
      emptyToUndefined,
      z
        .enum(['true', 'false'])
        .optional()
        .transform((v) => v === 'true'),
    ),

    // §21.20: kill switch de aquisição. Fecha a ENTRADA do cadastro autônomo sem
    // tocar em login, sessão ou tenant existente — é o botão que a operação
    // aperta quando o funil precisa parar (abuso, incidente, custo).
    //
    // Default LIGADO, ao contrário dos dois acima, porque o significado é outro:
    // aqueles são portões de rollout de fatia (nasce fechado, abre quando a
    // fatia existe); este é uma parada de emergência (nasce aberto, fecha sob
    // decisão). Por isso `!== 'false'`: só o valor explícito `false` desliga, e
    // ausência/erro de digitação nunca derruba a aquisição por acidente.
    SIGNUP_ENABLED: z.preprocess(
      emptyToUndefined,
      z
        .enum(['true', 'false'])
        .optional()
        .transform((v) => v !== 'false'),
    ),

    // --- Operational ---
    // Explicit opt-in for prod-targeting scripts (db:migrate:prod, db:backup:prod).
    // Default unset; only set in the operator's shell session right before a prod operation.
    SUPABASE_PROJECT_ENV: z.enum(['dev', 'prod']).optional(),

    // --- C3: identity / auth / rate limit ---
    // Pepper for HMAC-SHA256 over emails in login_attempts. NEVER store plaintext
    // emails (privacy). Min 32 chars enforces a baseline entropy. Treated as a
    // secret — rotation requires re-issuing all in-flight rate-limit windows,
    // which is acceptable since windows are short (15 min).
    LOGIN_HASH_PEPPER: z.preprocess(emptyToUndefined, z.string().min(32).optional()), // C3: required at runtime; build-time optional so vercel build works pre-config
    // Upstash Redis REST endpoint + token for rate-limit dual (IP + email_hash).
    // C3: required at runtime; optional at parse time so build doesn't break before secrets exist.
    UPSTASH_REDIS_REST_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
    UPSTASH_REDIS_REST_TOKEN: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    // Bootstrap super_admin via scripts/seed-super-admin.ts. Optional always —
    // only set in dev/setup shell sessions. Warning emitted if set during build.
    SUPER_ADMIN_EMAIL: z.preprocess(emptyToUndefined, z.string().email().optional()),
    SUPER_ADMIN_PASSWORD: z.preprocess(emptyToUndefined, z.string().min(12).optional()),

    // --- C4: outbox/audit/idempotency runtime ---
    // Shared secret between Vercel Cron (Authorization: Bearer header) and the
    // route handler. Optional at parse time so `next build` works before the
    // secret exists; assertCronRuntimeReady() enforces it on the route handler.
    CRON_SECRET: z.preprocess(emptyToUndefined, z.string().min(32).optional()),
    // V5 (auditoria de segurança) — segredo SEPARADO para as rotas de cron
    // DESTRUTIVAS (patient-hard-delete, data-retention, billing-dunning), para
    // reduzir o blast radius de um vazamento do CRON_SECRET (que guarda também as
    // rotas read-only). OPT-IN e retrocompatível: quando ausente, as rotas
    // destrutivas caem no CRON_SECRET (comportamento atual). Quando definido, o
    // agendador dessas rotas deve enviar este segredo. Ver docs/achados/
    // auditoria-seguranca-codigo.md (V5) + runbooks/secret-rotation.md.
    CRON_SECRET_DESTRUCTIVE: z.preprocess(emptyToUndefined, z.string().min(32).optional()),
    // M2 (auditoria de APIs) — silencia a métrica `cron.origin_header_missing`
    // quando o cron é disparado FORA da Vercel de propósito (smoke local, curl de
    // runbook). NÃO é controle de auth: o Bearer é o único gate (ver F-09 em
    // [cron-auth.ts]). Estava sendo lido via `process.env` cru em 13 rotas, fora do
    // schema — declarado aqui porque toda config do runtime passa por este ponto
    // único (DoD §3), e um typo silencioso num `process.env` não dá erro.
    OUTBOX_CRON_ALLOW_NON_VERCEL: z.preprocess(
      emptyToUndefined,
      z
        .enum(['true', 'false'])
        .optional()
        .transform((v) => v === 'true'),
    ),
    // Worker tuning — kept in env so prod can be tweaked without redeploy.
    // Defaults chosen for solo-founder operability (50 events/tick, 5 parallel).
    OUTBOX_BATCH_SIZE: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(1).max(500).optional().default(50),
    ),
    OUTBOX_PARALLELISM: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(1).max(20).optional().default(5),
    ),
    // HIGH-05: lock_timeout do idempotentMutation. 3s era curto demais para
    // Server Actions que fazem múltiplas queries + Zod parse + publishEvent.
    // 10s é o novo default; pode aumentar via env se UX em rede lenta exigir.
    // Máximo 60s (caso > 60 = arquitetura errada — usar two-step pattern).
    OUTBOX_IDEMPOTENCY_LOCK_TIMEOUT_MS: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(1000).max(60_000).optional().default(10_000),
    ),
    // HIGH-07: payload size cap em bytes. Default 64KB. Caps em runtime
    // mirroreiam CHECK constraints no banco (defense in depth).
    OUTBOX_MAX_PAYLOAD_BYTES: z.preprocess(
      emptyToUndefined,
      z.coerce
        .number()
        .int()
        .min(1024)
        .max(1024 * 1024)
        .optional()
        .default(64 * 1024),
    ),

    // --- C5: per-tenant encryption (AES-256-GCM + HKDF) + lookup HMAC ---
    // Master key(s) are 32-byte AES keys, base64-encoded. In dev/test they live
    // in env (EnvSecretProvider); in production they live in Google Secret
    // Manager (GcpSecretManagerProvider) and these env vars stay unset. NEVER
    // commit a real key. Optional at parse time so `next build` works before
    // secrets exist; assertCryptoRuntimeReady() enforces at runtime.
    // Versioned (V1, V2, ...) so master-key rotation can decrypt old ciphertext
    // by the `version` byte embedded in it (PlanoAção §5.5 rotation test).
    CRYPTO_MASTER_KEY_V1: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    CRYPTO_MASTER_KEY_V2: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    // Which master-key version NEW ciphertext is written with. Reads pick the
    // version from the ciphertext's own version byte, not this value.
    MASTER_KEY_VERSION: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(1).max(255).optional().default(1),
    ),
    // Global salt for the deterministic lookup HMAC (cpf_hash / telefone_hash /
    // suppression contact_hash). Base64. Global (not per-tenant) so the same CPF
    // hashes identically for a UNIQUE(clinic_id, cpf_hash) check. Secret.
    CRYPTO_LOOKUP_SALT: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    // Backend selector. Defaults to 'gcp' in production, 'env' otherwise.
    CRYPTO_SECRET_BACKEND: z.preprocess(emptyToUndefined, z.enum(['env', 'gcp']).optional()),
    // GCP Secret Manager wiring (only read by GcpSecretManagerProvider in prod).
    GCP_PROJECT_ID: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    GCP_SECRET_MASTER_KEY_NAME: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    GCP_SECRET_LOOKUP_SALT_NAME: z.preprocess(emptyToUndefined, z.string().min(1).optional()),

    // --- C10: WhatsApp / Meta Cloud API ---
    // App-level secret (1 app Meta, N números) usado para validar a assinatura
    // HMAC dos webhooks (X-Hub-Signature-256). NÃO é per-clínica (o token
    // per-clínica vive cifrado em clinic_whatsapp_numbers.token_encrypted).
    // Optional no parse; assertMessagingRuntimeReady() exige em runtime.
    META_APP_SECRET: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    // Token do handshake de verificação do webhook (GET hub.verify_token).
    META_WEBHOOK_VERIFY_TOKEN: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    // Versão da Graph API (v18+). Default v21.0 (atual). Formato vNN.N.
    META_GRAPH_API_VERSION: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .regex(/^v\d+\.\d+$/)
        .optional()
        .default('v21.0'),
    ),
    // Timeout (ms) de cada chamada HTTP ao provider (AbortController). Congelado
    // em 10s (3ª#4); env permite ajuste operacional sem redeploy. Máx 60s.
    META_HTTP_TIMEOUT_MS: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(1000).max(60_000).optional().default(10_000),
    ),
    // F2 — Embedded Signup (conexão self-service do WhatsApp pelo owner).
    // App id PÚBLICO do Meta (init do SDK no browser + troca de code server-side)
    // e Configuration ID do Embedded Signup. NÃO são secrets (≠ META_APP_SECRET).
    // Opcionais no parse (next build verde antes do setup); assertWhatsappOnboarding
    // Ready() exige em runtime. Chegam ao browser via props do Server Component
    // (sem NEXT_PUBLIC_ — um único ponto de leitura de env).
    // META_CONFIG_ID precisa ser uma configuração **v4** do Embedded Signup: o
    // cliente abre o FB.login só com `extras: { setup: {} }` (ver
    // whatsapp-connect.tsx). O v2/v3 é descontinuado pela Meta em 15/10/2026.
    META_APP_ID: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    META_CONFIG_ID: z.preprocess(emptyToUndefined, z.string().min(1).optional()),

    // --- C11: AI Agent (Gemini) ---
    // API key do Google AI Studio. Optional no parse (next build verde antes
    // do secret existir); assertAiRuntimeReady() exige em runtime no handler.
    GEMINI_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    // Modelo default (decisão sólida §11.17: Gemini Flash). Trocar exige
    // entrada correspondente na tabela de preços de src/lib/ai/cost.ts.
    GEMINI_MODEL: z.preprocess(
      emptyToUndefined,
      z.string().min(1).optional().default('gemini-3.8-flash'),
    ),
    // Timeout (ms) de cada chamada ao LLM (AbortController) — mesmo racional
    // do META_HTTP_TIMEOUT_MS: sem teto, um request lento trava o worker.
    AI_HTTP_TIMEOUT_MS: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(1000).max(60_000).optional().default(15_000),
    ),
    // Compatibilidade histórica do orçamento de IA. Ele continua aceito para
    // configuração/telemetria, mas a política comercial atual não bloqueia
    // conversas de IA (só a cota de usuários é trava dura; ADR-024).
    AI_MONTHLY_COST_LIMIT_USD: z.preprocess(
      emptyToUndefined,
      z.coerce.number().positive().optional().default(50),
    ),
    // R1: gate do prompt snapshot (replay determinístico G10). 'full' grava
    // sempre; 'sample' grava ~10% (determinístico por eventId); 'off' nunca.
    // Default: 'full' fora de produção, 'sample' em produção.
    AI_SNAPSHOT_MODE: z.preprocess(emptyToUndefined, z.enum(['off', 'full', 'sample']).optional()),

    // --- C13: Billing / Asaas ---
    // API key do Asaas (sandbox ou prod). Optional no parse (next build verde
    // antes do secret); assertBillingRuntimeReady() exige em runtime no adapter.
    ASAAS_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    // Base URL do Asaas. Sandbox: https://sandbox.asaas.com/api/v3 ;
    // prod: https://api.asaas.com/v3. Default sandbox (seguro por omissão).
    ASAAS_BASE_URL: z.preprocess(
      emptyToUndefined,
      z.string().url().optional().default('https://sandbox.asaas.com/api/v3'),
    ),
    // Token configurado no painel Asaas e enviado no header `asaas-access-token`
    // de cada webhook — validado constant-time. Optional no parse; exigido em
    // runtime pela rota de webhook (assertBillingWebhookReady()).
    ASAAS_WEBHOOK_TOKEN: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    // Timeout (ms) de cada chamada HTTP ao Asaas (AbortController). Mesmo racional
    // do META/AI: sem teto, um request lento trava o caller. Máx 60s.
    ASAAS_HTTP_TIMEOUT_MS: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(1000).max(60_000).optional().default(10_000),
    ),

    // Email transacional. Optional no boot; o handler LGPD exige ambos em runtime.
    RESEND_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    EMAIL_FROM: z.preprocess(emptyToUndefined, z.string().min(3).max(320).optional()),

    // --- C14: Proactive Jobs (templates Meta aprovados) ---
    // Cloud API envia template por NOME (não ID opaco). Em código vivem a CHAVE
    // canônica + ordem das variáveis; o NOME aprovado por ambiente vem daqui
    // (PlanoAção §14.18 — congelado: "IDs Meta em env por ambiente"). Optional no
    // parse; assertProactiveRuntimeReady() exige em runtime nos crons proactive-*.
    META_TEMPLATE_CONFIRMATION_REMINDER_ID: z.preprocess(
      emptyToUndefined,
      z.string().min(1).optional(),
    ),
    META_TEMPLATE_DUNNING_FRIENDLY_ID: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    META_TEMPLATE_FOLLOWUP_RETURN_ID: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    // ADR-057 / 2.4B — recuperação operacional após falta. Nome aprovado na
    // Meta; não é template clínico do prontuário.
    META_TEMPLATE_NO_SHOW_FOLLOWUP_ID: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    // WAIT-001 — oferta de vaga da lista de espera. Como os demais, o NOME
    // aprovado na Meta vem do ambiente; sem ele o job falha com
    // `template_not_configured` em vez de enviar algo não aprovado.
    META_TEMPLATE_WAITLIST_OFFER_ID: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    // ADR-049 1.6a — link do sinal. Este template carrega uma URL DE PAGAMENTO,
    // então ele precisa ser aprovado na Meta com esse conteúdo em mente. Sem a
    // variável configurada o job falha com `template_not_configured` e fica
    // visível — nunca envia texto livre nem link fora de template aprovado.
    META_TEMPLATE_DEPOSIT_LINK_ID: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    // D35 / 1.6c — saldo restante após atendimento. Copy distinta do sinal.
    META_TEMPLATE_REMAINDER_LINK_ID: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    // Idioma BCP-47 dos templates (default pt_BR).
    META_TEMPLATE_LANG: z.preprocess(
      emptyToUndefined,
      z.string().min(2).optional().default('pt_BR'),
    ),

    // --- C15: Platform Admin (impersonate) ---
    // Segredo HMAC que assina o cookie `qoro_imp` (carrega só o impersonationId).
    // A linha em impersonation_sessions é autoritativa; a assinatura só impede
    // adulteração. Min 32 chars (baseline de entropia). Optional no parse (next
    // build verde antes do secret); assertImpersonationRuntimeReady() exige em
    // runtime nas Server Actions de impersonate.
    IMPERSONATION_SECRET: z.preprocess(emptyToUndefined, z.string().min(32).optional()),
    // Onboarding (convite mágico): HMAC do token do link /join. Build-time opcional;
    // runtime exigido por assertOnboardingRuntimeReady(). Rotação invalida convites
    // em aberto (aceitável — expiram em 24h).
    MAGIC_TOKEN_SECRET: z.preprocess(emptyToUndefined, z.string().min(32).optional()),

    // --- C16: observabilidade / Sentry ---
    // DSN do projeto Sentry. NÃO é secret (é publishable) → NEXT_PUBLIC_ para o
    // client SDK inlinar no bundle; server/edge leem o mesmo valor. Lido via
    // process.env nos arquivos sentry.*.config.ts (rodam em edge/client e não
    // podem importar este módulo). Ausente → usa o DSN baked-in do wizard.
    NEXT_PUBLIC_SENTRY_DSN: z.preprocess(emptyToUndefined, z.string().url().optional()),
    // Token de upload de source maps (build-time, server-only, SECRET). Vive em
    // .env.sentry-build-plugin (gitignored). Ausente → build sem upload de maps.
    SENTRY_AUTH_TOKEN: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    // Org/projeto Sentry para o upload de source maps (build-time).
    SENTRY_ORG: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    SENTRY_PROJECT: z.preprocess(emptyToUndefined, z.string().min(1).optional()),

    // --- ADR-060 (O-2b): desafio de bot no cadastro autônomo ---
    // Site key é PÚBLICA por natureza — o widget roda no browser e qualquer
    // visitante a vê no HTML. O `NEXT_PUBLIC_` não é estilo: é o que faz o Next
    // inliná-la no bundle do cliente.
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    // Secret key: SÓ servidor, usada no `siteverify`. Sem `NEXT_PUBLIC_` — com o
    // prefixo ela iria para o bundle que todo visitante baixa.
    //
    // Ausentes → o desafio não é exigido (O-2a segue protegido por rate limit e
    // pelo teto de sessões vivas). É degradação declarada, não silenciosa: a
    // ausência aparece no `/api/health` quando o O-2b passar a depender delas.
    TURNSTILE_SECRET_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  })
  .superRefine((data, ctx) => {
    // C1: at least one Supabase publishable/anon key must be present.
    // Supabase renamed keys in 2024 — accept either, require ≥1.
    if (!data.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY && !data.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'],
        message:
          'One of NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (preferred) or NEXT_PUBLIC_SUPABASE_ANON_KEY (legacy) must be set',
      });
    }

    // Runtime serverless precisa do Transaction Pooler. O Session Pooler mantém
    // uma sessão por conexão e o prefetch/concurrency da Vercel esgota rapidamente
    // o pool_size do Supabase (EMAXCONNSESSION). DATABASE_URL_PROD não entra aqui:
    // migrations e backups usam 5432 deliberadamente e são validados nos scripts.
    if (data.NODE_ENV === 'production') {
      for (const [name, value] of [
        ['DATABASE_URL', data.DATABASE_URL],
        ['DATABASE_URL_RUNTIME', data.DATABASE_URL_RUNTIME],
      ] as const) {
        if (!value) continue;
        const url = new URL(value);
        if (/\.pooler\.supabase\.com$/i.test(url.hostname) && url.port !== '6543') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [name],
            message: `${name} must use the Supabase Transaction Pooler on port 6543 in deployments`,
          });
        }
      }
    }

    // SEC-041 (auditoria adversarial 2026-09-11) — coerência de ambiente.
    // Autenticar contra um projeto Supabase e ler o banco de outro faz o
    // `clinic_id` do JWT não significar nada no banco consultado; e preview
    // apontando para produção é uma cópia pública da base real. O detalhe do
    // que é e do que NÃO é detectável daqui está em env-coherence.ts.
    for (const issue of checkEnvironmentCoherence(data)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [issue.path],
        message: issue.message,
      });
    }

    // Note: DATABASE_URL_PROD validation lives in scripts/_env.ts.assertProdContext().
    // It is NEVER read by app runtime (only by db:migrate:prod / db:backup:prod),
    // so validating it in env.ts would needlessly break `next build` whenever
    // qoro-prod doesn't exist yet (which is the case until C16).
    //
    // Note: LOGIN_HASH_PEPPER / UPSTASH_* are validated at runtime via
    // assertAuthRuntimeReady() in src/lib/auth (called by login flow), not here.
    // Same reason as DATABASE_URL_PROD: keep `next build` green pre-config.
  });

export type Env = z.infer<typeof EnvSchema>;

/**
 * Os sufixos `_DEV` existem somente para segredos locais. Nunca são aceitos em
 * produção, evitando que uma chave de desenvolvimento seja promovida por engano.
 */
function normalizeDevelopmentAliases(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (source.NODE_ENV === 'production') return source;
  // A tabela vive em `env-aliases.ts` e é compartilhada com `scripts/_env.ts`.
  // Antes ela era copiada nos dois arquivos e divergiu: as chaves do Turnstile
  // entraram aqui e não lá, o que faria um script local usar a chave de
  // PRODUÇÃO em silêncio.
  //
  // Um alias explícito prevalece localmente: assim uma chave antiga sob o nome
  // padrão não consegue redirecionar uma homologação para outra conta.
  const result: NodeJS.ProcessEnv = { ...source };
  for (const [canonical, ...aliases] of DEVELOPMENT_ENV_ALIASES) {
    // Primeiro alias com valor vence. Truthiness, não `??`: um `FOO=` no
    // `.env.local` vira STRING VAZIA, e com `??` a vazia ganharia da chave boa.
    const value = aliases.map((name) => source[name]).find(Boolean);
    if (value) result[canonical] = value;
  }
  return result;
}

function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(normalizeDevelopmentAliases(source));
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(
      `[env] Invalid environment variables:\n${issues}\n\nSee .env.example for the expected shape.`,
    );
  }
  return parsed.data;
}

export const env = loadEnv();

// Test-only helper. Exported as named import so consumers can't reach
// for a "global" mutable env in production code.
export const __internal = { loadEnv, EnvSchema, normalizeDevelopmentAliases };

/**
 * Runtime guard for C4 cron routes. Fails fast when CRON_SECRET is missing
 * — same shape as assertAuthRuntimeReady() in src/lib/auth, called only by
 * the cron/healthcheck route handlers. Keeps `next build` green pre-config.
 */
export function assertCronRuntimeReady(): void {
  if (!env.CRON_SECRET) {
    throw new Error('[env] CRON_SECRET is required at runtime for /api/cron/* routes');
  }
}

/**
 * Runtime guard for C5 crypto. Fails fast when the active secret backend is
 * missing its inputs — same shape as assertCronRuntimeReady(). Called by the
 * crypto module the first time it needs a secret, NOT at import time, so
 * `next build` stays green before secrets exist.
 */
export function resolveCryptoBackend(): 'env' | 'gcp' {
  return env.CRYPTO_SECRET_BACKEND ?? (env.NODE_ENV === 'production' ? 'gcp' : 'env');
}

export function assertCryptoRuntimeReady(): void {
  const backend = resolveCryptoBackend();
  if (backend === 'env') {
    if (!env.CRYPTO_MASTER_KEY_V1) {
      throw new Error(
        '[env] CRYPTO_MASTER_KEY_V1 is required at runtime when CRYPTO_SECRET_BACKEND=env',
      );
    }
    if (!env.CRYPTO_LOOKUP_SALT) {
      throw new Error(
        '[env] CRYPTO_LOOKUP_SALT is required at runtime when CRYPTO_SECRET_BACKEND=env',
      );
    }
  } else {
    if (
      !env.GCP_PROJECT_ID ||
      !env.GCP_SECRET_MASTER_KEY_NAME ||
      !env.GCP_SECRET_LOOKUP_SALT_NAME
    ) {
      throw new Error(
        '[env] GCP_PROJECT_ID, GCP_SECRET_MASTER_KEY_NAME and GCP_SECRET_LOOKUP_SALT_NAME are required when CRYPTO_SECRET_BACKEND=gcp',
      );
    }
  }
}

/**
 * Runtime guard for C10 messaging routes. Fails fast when the Meta webhook
 * secrets are missing — same shape as assertCronRuntimeReady(). Called by the
 * webhook route handler, NOT at import time, so `next build` stays green before
 * secrets exist. The per-clinic access token is NOT here (it lives encrypted in
 * the DB); these two are app-level (1 Meta app validates all webhooks).
 */
export function assertMessagingRuntimeReady(): void {
  if (!env.META_APP_SECRET) {
    throw new Error('[env] META_APP_SECRET is required at runtime for /api/webhooks/meta');
  }
  if (!env.META_WEBHOOK_VERIFY_TOKEN) {
    throw new Error(
      '[env] META_WEBHOOK_VERIFY_TOKEN is required at runtime for /api/webhooks/meta',
    );
  }
}

/**
 * Runtime guard for F2 WhatsApp Embedded Signup (conexão self-service pelo owner).
 * Falha cedo, SERVER-SIDE, quando falta config do Embedded Signup — nunca deixa
 * o popup do Meta falhar silenciosamente no browser. Chamado pelas Server Actions
 * de connect/disconnect e pela página /configuracoes/whatsapp, NÃO no import
 * (next build verde antes do setup). META_APP_SECRET reusa o secret do webhook.
 */
export function assertWhatsappOnboardingReady(): void {
  if (!env.META_APP_ID || !env.META_CONFIG_ID || !env.META_APP_SECRET) {
    throw new Error(
      '[env] META_APP_ID, META_CONFIG_ID e META_APP_SECRET são obrigatórios para a conexão self-service do WhatsApp (Embedded Signup)',
    );
  }
}

/**
 * Runtime guard for C11 AI Agent. Fails fast when GEMINI_API_KEY is missing —
 * same shape as assertMessagingRuntimeReady(). Called by the GeminiProvider on
 * first use, NOT at import time, so `next build` stays green before the secret
 * exists (e o handler do outbox falha retentável, não no boot).
 */
export function assertAiRuntimeReady(): void {
  if (!env.GEMINI_API_KEY) {
    throw new Error('[env] GEMINI_API_KEY is required at runtime for the AI agent (C11)');
  }
}

/**
 * Runtime guard for C13 Billing — fails fast when ASAAS_API_KEY is missing.
 * Called pelo adapter Asaas no primeiro uso, NÃO no import (next build verde
 * antes do secret). O handler/cron falha retentável, não no boot.
 */
export function assertBillingRuntimeReady(): void {
  if (!env.ASAAS_API_KEY) {
    throw new Error('[env] ASAAS_API_KEY is required at runtime for billing (C13)');
  }
}

/** Runtime guard for the Asaas webhook route — exige o token de validação. */
export function assertBillingWebhookReady(): void {
  if (!env.ASAAS_WEBHOOK_TOKEN) {
    throw new Error('[env] ASAAS_WEBHOOK_TOKEN is required at runtime for /api/webhooks/asaas');
  }
}

/** Runtime guard do e-mail transacional, usado pelo worker de exportação LGPD. */
export function assertEmailRuntimeReady(): void {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    throw new Error(
      '[env] RESEND_API_KEY and EMAIL_FROM are required at runtime for transactional email',
    );
  }
}

/**
 * Runtime guard for C15 impersonate — exige o segredo HMAC do cookie. Chamado
 * pelas Server Actions de impersonate, NÃO no import (next build verde antes do
 * secret existir).
 */
export function assertImpersonationRuntimeReady(): void {
  if (!env.IMPERSONATION_SECRET) {
    throw new Error('[env] IMPERSONATION_SECRET is required at runtime for impersonate (C15)');
  }
}

/**
 * Runtime guard do onboarding (convite mágico) — exige o segredo HMAC do token.
 * Chamado pelas actions de convite/`/join`, NÃO no import.
 */
export function assertOnboardingRuntimeReady(): void {
  if (!env.MAGIC_TOKEN_SECRET) {
    throw new Error('[env] MAGIC_TOKEN_SECRET is required at runtime for onboarding invites');
  }
}

/** R1: modo efetivo do prompt snapshot (default por ambiente). */
export function resolveAiSnapshotMode(): 'off' | 'full' | 'sample' {
  return env.AI_SNAPSHOT_MODE ?? (env.NODE_ENV === 'production' ? 'sample' : 'full');
}

// C14: a prontidão dos templates Meta é checada POR JOB no processor
// (TemplateNotConfiguredError → job failed com reason), não num guard de rota —
// mantém os 3 crons proactive-* desacoplados (um template ausente não derruba
// os outros tipos).
