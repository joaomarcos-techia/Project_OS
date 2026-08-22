# Limitações conhecidas e validações pendentes

## Status

Canonical — fatos confirmados no código e bordas que não podem ser inferidas. Não é um roadmap comercial.

## Limitações confirmadas

| Item | Classificação | Evidência/efeito |
| --- | --- | --- |
| Z-API | `NOT_IMPLEMENTED` | skeleton lança em todos os métodos; selecionar `zapi` não envia/recebe |
| OpenAI | `NOT_IMPLEMENTED` | placeholder lança `openai_not_implemented` |
| Compensação do onboarding | `PARTIALLY_IMPLEMENTED` | cancelamento Asaas best-effort; não existe cron `onboarding-reconcile` |
| Secret Manager GCP | `PARTIALLY_IMPLEMENTED` | loader existe, mas SDK não está declarado em `package.json`/lockfile |
| Checkout de cartão | `IMPLEMENTED_WITH_CONSTRAINT` | PAN/CVV passam pelo Server Action; sem tokenização client-side/hosted checkout |
| CSP | `IMPLEMENTED_WITH_CONSTRAINT` | header atual é `Content-Security-Policy-Report-Only` |
| E2E no CI | `NOT_IMPLEMENTED` | workflow executa Vitest/build, não Playwright |
| Playwright local completo | `KNOWN_LIMITATION` | três specs `production-*` lançam guard de host em localhost em vez de fazer `skip` |
| Logs de dois specs PROD | `STALE_TEST_DIAGNOSTIC` | `dashboard-financial-rbac` e `whatsapp-settings-rbac` passam pelas assertivas corretas, mas imprimem flags/resultados legados invertidos |
| Node local | `INCONSISTENT_CONFIG` | `.nvmrc` diz 20; `package.json` e CI exigem 22 |
| Runtime fail-closed | `REQUIRES_MANUAL_VALIDATION` | `DATABASE_URL_RUNTIME` sem `BYPASSRLS` depende de role externo |
| Migration `0051` | `DRIFT_CONFIRMED` | timestamp/ordem coincidem no DEV, mas o hash aplicado não corresponde ao arquivo nem a LF/CRLF; objetos atuais foram confirmados |
| Trigger de plano | `LEAST_PRIVILEGE_GAP` | `bump_plan_claims_version()` é `SECURITY DEFINER` com `PUBLIC EXECUTE` no DEV; corrigir por nova migration |
| Templates Meta | `EXTERNAL_DRIFT` | `cobranca_amigavel` ausente; reminder/follow-up aprovados como `MARKETING`, não `UTILITY` |
| E-mail | `OPERATIONAL_RISK` | 33 dos 100 envios mais recentes da conta Resend observada estavam `bounced`; vínculo integral com PROD é incerto |
| Signed URLs | `KNOWN_LIMITATION` | URL já emitida pode continuar válida até TTL/cache expirar |
| Cash-flow rollup | `KNOWN_LIMITATION` | janela padrão de três dias pode não recomputar estorno muito antigo sem operação ampliada |

Adicionar o SDK GCP é dependência de produção e requer confirmação explícita; esta refatoração documental não o adiciona.

## Estado externo a validar por ambiente

- migrations `0000`–`0079`, grants/policies e role runtime em produção; DEV foi validado;
- Data API desabilitada quando a arquitetura exige somente backend;
- buckets, privacidade, CORS e políticas Storage;
- crons ativos, heartbeats recentes e timezone operacional;
- primeira cobrança/settlement real Asaas; cobranças atuais continuam pendentes;
- atribuição dos e-mails Resend ao deploy e causa dos bounces;
- Sentry, Better Stack e teste real dos canais de alerta;
- restore isolado de um backup recente;
- deploy/commit e variáveis corretas em Preview/Production.

## Não criar por inferência

Não há evidência atual para plano `Pro+`, billing Stripe, failover Z-API, media/STT/TTS no agente, API pública, attachments em feedback ou editor visual de workflow. Eles não são roadmap oficial.
