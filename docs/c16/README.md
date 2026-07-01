# C16 — Observabilidade, Hardening e Production Readiness

> **Status:** Ativo · **Owner:** João Marcos (Qoro) · **Última revisão:** 2026-07-01 · **Próxima revisão:** 2027-01-01
>
> ↩︎ Volta para o [índice mestre](../README.md).


Camada que torna o ClinicaOS **operável em produção por uma única pessoa**:
visibilidade de erros, rastreabilidade, alertas acionáveis, recuperação testada,
segurança validada e documentação operacional — **sem criar funcionalidade nova de produto**.

> Premissa-chave: ~70% do que a C16 pede **já existe** e é production-grade. O foco é
> construir só os gaps reais e **não refazer** infra existente. Veja a reconciliação completa em
> [`c16-inventory.md`](./c16-inventory.md).

## Documentos

| Arquivo | Conteúdo |
|---|---|
| [`c16-inventory.md`](./c16-inventory.md) | **FASE 0** — inventário do que existe, pontos críticos de erro, integrações, gaps e o mapa Gap → Fase → Onda |
| `slo.md` (Onda 1) | SLO/SLI — alvos formais (99.5% disponibilidade, API P95 <500ms, webhook <30s, IA <2%) |

## Decisões

- **Logging:** logger fino in-house (reusa `sanitizePayload` + request/correlation id, JSON→stdout, gated por `LOG_LEVEL`). Sem Pino.
- **Erros:** Sentry (client/server/edge).
- **Busca de logs:** Vercel Log Drain → Better Stack (Logtail).

## Roadmap em ondas

A FASE 0 (este inventário) está concluída. As ondas abaixo são a sequência de implementação:

- **Onda 1 — Fundação:** `slo.md` (SLO/SLI) · error envelope + `x-request-id` no middleware · logger in-house · Sentry · `/api/health` unificado (com SLIs de fila `outbox_depth`/`oldest_age`/`failed_rate`).
- **Onda 2 — Agregação/Métricas:** Better Stack (log drain + saved searches) · uptime monitors · `system_metrics_daily` + cron `metrics-rollup` · cleanup de `idempotency_keys` · `archive-old-messages`.
- **Onda 3 — Ops & Hardening:** runbooks faltantes (incl. `alert-tuning.md` anti alert-fatigue e `disaster-recovery.md` com **RPO ≤ 24h / RTO ≤ 4h**) · security headers + **CSP faseada** (sempre Report-Only primeiro) · teste de isolamento multi-tenant · LGPD gate · ADRs da C16.
- **Onda 4 — Validação:** failure drills (Sentry <1min, Gemini down → health degraded, restore PITR/dump, audit hash, prompt injection) · **production rehearsal** (clínica fake percorrendo cadastro → WhatsApp → agenda → IA → financeiro → export LGPD → delete → restore).

**Critério de conclusão:** SLOs definidos e medidos · Sentry ok · logs pesquisáveis ·
alertas com janela/threshold · runbooks escritos · incidentes simulados · production
rehearsal completo · checklist de segurança 100% · LGPD 100% · backup restaurado ·
uptime ativo · `/api/health` confiável.

> O roadmap detalhado (com paths e critérios por item) está no plano de implementação
> aprovado: `~/.claude/plans/plano-de-a-o-drifting-cascade.md`.
