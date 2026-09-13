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

## Estado informado pelo fundador — 2026-09-12

**Sentry em produção: funcionando. Monitores das APIs de saúde no Better Stack: funcionando.**
Informado pelo fundador em 12/09/2026, ao revisar a [ADR-060](../adr/060-sessao-anonima-de-cadastro.md).

Isto **corrige a leitura** que a evidência de 18/08 (abaixo) induzia. Aquela nota registra que a API do
Sentry recusou os **tokens locais** e que não havia credencial Better Stack *naquela tentativa* — é
sobre as credenciais daquela sessão de validação, não sobre o ambiente. Ela foi lida aqui como se o
alerting inteiro estivesse sem prova, e não está.

O que segue valendo da nota antiga: **caminho de alerta não exercitado não conta como proteção**. Por
isso a ADR-060 escolheu pendurar o sinal de pressão do cadastro no `/api/health` — que os monitores já
vigiam — em vez de criar uma regra de limiar sobre linha de log, que seria caminho novo.

Pendente de registro: quais monitores existem, desde quando e para qual canal escalam.

## Evidência — 2026-08-18

Os três targets do deploy responderam 200 e o health profundo estava `ok`. A API Sentry respondeu 401/403 aos tokens locais e não havia credencial Better Stack; nenhuma regra, canal ou notificação foi inspecionada/disparada. Estado do alerta fim a fim: `NOT_TESTED`.
