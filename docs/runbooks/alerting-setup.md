# Runbook — Ligar o alerting (fecha o go-live #2)

> **Status:** Ativo · **Owner:** João Marcos (Qoro) · **Última revisão:** 2026-07-18 · **Próxima revisão:** 2027-01-18
>
> ↩︎ Volta para o [índice de runbooks](./README.md) · [índice mestre](../README.md).

> Achado **C1** — o mais crítico da [auditoria de monitoramento](../achados/auditoria-monitoramento-producao.md):
> *"um outage total pode não notificar ninguém"*.

## O problema em uma frase

A instrumentação existe; **a notificação não**. Sem canal, toda a
instrumentação vira uma caixa-preta que só é lida se alguém abrir o dashboard —
e a detecção passa a depender de um cliente reclamar.

**Cenário concreto:** sexta 23h, o worker do outbox começa a falhar em 100%
(rotação de secret quebrou o acesso à Meta). Lembretes e respostas de IA param.
Tudo responde HTTP 200. Sem alerta, o problema aparece **segunda de manhã**,
quando as clínicas ligam.

## Pré-requisitos

- [x] Log drain do Better Stack ativo (2026-07-16).
- [ ] Um canal que **interrompe**: push do app Better Stack, Telegram, SMS ou
      ligação. **E-mail não serve** — não acorda ninguém.

---

## Passo 1 — Monitores de uptime (Better Stack)

Crie os 3 monitores de [`infra/observability/betterstack-monitors.md`](../../infra/observability/betterstack-monitors.md).

Para cada um: **Monitors → Create monitor** → URL + método → **Request headers**
→ `Authorization: Bearer <CRON_SECRET>` → intervalo → **On-call escalation** →
canal.

⚠️ Sem o header, os três retornam **401** e o monitor alarma falso para sempre.

## Passo 2 — Regras do Sentry

```bash
cd infra/observability
export SENTRY_AUTH_TOKEN=...
export TF_VAR_notify_target=<seu-usuário-ou-canal>
terraform init && terraform apply
```

Sem Terraform, as duas regras estão descritas em
[`sentry-alerts.tf`](../../infra/observability/sentry-alerts.tf) e podem ser
criadas à mão em **Alerts → Create Alert** — os campos são os mesmos.

## Passo 3 — Saved searches

Crie as buscas de [`log-search.md`](./log-search.md). **Confirme que cada uma
retorna linha antes de salvar.**

---

## Passo 4 — TESTAR O DISPARO (o passo que não se pula)

> **Um alerta não testado não é um alerta.** O go-live #2 ficou aberto por
> semanas com as regras "criadas" — o que faltava era ter visto a notificação
> chegar. Esta seção é a Definition of Done.

### 4.1 Uptime → 503 → notificação

Em **staging** (ou na janela barata de prod, enquanto há 1 clínica de teste):
remova temporariamente uma env externa (ex.: `GEMINI_API_KEY`) e chame:

```
GET <URL>/api/health?strict=1
Authorization: Bearer <CRON_SECRET>
```

Esperado: **503** com `checks.gemini: "degraded"` → o monitor vira DOWN → **a
notificação chega no seu telefone**. Reponha a env depois.

- [ ] Notificação recebida. Anote o tempo entre o 503 e a chegada — **é o seu
      MTTD real** ([slo.md](../c16/slo.md): alvo < 5 min para SEV1).

### 4.2 Sentry → issue → notificação

Force uma exceção num caminho de background (um payload malformado que passe do
parse num webhook de staging).

Esperado: issue no Sentry **com stack trace e tag `flow`** → Regra 1 dispara.

- [ ] Issue apareceu **com stack** (não `{name, message}` pelado).
- [ ] Notificação recebida.

> Este teste só passa desde a ADR-045. Antes, exceção de background nunca chegava
> ao Sentry — o catch emitia métrica e devolvia 500 sem rethrow.

### 4.3 Fila parada

Pare o worker em staging (ou insira um `outbox` com `status='failed'`) e chame
`/api/health/outbox?strict=1`.

- [ ] 503 + notificação do Monitor 2.

---

## Passo 5 — Registrar

- [ ] Marcar o item **#2** em [go-live-checklist.md](../c16/go-live-checklist.md)
      com a data e **evidência do disparo** (print da notificação), não só "feito".

---

## Manutenção

- **Recalibrar após ~4 semanas** de tráfego real (INFO-1): os thresholds atuais
  não têm histórico. Threshold nunca revisitado vira ruído ou cegueira.
- **Alerta que dispara e ninguém age** deve ser removido ou ter o threshold
  corrigido — não silenciado. Ver [alert-tuning.md](./alert-tuning.md).

## Veja também

- [`infra/observability/`](../../infra/observability/README.md) — por que o alerting é código.
- [alert-tuning.md](./alert-tuning.md) · [log-search.md](./log-search.md) · [incident-response.md](./incident-response.md)
