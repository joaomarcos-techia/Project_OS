# app/(admin) — Platform Admin (C15)

Painel operacional do fundador (admin.qoro.dev — gestão da plataforma inteira).
**Status:** entregue (C15). Acesso exclusivo a `super_admin` com AAL2.

## Acesso (OR-A1/A2)
`guardAdminAccess()` (`admin/_lib/guard.ts`) chama `requireSuperAdmin()` (super_admin + AAL2)
e traduz qualquer falha em `notFound()` (404 — NUNCA redirect/401/403). Chamado no layout
**e** no topo de cada page/route handler.

## Rotas (exatamente as 9 do brief)
`/admin` · `/admin/clinicas` · `/admin/clinicas/[id]` · `/admin/billing` ·
`/admin/conversas-ia` · `/admin/metricas` · `/admin/audit` · `/admin/saude` · `/admin/config`
+ endpoint `GET /admin/clinicas/[id]/audit/export`.

## Camadas
- `_lib/repositories/*.repo.ts` — ÚNICO ponto que toca `dbAdmin` por área (MV-ready).
- `_lib/services/*` — AuditExportService (PDF+SHA256+signed URL), HealthService (probe ativo).
- `_lib/conversation-content.ts` — ÚNICO ponto que decifra conversa da IA (ver abaixo).
- Escritas: só de nível de plataforma (sessão de suporte, convites, flags e anúncios, gestão de
  feedback, exports e o registro de abertura de conversa), todas com linha em
  `super_admin_actions` via `superAdminAction`/`superAdminAuditedRead`. Read-only sobre dados de
  clínica é garantido por `_lib/admin-read-only.test.ts` (arch test).

## Conversas IA (S-01, ADR-073)
`/admin/conversas-ia` mostra metadado de qualquer conversa (autor, horário, intent, tools,
modelo, latência). O TEXTO só aparece com sessão de suporte ativa para a MESMA clínica, e cada
abertura grava `ai_conversation.content_viewed` em `super_admin_actions` na mesma transação da
leitura (fail-closed). Trava estática em `_lib/conversation-content.test.ts`: dentro do
`(admin)`, decifrar só ali e no CNPJ da clínica (`clinics.repo.ts`).

## Impersonate
Cookie assinado (`qoro_imp`) + tabela autoritativa `impersonation_sessions` (TTL 1h, kill
switch via `revoked_at`). Módulo: `src/lib/impersonation`. Escopo efetivo resolvido em
`tenant-context.requireClinicId()`. Banner permanente em `(app)/(shell)` durante a sessão.
Toda mutação no impersonate gera audit extra (referência) em `super_admin_actions`.

## Setup (deploy)
- env `IMPERSONATION_SECRET` (≥32 chars) — assina o cookie.
- bucket privado `admin-exports` no Supabase Storage (signed URL 7 dias).
- migração `0028_*` (impersonation_sessions + GRANT INSERT super_admin_actions p/ authenticated).
