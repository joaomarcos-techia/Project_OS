# Deploy, observabilidade e retenção

## Status

Canonical — operação versionada; não é prova de saúde atual.

## Source of Truth

`.github/workflows`, `vercel.json`, `next.config.ts`, `src/lib/observability`, `infra/observability`, health routes e crons.

## Build e deploy

- runtime exigido pelo manifesto/CI: Node 22.x e pnpm 11.17;
- Vercel instala com lockfile congelado e executa `pnpm build`;
- CI roda audit de dependências de produção, typecheck, lint, arquitetura, migrations, observabilidade, registry, cobertura e build;
- Playwright não roda no CI atual;
- deploy bem-sucedido não prova provider, banco, Storage, cron ou jornada autenticada.

Variáveis são validadas em `src/lib/env.ts`; veja [environment](../development/environment.md). `APP_BASE_URL` precisa apontar ao host canônico para links de convite.

## Observabilidade

- logger estruturado em stdout com request/trace ids;
- Sentry para errors/traces e tunnel `/monitoring`;
- métricas de aplicação e agregados em `system_metrics_daily`;
- `cron_heartbeats` registra execução;
- endpoints `/api/health`, `/api/health/auth-hook` e `/api/health/outbox` têm exposições distintas;
- specs Better Stack ficam em `infra/observability`; criação de monitores é manual.

Em 2026-08-18, os três endpoints operacionais do deploy responderam 200 com autenticação: health profundo `ok`, outbox estrito sem alarmes e auth hook `ok`. Os 13 jobs diários/frequentes tinham heartbeat `success`; `audit-partitions` e `data-retention` são mensais e ainda não tinham heartbeat no ciclo atual.

Isso não prova notificação: a API Sentry não pôde ser lida com os tokens locais e não há credencial Better Stack. Regra, canal e teste de disparo continuam `REQUIRES_MANUAL_VALIDATION`.

Buscas operacionais: [log-search](../runbooks/log-search.md). SLOs: [c16/slo](../c16/slo.md).

## Retenção implementada

| Dado | Retenção/ação |
| --- | --- |
| outbox terminal | purge após 30 dias |
| login attempts | 90 dias |
| conversas/mensagens de IA | `expires_at`, padrão 30 dias |
| inbound bruto | 90 dias |
| outbound | 180 dias |
| status raw | 90 dias |
| convite incompleto | anonimizado após 30 dias |
| audit/AI partitions | criadas/retidas por cron e policy |

Idempotency keys usam TTL próprio do caso de uso; não aplicar uma retenção global arbitrária.

## Backups

Workflow `db-backup.yml` agenda `pg_dump` diário às 06:00 UTC com PostgreSQL 17, exclui schemas gerenciados do Supabase, cifra o artefato com GPG AES-256 e retém o artifact por 30 dias. Existência do workflow não prova execução nem restauração; faça restore test em ambiente isolado.

Evidência de 2026-08-18: os dez últimos runs agendados estavam verdes. O run do dia produziu dump de 2.731.974 bytes e artifact cifrado de 530.326 bytes, com expiração em 2026-09-17. Nenhum restore foi executado nesta auditoria.

## Release evidence

Para cada gate, reporte `PASS`, `FAIL`, `BLOCKED` ou `NOT TESTED` e identifique o nível:

1. código/teste local;
2. CI;
3. deploy;
4. configuração externa;
5. jornada real autenticada/provider.

Não use mock, bypass ou teste desabilitado para liberar uma borda externa. Matriz completa: [production-readiness](../runbooks/production-readiness.md).

## Incidentes

Triagem e cenários de Meta, Gemini, Asaas, Redis, LGPD e super-admin estão em [incident-response](../runbooks/incident-response.md). Desastre/restore em [disaster-recovery](../runbooks/disaster-recovery.md).
