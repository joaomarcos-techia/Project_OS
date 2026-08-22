# Configuração de alertas

## Status

Reference — infraestrutura versionada, ativação manual.

## Source of Truth

`infra/observability/betterstack-monitors.md`, métricas/log events no código e [SLO](../c16/slo.md).

## Processo

1. crie saved searches exatamente como [log-search](log-search.md);
2. configure monitores de health, cron heartbeat, outbox failed/backlog, provider/circuit e erros 5xx;
3. vincule canal real e owner/escalation;
4. dispare evento/probe controlado e confirme recebimento;
5. registre data/ambiente, sem segredo.

Spec em Markdown não prova monitor criado. `REQUIRES_MANUAL_VALIDATION` até o teste de disparo.

## Evidência — 2026-08-18

Os três targets do deploy responderam 200 e o health profundo estava `ok`. A API Sentry respondeu 401/403 aos tokens locais e não havia credencial Better Stack; nenhuma regra, canal ou notificação foi inspecionada/disparada. Estado do alerta fim a fim: `NOT_TESTED`.
