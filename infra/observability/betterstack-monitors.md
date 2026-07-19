# Better Stack — spec versionada dos monitores (achado C1)

> Esta é a **definição** dos monitores de uptime. A criação é manual (a API do
> Better Stack não justifica Terraform para 3 monitores), mas a spec vive aqui
> para ser revisável em PR e reproduzível numa conta nova.
>
> Passo a passo de aplicação + **teste de disparo**:
> [`docs/runbooks/alerting-setup.md`](../../docs/runbooks/alerting-setup.md).

Placeholders: `<PROD_URL>` = domínio de produção · `<CRON_SECRET>` = valor real.

---

## Monitor 1 — Saúde geral da aplicação

| Campo | Valor |
|---|---|
| Nome | `Qoro · app health` |
| URL | `<PROD_URL>/api/health?strict=1` |
| Método | `GET` |
| Header | `Authorization: Bearer <CRON_SECRET>` |
| Intervalo | 3 min |
| Sucesso | HTTP `200` |
| Alerta | HTTP `503`, timeout, ou 2 falhas consecutivas |
| Severidade | **CRÍTICO** → canal que interrompe |

**O que cobre:** app no ar + `db` + `outbox` dentro do SLO + **dependências
externas realmente alcançáveis**.

> ⚠️ **`?strict=1` implica `?deep=1`** desde 2026-07-18 (achado C2). Antes, os
> checks de gemini/meta/asaas só verificavam se a variável de ambiente existia —
> um apagão do WhatsApp com a key configurada reportava `ok` e este monitor
> ficava **verde durante o incidente**. Agora ele paga um probe real (timeout 2s,
> cache 60s). É por isso que o monitor usa `strict`: é ele quem precisa enxergar.

## Monitor 2 — Fila / anti-falha-silenciosa

| Campo | Valor |
|---|---|
| Nome | `Qoro · outbox queue` |
| URL | `<PROD_URL>/api/health/outbox?strict=1` |
| Header | `Authorization: Bearer <CRON_SECRET>` |
| Intervalo | 3 min |
| Alerta | HTTP `503` |
| Severidade | **CRÍTICO** → canal que interrompe |

**Alarmes que produzem o 503:** `outbox_failed>0`, `pending_age>300s`,
`processing_age>600s`, `idem_orphans>0`, `<parent>_default_rows>0`,
`<parent>_months_ahead<1`, `db_pool_saturation>80%`.

**Por que um monitor separado do #1:** a falha mais perigosa de um SaaS de
WhatsApp é a **silenciosa** — tudo responde 200, mas a fila parada significa
lembrete e resposta de IA não enviados. Merece disparo próprio mesmo com o
Monitor 1 verde.

## Monitor 3 — Auth Hook

| Campo | Valor |
|---|---|
| Nome | `Qoro · auth hook` |
| URL | `<PROD_URL>/api/health/auth-hook` |
| Header | `Authorization: Bearer <CRON_SECRET>` |
| Intervalo | 15 min |
| Alerta | HTTP ≠ `200` |
| Severidade | **CRÍTICO** (sem o hook, ninguém loga com claims) |

> ⚠️ Esta rota **passou a exigir o header** na auditoria de APIs (go-live #2.a).
> Um monitor criado antes disso alarma falso. Se ele está vermelho sem incidente,
> é o header que falta.

---

## Escalonamento (todos)

Notificação em canal que **interrompe** (ligação/SMS/push/Telegram), repetindo a
cada 5 min até ack. **E-mail sozinho não cumpre "acordar o operador"** — foi
exatamente essa a lacuna que manteve o go-live #2 aberto.

## Log drain

✅ Ativo desde 2026-07-16. Sem ele as saved searches não têm dados.

⚠️ **Toda busca exige o prefixo `message.`** — o Better Stack aninha o JSON da
aplicação sob `message`. Sem o prefixo a busca retorna vazio, o que é
indistinguível de "está tudo bem". Foi assim que as 5 primeiras saved searches
do projeto passaram meses erradas.

Lista das buscas: [`docs/runbooks/log-search.md`](../../docs/runbooks/log-search.md).
