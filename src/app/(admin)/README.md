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
- `actions/impersonation.ts` + `clinicas/[id]/audit/export/route.ts` — ÚNICAS escritas
  (platform-level: super_admin_actions / impersonation_sessions). Read-only sobre dados de
  clínica é garantido por `_lib/admin-read-only.test.ts` (arch test).

## Impersonate
Cookie assinado (`qoro_imp`) + tabela autoritativa `impersonation_sessions` (TTL 1h, kill
switch via `revoked_at`). Módulo: `src/lib/impersonation`. Escopo efetivo resolvido em
`tenant-context.requireClinicId()`. Banner permanente em `(app)/(shell)` durante a sessão.
Toda mutação no impersonate gera audit extra (referência) em `super_admin_actions`.

## Setup (deploy)
- env `IMPERSONATION_SECRET` (≥32 chars) — assina o cookie.
- bucket privado `admin-exports` no Supabase Storage (signed URL 7 dias).
- migração `0028_*` (impersonation_sessions + GRANT INSERT super_admin_actions p/ authenticated).
