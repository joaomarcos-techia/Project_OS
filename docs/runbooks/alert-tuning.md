# Runbook — Alert Tuning (anti alert-fatigue)

> **Status:** Ativo · **Owner:** João Marcos (Qoro) · **Última revisão:** 2026-07-01 · **Próxima revisão:** 2027-01-01
>
> ↩︎ Volta para o [índice de runbooks](./README.md) · [índice mestre](../README.md).


> C16 FASE 9 / GAP 2. Como definir alertas que **valem a pena acordar alguém**.
> Thresholds derivam dos SLOs em [slo.md](../c16/slo.md).

## Regra de ouro

> **Nunca alertar por evento isolado.** Sempre janela + threshold (ou burn-rate de SLO).

| ❌ Ruim | ✅ Bom |
|---|---|
| 1 erro Gemini → alerta | Gemini error **> 5% em 10 min** |
| 1 resposta 5xx → alerta | 5xx **> 1% das requests em 5 min** |
| 1 evento outbox `failed` → página | `oldest_pending_age_s > 300s` **por 10 min** OU `failed` crescendo |
| qualquer latência alta | API **P95 > 500ms por 10 min** |
| 1 `auth.ratelimit.degraded` → alerta | degradação **sustentada OU intermitente-recorrente** (ver abaixo) |

## Degradação do rate-limit de auth (`auth.ratelimit.degraded`)

O rate-limit de login/reset/join é **fail-open** (ADR-008 F-08): se o Upstash cair ou rejeitar
comandos, cai para um limiter local per-instância (~N× mais fraco) e emite
`auth.ratelimit.degraded` (métrica + `logger.warn`) com `reason_category`. Sem alerta, essa
degradação — a defesa de brute-force enfraquecendo — é **invisível** (auditoria Redis R1).

- **Sustentada** (incidente agudo): `auth.ratelimit.degraded` **> N em 10 min** → **ALERTA**.
- **Intermitente/recorrente** (dente-de-serra): o padrão "10 eventos → para → 10 eventos" **não**
  dispara um threshold de janela única. Segunda regra por **recorrência**: presente em **≥ X
  janelas de 10 min distintas em 24 h** (ou contagem diária acima de limiar) → **ALERTA**.
- **Triagem por `reason_category`:**
  - `server` — o endpoint Upstash **respondeu** erro. A causa mais comum em escala é **429/cota
    esgotada** (a lib `@upstash/redis` descarta o status HTTP, então não dá p/ isolar cota de
    outros erros no código — **confirmar no painel de cota do Upstash**). Ação: **dimensionar o
    tier ao pico** (sair do free antes de a cota virar gargalo); rejeição de auth (token) após
    rotação também cai aqui.
  - `network` — falha de transporte (Upstash inacessível / timeout). Ação: tratar como
    dependência externa degradada (incidente Upstash).
- **Ação do alerta:** este runbook. Objetivo: não deixar a degradação virar crônica sem ninguém
  perceber.

## Severidade → canal
- **CRÍTICO** (acorda): app down, `db: down`, fila parada (SLO de fila estourado), suspeita de breach, webhook de pagamento falhando em série.
- **ALERTA** (horário útil): dependência externa degradada, aproximando do limite do SLO, custo de IA acima do orçamento.
- **INFO** (sem notificação, só dashboard): deploys, picos pontuais que voltaram sozinhos.

## Onde configurar
- **Sentry** (erros): alertas por *issue volume* e *crash rate*, não por ocorrência única. Agrupe por fingerprint. Rotas críticas (auth, webhooks) = CRÍTICO.
- **Better Stack** (logs/uptime): alerta quando uma saved search (ver [log-search.md](./log-search.md)) passa de N ocorrências numa janela, e quando `/api/health?strict=1` fica 503 por ≥ X min.

## Burn-rate (error budget)
Disponibilidade 99.5% → budget de 0.5% / 28 dias (~3h36). Alerte quando:
- **rápido**: consumo de > 2% do budget em 1h (incidente agudo) → CRÍTICO.
- **lento**: consumo de > 10% do budget em 24h (degradação contínua) → ALERTA.

## Higiene
- Todo alerta tem **uma ação clara** (link para o runbook). Sem ação → não é alerta, é dashboard.
- Hysteresis: threshold de disparo ≠ de resolução (evita flapping).
- Suprima alertas dependentes durante um incidente conhecido (se `db: down`, não precisa de 30 alertas de "query falhou").
- Revise mensalmente: alerta que dispara e ninguém age → ajuste ou remova.
