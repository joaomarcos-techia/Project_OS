# Variáveis de ambiente

## Status

Canonical — mapa sem valores. `src/lib/env.ts` é o contrato executável.

## Regras

- Nunca registre valores reais em documentação, log ou commit.
- Variável presente em `.env.example` mas ausente de `env.ts` não é automaticamente runtime.
- Scripts podem validar variáveis adicionais próprias; leia o script antes de executar.
- Em Preview/Production, `APP_BASE_URL`, `VERCEL_ENV` e `SUPABASE_PROJECT_ENV` evitam cruzamento de ambiente.

## Grupos runtime

| Grupo | Variáveis principais |
| --- | --- |
| Banco | `DATABASE_URL`, `DATABASE_URL_PROD`, `DATABASE_URL_RUNTIME` |
| Supabase público | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` |
| Supabase privilegiado | `SUPABASE_SECRET_KEY` (aliases legados ainda aceitos) |
| Ambiente/log | `NODE_ENV`, `VERCEL_ENV`, `APP_BASE_URL`, `VERCEL_AUTOMATION_BYPASS_SECRET`, `LOG_LEVEL`, `SUPABASE_PROJECT_ENV` |
| Auth | `LOGIN_HASH_PEPPER`, `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD` |
| Redis | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` |
| Cron/outbox | `CRON_SECRET`, `CRON_SECRET_DESTRUCTIVE`, `OUTBOX_*` |
| Crypto | `CRYPTO_MASTER_KEY_V1`, `CRYPTO_MASTER_KEY_V2`, `MASTER_KEY_VERSION`, `CRYPTO_LOOKUP_SALT`, `CRYPTO_SECRET_BACKEND` |
| GCP secrets | `GCP_PROJECT_ID`, `GCP_SECRET_MASTER_KEY_NAME`, `GCP_SECRET_LOOKUP_SALT_NAME` |
| Meta | `META_APP_ID`, `META_APP_SECRET`, `META_CONFIG_ID`, `META_WEBHOOK_VERIFY_TOKEN`, `META_GRAPH_API_VERSION`, `META_HTTP_TIMEOUT_MS` |
| Gemini | `GEMINI_API_KEY`, `GEMINI_MODEL`, `AI_HTTP_TIMEOUT_MS`, `AI_MONTHLY_COST_LIMIT_USD`, `AI_SNAPSHOT_MODE` |
| Asaas | `ASAAS_API_KEY`, `ASAAS_BASE_URL`, `ASAAS_WEBHOOK_TOKEN`, `ASAAS_HTTP_TIMEOUT_MS` |
| E-mail | `RESEND_API_KEY`, `EMAIL_FROM` |
| Templates Meta | `META_TEMPLATE_CONFIRMATION_REMINDER_ID`, `META_TEMPLATE_DUNNING_FRIENDLY_ID`, `META_TEMPLATE_FOLLOWUP_RETURN_ID`, `META_TEMPLATE_WAITLIST_OFFER_ID`, `META_TEMPLATE_DEPOSIT_LINK_ID`, `META_TEMPLATE_REMAINDER_LINK_ID`, `META_TEMPLATE_LANG` |
| Tokens internos | `IMPERSONATION_SECRET`, `MAGIC_TOKEN_SECRET` |
| Sentry | `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` |

## Ambiente DEV

O loader aceita somente os aliases DEV declarados em `src/lib/env.ts` e os normaliza para o nome runtime. Sufixos arbitrários, como `META_APP_ID1`, não são aliases e são ignorados pela aplicação. Não use alias DEV em produção nem credencial PROD em smoke local.

## Requisitos condicionais

- `DATABASE_URL`, URL/chave pública Supabase são exigidas no carregamento comum.
- produção exige separação/validação adicional de banco.
- Preview com Vercel Authentication exige `VERCEL_AUTOMATION_BYPASS_SECRET` para o auto-registro de
  webhooks de paciente; o valor vai somente no query param server-to-server enviado ao Asaas.
- backends `env` e `gcp` de crypto exigem conjuntos diferentes de secrets.
- providers opcionais falham quando a ação correspondente é chamada sem configuração.

Consulte [integrações](../integrations/providers.md) para distinguir variável aceita de provider funcional.
