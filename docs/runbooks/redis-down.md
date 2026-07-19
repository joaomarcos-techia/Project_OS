# Runbook — Redis (Upstash) indisponível

> **Status:** Ativo · **Owner:** João Marcos (Qoro) · **Última revisão:** 2026-07-18 · **Próxima revisão:** 2027-01-18
>
> ↩︎ Volta para o [índice de runbooks](./README.md) · [índice mestre](../README.md).

> Achado **M3** da [auditoria de monitoramento](../achados/auditoria-monitoramento-producao.md).
> A DR cobria só o banco; o Redis não tinha runbook — e é a peça cuja falha é
> **silenciosa por design**.

## 0. Por que este runbook existe (leia uma vez)

O rate limiting é **fail-open**: se o Upstash cai, a requisição **passa**. Isso é
deliberado (ADR-008 F-08) — derrubar o login inteiro porque o Redis piscou seria
pior. Mas a consequência é que, sob outage, o sistema **continua servindo sem
proteção de brute-force** e, até 2026-07-18, **ninguém ficava sabendo**.

Combinado com a ausência de telemetria de auth (achado A1, também fechado agora),
um ataque durante um outage de Redis seria **invisível**: sem trip de rate-limit,
sem falha de login registrada, sem status de Redis.

## 1. Detectar

| Sinal | O que significa |
|---|---|
| `GET /api/health?deep=1` → `checks.redis: degraded` | Upstash inalcançável, credencial inválida, ou env ausente |
| `message.event:"auth.ratelimit.degraded"` (Better Stack) | O limiter caiu para o fallback local per-instância. `reason_category`: `network` \| `server` \| `other` |
| Ausência súbita de `auth.ratelimit.tripped` sob tráfego alto | Suspeito: o limiter deveria estar bloqueando alguém |

⚠️ O prefixo **`message.`** é obrigatório nas buscas do Better Stack — sem ele a
query volta vazia e parece que o sinal não existe.

## 2. Diagnosticar (em ordem)

1. **Painel do Upstash** → status da database + cota. A causa mais comum não é
   outage: é **cota estourada** no plano free. O código não vê o status HTTP da
   cota — só o erro. Por isso o painel é o passo 1, não o 3.
2. `GET /api/health?deep=1` com `Authorization: Bearer <CRON_SECRET>` → confirma
   se é alcançabilidade ou credencial.
3. Se `redis: degraded` mas o painel está verde → suspeite de env
   (`UPSTASH_REDIS_REST_URL` / `_TOKEN` ausentes ou rotacionados sem redeploy).

## 3. Resolver

| Causa | Ação |
|---|---|
| **Cota estourada (free)** | Upgrade do plano OU aguardar a janela. Enquanto isso, §4. |
| **Token rotacionado sem redeploy** | Repor em Vercel → Environment Variables → redeploy. Ver [secret-rotation.md](./secret-rotation.md). |
| **Outage real do Upstash** | Nada a fazer no código — acompanhar o status do provedor e aplicar §4. |
| **Env ausente em ambiente novo** | `UPSTASH_REDIS_REST_URL` + `_TOKEN` (ver `.env.example`). |

## 4. Mitigação enquanto o Redis não volta

O fallback local per-instância **ainda limita**, mas por instância — num deploy
serverless com N instâncias o teto efetivo é ~N× o configurado. Não é proteção
contra brute-force distribuído.

Se houver sinal de ataque durante o outage:

- Monitore `message.event:"auth.login.failed"` — o volume é o indicador.
- Considere o **WAF da Vercel** (rate-limit de borda) nas rotas de auth como
  medida temporária: é a única camada que não depende do Upstash.
- **Não** desative o login. O fail-open é preferível a indisponibilidade total —
  mas essa escolha só é defensável enquanto alguém está olhando.

## 5. Pós-incidente

- Registre a duração e a `reason_category` predominante.
- Se a degradação for **recorrente**, ela deixou de ser excepcional e vira
  violação do SLO nº7 ([slo.md](../c16/slo.md)) — reavalie plano/arquitetura do
  Upstash, não o threshold do alerta.

---

## Veja também

- [slo.md §7](../c16/slo.md) — SLO de degradação do rate-limit.
- [alert-tuning.md](./alert-tuning.md) — thresholds de `auth.ratelimit.degraded`.
- [incident-response.md](./incident-response.md) — fluxo geral.
- ADR-008 (F-08) — por que fail-open.
