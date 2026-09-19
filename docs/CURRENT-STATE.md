# Estado atual verificável

## Status

Canonical — fotografia do repositório em 2026-08-18, no commit-base `d414191`.

## Scope

Separa implementação versionada de estado externo. Para detalhes, siga os links; este arquivo não replica contratos.

## Implementação atual

| Área | Estado | Evidência principal |
| --- | --- | --- |
| Aplicação web | `IMPLEMENTADO` | Next.js App Router em `src/app` |
| Multi-tenancy | `IMPLEMENTADO` | `withTenant`, RLS forçada e migrations |
| Auth/RBAC | `IMPLEMENTADO` | Supabase Auth, 6 roles, 28 permissões e claims epoch |
| Onboarding | `IMPLEMENTADO` | convite mágico e saga Asaas/Auth/Postgres em `/join/[token]` |
| Pacientes/LGPD | `IMPLEMENTADO` | cadastro, PII cifrada, consentimento, export/delete e hard-delete |
| Agenda | `IMPLEMENTADO` | disponibilidade, estados, recursos, recorrência, import, fila e waitlist |
| Prontuário/documentos | `IMPLEMENTADO` | SOAP cifrado, assinatura imutável, correção legal e PDFs privados |
| Financeiro da clínica | `IMPLEMENTADO` | lançamentos, pagamentos, estornos, conciliação e fluxo de caixa |
| WhatsApp Meta | `IMPLEMENTADO` | conexão, webhook, inbound/outbound, templates e health check |
| Agente Gemini | `IMPLEMENTADO` | pipeline, 15 tools, confirmação em dois turnos e handoff |
| Billing Asaas | `IMPLEMENTADO` | onboarding, assinatura, webhook, reconciliação, dunning e troca de plano |
| Feedback | `IMPLEMENTADO` | autor privado por `userId`; super-admin global |
| Admin de plataforma | `IMPLEMENTADO` | clínicas, billing, feedback, IA, métricas, auditoria e saúde |
| Outbox/crons | `IMPLEMENTADO` | worker transacional e 15 rotas agendadas em `vercel.json` |
| Z-API | `NOT_IMPLEMENTED` | provider skeleton lança `ProviderNotImplementedError` |
| OpenAI | `NOT_IMPLEMENTED` | provider placeholder lança `openai_not_implemented` |

## Regras que resolvem contradições antigas

- Existem somente os planos `solo`, `clinica` e `pro`; `Pro+` não existe.
- O trial do onboarding é de 14 dias.
- Assentos são a única quota rígida. Agendamentos e conversas de IA são métricas; permissões granulares são recurso de Clínica/Pro.
- Asaas é o único provider de billing. Stripe não integra o produto.
- Gemini é o runtime de IA. Não há arquitetura multi-LLM operacional.
- Meta Cloud API é o único provider de mensagens funcional. Selecionar `zapi` falha explicitamente.
- A marca Qoro e o nome técnico ClinicaOS referem-se ao mesmo produto/repositório.

## Evidência externa atual

Snapshot conectado de 2026-08-18, sem mutações em clientes:

- DEV usado pelo localhost: migrations, grants, RLS, `qoro_runtime` e isolamento comportamental validados; há drift real no hash da migration `0051`;
- deploy PROD: health profundo/outbox/auth hook aprovados, crons frequentes saudáveis e Storage privado confirmado;
- Meta: canal, webhook, inbound/outbound e callbacks de entrega reais; três templates aprovados e um ausente;
- Gemini live e Asaas API/webhook/reconcile aprovados;
- Resend tem domínio verificado e entregas reais na conta observada;
- backup diário tem dez runs consecutivos verdes e artifact cifrado atual;
- três specs Playwright read-only autenticadas passaram em `app.qoro.dev`: RBAC financeiro do dashboard, reconciliação operacional do dashboard e RBAC das configurações WhatsApp.

Continuam `REQUIRES_MANUAL_VALIDATION`: migrations/RLS/role runtime em PROD, primeira cobrança/settlement Asaas, atribuição e bounces de e-mail PROD, regras/canais Sentry/Better Stack, teste de disparo de alerta, restore isolado, Data API e a matriz E2E autenticada completa além dos três controles read-only executados.

Consulte [limitações conhecidas](roadmap/known-limitations.md) e [produção](runbooks/production-readiness.md) antes de uma decisão de release.
